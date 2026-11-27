// Sign-in checks. Accounts and roles live in src/users.js (Caspio table CSP_Users).
const users = require('./users');

// Every signed-in page: re-check the account still exists, is active, and read its role.
async function requireLogin(req, res, next) {
  try {
    if (!req.session || !req.session.user) return res.redirect('/login');
    const u = await users.current(req.session.user, req.session.legacyRole);
    if (!u) {
      req.session = null;
      return res.redirect('/login');
    }
    req.user = u;
    res.locals.user = u.Username;
    res.locals.displayName = u.DisplayName || u.Username;
    res.locals.isAdmin = u.Role === 'Admin';
    res.locals.role = u.Role;
    next();
  } catch (e) {
    next(e);
  }
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.Role === 'Admin') return next();
  res.status(403).render('error', { message: 'Only an Admin can use this page.' });
}

module.exports = { requireLogin, requireAdmin, normUser: users.normUser };
