// On a hosted deploy (Railway) the database starts completely empty, and the server used to
// die on boot -- ensureSchema's first query is SHOW COLUMNS FROM tickets, which throws
// ER_NO_SUCH_TABLE and crash-loops the service. Fixing that meant opening a shell or a public
// database port and running bootstrap.js by hand before the app could start even once.
//
// This does it automatically, and only when there is genuinely nothing there: if the `users`
// table is absent the database has never been set up, so run the same bootstrap a human
// would have run. An existing database -- production with real data, or a dev box -- takes
// the early return and is never touched. New module migrations still need bootstrap.js run
// deliberately, which keeps deploys fast and stops a migration bug from bringing up a
// half-migrated schema on every restart.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const pool = require('../db');

const DB_DIR = __dirname;
const SERVER_ROOT = path.join(__dirname, '..', '..');

function run(script, args = []) {
  execFileSync(process.execPath, [path.join(DB_DIR, script), ...args], {
    stdio: 'inherit',
    cwd: SERVER_ROOT,
  });
}

async function tableExists(name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [name]
  );
  return rows[0].n > 0;
}

async function ensureDatabaseReady() {
  if (await tableExists('users')) return false;

  console.log('Database is empty -- running first-time bootstrap.');
  run('bootstrap.js');

  // Bootstrap creates the schema but seeds no accounts. A chart of accounts is the one thing
  // the accounting screens cannot start without, so load the company's own if the migrations
  // left it empty and a seed file is present.
  const seed = path.join(SERVER_ROOT, 'db', 'seed-data', 'chart-of-accounts.tsv');
  if (fs.existsSync(seed)) {
    const [[coa]] = await pool.query('SELECT COUNT(*) AS n FROM chart_of_accounts');
    if (coa.n === 0) {
      console.log('Chart of accounts is empty -- loading the seed file.');
      run('import-chart-of-accounts.js', [path.relative(SERVER_ROOT, seed)]);

      // Anything that resolves an account by CODE has to run again now that the accounts
      // exist. create-pos-category-accounts ran inside bootstrap above, against an empty
      // chart, so every POS category was left unmapped -- which silently costs imported
      // counter sales their entire GL entry, since revenue has nothing to split by. It is
      // idempotent, so re-running only fills the gaps it left.
      console.log('Re-seeding account mappings now that the chart exists.');
      run('create-pos-category-accounts.js');
    }
  }

  console.log('First-time bootstrap complete.');
  return true;
}

module.exports = { ensureDatabaseReady };
