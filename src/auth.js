// Simple login using users defined in the USERS_JSON environment variable:
//   USERS_JSON={"simon":"a-long-password","daughter":"another-long-password"}
const crypto = require('crypto');

function loadUsers() {
  try {
    const users = JSON.parse(process.env.USERS_JSON || '{}');
    if (!Object.keys(users).length) console.warn('WARNING: USERS_JSON is empty — nobody can log in.');
    return users;
  } catch {
    console.error('USERS_JSON is not valid JSON.');
    return {};
  }
}
const users = loadUsers();

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

function checkLogin(username, password) {
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

module.exports = { checkLogin, requireLogin };
