// Checks the Caspio connection and that each table has the fields the app expects.
// Usage: set the CASPIO_* env vars, then `npm run check-caspio`
const db = require('../src/db/caspio');
const { TABLES } = require('../src/config');

const EXPECTED = {
  items: ['ItemID', 'Description', 'Brand', 'Size', 'Category', 'Condition', 'Ownership', 'PurchaseID', 'CostAllocated', 'Status', 'ListedOn', 'DateAdded', 'Notes', 'CreatedBy'],
  purchases: ['PurchaseID', 'PurchaseDate', 'Supplier', 'SourceType', 'PaymentMethod', 'TotalCost', 'ItemCount', 'ReceiptRef', 'Notes', 'TaxYear', 'CreatedBy'],
  sales: ['SaleID', 'ItemID', 'SaleDate', 'Channel', 'OrderRef', 'SalePrice', 'BuyerPostage', 'PlatformFee', 'PostageCost', 'Ownership', 'ItemCost', 'TaxYear', 'Refunded', 'Notes', 'CreatedBy'],
};

(async () => {
  let ok = true;
  for (const [key, t] of Object.entries(TABLES)) {
    try {
      const rows = await db.select(t.name);
      if (!rows.length) {
        console.log(`✓ ${t.name}: reachable (empty — field names can't be checked until it has a row)`);
        continue;
      }
      const missing = EXPECTED[key].filter((f) => !(f in rows[0]));
      if (missing.length) { ok = false; console.log(`✗ ${t.name}: missing fields ${missing.join(', ')}`); }
      else console.log(`✓ ${t.name}: ${rows.length} row(s), all fields present`);
    } catch (e) {
      ok = false;
      console.log(`✗ ${t.name}: ${e.message}`);
    }
  }
  process.exit(ok ? 0 : 1);
})();
