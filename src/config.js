// Central configuration: table names, ID fields and pick-lists.
const TABLES = {
  items: { name: process.env.TBL_ITEMS || 'CSP_Items', id: 'ItemID' },
  purchases: { name: process.env.TBL_PURCHASES || 'CSP_Purchases', id: 'PurchaseID' },
  sales: { name: process.env.TBL_SALES || 'CSP_Sales', id: 'SaleID' },
  expenses: { name: process.env.TBL_EXPENSES || 'CSP_Expenses', id: 'ExpenseID' },
};

// SA103 self-employment expense categories (names as on the form; box numbers
// change between years so they're not hard-coded).
const SA103 = {
  goods: 'Cost of goods bought for resale',
  travel: 'Car, van and travel expenses',
  staff: 'Wages, salaries and other staff costs',
  premises: 'Rent, rates, power and insurance costs',
  repairs: 'Repairs and maintenance of property and equipment',
  office: 'Phone, fax, stationery and other office costs',
  advertising: 'Advertising and business entertainment costs',
  interest: 'Interest on bank and other loans',
  finance: 'Bank, credit card and other financial charges',
  professional: 'Accountancy, legal and professional fees',
  other: 'Other allowable business expenses',
};

// Everyday expense types → SA103 category. Order = order shown in the form.
const EXPENSE_TYPES = [
  { type: 'Packaging (mailers, tissue, tape)', cat: SA103.other },
  { type: 'Postage (not linked to a sale)', cat: SA103.office },
  { type: 'Mileage (45p per mile)', cat: SA103.travel, mileage: true },
  { type: 'Parking / public transport', cat: SA103.travel },
  { type: 'Phone / internet (business share)', cat: SA103.office },
  { type: 'Printing / stationery / labels', cat: SA103.office },
  { type: 'Listing boosts / promoted listings', cat: SA103.advertising },
  { type: 'Advertising / promotion', cat: SA103.advertising },
  { type: 'Platform subscription or other platform fee', cat: SA103.other },
  { type: 'PayPal / bank / card charges', cat: SA103.finance },
  { type: 'Accountant / software', cat: SA103.professional },
  { type: 'Equipment (rail, hangers, steamer, camera…)', cat: SA103.other },
  { type: 'Cleaning / repairs to stock', cat: SA103.goods },
  { type: 'Other', cat: SA103.other },
];

// Where costs recorded on sales go on the SA103
const SALE_COST_CATEGORIES = {
  PlatformFee: SA103.other,
  PostageCost: SA103.office,
};

const MILEAGE_RATE = 0.45; // HMRC simplified rate, first 10,000 business miles

const LISTS = {
  ownership: ['Business', 'Personal'],
  itemStatus: ['In stock', 'Listed', 'Sold', 'Written off'],
  condition: ['New with tags', 'New without tags', 'Very good', 'Good', 'Satisfactory'],
  channels: ['Vinted', 'eBay', 'Other'],
  purchaseSources: ['Charity shop', 'Wholesale / bundle', 'Vinted', 'eBay', 'Car boot / market', 'Retail', 'Other'],
  paymentMethods: ['Card', 'Cash', 'Bank transfer', 'PayPal', 'Platform balance'],
  categories: ['Tops', 'Dresses', 'Trousers / jeans', 'Skirts / shorts', 'Outerwear', 'Knitwear', 'Shoes', 'Bags / accessories', 'Other'],
  expenseTypes: EXPENSE_TYPES,
  sa103: Object.values(SA103),
};

module.exports = { TABLES, LISTS, SA103, EXPENSE_TYPES, SALE_COST_CATEGORIES, MILEAGE_RATE, VERSION: require('../package.json').version };
