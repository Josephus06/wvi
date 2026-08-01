// A Vendor Bill could only ever be raised from a received Purchase Order's "Bill" button:
// vendor_bills.purchase_order_id was NOT NULL and every vendor_bill_lines row pointed at a
// purchase_order_line and an inventory item. The real system also has a standalone
// "Add Vendor Bill" form (#/vendor_bill_crud, reached from the Saved Vendor Bills list)
// whose lines are general-ledger EXPENSE lines against arbitrary Chart of Accounts entries
// -- no PO, no item, no qty -- the same shape bill_credit_lines already uses. Rather than a
// second pair of tables, relax the PO columns and add the expense-line columns so both kinds
// of bill live in vendor_bills/vendor_bill_lines and everything downstream (Bill Payment,
// Bill Credit, A/P aging, GL Impact) keeps working off the same rows.
//
// A standalone bill needs its own supplier_id because there is no PO to inherit the vendor
// from. Existing PO-linked rows keep supplier_id NULL and still resolve through the PO.
const pool = require('../db');

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
    await pool.query('ALTER TABLE vendor_bills MODIFY COLUMN purchase_order_id BIGINT NULL');
    console.log('vendor_bills.purchase_order_id -> NULL');
    await addColumn('vendor_bills', 'supplier_id', 'BIGINT NULL AFTER purchase_order_id');

    await pool.query('ALTER TABLE vendor_bill_lines MODIFY COLUMN purchase_order_line_id BIGINT NULL');
    console.log('vendor_bill_lines.purchase_order_line_id -> NULL');
    await pool.query('ALTER TABLE vendor_bill_lines MODIFY COLUMN item_id BIGINT NULL');
    console.log('vendor_bill_lines.item_id -> NULL');
    // Expense lines carry their own debit account and free-text description in place of the
    // item/purchase_description a PO line would have supplied.
    await addColumn('vendor_bill_lines', 'account_id', 'BIGINT NULL AFTER item_id');
    await addColumn('vendor_bill_lines', 'description', 'VARCHAR(255) NULL AFTER account_id');

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
