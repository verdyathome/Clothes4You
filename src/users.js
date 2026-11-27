// User accounts stored in Caspio (CSP_Users) with Admin / User roles.
// Passwords are stored only as scrypt hashes: nobody, Admins included, can read them.
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');
const { TABLES } = require('./config');

const scrypt = promisify(crypto.scrypt);
const T = TABLES.users;
const ROLES = ['Admin', 'User'];
const MIN_PASSWORD = 10;

// Usernames ignore capitals and surrounding spaces (phones capitalise the first letter).
const normUser = (u) => String(u || '').trim().toLowerCase();
const USERNAME_RE = /^[a-z0-9._-]{2,30}$/;

// ---------- Password hashing ----------
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, n, saltB64, keyB64] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(String(pw), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 });
  return crypto.timingSafeEqual(key, expected);
}
function checkPasswordRules(pw, username) {
  pw = String(pw || '');
  if (pw.length < MIN_PASSWORD) throw new Error(`Passwords must be at least ${MIN_PASSWORD} characters.`);
  if (pw.toLowerCase().includes(normUser(username)) && normUser(username).length > 2) throw new Error('The password must not contain the username.');
}

// ---------- Legacy USERS_JSON logins (only until the first Admin exists in Caspio) ----------
function envUsers() {
  try {
    const raw = JSON.parse(process.env.USERS_JSON || '{}');
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [normUser(k), String(v)]));
  } catch {
    if (process.env.USERS_JSON) console.error('USERS_JSON is not valid JSON.');
    return {};
  }
}
const legacy = envUsers();

// ---------- Cache (every page checks the user is still active) ----------
let cache = null;
let cacheAt = 0;
async function all(force = false) {
  if (!force && cache && Date.now() - cacheAt < 30 * 1000) return cache;
  cache = await db.select(T.name, {}, 'Username');
  cacheAt = Date.now();
  return cache;
}
const invalidate = () => { cache = null; };
const strip = (u) => u && ({ UserID: u.UserID, Username: u.Username, DisplayName: u.DisplayName, Role: u.Role, Active: !!u.Active, LastLogin: u.LastLogin, CreatedBy: u.CreatedBy });

async function list() { return (await all()).map(strip); }
async function getById(id) { return strip((await all()).find((u) => u.UserID === Number(id))); }
async function getByName(name) { return (await all()).find((u) => u.Username === normUser(name)) || null; }
const activeAdmins = (users) => users.filter((u) => u.Role === 'Admin' && u.Active);

async function tableReady() {
  try { await all(); return true; } catch { return false; }
}

// ---------- Login lockout: 5 wrong passwords → 15 minutes ----------
const failures = new Map();
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
function lockedFor(name) {
  const f = failures.get(name);
  if (!f || f.count < LOCK_AFTER) return 0;
  const left = f.at + LOCK_MS - Date.now();
  if (left <= 0) { failures.delete(name); return 0; }
  return Math.ceil(left / 60000);
}
function noteFailure(name) {
  const f = failures.get(name) || { count: 0, at: 0 };
  f.count += 1;
  f.at = Date.now();
  failures.set(name, f);
}

// Returns { user } on success, or { error }.
async function login(usernameRaw, password) {
  const name = normUser(usernameRaw);
  const mins = lockedFor(name);
  if (mins) return { error: `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };

  let users = null;
  try { users = await all(true); } catch (e) { console.warn(`CSP_Users not available (${e.message.slice(0, 100)})`); }
  const record = users && users.find((u) => u.Username === name);

  if (record) {
    const ok = await verifyPassword(password, record.PasswordHash);
    if (!ok || !record.Active) {
      noteFailure(name);
      return { error: 'Username or password not recognised.' };
    }
    failures.delete(name);
    db.update(T.name, { UserID: record.UserID }, { LastLogin: new Date().toISOString().slice(0, 19) }).catch(() => {});
    return { user: strip(record) };
  }

  // Legacy USERS_JSON: only while no Admin exists in Caspio. A successful legacy login is
  // copied into Caspio (with a hashed password); the first one becomes the Admin.
  const hasAdmin = users && activeAdmins(users).length > 0;
  if (!hasAdmin && Object.prototype.hasOwnProperty.call(legacy, name)) {
    const a = crypto.createHash('sha256').update(String(password)).digest();
    const b = crypto.createHash('sha256').update(legacy[name]).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      noteFailure(name);
      return { error: 'Username or password not recognised.' };
    }
    failures.delete(name);
    // FIRST_ADMIN (optional Railway variable) says who becomes the Admin; others become Users.
    // Without it, the first person to log in becomes the Admin.
    const firstAdmin = normUser(process.env.FIRST_ADMIN || '');
    const role = !firstAdmin || firstAdmin === name ? 'Admin' : 'User';
    if (users) {
      try {
        const created = await db.insert(T.name, {
          Username: name, DisplayName: name.charAt(0).toUpperCase() + name.slice(1), Role: role,
          PasswordHash: await hashPassword(legacy[name]), Active: true, CreatedBy: 'setup',
          LastLogin: new Date().toISOString().slice(0, 19),
        });
        invalidate();
        console.log(`"${name}" copied into CSP_Users from USERS_JSON as ${role}.`);
        return { user: strip(created), migrated: role };
      } catch (e) {
        console.error(`Could not create first Admin: ${e.message}`);
      }
    }
    // Users table missing: let the legacy login in so the app still works
    return { user: { UserID: 0, Username: name, DisplayName: name, Role: role, Active: true, legacy: true } };
  }

  // Same work for unknown usernames, so response time doesn't reveal which exist
  await verifyPassword(password, 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86));
  noteFailure(name);
  return { error: 'Username or password not recognised.' };
}

// ---------- Admin actions ----------
async function create(form, by) {
  const users = await all(true);
  const name = normUser(form.Username);
  if (!USERNAME_RE.test(name)) throw new Error('Usernames are 2–30 characters: letters, numbers, dots, dashes or underscores, no spaces.');
  if (users.some((u) => u.Username === name)) throw new Error(`There is already a user called "${name}".`);
  const role = ROLES.includes(form.Role) ? form.Role : 'User';
  checkPasswordRules(form.Password, name);
  if (form.Password !== form.Password2) throw new Error('The two passwords don\'t match.');
  const display = String(form.DisplayName || '').trim().slice(0, 60) || name;
  const created = await db.insert(T.name, {
    Username: name, DisplayName: display, Role: role, PasswordHash: await hashPassword(form.Password),
    Active: true, CreatedBy: by, LastLogin: null,
  });
  invalidate();
  return strip(created);
}

async function amend(id, form, by) {
  const users = await all(true);
  const u = users.find((x) => x.UserID === Number(id));
  if (!u) throw new Error('User not found.');
  const role = ROLES.includes(form.Role) ? form.Role : u.Role;
  const active = form.Active === '1';
  const others = activeAdmins(users).filter((a) => a.UserID !== u.UserID);
  if ((role !== 'Admin' || !active) && u.Role === 'Admin' && u.Active && !others.length) {
    throw new Error('This is the only Admin. Make someone else an Admin first.');
  }
  if (u.Username === by && !active) throw new Error('You can\'t disable your own account.');
  const fields = { DisplayName: String(form.DisplayName || '').trim().slice(0, 60) || u.Username, Role: role, Active: active };
  if (form.Password) {
    checkPasswordRules(form.Password, u.Username);
    if (form.Password !== form.Password2) throw new Error('The two passwords don\'t match.');
    fields.PasswordHash = await hashPassword(form.Password);
  }
  await db.update(T.name, { UserID: u.UserID }, fields);
  invalidate();
  return { ...strip(u), ...fields, PasswordHash: undefined, passwordChanged: !!form.Password };
}

async function removeUser(id, by) {
  const users = await all(true);
  const u = users.find((x) => x.UserID === Number(id));
  if (!u) throw new Error('User not found.');
  if (u.Username === by) throw new Error('You can\'t delete your own account.');
  if (u.Role === 'Admin' && u.Active && activeAdmins(users).length <= 1) throw new Error('This is the only Admin and can\'t be deleted.');
  await db.remove(T.name, { UserID: u.UserID });
  invalidate();
  return strip(u);
}

async function changeOwnPassword(username, current, next1, next2) {
  const u = await getByName(username);
  if (!u) throw new Error('Your account is still using the old Railway login. Ask the Admin to set up the Users table first.');
  if (!(await verifyPassword(current, u.PasswordHash))) throw new Error('Your current password is wrong.');
  checkPasswordRules(next1, u.Username);
  if (next1 !== next2) throw new Error('The two new passwords don\'t match.');
  await db.update(T.name, { UserID: u.UserID }, { PasswordHash: await hashPassword(next1) });
  invalidate();
}

// The signed-in user, re-checked against Caspio (cached 30 s), so a deleted or
// disabled user, or a role change, takes effect without waiting for them to log out.
async function current(username, legacyRole) {
  if (legacyRole) return { Username: username, DisplayName: username, Role: legacyRole, Active: true, legacy: true };
  try {
    const u = await getByName(username);
    return u && u.Active ? strip(u) : null;
  } catch {
    return null;
  }
}

module.exports = { ROLES, MIN_PASSWORD, normUser, login, list, getById, create, amend, removeUser, changeOwnPassword, current, tableReady, hashPassword, verifyPassword };
