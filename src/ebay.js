// Reads an eBay CSV report into sale rows.
// Works with:
//  - Payments > Reports > Transaction report (includes fees and postage labels) — recommended
//  - Seller Hub > Orders > Download report (no fee columns)
// Column names are matched loosely because eBay changes them from time to time.
const { parseCsv } = require('./csv');

// eBay writes "--" in empty cells
const blank = (s) => { const t = String(s || '').trim(); return /^-+$/.test(t) ? '' : t; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

// Accepts "20 Nov 2026", "Nov 20, 2026", "20-Nov-26", "20/11/2026", "2026-11-20" (+ optional time)
function parseDate(s) {
  s = String(s || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
  if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})/)) && MONTHS[m[2].toLowerCase()])
    return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  if ((m = s.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/)) && MONTHS[m[1].toLowerCase()])
    return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`;
  return '';
}

const amount = (s) => {
  const n = Number(blank(s).replace(/[£$€,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : 0;
};

function parse(text) {
  const table = parseCsv(text);
  const headerIdx = table.findIndex((r) => r.some((c) => norm(c) === 'order number'));
  if (headerIdx === -1) throw new Error('This doesn\'t look like an eBay report — no "Order number" column found.');
  const header = table[headerIdx].map(norm);
  const col = (...names) => header.findIndex((h) => names.includes(h));
  const cols = {
    type: col('type'),
    order: col('order number'),
    date: col('transaction creation date', 'sale date', 'paid on date', 'date'),
    title: col('item title'),
    label: col('custom label', 'custom label sku'),
    qty: col('quantity'),
    subtotal: col('item subtotal', 'sold for'),
    postage: col('postage and packaging', 'postage and handling', 'shipping and handling'),
    net: col('net amount'),
  };
  if (cols.subtotal === -1) throw new Error('Couldn\'t find an "Item subtotal" or "Sold for" column in this report.');
  const feeCols = header
    .map((h, i) => (/\bfee\b/.test(h) && !/currency/.test(h) ? i : -1))
    .filter((i) => i >= 0);

  const orders = new Map();
  const labels = new Map();
  const skipped = { refunds: 0, otherFees: 0, other: 0 };

  for (const r of table.slice(headerIdx + 1)) {
    const get = (i) => (i >= 0 ? r[i] || '' : '');
    const type = norm(get(cols.type));
    const orderRef = blank(get(cols.order));
    if (!orderRef && !type) continue;

    if (type && type.startsWith('shipping label')) {
      // Postage labels bought through eBay — count as postage paid on that order
      if (orderRef) labels.set(orderRef, (labels.get(orderRef) || 0) + Math.abs(amount(get(cols.net))));
      continue;
    }
    if (type && type !== 'order') {
      if (type.startsWith('refund')) skipped.refunds++;
      else if (type.includes('fee')) skipped.otherFees++;
      else skipped.other++;
      continue;
    }
    if (!orderRef) continue;

    const fees = feeCols.reduce((a, i) => a + Math.abs(amount(get(i))), 0);
    const existing = orders.get(orderRef);
    const row = {
      orderRef,
      date: parseDate(get(cols.date)),
      title: blank(get(cols.title)),
      customLabel: blank(get(cols.label)),
      quantity: Number(get(cols.qty)) || 1,
      price: amount(get(cols.subtotal)),
      buyerPostage: amount(get(cols.postage)),
      fee: Math.round(fees * 100) / 100,
      postageCost: 0,
    };
    // Multi-line orders: keep the first line, note the rest
    if (existing) existing.extraLines = (existing.extraLines || 0) + 1;
    else orders.set(orderRef, row);
  }
  for (const [ref, cost] of labels) if (orders.has(ref)) orders.get(ref).postageCost = Math.round(cost * 100) / 100;

  return { rows: [...orders.values()], skipped };
}

module.exports = { parse, parseDate };
