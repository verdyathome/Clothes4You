// App settings (name, colour scheme, favicon), stored as key/value rows in Caspio.
// Cached in memory so every page doesn't hit the database.
const db = require('./db');
const { TABLES } = require('./config');

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

const DEFAULTS = { AppName: 'Clothing Portal', ...Object.fromEntries(COLOURS.map((c) => [c.key, c.def])), Favicon: '', FaviconType: '' };
const HEX = /^#[0-9a-f]{6}$/i;
const FAVICON_TYPES = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/jpeg', 'image/gif', 'image/webp'];
const FAVICON_MAX = 45 * 1024; // stored base64 in a Text (64000) field

let cache = null;
let cacheAt = 0;
const TTL = 60 * 1000;

async function load() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  const s = { ...DEFAULTS };
  try {
    const rows = await db.select(T.name);
    for (const r of rows) if (r.SettingKey in DEFAULTS && r.SettingValue != null) s[r.SettingKey] = String(r.SettingValue);
  } catch (e) {
    // Table not created yet, or Caspio unreachable: run on defaults rather than break every page.
    if (!cache) console.warn(`Settings not loaded (${e.message.slice(0, 120)}) — using defaults.`);
  }
  for (const c of COLOURS) if (!HEX.test(s[c.key])) s[c.key] = c.def;
  if (!s.AppName.trim()) s.AppName = DEFAULTS.AppName;
  cache = s;
  cacheAt = Date.now();
  return s;
}

async function put(key, value) {
  const existing = await db.select(T.name, { SettingKey: key });
  if (existing.length) await db.update(T.name, { SettingKey: key }, { SettingValue: value });
  else await db.insert(T.name, { SettingKey: key, SettingValue: value });
}

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

async function save(form, file) {
  const values = validate(form);
  if (file) {
    if (!FAVICON_TYPES.includes(file.mimetype)) throw new Error('The icon must be a PNG, ICO, JPG, GIF or WebP image.');
    if (file.buffer.length > FAVICON_MAX) throw new Error(`The icon is ${Math.round(file.buffer.length / 1024)} KB — please use one under 45 KB (a 64×64 or 180×180 PNG is ideal).`);
    values.Favicon = file.buffer.toString('base64');
    values.FaviconType = file.mimetype;
  }
  if (form.removeFavicon === '1' && !file) {
    values.Favicon = '';
    values.FaviconType = '';
  }
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

module.exports = { load, save, reset, warnings, themeCss, COLOURS, PRESETS, DEFAULTS };
