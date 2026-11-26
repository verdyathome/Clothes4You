// Business logic: purchases, items, sales, refunds, expenses, imports and figures.
const db = require('./db');
const { TABLES, SA103, EXPENSE_TYPES, SALE_COST_CATEGORIES, MILEAGE_RATE } = require('./config');
const { toPence, fromPence, allocateCost, taxYearOf, taxYearRange, today, isDate, money } = require('./util');

const T = TABLES;
const num = (v) => Number(v) || 0;
const sumP = (arr, f) => arr.reduce((a, r) => a + toPence(typeof f === 'function' ? f(r) : r[f]), 0);

// ---------- Purchases ----------
async function createPurchase(p, itemRows, user) {
  const totalPence = toPence(p.TotalCost);
  if (totalPence <= 0) throw new Error('Enter the total amount paid for this purchase.');
  const rows = itemRows.filter((r) => r.Description && r.Description.trim());
  if (rows.length === 0) throw new Error('Add at least one item to the purchase.');
  const allocated = allocateCost(
    totalPence,
    rows.map((r) => (r.Cost === undefined || r.Cost === '' ? null : toPence(r.Cost)))
  );

  const purchase = await db.insert(T.purchases.name, {
    PurchaseDate: p.PurchaseDate,
    Supplier: (p.Supplier || '').trim(),
    SourceType: p.SourceType,
    PaymentMethod: p.PaymentMethod,
    TotalCost: fromPence(totalPence),
    ItemCount: rows.length,
    ReceiptRef: (p.ReceiptRef || '').trim(),
    Notes: (p.Notes || '').trim(),
    TaxYear: taxYearOf(p.PurchaseDate),
    CreatedBy: user,
  });

  for (let i = 0; i < rows.length; i++) {
    await createItem(
      { ...rows[i], Ownership: 'Business', PurchaseID: purchase.PurchaseID, CostAllocated: fromPence(allocated[i]), DateAdded: p.PurchaseDate },
      user
    );
  }
  return purchase;
}

const listPurchases = (taxYear) => db.select(T.purchases.name, taxYear ? { TaxYear: taxYear } : {}, 'PurchaseDate DESC');

async function getPurchase(id) {
  const [p] = await db.select(T.purchases.name, { PurchaseID: Number(id) });
  return p;
}

// ---------- Items ----------
async function createItem(i, user) {
  return db.insert(T.items.name, {
    Description: i.Description.trim(),
    Brand: (i.Brand || '').trim(),
    Size: (i.Size || '').trim(),
    Category: i.Category || '',
    Condition: i.Condition || '',
    Ownership: i.Ownership === 'Personal' ? 'Personal' : 'Business',
    PurchaseID: i.PurchaseID ?? null,
    CostAllocated: i.Ownership === 'Personal' ? 0 : num(i.CostAllocated),
    Status: 'In stock',
    ListedOn: '',
    DateAdded: i.DateAdded || today(),
    Notes: (i.Notes || '').trim(),
    CreatedBy: user,
  });
}

async function listItems(filter = {}) {
  const f = {};
  if (filter.status) f.Status = filter.status;
  if (filter.ownership) f.Ownership = filter.ownership;
  return db.select(T.items.name, f, 'ItemID DESC');
}

const unsoldItems = async () => (await listItems()).filter((i) => i.Status === 'In stock' || i.Status === 'Listed');

async function getItem(id) {
  const [item] = await db.select(T.items.name, { ItemID: Number(id) });
  return item;
}

async function updateItemStatus(id, status, listedOn) {
  const fields = { Status: status };
  if (listedOn !== undefined) fields.ListedOn = listedOn;
  return db.update(T.items.name, { ItemID: Number(id) }, fields);
}

// ---------- Sales ----------
async function createSale(s, user) {
  const item = await getItem(s.ItemID);
  if (!item) throw new Error('Item not found.');
  if (item.Status === 'Sold') throw new Error(`Item #${item.ItemID} is already marked as sold.`);
  const price = toPence(s.SalePrice);
  if (price <= 0) throw new Error('Enter the sale price.');

  const sale = await db.insert(T.sales.name, {
    ItemID: item.ItemID,
    SaleDate: s.SaleDate,
    Channel: s.Channel,
    OrderRef: (s.OrderRef || '').trim(),
    SalePrice: fromPence(price),
    BuyerPostage: fromPence(toPence(s.BuyerPostage)),
    PlatformFee: fromPence(toPence(s.PlatformFee)),
    PostageCost: fromPence(toPence(s.PostageCost)),
    Ownership: item.Ownership,
    ItemCost: num(item.CostAllocated),
    TaxYear: taxYearOf(s.SaleDate),
    Refunded: false,
    Notes: (s.Notes || '').trim(),
    CreatedBy: user,
  });
  await updateItemStatus(item.ItemID, 'Sold', s.Channel);
  return sale;
}

const listSales = (taxYear) => db.select(T.sales.name, taxYear ? { TaxYear: taxYear } : {}, 'SaleDate DESC');

async function getSale(id) {
  const [s] = await db.select(T.sales.name, { SaleID: Number(id) });
  return s;
}

// ---------- Refunds ----------
// Cash basis: a refund reduces turnover in the tax year the money went back.
async function recordRefund(saleId, r) {
  const sale = await getSale(saleId);
  if (!sale) throw new Error('Sale not found.');
  if (sale.Refunded) throw new Error('This sale already has a refund recorded.');
  if (!isDate(r.RefundDate)) throw new Error('Enter the date the refund was paid.');
  if (r.RefundDate < sale.SaleDate) throw new Error('The refund date is before the sale date.');
  const max = toPence(sale.SalePrice) + toPence(sale.BuyerPostage);
  const amount = r.RefundAmount === undefined || r.RefundAmount === '' ? max : toPence(r.RefundAmount);
  if (amount <= 0) throw new Error('Enter the amount refunded.');
  if (amount > max) throw new Error(`The refund can't be more than the buyer paid (${money(fromPence(max))}).`);
  const returned = r.ItemReturned === 'yes';

  await db.update(T.sales.name, { SaleID: sale.SaleID }, {
    Refunded: true,
    RefundDate: r.RefundDate,
    RefundAmount: fromPence(amount),
    ItemReturned: returned,
  });
  if (returned) await updateItemStatus(sale.ItemID, 'In stock', '');
  return { sale, amount: fromPence(amount), returned };
}

// ---------- Expenses ----------
async function createExpense(e, file, user) {
  const typeDef = EXPENSE_TYPES.find((t) => t.type === e.ExpenseType);
  if (!typeDef) throw new Error('Choose what the expense was for.');
  if (!isDate(e.ExpenseDate)) throw new Error('Enter the date paid.');
  let miles = 0;
  let amount;
  if (typeDef.mileage) {
    miles = Number(e.Miles);
    if (!(miles > 0)) throw new Error('Enter the number of business miles.');
    amount = Math.round(miles * MILEAGE_RATE * 100);
  } else {
    amount = toPence(e.Amount);
    if (amount <= 0) throw new Error('Enter the amount paid.');
  }
  if (!e.Description || !e.Description.trim()) throw new Error('Enter a short description.');

  const exp = await db.insert(T.expenses.name, {
    ExpenseDate: e.ExpenseDate,
    Description: e.Description.trim(),
    ExpenseType: typeDef.type,
    SA103Category: typeDef.cat,
    Amount: fromPence(amount),
    Miles: miles,
    Supplier: (e.Supplier || '').trim(),
    PaymentMethod: typeDef.mileage ? '' : e.PaymentMethod || '',
    TaxYear: taxYearOf(e.ExpenseDate),
    Notes: (e.Notes || '').trim(),
    CreatedBy: user,
  });

  let receiptError = null;
  if (file) {
    try {
      await db.uploadAttachment(T.expenses.name, 'Receipt', exp.PK_ID, file);
    } catch (err) {
      console.error(err);
      receiptError = 'The expense was saved but the receipt photo could not be uploaded. Try again from the expense page.';
    }
  }
  return { exp, receiptError };
}

async function attachReceipt(id, file) {
  const exp = await getExpense(id);
  if (!exp) throw new Error('Expense not found.');
  await db.uploadAttachment(T.expenses.name, 'Receipt', exp.PK_ID, file);
}

const listExpenses = (taxYear) => db.select(T.expenses.name, taxYear ? { TaxYear: taxYear } : {}, 'ExpenseDate DESC');

async function getExpense(id) {
  const [e] = await db.select(T.expenses.name, { ExpenseID: Number(id) });
  return e;
}

async function getReceipt(id) {
  const exp = await getExpense(id);
  if (!exp || !exp.Receipt) return null;
  const file = await db.downloadAttachment(T.expenses.name, 'Receipt', exp.PK_ID);
  if (file) file.filename = String(exp.Receipt).split('/').pop() || `receipt-${id}`;
  return file;
}

// ---------- Figures ----------
function inRange(date, range) {
  const d = String(date || '').slice(0, 10);
  return d >= range.start && d <= range.end;
}

async function figures(taxYear) {
  const range = taxYearRange(taxYear);
  const [sales, purchases, expenses, items] = await Promise.all([
    db.select(T.sales.name),
    db.select(T.purchases.name),
    db.select(T.expenses.name).catch(() => []), // table may not exist yet
    db.select(T.items.name),
  ]);
  const biz = sales.filter((s) => s.Ownership === 'Business');
  const tySales = biz.filter((s) => inRange(s.SaleDate, range));
  const tyRefunds = biz.filter((s) => s.Refunded && inRange(s.RefundDate, range));
  const tyPurchases = purchases.filter((p) => inRange(p.PurchaseDate, range));
  const tyExpenses = expenses.filter((e) => inRange(e.ExpenseDate, range));

  const grossP = sumP(tySales, (s) => num(s.SalePrice) + num(s.BuyerPostage));
  const refundsP = sumP(tyRefunds, 'RefundAmount');
  const turnoverP = grossP - refundsP;

  const cats = Object.fromEntries(Object.values(SA103).map((c) => [c, 0]));
  cats[SA103.goods] += sumP(tyPurchases, 'TotalCost');
  for (const [field, cat] of Object.entries(SALE_COST_CATEGORIES)) cats[cat] += sumP(tySales, field);
  for (const e of tyExpenses) cats[e.SA103Category in cats ? e.SA103Category : SA103.other] += toPence(e.Amount);
  const totalExpP = Object.values(cats).reduce((a, b) => a + b, 0);

  const kept = tySales.filter((s) => !(s.Refunded && s.ItemReturned));
  const unsold = items.filter((i) => i.Ownership === 'Business' && (i.Status === 'In stock' || i.Status === 'Listed'));

  return {
    taxYear,
    range,
    sales: tySales,
    refunds: tyRefunds,
    purchases: tyPurchases,
    expenses: tyExpenses,
    unsold,
    salesCount: tySales.length,
    personalSalesCount: sales.filter((s) => s.Ownership === 'Personal' && inRange(s.SaleDate, range)).length,
    grossSales: fromPence(grossP),
    refundsTotal: fromPence(refundsP),
    turnover: fromPence(turnoverP),
    categories: Object.entries(cats).map(([name, p]) => ({ name, amount: fromPence(p) })),
    stockPurchases: fromPence(cats[SA103.goods]),
    feesAndPostage: fromPence(sumP(tySales, 'PlatformFee') + sumP(tySales, 'PostageCost')),
    otherExpenses: fromPence(sumP(tyExpenses, 'Amount')),
    totalExpenses: fromPence(totalExpP),
    profit: fromPence(turnoverP - totalExpP),
    costOfItemsSold: fromPence(sumP(kept, 'ItemCost')),
    grossItemProfit: fromPence(sumP(kept, 'SalePrice') - sumP(kept, 'ItemCost')),
    unsoldCount: unsold.length,
    unsoldValue: fromPence(sumP(unsold, 'CostAllocated')),
  };
}

// Platform reporting (DAC7) works on CALENDAR years and includes personal sales.
async function platformCheck(calYear) {
  const sales = await db.select(T.sales.name);
  const platforms = {};
  const get = (c) => (platforms[c] = platforms[c] || { count: 0, gross: 0, refunds: 0, business: 0, personal: 0 });
  for (const s of sales) {
    if (String(s.SaleDate).startsWith(calYear)) {
      const p = get(s.Channel);
      const g = toPence(s.SalePrice) + toPence(s.BuyerPostage);
      p.count++;
      p.gross += g;
      p[s.Ownership === 'Personal' ? 'personal' : 'business'] += g;
    }
    if (s.Refunded && String(s.RefundDate).startsWith(calYear)) get(s.Channel).refunds += toPence(s.RefundAmount);
  }
  for (const p of Object.values(platforms)) for (const k of ['gross', 'refunds', 'business', 'personal']) p[k] = fromPence(p[k]);
  return platforms;
}

// Tax years always offered, even before any records exist for them
// (2025-26 is the first year the business needs to file).
const FIRST_TAX_YEAR = '2025-26';

async function taxYearsInUse() {
  const [sales, purchases] = await Promise.all([db.select(T.sales.name), db.select(T.purchases.name)]);
  const current = taxYearOf(today());
  const set = new Set([current, ...sales.map((s) => s.TaxYear), ...purchases.map((p) => p.TaxYear)]);
  for (let y = Number(FIRST_TAX_YEAR.slice(0, 4)); y <= Number(current.slice(0, 4)); y++) {
    set.add(`${y}-${String((y + 1) % 100).padStart(2, '0')}`);
  }
  return [...set].filter(Boolean).sort().reverse();
}

async function calendarYearsInUse() {
  const sales = await db.select(T.sales.name);
  const set = new Set([String(new Date().getFullYear()), FIRST_TAX_YEAR.slice(0, 4), ...sales.map((s) => String(s.SaleDate).slice(0, 4))]);
  return [...set].filter((y) => /^\d{4}$/.test(y)).sort().reverse();
}

// ---------- eBay import ----------
// rows: output of ebay.parse(). Adds suggested item + duplicate flag.
async function prepareEbayImport(rows) {
  const [sales, items] = await Promise.all([db.select(T.sales.name), listItems()]);
  const imported = new Set(sales.filter((s) => s.Channel === 'eBay' && s.OrderRef).map((s) => s.OrderRef));
  const available = items.filter((i) => i.Status === 'In stock' || i.Status === 'Listed');
  const byId = new Map(available.map((i) => [i.ItemID, i]));
  const used = new Set();
  return {
    available,
    rows: rows.map((r) => {
      const dup = imported.has(r.orderRef);
      let itemId = '';
      const m = String(r.customLabel || '').match(/\d+/);
      if (!dup && m && byId.has(Number(m[0])) && !used.has(Number(m[0]))) {
        itemId = Number(m[0]);
        used.add(itemId);
      }
      return { ...r, duplicate: dup, itemId };
    }),
  };
}

async function importEbay(rows, user) {
  const done = [];
  const errors = [];
  const sales = await db.select(T.sales.name);
  const imported = new Set(sales.filter((s) => s.Channel === 'eBay' && s.OrderRef).map((s) => s.OrderRef));
  const usedItems = new Set();
  for (const r of rows) {
    if (!r.ItemID) continue;
    if (r.OrderRef && imported.has(r.OrderRef)) {
      errors.push(`Order ${r.OrderRef}: already imported, skipped.`);
      continue;
    }
    if (usedItems.has(String(r.ItemID))) {
      errors.push(`Order ${r.OrderRef}: item #${r.ItemID} was chosen for more than one order, skipped.`);
      continue;
    }
    usedItems.add(String(r.ItemID));
    try {
      const sale = await createSale({ ...r, Channel: 'eBay', Notes: r.Notes || 'Imported from eBay report' }, user);
      done.push(sale);
    } catch (e) {
      errors.push(`Order ${r.OrderRef}: ${e.message}`);
    }
  }
  return { done, errors };
}

module.exports = {
  createPurchase, listPurchases, getPurchase,
  createItem, listItems, unsoldItems, getItem, updateItemStatus,
  createSale, listSales, getSale, recordRefund,
  createExpense, attachReceipt, listExpenses, getExpense, getReceipt,
  figures, platformCheck, taxYearsInUse, calendarYearsInUse,
  prepareEbayImport, importEbay,
};
