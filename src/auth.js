// Simple login using users defined in the USERS_JSON environment variable:
//   USERS_JSON={"simon":"a-long-password","daughter":"another-long-password"}
const crypto = require('crypto');

// Usernames are matched ignoring capitals and spaces at either end, because
// phone keyboards often capitalise the first letter or add a trailing space.
const normUser = (u) => String(u || '').trim().toLowerCase();

function loadUsers() {
  try {
    const raw = JSON.parse(process.env.USERS_JSON || '{}');
    const users = {};
    for (const [name, pass] of Object.entries(raw)) users[normUser(name)] = String(pass);
    if (!Object.keys(users).length) console.warn('WARNING: USERS_JSON is empty — nobody can log in.');
    else console.log(`Logins configured for: ${Object.keys(users).join(', ')}`);
    return users;
  } catch {
    console.error('USERS_JSON is not valid JSON — nobody can log in. Expected e.g. {"simon":"pass1","kate":"pass2"}');
    return {};
  }
}
const users = loadUsers();

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

function checkLogin(username, password) {
  username = normUser(username);
  const expected = Object.prototype.hasOwnProperty.call(users, username) ? users[username] : null;
  // Always compare to avoid leaking which usernames exist via timing.
  const ok = crypto.timingSafeEqual(hash(password), hash(expected ?? crypto.randomBytes(16)));
  return ok && expected !== null;
}

function requireLogin(req, res, next) {
  if (req.session && req.session.user) {
    res.locals.user = req.session.user;
    return next();
  }
  res.redirect('/login');
}

module.exports = { checkLogin, requireLogin, normUser };
