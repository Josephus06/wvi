// An imported counter-sales Sales Order debits Undeposited Funds -- money taken at the till
// that has not reached the bank yet. So it needs the same two-state life as a Customer
// Payment: it lands UNDEPOSITED, and a Bank Deposit sweeps it into a bank account and flips
// it to DEPOSITED. Same statuses, same deposit_id link, same Deposit button.
//
// 'recorded' from the first cut of this feature is kept in the enum so nothing that already
// used it breaks, but imports now land on 'undeposited' instead.
const pool = require('../db');

async function hasColumn(table, column) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return row.n > 0;
}

(async () => {
  try {
    await pool.query(`ALTER TABLE sales_orders MODIFY COLUMN status ENUM(
      'pending_for_jo', 'jo_in_process', 'pending_delivery', 'partially_delivered',
      'pending_billing', 'pending_billing_partially_delivered', 'billed', 'cancelled',
      'recorded', 'undeposited', 'deposited'
    ) DEFAULT 'pending_for_jo'`);
    console.log("sales_orders.status -> added 'undeposited', 'deposited'");

    if (await hasColumn('sales_orders', 'deposit_id')) {
      console.log('sales_orders.deposit_id already present -- skipped');
    } else {
      await pool.query('ALTER TABLE sales_orders ADD COLUMN deposit_id BIGINT NULL');
      console.log('sales_orders.deposit_id added');
    }

    const [r] = await pool.query(
      "UPDATE sales_orders SET status = 'undeposited' WHERE sales_layout = 'daily_collections' AND status = 'recorded'"
    );
    console.log(`re-stated ${r.affectedRows} existing counter-sales order(s) as undeposited`);

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
