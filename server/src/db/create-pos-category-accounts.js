// An imported counter-sales Sales Order posts to the GL, unlike an estimate-derived one
// (which posts when it is invoiced, not when it is ordered). The entry follows the
// operator's own remarks:
//
//   with payment                    -> Dr Undeposited Funds
//   if no payment                   -> Dr AR Trade
//   with payment/for laundry        -> Cr Service Revenue - Laundry
//   with payment/for water refilling-> Cr Service Revenue - Water Refilling
//
// Splitting revenue between laundry and water refilling needs the Z-Reading's own category
// breakdown (ALA CARTE, DETERGENT, DRY, FABCON, FULL-SERVICE, SELF-SERVICE, WATER
// REFILLING), which the import reads but had nowhere to keep -- sales_order_lines holds one
// row per SHIFT, and a shift has many categories. Hence sales_order_line_categories.
//
// pos_category_accounts is the mapping from a POS category to the revenue account it
// credits. A table rather than a hardcoded list because the POS gains categories over time
// and adding one should be a data change, not a code change. An unmapped category is
// reported rather than quietly folded into laundry -- misfiled revenue is worse than a
// visible gap.
const pool = require('../db');

// Codes are from the consolidated Wu Ventures chart: 30110 Service Revenue - Laundry,
// 30120 Service Revenue - Water Refilling. Everything the laundry POS sells other than
// water is laundry revenue.
const DEFAULT_MAPPING = [
  ['WATER REFILLING', '30120'],
  ['ALA CARTE', '30110'],
  ['DETERGENT', '30110'],
  ['DRY', '30110'],
  ['FABCON', '30110'],
  ['FULL-SERVICE', '30110'],
  ['SELF-SERVICE', '30110'],
];

(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS sales_order_line_categories (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      sales_order_line_id BIGINT NOT NULL REFERENCES sales_order_lines(id),
      category_name VARCHAR(80) NOT NULL,
      amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_solc_line (sales_order_line_id)
    )`);
    console.log('sales_order_line_categories ready');

    await pool.query(`CREATE TABLE IF NOT EXISTS pos_category_accounts (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      category_name VARCHAR(80) NOT NULL UNIQUE,
      account_id BIGINT NULL REFERENCES chart_of_accounts(id),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL
    )`);
    console.log('pos_category_accounts ready');

    // Seeded by account CODE, resolved here -- a chart that numbers its revenue accounts
    // differently simply ends up with the row unmapped rather than pointing at whatever
    // account happened to take that id.
    for (const [category, code] of DEFAULT_MAPPING) {
      const [[account]] = await pool.query('SELECT id FROM chart_of_accounts WHERE account_code = ?', [code]);
      if (!account) {
        console.log(`  ${category}: account ${code} not in this chart -- left unmapped`);
        continue;
      }
      const [[existing]] = await pool.query('SELECT id FROM pos_category_accounts WHERE category_name = ?', [category]);
      if (existing) {
        console.log(`  ${category}: already mapped -- left as is`);
        continue;
      }
      await pool.query('INSERT INTO pos_category_accounts (category_name, account_id) VALUES (?, ?)', [category, account.id]);
      console.log(`  ${category} -> ${code}`);
    }

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
