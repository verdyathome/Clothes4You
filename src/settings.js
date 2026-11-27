// App settings (name, colour scheme, favicon), stored as key/value rows in Caspio.
// Cached in memory so every page doesn't hit the database.
const crypto = require('crypto');
const db = require('./db');
const { TABLES } = require('./config');
const images = require('./images');

const T = TABLES.settings;

const COLOURS = [
  { key: 'Accent', label: 'Buttons & highlights', css: '--accent', def: '#7a3e5c' },
  { key: 'AccentInk', label: 'Button text', css: '--accent-ink', def: '#ffffff' },
  { key: 'Bg', label: 'Page background', css: '--bg', def: '#f6f4f1' },
  { key: 'Card', label: 'Panels & cards', css: '--card', def: '#ffffff' },
  { key: 'HeaderBg', label: 'Header bar', css: '--header-bg', def: '#ffffff' },
  { key: 'Ink', label: 'Text', css: '--ink', def: '#1f1d1a' },
];

const PRESETS = [
  { name: 'Plum (default)', Accent: '#7a3e5c', AccentInk: '#ffffff', Bg: '#f6f4f1', Card: '#ffffff', HeaderBg: '#ffffff', Ink: '#1f1d1a' },
  { name: 'Navy', Accent: '#1f3a68', AccentInk: '#ffffff', Bg: '#f2f4f8', Card: '#ffffff', HeaderBg: '#ffffff', Ink: '#16202e' },
  { name: 'Forest', Accent: '#2f5d46', AccentInk: '#ffffff', Bg: '#f3f5f1', Card: '#ffffff', HeaderBg: '#ffffff', Ink: '#1b241f' },
  { name: 'Blush', Accent: '#b03a64', AccentInk: '#ffffff', Bg: '#fbf3f5', Card: '#ffffff', HeaderBg: '#ffffff', Ink: '#2a1a20' },
  { name: 'Charcoal', Accent: '#2b2b2b', AccentInk: '#ffffff', Bg: '#f4f4f2', Card: '#ffffff', HeaderBg: '#ffffff', Ink: '#1a1a1a' },
  { name: 'Dark', Accent: '#e0a3c0', AccentInk: '#1d1418', Bg: '#17151a', Card: '#221f26', HeaderBg: '#221f26', Ink: '#eee9f0' },
];

const DEFAULTS = {
  AppName: 'Clothing Portal', ...Object.fromEntries(COLOURS.map((c) => [c.key, c.def])),
  Favicon: '', FaviconType: '', LoginBgDim: '35', IconLargeVer: '', LoginBgVer: '',
};
// Larger images are stored base64 across several rows ("chunks"), because each
// Caspio Text (64000) field holds about 64 KB.
const BLOBS = ['IconLarge', 'LoginBg'];
const CHUNK = 60000;
const HEX = /^#[0-9a-f]{6}$/i;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'];
const IMAGE_MAX = 15 * 1024 * 1024; // before shrinking

let cache = null;
let cacheAt = 0;
let blobs = {};
const TTL = 60 * 1000;

function readBlob(raw, name) {
  const n = Number(raw[`${name}Count`]) || 0;
  if (!n) return null;
  let b64 = '';
  for (let i = 0; i < n; i++) b64 += raw[`${name}_${i}`] || '';
  return b64 ? Buffer.from(b64, 'base64') : null;
}

async function load() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  const s = { ...DEFAULTS };
  try {
    const rows = await db.select(T.name);
    const raw = {};
    for (const r of rows) if (r.SettingValue != null) raw[r.SettingKey] = String(r.SettingValue);
    for (const k of Object.keys(DEFAULTS)) if (k in raw) s[k] = raw[k];
    blobs = Object.fromEntries(BLOBS.map((b) => [b, readBlob(raw, b)]));
  } catch (e) {
    // Table not created yet, or Caspio unreachable: run on defaults rather than break every page.
    if (!cache) console.warn(`Settings not loaded (${e.message.slice(0, 120)}) — using defaults.`);
  }
  for (const c of COLOURS) if (!HEX.test(s[c.key])) s[c.key] = c.def;
  if (!s.AppName.trim()) s.AppName = DEFAULTS.AppName;
  s.hasLoginBg = !!blobs.LoginBg;
  s.hasIcon = !!(blobs.IconLarge || s.Favicon);
  // Changes whenever anything shown in icons / launch screens changes, so phones refetch them
  s.assetVer = crypto.createHash('sha1').update([s.IconLargeVer, s.Favicon.length, s.Accent, s.AccentInk, s.Bg, s.AppName].join('|')).digest('hex').slice(0, 8);
  cache = s;
  cacheAt = Date.now();
  return s;
}

async function put(key, value) {
  const existing = await db.select(T.name, { SettingKey: key });
  if (existing.length) await db.update(T.name, { SettingKey: key }, { SettingValue: value });
  else await db.insert(T.name, { SettingKey: key, SettingValue: value });
}

async function putBlob(name, buffer) {
  const b64 = buffer ? buffer.toString('base64') : '';
  const n = Math.ceil(b64.length / CHUNK);
  for (let i = 0; i < n; i++) await put(`${name}_${i}`, b64.slice(i * CHUNK, (i + 1) * CHUNK));
  // Old, now unused chunks are blanked (the API profile isn't allowed to delete rows)
  const rows = await db.select(T.name);
  for (const r of rows) {
    const m = String(r.SettingKey).match(new RegExp(`^${name}_(\\d+)$`));
    if (m && Number(m[1]) >= n && r.SettingValue) await put(r.SettingKey, '');
  }
  await put(`${name}Count`, String(n));
  await put(`${name}Ver`, buffer ? crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 10) : '');
}

const getBlob = async (name) => { await load(); return blobs[name] || null; };

function validate(form) {
  const out = {};
  const name = String(form.AppName || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Enter a name for the app.');
  if (name.length > 40) throw new Error('Keep the app name to 40 characters or fewer.');
  out.AppName = name;
  for (const c of COLOURS) {
    const v = String(form[c.key] || '').trim();
    if (!HEX.test(v)) throw new Error(`"${c.label}" must be a colour like #7a3e5c.`);
    out[c.key] = v.toLowerCase();
  }
  return out;
}

async function readImage(file, what) {
  if (!IMAGE_TYPES.includes(file.mimetype)) throw new Error(`The ${what} must be a JPG, PNG, WebP or GIF image.`);
  if (file.buffer.length > IMAGE_MAX) throw new Error(`The ${what} is over 15 MB — please choose a smaller image.`);
}

async function save(form, files = {}) {
  const values = validate(form);
  const dim = Number(form.LoginBgDim);
  values.LoginBgDim = String(Number.isFinite(dim) ? Math.min(80, Math.max(0, Math.round(dim))) : 35);

  // App icon: any image, cropped square and shrunk; a small copy is the favicon
  let icon = null;
  if (files.favicon) {
    await readImage(files.favicon, 'app icon');
    try { icon = await images.processIcon(files.favicon.buffer); } catch { throw new Error('That app icon image could not be read — try saving it as a JPG or PNG.'); }
    values.Favicon = (await images.smallIcon(icon)).toString('base64');
    values.FaviconType = 'image/png';
  } else if (form.removeFavicon === '1') {
    values.Favicon = '';
    values.FaviconType = '';
  }

  // Login background: shrunk and compressed to WebP
  let bg = null;
  if (files.loginBg) {
    await readImage(files.loginBg, 'background photo');
    try { bg = await images.processLoginBg(files.loginBg.buffer); } catch { throw new Error('That background photo could not be read — try saving it as a JPG or PNG.'); }
  }

  if (icon) await putBlob('IconLarge', icon);
  else if (form.removeFavicon === '1') await putBlob('IconLarge', null);
  if (bg) await putBlob('LoginBg', bg);
  else if (form.removeLoginBg === '1') await putBlob('LoginBg', null);

  for (const [k, v] of Object.entries(values)) await put(k, v);
  cache = null;
  return load();
}

async function reset() {
  for (const k of ['AppName', ...COLOURS.map((c) => c.key)]) await put(k, DEFAULTS[k]);
  cache = null;
}

// Relative luminance contrast (WCAG)
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function warnings(s) {
  const w = [];
  if (contrast(s.Accent, s.AccentInk) < 4.5) w.push('Button text is hard to read on the button colour.');
  if (contrast(s.Ink, s.Bg) < 4.5) w.push('Text is hard to read on the page background.');
  if (contrast(s.Ink, s.Card) < 4.5) w.push('Text is hard to read on the panels.');
  if (contrast(s.Ink, s.HeaderBg) < 4.5) w.push('Text is hard to read on the header bar.');
  return w;
}

// CSS custom properties for the <style> block in every page's <head>
function themeCss(s) {
  return COLOURS.map((c) => `${c.css}:${HEX.test(s[c.key]) ? s[c.key] : c.def}`).join(';');
}

module.exports = { load, save, reset, warnings, themeCss, getBlob, COLOURS, PRESETS, DEFAULTS };
