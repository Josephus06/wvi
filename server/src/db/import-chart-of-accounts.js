// Loads the company's Chart of Accounts from a TSV/CSV export.
//
// Expected columns (header row required, order-independent, case-insensitive):
//   Account Code | Account Name | Category | Sub-Category | Description
//
// Two tables are populated:
//   chart_of_account_types -- one row per Category+Sub-Category pair. The reports read
//     account_type / account_sub_type / normal_balance from HERE (joined via coa_type_id),
//     not from chart_of_accounts, and they compare against UPPERCASE names, so the
//     category is normalised on the way in.
//   chart_of_accounts       -- one row per account, linked to its type.
//
// Idempotent: matching on account_code, existing accounts are updated rather than
// duplicated, so re-running after editing the sheet is the intended way to make changes.
//
//   node src/db/import-chart-of-accounts.js <file.tsv> --dry-run
//   node src/db/import-chart-of-accounts.js <file.tsv>
const fs = require('fs');
const pool = require('../db');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));

// Spreadsheet category -> what the reports group by. INCOME/EXPENSE drive the Income
// Statement; ASSET/LIABILITY/EQUITY drive the Balance Sheet.
//
// "Contra Asset" (Accumulated Depreciation) is deliberately given a DEBIT normal balance,
// even though accounting convention calls it a credit-normal account.
//
// The reports derive which SIDE of the balance sheet an account lands on from
// normal_balance, not from account_type (see groupRoots/balanceSheet in lib/reportsEngine.js:
// asset_total is the debit side, liability_equity_total the credit side). Marking it CREDIT
// therefore parks Accumulated Depreciation in the liability/equity column -- arithmetically
// balanced, but not a balance sheet anyone wants to read. With DEBIT its natural credit
// balance comes through as a negative under Non-Current Assets, which is the conventional
// presentation and nets total assets down correctly.
//
// The sub-type is still suffixed so it shows as its own line under assets rather than
// merging into the plain "Non-Current Asset" group.
const CATEGORY = {
  'asset': { type: 'ASSET', normal: 'DEBIT', display: 'Asset' },
  'contra asset': { type: 'ASSET', normal: 'DEBIT', display: 'Asset', subSuffix: ' (Contra)' },
  'liability': { type: 'LIABILITY', normal: 'CREDIT', display: 'Liability' },
  'equity': { type: 'EQUITY', normal: 'CREDIT', display: 'Equity' },
  'revenue': { type: 'INCOME', normal: 'CREDIT', display: 'Revenue' },
  'income': { type: 'INCOME', normal: 'CREDIT', display: 'Revenue' },
  'cost of sales': { type: 'EXPENSE', normal: 'DEBIT', display: 'Expense' },
  'expense': { type: 'EXPENSE', normal: 'DEBIT', display: 'Expense' },
};

function parseRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('File is empty.');
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const head = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const col = (...names) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iCode = col('account code', 'code');
  const iName = col('account name', 'account title', 'name');
  const iCat = col('category', 'type');
  const iSub = col('sub-category', 'sub category', 'sub-type', 'sub type');
  const iDesc = col('description');
  if (iCode === -1 || iName === -1 || iCat === -1) {
    throw new Error(`Need at least Account Code, Account Name and Category columns. Saw: ${head.join(' | ')}`);
  }
  return lines.slice(1).map((l) => {
    const c = l.split(delim);
    const get = (i) => (i === -1 || c[i] === undefined ? '' : c[i].trim());
    return {
      code: get(iCode),
      name: get(iName),
      category: get(iCat),
      sub: get(iSub) || 'General',
      description: get(iDesc) || null,
    };
  }).filter((r) => r.code && r.name);
}

async function main() {
  if (!FILE) { console.error('Usage: node src/db/import-chart-of-accounts.js <file.tsv> [--dry-run]'); process.exit(1); }
  console.log(`Database: ${process.env.DB_NAME} on ${process.env.DB_HOST}`);
  console.log(`Source:   ${FILE}`);
  console.log(DRY_RUN ? 'DRY RUN -- reporting only.\n' : 'APPLYING changes.\n');

  const rows = parseRows(fs.readFileSync(FILE, 'utf8'));
  console.log(`Parsed ${rows.length} account(s).`);

  const unknown = [...new Set(rows.map((r) => r.category.toLowerCase()).filter((c) => !CATEGORY[c]))];
  if (unknown.length) {
    console.error(`\nUnrecognised Category value(s): ${unknown.join(', ')}`);
    console.error(`Known: ${Object.keys(CATEGORY).join(', ')}`);
    process.exit(1);
  }

  // --- account types -----------------------------------------------------------------
  const subTypeOf = (r) => r.sub + (CATEGORY[r.category.toLowerCase()].subSuffix || '');
  const typeKey = (r) => {
    const c = CATEGORY[r.category.toLowerCase()];
    return `${c.type}||${subTypeOf(r)}||${c.normal}`;
  };
  const wanted = [...new Set(rows.map(typeKey))];
  const typeIdByKey = new Map();
  let typesCreated = 0;

  for (const key of wanted) {
    const [type, sub, normal] = key.split('||');
    const [[found]] = await pool.query(
      'SELECT id FROM chart_of_account_types WHERE account_type = ? AND account_sub_type = ? AND normal_balance = ?',
      [type, sub, normal]
    );
    if (found) { typeIdByKey.set(key, found.id); continue; }
    typesCreated += 1;
    if (DRY_RUN) { typeIdByKey.set(key, null); console.log(`  + would create type ${type} / ${sub} (${normal})`); continue; }
    const [res] = await pool.query(
      'INSERT INTO chart_of_account_types (account_type, account_sub_type, normal_balance) VALUES (?, ?, ?)',
      [type, sub, normal]
    );
    typeIdByKey.set(key, res.insertId);
    console.log(`  + type ${type} / ${sub} (${normal})`);
  }
  console.log(`\n${typesCreated} account type(s) ${DRY_RUN ? 'would be ' : ''}created, ${wanted.length - typesCreated} already present.`);

  // --- accounts ----------------------------------------------------------------------
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const cat = CATEGORY[r.category.toLowerCase()];
    const coaTypeId = typeIdByKey.get(typeKey(r));
    const [[existing]] = await pool.query('SELECT id FROM chart_of_accounts WHERE account_code = ?', [r.code]);
    if (existing) {
      updated += 1;
      if (DRY_RUN) continue;
      await pool.query(
        `UPDATE chart_of_accounts
            SET account_name = ?, account_type = ?, coa_type_id = ?, description = ?,
                detail_type = ?, is_summary = 0, is_active = 1, updated_at = NOW()
          WHERE id = ?`,
        [r.name, cat.display, coaTypeId, r.description, subTypeOf(r), existing.id]
      );
    } else {
      created += 1;
      if (DRY_RUN) continue;
      // Every account in the sheet is postable -- there are no header/roll-up accounts, so
      // is_summary stays 0 and nothing is parented. (The Journal account picker hides
      // is_summary=1 rows, so getting this wrong would hide accounts from data entry.)
      await pool.query(
        `INSERT INTO chart_of_accounts
           (account_code, account_name, account_type, parent_account_id, is_active,
            coa_type_id, description, detail_type, is_summary)
         VALUES (?, ?, ?, NULL, 1, ?, ?, ?, 0)`,
        [r.code, r.name, cat.display, coaTypeId, r.description, subTypeOf(r)]
      );
    }
  }

  console.log(`${created} account(s) ${DRY_RUN ? 'would be ' : ''}created, ${updated} updated.`);
  if (!DRY_RUN) {
    const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM chart_of_accounts');
    console.log(`\nChart of Accounts now holds ${n.n} account(s).`);
  }
  await pool.end();
}

main().catch((err) => { console.error('Import failed:', err.message); process.exit(1); });
