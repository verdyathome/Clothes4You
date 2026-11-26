// Business logic: purchases, items, sales and the dashboard figures.
const db = require('./db');
const { TABLES } = require('./config');
const { toPence, fromPence, allocateCost, taxYearOf, taxYearRange, today } = require('./util');

const T = TABLES;
const num = (v) => Number(v) || 0;

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

const listPurchases = () => db.select(T.purchases.name, {}, 'PurchaseDate DESC');

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

// ---------- Dashboard ----------
async function dashboard(taxYear) {
  const [sales, purchases, items] = await Promise.all([
    db.select(T.sales.name),
    db.select(T.purchases.name),
    db.select(T.items.name),
  ]);
  const live = sales.filter((s) => !s.Refunded);
  const tySales = live.filter((s) => s.TaxYear === taxYear);
  const bizSales = tySales.filter((s) => s.Ownership === 'Business');
  const sum = (arr, f) => fromPence(arr.reduce((a, r) => a + toPence(r[f]), 0));

  const turnover = fromPence(toPence(sum(bizSales, 'SalePrice')) + toPence(sum(bizSales, 'BuyerPostage')));
  const stockPurchases = sum(purchases.filter((p) => p.TaxYear === taxYear), 'TotalCost');
  const platformFees = sum(bizSales, 'PlatformFee');
  const postageCosts = sum(bizSales, 'PostageCost');
  const costOfItemsSold = sum(bizSales, 'ItemCost');
  const grossItemProfit = fromPence(toPence(sum(bizSales, 'SalePrice')) - toPence(costOfItemsSold));

  const unsold = items.filter((i) => i.Ownership === 'Business' && (i.Status === 'In stock' || i.Status === 'Listed'));

  // Platform reporting (DAC7) works on CALENDAR years and includes personal sales.
  const calYear = String(new Date().getFullYear());
  const platforms = {};
  for (const s of live.filter((x) => String(x.SaleDate).startsWith(calYear))) {
    const p = (platforms[s.Channel] = platforms[s.Channel] || { count: 0, gross: 0, business: 0, personal: 0 });
    const gross = toPence(s.SalePrice) + toPence(s.BuyerPostage);
    p.count++;
    p.gross += gross;
    p[s.Ownership === 'Personal' ? 'personal' : 'business'] += gross;
  }
  for (const p of Object.values(platforms)) {
    p.gross = fromPence(p.gross);
    p.business = fromPence(p.business);
    p.personal = fromPence(p.personal);
  }

  return {
    taxYear,
    range: taxYearRange(taxYear),
    salesCount: bizSales.length,
    personalSalesCount: tySales.length - bizSales.length,
    turnover,
    stockPurchases,
    platformFees,
    postageCosts,
    estimatedProfit: fromPence(toPence(turnover) - toPence(stockPurchases) - toPence(platformFees) - toPence(postageCosts)),
    costOfItemsSold,
    grossItemProfit,
    unsoldCount: unsold.length,
    unsoldValue: sum(unsold, 'CostAllocated'),
    calYear,
    platforms,
  };
}

async function taxYearsInUse() {
  const [sales, purchases] = await Promise.all([db.select(T.sales.name), db.select(T.purchases.name)]);
  const set = new Set([taxYearOf(today()), ...sales.map((s) => s.TaxYear), ...purchases.map((p) => p.TaxYear)]);
  return [...set].filter(Boolean).sort().reverse();
}

module.exports = {
  createPurchase, listPurchases, getPurchase,
  createItem, listItems, getItem, updateItemStatus,
  createSale, listSales,
  dashboard, taxYearsInUse,
};
