const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');

const { LISTS, VERSION, EXPENSE_TYPES, MILEAGE_RATE } = require('./src/config');
const svc = require('./src/services');
const db = require('./src/db');
const ebay = require('./src/ebay');
const { buildWorkbook } = require('./src/export');
const settingsSvc = require('./src/settings');
const crypto = require('crypto');
const { checkLogin, requireLogin, normUser } = require('./src/auth');
const { money, today, isDate, taxYearOf, ukDate } = require('./src/util');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) console.warn('WARNING: SESSION_SECRET is not set.');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Railway sits behind a proxy

app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 20000 }));
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

// Uploads are kept in memory and passed straight to Caspio
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\/|^application\/pdf$/.test(file.mimetype)),
});
const iconUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

// Shared template helpers + one-shot flash messages
app.use((req, res, next) => {
  Object.assign(res.locals, { LISTS, VERSION, money, ukDate, today: today(), user: null, path: req.path, backend: db.name });
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  req.flash = (type, text) => (req.session.flash = { type, text });
  next();
});

// Name, colours and favicon from Settings, available to every page (login included)
app.use(async (req, res, next) => {
  try {
    const s = await settingsSvc.load();
    res.locals.settings = s;
    res.locals.themeCss = settingsSvc.themeCss(s);
    res.locals.faviconVersion = s.Favicon ? crypto.createHash('sha1').update(s.Favicon).digest('hex').slice(0, 8) : '';
    next();
  } catch (e) { next(e); }
});

// Public: browsers fetch the icon before anyone logs in
app.get(['/favicon', '/favicon.ico', '/apple-touch-icon.png'], async (req, res) => {
  const s = res.locals.settings;
  if (!s.Favicon) return res.status(404).end();
  res.setHeader('Content-Type', s.FaviconType || 'image/png');
  res.setHeader('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(s.Favicon, 'base64'));
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isUserError = (e) => !/^Caspio/.test(e.message);
const fileFrom = (f) => (f ? { buffer: f.buffer, filename: f.originalname || 'receipt', mimetype: f.mimetype } : null);

async function yearChoice(req) {
  const years = await svc.taxYearsInUse();
  return { years, ty: years.includes(req.query.ty) ? req.query.ty : taxYearOf(today()) };
}

// ---------- Auth ----------
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const { username = '', password = '' } = req.body;
  if (checkLogin(username, password)) {
    req.session.user = normUser(username);
    return res.redirect('/');
  }
  console.warn(`Failed login for username "${normUser(username).slice(0, 40)}"`);
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
  const { years, ty } = await yearChoice(req);
  const calYears = await svc.calendarYearsInUse();
  const cy = calYears.includes(req.query.cy) ? req.query.cy : String(new Date().getFullYear());
  const [d, platforms] = await Promise.all([svc.figures(ty), svc.platformCheck(cy)]);
  res.render('dashboard', { d, years, calYears, cy, platforms });
}));

// ---------- Export ----------
app.get('/export/:ty.xlsx', wrap(async (req, res) => {
  const years = await svc.taxYearsInUse();
  if (!years.includes(req.params.ty)) return res.status(404).render('error', { message: 'Unknown tax year.' });
  const [f, items] = await Promise.all([svc.figures(req.params.ty), svc.listItems()]);
  const buf = await buildWorkbook(f, new Map(items.map((i) => [i.ItemID, i])), VERSION);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="clothing-accounts-${req.params.ty}.xlsx"`);
  res.send(Buffer.from(buf));
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
    if (!isUserError(e)) throw e;
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
    if (!isUserError(e)) throw e;
    res.status(400).render('item-new', { form, error: e.message });
  }
}));
app.get('/items/:id', wrap(async (req, res) => {
  const item = await svc.getItem(req.params.id);
  if (!item) return res.status(404).render('error', { message: 'Item not found.' });
  const sales = (await svc.listSales()).filter((s) => s.ItemID === item.ItemID);
  res.render('item', { item, sales });
}));
app.post('/items/:id/status', wrap(async (req, res) => {
  const item = await svc.getItem(req.params.id);
  if (!item) return res.status(404).render('error', { message: 'Item not found.' });
  const { Status, ListedOn } = req.body;
  if (item.Status === 'Sold') {
    req.flash('error', 'Sold items can\'t be changed here. Record a refund with "item returned" to put it back in stock.');
  } else if (['In stock', 'Listed', 'Written off'].includes(Status)) {
    await svc.updateItemStatus(item.ItemID, Status, Status === 'Listed' ? ListedOn || '' : '');
    req.flash('ok', `Item #${item.ItemID} marked as ${Status.toLowerCase()}.`);
  }
  res.redirect(`/items/${item.ItemID}`);
}));

// ---------- Sales ----------
app.get('/sales', wrap(async (req, res) => {
  const { years, ty } = await yearChoice(req);
  res.render('sales', { sales: await svc.listSales(ty), ty, years });
}));
app.get('/sales/new', wrap(async (req, res) => {
  const items = await svc.unsoldItems();
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
    if (!isUserError(e)) throw e;
    res.status(400).render('sale-new', { items: await svc.unsoldItems(), form, error: e.message });
  }
}));
app.post('/sales/:id/refund', wrap(async (req, res) => {
  const sale = await svc.getSale(req.params.id);
  if (!sale) return res.status(404).render('error', { message: 'Sale not found.' });
  try {
    const r = await svc.recordRefund(sale.SaleID, req.body);
    req.flash('ok', `Refund of ${money(r.amount)} recorded${r.returned ? ' and the item is back in stock' : ''}.`);
  } catch (e) {
    if (!isUserError(e)) throw e;
    req.flash('error', e.message);
  }
  res.redirect(`/items/${sale.ItemID}`);
}));

// ---------- eBay import ----------
app.get('/import/ebay', (req, res) => res.render('import-ebay', { error: null }));
app.post('/import/ebay', csvUpload.single('report'), wrap(async (req, res) => {
  try {
    if (!req.file) throw new Error('Choose the CSV file downloaded from eBay.');
    const parsed = ebay.parse(req.file.buffer.toString('utf8'));
    if (!parsed.rows.length) throw new Error('No eBay orders found in this file.');
    const prep = await svc.prepareEbayImport(parsed.rows);
    res.render('import-ebay-preview', { rows: prep.rows, available: prep.available, skipped: parsed.skipped });
  } catch (e) {
    if (!isUserError(e)) throw e;
    res.status(400).render('import-ebay', { error: e.message });
  }
}));
app.post('/import/ebay/confirm', wrap(async (req, res) => {
  const rows = Object.values(req.body.rows || {}).map((r) => ({
    ItemID: r.ItemID, OrderRef: r.OrderRef, SaleDate: r.SaleDate, SalePrice: r.SalePrice,
    BuyerPostage: r.BuyerPostage, PlatformFee: r.PlatformFee, PostageCost: r.PostageCost,
    Title: r.Title, NewCost: r.NewCost, NewCostDate: r.NewCostDate,
  })).filter((r) => r.ItemID && isDate(r.SaleDate));
  if (!rows.length) {
    req.flash('error', 'Nothing was imported — every order was left as "Don\'t import". Choose an existing item or "Create new item" for each order you want to bring in.');
    return res.redirect('/import/ebay');
  }
  const { done, errors } = await svc.importEbay(rows, req.session.user);
  const created = done.filter((d) => d.createdItem).length;
  req.flash(errors.length ? 'error' : 'ok', `Imported ${done.length} eBay sale(s)${created ? `, creating ${created} new item(s)` : ''}.${errors.length ? ' ' + errors.join(' ') : ''}`);
  res.redirect('/sales');
}));

// ---------- Expenses ----------
app.get('/expenses', wrap(async (req, res) => {
  const { years, ty } = await yearChoice(req);
  res.render('expenses', { expenses: await svc.listExpenses(ty), ty, years });
}));
app.get('/expenses/new', (req, res) =>
  res.render('expense-new', { form: { ExpenseDate: today() }, error: null, types: EXPENSE_TYPES, rate: MILEAGE_RATE }));
app.post('/expenses', (req, res, next) => receiptUpload.single('receipt')(req, res, (err) => {
  if (err) return res.status(400).render('expense-new', { form: req.body || {}, error: 'Receipt must be a photo or PDF under 10 MB.', types: EXPENSE_TYPES, rate: MILEAGE_RATE });
  next();
}), wrap(async (req, res) => {
  const form = req.body;
  try {
    const { exp, receiptError } = await svc.createExpense(form, fileFrom(req.file), req.session.user);
    req.flash(receiptError ? 'error' : 'ok', receiptError || `Expense #${exp.ExpenseID} saved (${money(exp.Amount)}).`);
    res.redirect(form.again ? '/expenses/new' : `/expenses/${exp.ExpenseID}`);
  } catch (e) {
    if (!isUserError(e)) throw e;
    res.status(400).render('expense-new', { form, error: e.message, types: EXPENSE_TYPES, rate: MILEAGE_RATE });
  }
}));
app.get('/expenses/:id', wrap(async (req, res) => {
  const e = await svc.getExpense(req.params.id);
  if (!e) return res.status(404).render('error', { message: 'Expense not found.' });
  res.render('expense', { e });
}));
app.post('/expenses/:id/receipt', receiptUpload.single('receipt'), wrap(async (req, res) => {
  if (!req.file) req.flash('error', 'Choose a photo or PDF of the receipt.');
  else {
    try {
      await svc.attachReceipt(req.params.id, fileFrom(req.file));
      req.flash('ok', 'Receipt uploaded.');
    } catch (e) {
      console.error(e);
      req.flash('error', 'The receipt could not be uploaded. Please try again.');
    }
  }
  res.redirect(`/expenses/${req.params.id}`);
}));
app.get('/expenses/:id/receipt', wrap(async (req, res) => {
  const file = await svc.getReceipt(req.params.id);
  if (!file) return res.status(404).render('error', { message: 'No receipt stored for this expense.' });
  const safeType = /^image\/(jpeg|png|gif|webp|heic|heif)$|^application\/pdf$/.test(file.contentType) ? file.contentType : 'application/octet-stream';
  res.setHeader('Content-Type', safeType);
  res.setHeader('Content-Disposition', `${safeType === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${file.filename.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.buffer);
}));

// ---------- Settings ----------
function renderSettings(res, form, error, status = 200) {
  const s = res.locals.settings;
  res.status(status).render('settings', {
    form, error, warnings: settingsSvc.warnings({ ...s, ...form }),
    colours: settingsSvc.COLOURS, presets: settingsSvc.PRESETS,
  });
}
app.get('/settings', (req, res) => renderSettings(res, { ...res.locals.settings }, null));
app.post('/settings', (req, res, next) => iconUpload.single('favicon')(req, res, (err) => {
  if (err) return renderSettings(res, { ...res.locals.settings, ...(req.body || {}) }, 'The icon file is too large — please use one under 45 KB.', 400);
  next();
}), wrap(async (req, res) => {
  try {
    const saved = await settingsSvc.save(req.body, fileFrom(req.file));
    const w = settingsSvc.warnings(saved);
    req.flash(w.length ? 'error' : 'ok', w.length ? `Settings saved, but: ${w.join(' ')}` : 'Settings saved.');
    res.redirect('/settings');
  } catch (e) {
    if (!isUserError(e)) throw e;
    renderSettings(res, { ...res.locals.settings, ...req.body }, e.message, 400);
  }
}));
app.post('/settings/reset', wrap(async (req, res) => {
  await settingsSvc.reset();
  req.flash('ok', 'Name and colours reset to the defaults.');
  res.redirect('/settings');
}));

// ---------- Errors ----------
app.use((req, res) => res.status(404).render('error', { message: 'Page not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: IS_PROD ? 'Something went wrong talking to the database. Please try again.' : err.message });
});

app.listen(PORT, () => console.log(`Clothing portal v${VERSION} on port ${PORT} (data: ${db.name})`));
