const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const { LISTS, VERSION } = require('./src/config');
const svc = require('./src/services');
const db = require('./src/db');
const { checkLogin, requireLogin } = require('./src/auth');
const { money, today, isDate, taxYearOf, ukDate } = require('./src/util');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) console.warn('WARNING: SESSION_SECRET is not set.');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Railway sits behind a proxy

app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  cookieSession({
    name: 'csp_session',
    secret: process.env.SESSION_SECRET || 'dev-only-secret',
    maxAge: 12 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: IS_PROD,
  })
);

// Shared template helpers + one-shot flash messages
app.use((req, res, next) => {
  Object.assign(res.locals, { LISTS, VERSION, money, ukDate, today: today(), user: null, path: req.path, backend: db.name });
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  req.flash = (type, text) => (req.session.flash = { type, text });
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Auth ----------
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const { username = '', password = '' } = req.body;
  if (checkLogin(username.trim(), password)) {
    req.session.user = username.trim();
    return res.redirect('/');
  }
  res.status(401).render('login', { error: 'Username or password not recognised.' });
});
app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

app.get('/health', (req, res) => res.json({ ok: true, version: VERSION }));

app.use(requireLogin);

// ---------- Dashboard ----------
app.get('/', wrap(async (req, res) => {
  const years = await svc.taxYearsInUse();
  const ty = years.includes(req.query.ty) ? req.query.ty : taxYearOf(today());
  res.render('dashboard', { d: await svc.dashboard(ty), years });
}));

// ---------- Purchases ----------
app.get('/purchases', wrap(async (req, res) => res.render('purchases', { purchases: await svc.listPurchases() })));
app.get('/purchases/new', (req, res) => res.render('purchase-new', { form: { PurchaseDate: today() }, items: [{}], error: null }));
app.post('/purchases', wrap(async (req, res) => {
  const form = req.body;
  // qs turns items[0][..] into an array, but switches to an object beyond 20 rows
  const items = Object.values(form.items || {});
  try {
    if (!isDate(form.PurchaseDate)) throw new Error('Enter a valid purchase date.');
    const p = await svc.createPurchase(form, items, req.session.user);
    req.flash('ok', `Purchase #${p.PurchaseID} saved with ${p.ItemCount} item(s).`);
    res.redirect(`/purchases/${p.PurchaseID}`);
  } catch (e) {
    if (e.message.startsWith('Caspio')) throw e;
    res.status(400).render('purchase-new', { form, items: items.length ? items : [{}], error: e.message });
  }
}));
app.get('/purchases/:id', wrap(async (req, res) => {
  const p = await svc.getPurchase(req.params.id);
  if (!p) return res.status(404).render('error', { message: 'Purchase not found.' });
  const items = (await svc.listItems()).filter((i) => i.PurchaseID === p.PurchaseID);
  res.render('purchase', { p, items });
}));

// ---------- Items ----------
app.get('/items', wrap(async (req, res) => {
  const filter = { status: req.query.status || '', ownership: req.query.ownership || '' };
  const q = (req.query.q || '').toLowerCase().trim();
  let items = await svc.listItems(filter);
  if (q) items = items.filter((i) => [i.Description, i.Brand, i.Size, String(i.ItemID)].join(' ').toLowerCase().includes(q));
  res.render('items', { items, filter, q });
}));
app.get('/items/new', (req, res) => res.render('item-new', { form: { Ownership: 'Personal', DateAdded: today() }, error: null }));
app.post('/items', wrap(async (req, res) => {
  const form = req.body;
  try {
    if (!form.Description || !form.Description.trim()) throw new Error('Enter a description.');
    if (!isDate(form.DateAdded)) throw new Error('Enter a valid date.');
    // Business stock should come in through a purchase so the cost is recorded.
    const item = await svc.createItem({ ...form, Ownership: 'Personal', PurchaseID: null }, req.session.user);
    req.flash('ok', `Personal item #${item.ItemID} added.`);
    res.redirect(`/items/${item.ItemID}`);
  } catch (e) {
    if (e.message.startsWith('Caspio')) throw e;
    res.status(400).render('item-new', { form, error: e.message });
  }
}));
app.get('/items/:id', wrap(async (req, res) => {
  const item = await svc.getItem(req.params.id);
  if (!item) return res.status(404).render('error', { message: 'Item not found.' });
  const sales = (await svc.listSales()).filter((s) => s.ItemID === item.ItemID);
  res.render('item', { item, sale: sales[0] || null });
}));
app.post('/items/:id/status', wrap(async (req, res) => {
  const item = await svc.getItem(req.params.id);
  if (!item) return res.status(404).render('error', { message: 'Item not found.' });
  const { Status, ListedOn } = req.body;
  if (item.Status === 'Sold') {
    req.flash('error', 'Sold items can\'t be changed here.');
  } else if (['In stock', 'Listed', 'Written off'].includes(Status)) {
    await svc.updateItemStatus(item.ItemID, Status, Status === 'Listed' ? ListedOn || '' : '');
    req.flash('ok', `Item #${item.ItemID} marked as ${Status.toLowerCase()}.`);
  }
  res.redirect(`/items/${item.ItemID}`);
}));

// ---------- Sales ----------
app.get('/sales', wrap(async (req, res) => {
  const years = await svc.taxYearsInUse();
  const ty = years.includes(req.query.ty) ? req.query.ty : taxYearOf(today());
  res.render('sales', { sales: await svc.listSales(ty), ty, years });
}));
app.get('/sales/new', wrap(async (req, res) => {
  const items = (await svc.listItems()).filter((i) => i.Status === 'In stock' || i.Status === 'Listed');
  const pre = items.find((i) => String(i.ItemID) === String(req.query.item));
  res.render('sale-new', { items, form: { SaleDate: today(), ItemID: pre ? pre.ItemID : '', Channel: pre && pre.ListedOn ? pre.ListedOn : 'Vinted' }, error: null });
}));
app.post('/sales', wrap(async (req, res) => {
  const form = req.body;
  try {
    if (!isDate(form.SaleDate)) throw new Error('Enter a valid sale date.');
    if (!LISTS.channels.includes(form.Channel)) throw new Error('Choose where it sold.');
    const sale = await svc.createSale(form, req.session.user);
    req.flash('ok', `Sale #${sale.SaleID} recorded for item #${sale.ItemID}.`);
    res.redirect(`/items/${sale.ItemID}`);
  } catch (e) {
    if (e.message.startsWith('Caspio')) throw e;
    const items = (await svc.listItems()).filter((i) => i.Status === 'In stock' || i.Status === 'Listed');
    res.status(400).render('sale-new', { items, form, error: e.message });
  }
}));

// ---------- Errors ----------
app.use((req, res) => res.status(404).render('error', { message: 'Page not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: IS_PROD ? 'Something went wrong talking to the database. Please try again.' : err.message });
});

app.listen(PORT, () => console.log(`Clothing portal v${VERSION} on port ${PORT} (data: ${db.name})`));
