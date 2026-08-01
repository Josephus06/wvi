// Parser for the laundry/water-refilling POS "CATEGORY SALES" shift report PDF, the
// document the Sales Order module's "Upload PDF" button ingests. One PDF = one shift at one
// branch, and the report is a fixed layout:
//
//   FRESH AND TIDY                        <- store name
//   CATEGORY SALES                        <- report type (verified, not guessed)
//   625/SECONDSHIFT                       <- branch code / shift name
//   OPENED: 04/29/26 11:48 AM @ CRISTY    <- shift open + cashier
//   CLOSED: 04/29/26 07:54 PM @ CRISTY    <- shift close + cashier
//   ALA CARTE ₱178.00                     <- category header: name + category total
//   2 ADD DRY 40 MINS 1-5KG @ 89.00 178.00    <- qty, description, unit price, ext amount
//   ...
//   142 TOTAL AMOUNT 6,469.00             <- total qty + grand total
//
// PDF text extraction wraps long descriptions across lines unpredictably ("2\nADD DRY 40
// MINS 1-5KG \n@ 89.00 178.00"), so nothing here may depend on line breaks: each category's
// block is collapsed to a single spaced string first and the items are then read off by the
// "@ <unit> <ext>" anchor, which is the one shape that survives the wrapping.
//
// The peso sign is what separates structure from content -- it appears only in category
// headers, never inside an item -- so the body is segmented on it before any item is read.

const PESO = '₱';

// Category header: an ALL-CAPS name immediately followed by the peso-prefixed category
// total. The name must START with a letter so a preceding item's amount ("178.00 DETERGENT")
// can never be swallowed into it.
const CATEGORY_RE = new RegExp(`([A-Z][A-Z0-9 &+.'\\-\\/]*?)\\s*${PESO}\\s*(-?[\\d,]+\\.\\d{2})`, 'g');

// One item: quantity, description, "@", unit price, extended amount. The description is
// lazy so it stops at the FIRST "@", which is what keeps descriptions containing their own
// digits ("40 MINS DRY 1-5KG", "DETERGENT 50ML") from being mis-split.
const ITEM_RE = /(\d[\d,]*)\s+(.+?)\s*@\s*(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})/g;

const FOOTER_RE = /(\d[\d,]*)\s+TOTAL\s+AMOUNT\s+(-?[\d,]+\.\d{2})/i;
const OPENED_RE = /OPENED:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s*@\s*([^\n]+)/i;
const CLOSED_RE = /CLOSED:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s*@\s*([^\n]+)/i;
const BRANCH_RE = /^\s*([A-Z0-9]+)\s*\/\s*([A-Z0-9 ]+?)\s*$/im;

function num(v) { return Number(String(v).replace(/,/g, '')); }
function collapse(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function round2(n) { return Number(n.toFixed(2)); }

// The report writes dates as MM/DD/YY. Two-digit years are this century -- the POS has no
// records predating it, so there is no ambiguous window to agonise over.
function toIsoDate(mdY) {
  const [m, d, y] = mdY.split('/').map((p) => p.trim());
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  return `${year}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
}

function to24h(time) {
  const m = /(\d{1,2}):(\d{2})\s*([AP])M/i.exec(time);
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'P') hour += 12;
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

// Parses the extracted text. Returns { ok, errors, ...parsed } -- never throws on a
// malformed document, so the caller can show the operator what didn't line up.
function parseCategorySales(rawText) {
  const text = String(rawText || '').replace(/\r/g, '');
  const errors = [];

  if (!/CATEGORY\s+SALES/i.test(text)) {
    return { ok: false, errors: ['This does not look like a CATEGORY SALES report.'] };
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const storeName = lines[0] && !/CATEGORY\s+SALES/i.test(lines[0]) ? lines[0] : null;

  const opened = OPENED_RE.exec(text);
  const closed = CLOSED_RE.exec(text);
  if (!closed) errors.push('Could not read the CLOSED date/time -- the shift date is taken from it.');

  const branch = BRANCH_RE.exec(text);

  const footer = FOOTER_RE.exec(text);
  if (!footer) errors.push('Could not find the TOTAL AMOUNT line.');

  // Body runs from the CLOSED line to the TOTAL AMOUNT line; anything outside is header or
  // the trailing reprint stamp.
  const bodyStart = closed ? closed.index + closed[0].length : 0;
  const bodyEnd = footer ? footer.index : text.length;
  const body = text.slice(bodyStart, bodyEnd);

  const headers = [...body.matchAll(CATEGORY_RE)];
  if (!headers.length) errors.push('No category headers found.');

  const categories = headers.map((h, i) => {
    const segStart = h.index + h[0].length;
    const segEnd = i + 1 < headers.length ? headers[i + 1].index : body.length;
    const segment = collapse(body.slice(segStart, segEnd));

    const items = [...segment.matchAll(ITEM_RE)].map((m) => {
      const quantity = num(m[1]);
      const unitPrice = num(m[3]);
      const amount = num(m[4]);
      return {
        quantity,
        description: collapse(m[2]),
        unit_price: unitPrice,
        amount,
        // The POS prints both the unit price and the extended amount; when they disagree the
        // report itself is the authority -- flagged rather than silently recomputed, since a
        // mismatch means the document was misread, not that the POS did bad arithmetic.
        amount_mismatch: round2(quantity * unitPrice) !== round2(amount),
      };
    });

    return { name: collapse(h[1]), total: num(h[2]), items };
  });

  for (const c of categories) {
    if (!c.items.length) {
      errors.push(`Category "${c.name}" has no readable items.`);
      continue;
    }
    const summed = round2(c.items.reduce((s, it) => s + it.amount, 0));
    if (summed !== round2(c.total)) {
      errors.push(`Category "${c.name}" totals ${c.total.toFixed(2)} but its items add up to ${summed.toFixed(2)}.`);
    }
    for (const it of c.items) {
      if (it.amount_mismatch) {
        errors.push(`"${it.description}" in ${c.name}: ${it.quantity} @ ${it.unit_price.toFixed(2)} does not equal ${it.amount.toFixed(2)}.`);
      }
    }
  }

  const allItems = categories.flatMap((c) => c.items);
  const totalQty = allItems.reduce((s, it) => s + it.quantity, 0);
  const totalAmount = round2(allItems.reduce((s, it) => s + it.amount, 0));

  if (footer) {
    const statedQty = num(footer[1]);
    const statedAmount = num(footer[2]);
    if (statedQty !== totalQty) errors.push(`Report states ${statedQty} items but ${totalQty} were read.`);
    if (round2(statedAmount) !== totalAmount) {
      errors.push(`Report states a total of ${statedAmount.toFixed(2)} but the items add up to ${totalAmount.toFixed(2)}.`);
    }
  }

  const closedDate = closed ? toIsoDate(closed[1]) : null;
  const closedTime = closed ? to24h(closed[2]) : null;
  const branchCode = branch ? branch[1] : null;
  const shift = branch ? branch[2] : null;

  return {
    ok: errors.length === 0,
    errors,
    store_name: storeName,
    branch_code: branchCode,
    shift,
    opened_date: opened ? toIsoDate(opened[1]) : null,
    opened_time: opened ? to24h(opened[2]) : null,
    opened_by: opened ? collapse(opened[3]) : null,
    closed_date: closedDate,
    closed_time: closedTime,
    closed_by: closed ? collapse(closed[3]) : null,
    categories,
    total_qty: totalQty,
    total_amount: totalAmount,
    // Natural key for one shift at one branch -- what stops the same PDF being imported
    // twice and double-counting the day's sales.
    import_key: branchCode && closedDate ? `${branchCode}/${shift}|${closedDate} ${closedTime || ''}`.trim() : null,
  };
}

// pdf-parse v2 exposes a class rather than the v1 callable module.
async function extractPdfText(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const { text } = await parser.getText();
    return text;
  } finally {
    await parser.destroy();
  }
}

module.exports = { parseCategorySales, extractPdfText };
