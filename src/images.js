// Image processing for Settings: login background, app icons and iPhone launch screens.
const sharp = require('sharp');

// iPhone screen sizes (CSS points × scale) for apple-touch-startup-image.
// Portrait only; iOS picks the one whose media query matches the device.
const SPLASH_DEVICES = [
  { w: 440, h: 956, r: 3 },  // iPhone 17 Pro Max / 16 Pro Max
  { w: 402, h: 874, r: 3 },  // iPhone 17 / 17 Pro / 16 Pro
  { w: 420, h: 912, r: 3 },  // iPhone Air
  { w: 430, h: 932, r: 3 },  // iPhone 16 Plus / 15 Plus / 15 Pro Max / 14 Pro Max
  { w: 393, h: 852, r: 3 },  // iPhone 16 / 15 / 15 Pro / 14 Pro
  { w: 428, h: 926, r: 3 },  // iPhone 14 Plus / 13 Pro Max / 12 Pro Max
  { w: 390, h: 844, r: 3 },  // iPhone 14 / 13 / 13 Pro / 12 / 12 Pro
  { w: 375, h: 812, r: 3 },  // iPhone 13 mini / 12 mini / 11 Pro / X / XS
  { w: 414, h: 896, r: 3 },  // iPhone 11 Pro Max / XS Max
  { w: 414, h: 896, r: 2 },  // iPhone 11 / XR
  { w: 375, h: 667, r: 2 },  // iPhone SE (2nd/3rd gen) / 8
];
const SPLASH_SIZES = new Set(SPLASH_DEVICES.map((d) => `${d.w * d.r}x${d.h * d.r}`));
const ICON_SIZES = new Set([64, 180, 192, 512]);

// Default icon: a white coat hanger on the button colour (no fonts needed).
function defaultIconSvg(accent, ink = '#ffffff', size = 512, rounded = false) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${rounded ? 22 : 0}" fill="${accent}"/>
  <path d="M41.5 31a8.5 8.5 0 1 1 8.5 8.5v6.5 M50 46 L17 70 Q13 73 18 73 H82 Q87 73 83 70 Z" fill="none" stroke="${ink}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);
}

// Uploaded icon → square 512px PNG (centre-cropped).
async function processIcon(buffer) {
  return sharp(buffer, { failOn: 'error' }).rotate().resize(512, 512, { fit: 'cover' }).png({ palette: true, quality: 90, effort: 8 }).toBuffer();
}

// Small favicon (stored in a single text field) from the large icon.
async function smallIcon(png512) {
  return sharp(png512).resize(180, 180).png({ palette: true, quality: 85, effort: 8 }).toBuffer();
}

// Uploaded photo → WebP, max 1920px wide, compressed for storage in text fields.
async function processLoginBg(buffer) {
  let quality = 70;
  for (;;) {
    const out = await sharp(buffer, { failOn: 'error' }).rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 5 }).toBuffer();
    if (out.length <= 350 * 1024 || quality <= 40) return out;
    quality -= 10;
  }
}

async function iconPng(size, { iconLarge, accent, accentInk, rounded = false }) {
  const src = iconLarge || defaultIconSvg(accent, accentInk, 512, rounded);
  return sharp(src).resize(size, size).png().toBuffer();
}

// Launch screen: the icon centred on the page background colour.
async function splashPng(w, h, { iconLarge, accent, accentInk, bg }) {
  const iconSize = Math.round(Math.min(w, h) * 0.3);
  const r = Math.round(iconSize * 0.22);
  const mask = Buffer.from(`<svg width="${iconSize}" height="${iconSize}"><rect width="${iconSize}" height="${iconSize}" rx="${r}" ry="${r}"/></svg>`);
  const icon = await sharp(await iconPng(iconSize, { iconLarge, accent, accentInk }))
    .ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: bg } })
    .composite([{ input: icon, left: Math.round((w - iconSize) / 2), top: Math.round((h - iconSize) / 2 - h * 0.04) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

module.exports = { SPLASH_DEVICES, SPLASH_SIZES, ICON_SIZES, processIcon, smallIcon, processLoginBg, iconPng, splashPng };
