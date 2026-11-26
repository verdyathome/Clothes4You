// Helpers: money, dates and UK tax years (6 April – 5 April).

function toPence(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(String(value).replace(/[£,\s]/g, ''));
  if (!Number.isFinite(n)) throw new Error(`"${value}" is not a valid amount`);
  return Math.round(n * 100);
}

const fromPence = (p) => Math.round(p) / 100;

function money(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
}

function today() {
  // London local date
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// "2026-11-26" -> "2026-27"
function taxYearOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = m > 4 || (m === 4 && d >= 6) ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function taxYearRange(label) {
  const start = Number(label.slice(0, 4));
  return { start: `${start}-04-06`, end: `${start + 1}-04-05` };
}

function ukDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// Split a purchase's total cost across its items.
// costs: array of pence values or null (null = share the remainder equally).
function allocateCost(totalPence, costs) {
  const fixed = costs.filter((c) => c !== null).reduce((a, b) => a + b, 0);
  const blanks = costs.filter((c) => c === null).length;
  const remainder = totalPence - fixed;
  if (remainder < 0) throw new Error(`Item costs (${money(fromPence(fixed))}) are more than the purchase total (${money(fromPence(totalPence))}).`);
  if (blanks === 0) {
    if (remainder !== 0) throw new Error(`Item costs add up to ${money(fromPence(fixed))} but the purchase total is ${money(fromPence(totalPence))}. Leave some item costs blank to share the difference, or correct them.`);
    return costs.slice();
  }
  const share = Math.floor(remainder / blanks);
  let extra = remainder - share * blanks; // leftover pennies go to the first blank items
  return costs.map((c) => {
    if (c !== null) return c;
    const v = share + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    return v;
  });
}

module.exports = { toPence, fromPence, money, today, isDate, taxYearOf, taxYearRange, ukDate, allocateCost };
