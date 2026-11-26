// Central configuration: table names, ID fields and pick-lists.
const TABLES = {
  items: { name: process.env.TBL_ITEMS || 'CSP_Items', id: 'ItemID' },
  purchases: { name: process.env.TBL_PURCHASES || 'CSP_Purchases', id: 'PurchaseID' },
  sales: { name: process.env.TBL_SALES || 'CSP_Sales', id: 'SaleID' },
};

const LISTS = {
  ownership: ['Business', 'Personal'],
  itemStatus: ['In stock', 'Listed', 'Sold', 'Written off'],
  condition: ['New with tags', 'New without tags', 'Very good', 'Good', 'Satisfactory'],
  channels: ['Vinted', 'eBay', 'Other'],
  purchaseSources: ['Charity shop', 'Wholesale / bundle', 'Vinted', 'eBay', 'Car boot / market', 'Retail', 'Other'],
  paymentMethods: ['Card', 'Cash', 'Bank transfer', 'PayPal', 'Platform balance'],
  categories: ['Tops', 'Dresses', 'Trousers / jeans', 'Skirts / shorts', 'Outerwear', 'Knitwear', 'Shoes', 'Bags / accessories', 'Other'],
};

module.exports = { TABLES, LISTS, VERSION: require('../package.json').version };
