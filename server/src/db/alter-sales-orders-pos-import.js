// Sales Orders could only ever be created one way: an Estimate reaching final Approved
// snapshots itself into one (estimates.js), so sales_orders.estimate_id was NOT NULL.
//
// The Sales Order module now also ingests the POS "CATEGORY SALES" shift report PDF -- a
// record of counter sales that already happened at a branch. There is no estimate behind it
// and never will be: nobody quotes a walk-in laundry customer. Rather than fabricate a
// hollow Estimate purely to satisfy the FK (which would then pollute the estimates list,
// the costing screens and the GP reports with records nobody raised), relax the column, the
// same way alter-jo-nullable-so.js relaxed job_orders.sales_order_id for internal NSSO work.
// Both read paths already use LEFT JOIN estimates, so nothing downstream needs changing.
//
// pos_import_key is the natural key of one shift at one branch ("625/SECONDSHIFT|2026-04-29
// 19:54"). It is UNIQUE because the same shift genuinely does get exported more than once --
// two of the sample PDFs are byte-different files of the identical 613 FIRSTSHIFT shift --
// and importing it twice would double-count that day's revenue.
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
    await pool.query('ALTER TABLE sales_orders MODIFY COLUMN estimate_id BIGINT NULL');
    console.log('sales_orders.estimate_id -> NULL');

    if (await hasColumn('sales_orders', 'pos_import_key')) {
      console.log('sales_orders.pos_import_key already present -- skipped');
    } else {
      await pool.query('ALTER TABLE sales_orders ADD COLUMN pos_import_key VARCHAR(120) NULL AFTER estimate_id');
      await pool.query('ALTER TABLE sales_orders ADD UNIQUE KEY uniq_so_pos_import (pos_import_key)');
      console.log('sales_orders.pos_import_key added (unique)');
    }

    // The shift's own metadata, kept on the order so the imported record can be traced back
    // to the exact document and cashier without re-reading the PDF.
    for (const [col, def] of [
      ['pos_branch_code', 'VARCHAR(30) NULL'],
      ['pos_shift', 'VARCHAR(60) NULL'],
      ['pos_closed_at', 'DATETIME NULL'],
      ['pos_cashier', 'VARCHAR(100) NULL'],
      ['pos_source_file', 'VARCHAR(255) NULL'],
    ]) {
      if (await hasColumn('sales_orders', col)) {
        console.log(`sales_orders.${col} already present -- skipped`);
      } else {
        await pool.query(`ALTER TABLE sales_orders ADD COLUMN ${col} ${def}`);
        console.log(`sales_orders.${col} added`);
      }
    }

    // The existing statuses are a print-shop production pipeline -- pending_for_jo,
    // jo_in_process, pending_delivery and the rest all describe work still to be done. A POS
    // shift report is the opposite: the sale is finished, collected and walked out the door
    // before the PDF even exists, so none of those states can ever apply to it. 'recorded' is
    // added as a terminal state for imported counter sales so they never sit in anyone's
    // pending queue. Existing values are preserved exactly -- estimate-derived orders keep
    // running through the pipeline unchanged.
    await pool.query(`ALTER TABLE sales_orders MODIFY COLUMN status ENUM(
      'pending_for_jo', 'jo_in_process', 'pending_delivery', 'partially_delivered',
      'pending_billing', 'pending_billing_partially_delivered', 'billed', 'cancelled',
      'recorded'
    ) DEFAULT 'pending_for_jo'`);
    console.log("sales_orders.status -> added 'recorded'");

    // Each imported line keeps the POS category it came from ("FULL-SERVICE", "WATER
    // REFILLING"), which is the only grouping the report carries and the thing anyone
    // reading the order will want to sort by.
    if (await hasColumn('sales_order_lines', 'pos_category')) {
      console.log('sales_order_lines.pos_category already present -- skipped');
    } else {
      await pool.query('ALTER TABLE sales_order_lines ADD COLUMN pos_category VARCHAR(80) NULL');
      console.log('sales_order_lines.pos_category added');
    }

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
