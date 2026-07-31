# Setting this ERP up for a new company

This is a clone of the GSuite ERP with all company-specific branding pulled out into
configuration and the previous owner's data-migration tooling removed. It starts as an
empty system: full schema, no business records.

## 1. Database

Create the database and every table in one command:

```bash
cd server
cp .env.example .env          # then fill in DB_HOST / DB_NAME / DB_USER / DB_PASSWORD
npm install
node src/db/bootstrap.js --dry-run   # lists the 41 steps, touches nothing
node src/db/bootstrap.js             # runs them
```

`bootstrap.js` exists because the schema is not a single file: `db/schema.sql` holds the
original 116 tables and every module added since creates its own. It applies the schema,
seeds pages/lookups/admin, runs each module migration in dependency order, and registers
every page. It is idempotent — re-run it after pulling new modules to bring an existing
database up to date.

Log in with **admin / Admin123!** and change the password immediately.

## 2. Branding

All company details live in `client/src/config/company.js`, read from the environment at
build time. Copy `client/.env.example` to `client/.env` and fill it in:

```
VITE_COMPANY_NAME="Acme Imaging Corp."
VITE_COMPANY_SHORT="ACME"
VITE_COMPANY_DEMONYM="Acme Team"
VITE_COMPANY_TAGLINE="Your tagline here"
VITE_COMPANY_ADDRESS1="123 Example St."
VITE_COMPANY_ADDRESS2="City, Country"
VITE_COMPANY_PHONE="#000-0000"
VITE_COMPANY_WEBSITE="www.example.com"
VITE_COMPANY_BANKS="BPI Savings # 0000-0000|BDO Checking # 0000-0000"
VITE_NATIVE_API_BASE="https://api.example.com"
```

These are inlined by Vite at build time, so set them **before** `npm run build`.

Images to replace in `client/public/`:

| File | Used for |
| --- | --- |
| `favicon.svg` | browser tab icon |
| `chat-icon.gif` | support-chat mascot |
| login collage images | login screen background |

## 3. Deploy

Push to your own GitHub repo, then point a Railway (or equivalent) project at it with its
own database. Set the same `DB_*` and `VITE_*` variables there. Migrations are **not**
run automatically on deploy — run `railway run node src/db/bootstrap.js` once after the
first deploy, and again whenever a new module migration lands.

## What was removed

The 33 files that pulled data from the previous owner's legacy site: all `import-*`
scripts, the `liveEstimateSync`/`liveStatusSync` libraries, the `/api/admin` sync routes,
and the "Sync from Source" buttons. Nothing in the running app depended on them.

## Known gaps

- **Stock Ledger has no data source.** In the original system that page was fed by an
  importer from a legacy site, not computed from transactions. `bootstrap.js` creates the
  table empty so the page renders instead of erroring, but it will stay empty until it is
  reimplemented against this system's own inventory movements.
- **Chart of accounts is empty.** The GL posts to account codes (10006 Undeposited Funds,
  24200, 30611, and so on) that the accounting modules expect to exist. Set up the chart
  of accounts before using any accounting document, or those postings will fail.
- **Job types, processes and materials are empty.** Estimates cost from these, so
  production/costing needs them defined before the first estimate.
- `align-nstdjo-master-data.js` is skipped by bootstrap: it expects the previous owner's
  own job types ("FILE PREPARATION LAYOUT", "SITE INSPECTION"). Adapt it if the NSTDJO
  layout flow needs equivalent job types here.
