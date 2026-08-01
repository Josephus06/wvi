// The Sales Order line grid for imported counter sales becomes a daily cash & collections
// summary -- one row per DATE, with the columns the operator's own sheet uses:
//
//   DATE | CASH | COLLECTED CASH | GCASH | COLLECTED GCASH |
//   COLLECTED BANK DEPOSIT/COLLECTED SALES | TOTAL DAILY SALES |
//   TOTAL CASH TO BE DEPOSITED | TOTAL GCASH | UNCOLLECTED SALES |
//   VAT EX | VAT 12% | VAT (INC.)
//
// These live on sales_order_lines rather than in a table of their own because they ARE the
// line grid for this kind of order -- the same rows the view already renders, just different
// columns. Every one is nullable: an estimate-derived order fills the job/quantity columns
// and leaves these empty, an imported one does the reverse. Nothing existing is touched.
//
// sales_orders.sales_layout says which set of columns a given order's lines actually use, so
// the view never has to infer it from which fields happen to be non-null.
const pool = require('../db');

const LINE_COLUMNS = [
  ['sale_date', 'DATE NULL'],
  ['cash', 'DECIMAL(14,2) NULL'],
  ['collected_cash', 'DECIMAL(14,2) NULL'],
  ['gcash', 'DECIMAL(14,2) NULL'],
  ['collected_gcash', 'DECIMAL(14,2) NULL'],
  // The sheet's "COLLECTED BANK DEPOSIT/COLLECTED SALES" -- one column, two names.
  ['collected_bank_deposit', 'DECIMAL(14,2) NULL'],
  ['total_daily_sales', 'DECIMAL(14,2) NULL'],
  ['total_cash_to_deposit', 'DECIMAL(14,2) NULL'],
  ['total_gcash', 'DECIMAL(14,2) NULL'],
  ['uncollected_sales', 'DECIMAL(14,2) NULL'],
  // VAT EX is the net-of-VAT figure, VAT 12% the tax on it, VAT (INC.) the gross.
  ['vat_ex', 'DECIMAL(14,2) NULL'],
  ['vat_12', 'DECIMAL(14,2) NULL'],
  ['vat_inc', 'DECIMAL(14,2) NULL'],
];

async function hasColumn(table, column) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return row.n > 0;
}

async function addColumn(table, column, definition) {
  if (await hasColumn(table, column)) {
    console.log(`${table}.${column} already present -- skipped`);
    return;
  }
  await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`${table}.${column} added`);
}

(async () => {
  try {
    for (const [col, def] of LINE_COLUMNS) {
      await addColumn('sales_order_lines', col, def);
    }

    // One Z-Reading = one shift = one row, and a single order collects several shifts (a
    // branch runs a first and second shift, and an order can span a whole period). So the
    // "already imported" key belongs on the LINE, not the order -- unique, because
    // re-importing a shift would double-count that day's takings.
    if (await hasColumn('sales_order_lines', 'pos_import_key')) {
      console.log('sales_order_lines.pos_import_key already present -- skipped');
    } else {
      await pool.query('ALTER TABLE sales_order_lines ADD COLUMN pos_import_key VARCHAR(120) NULL');
      await pool.query('ALTER TABLE sales_order_lines ADD UNIQUE KEY uniq_sol_pos_import (pos_import_key)');
      console.log('sales_order_lines.pos_import_key added (unique)');
    }
    for (const [col, def] of [
      ['pos_branch_code', 'VARCHAR(30) NULL'],
      ['pos_shift', 'VARCHAR(60) NULL'],
      ['pos_cashier', 'VARCHAR(100) NULL'],
      ['pos_beginning_or', 'VARCHAR(40) NULL'],
      ['pos_ending_or', 'VARCHAR(40) NULL'],
    ]) {
      await addColumn('sales_order_lines', col, def);
    }

    // 'estimate' is the existing print-shop shape (job type, quantity, GP) and stays the
    // default so every order already in the system keeps rendering exactly as it does now.
    await addColumn(
      'sales_orders',
      'sales_layout',
      "VARCHAR(30) NOT NULL DEFAULT 'estimate' AFTER pos_import_key"
    );

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
