const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
  const dbName = process.env.DB_NAME || 'gsuite_erp';
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.changeUser({ database: dbName });

    const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    // schema.sql uses plain CREATE TABLE, so applying it twice fails. Bootstrap is meant to
    // be re-runnable to bring an existing database up to date, so treat an already-populated
    // database as done rather than an error -- the later module migrations are all guarded.
    const [[{ tableCount }]] = await connection.query(
      'SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = ?', [dbName]
    );
    if (tableCount > 0) {
      console.log(`Database "${dbName}" already has ${tableCount} table(s) -- skipping schema.sql.`);
      return;
    }

    console.log(`Applying schema to database "${dbName}"...`);
    // schema.sql is not in dependency order -- vendor_bills references bill_credits about 20
    // tables before bill_credits is created, among others. That never surfaced while the
    // database already existed, but it makes the file unusable against an empty one. Turning
    // FK checks off for the load is the standard fix for a bulk schema import: the
    // constraints are still declared, they just aren't validated table-by-table on the way in.
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await connection.query(sql);
    } finally {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    console.log('Schema applied successfully.');
  } finally {
    await connection.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
