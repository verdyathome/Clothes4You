// Caspio REST API v3 adapter.
// Env: CASPIO_TOKEN_URL, CASPIO_REST_URL, CASPIO_CLIENT_ID, CASPIO_CLIENT_SECRET
// (copy the URLs from Caspio > Access Permissions > Web Services Profiles)
const TOKEN_URL = process.env.CASPIO_TOKEN_URL;
const REST_URL = (process.env.CASPIO_REST_URL || '').replace(/\/+$/, '');
const CLIENT_ID = process.env.CASPIO_CLIENT_ID;
const CLIENT_SECRET = process.env.CASPIO_CLIENT_SECRET;

let token = null;
let tokenExpires = 0;

async function getToken() {
  if (token && Date.now() < tokenExpires - 60000) return token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Caspio token request failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  token = json.access_token;
  tokenExpires = Date.now() + (json.expires_in || 3600) * 1000;
  return token;
}

async function call(method, path, { query, body } = {}) {
  const url = new URL(`${REST_URL}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Caspio ${method} ${path} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

// Build a safe WHERE clause from a { field: value } equality filter.
function whereFrom(filter = {}) {
  const parts = [];
  for (const [field, value] of Object.entries(filter)) {
    if (!/^[A-Za-z0-9_]+$/.test(field)) throw new Error(`Bad field name ${field}`);
    if (value === null) parts.push(`${field} IS NULL`);
    else if (typeof value === 'number') parts.push(`${field}=${Number(value)}`);
    else if (typeof value === 'boolean') parts.push(`${field}=${value ? 1 : 0}`);
    else parts.push(`${field}='${String(value).replace(/'/g, "''")}'`);
  }
  return parts.join(' AND ');
}

// Caspio returns dates as "2026-11-26T00:00:00" — normalise to YYYY-MM-DD.
function normalise(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? v.slice(0, 10) : v;
  }
  return out;
}

function toCaspio(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v;
  }
  return out;
}

async function select(table, filter = {}, orderBy) {
  const rows = [];
  const pageSize = 1000;
  for (let page = 1; page < 100; page++) {
    const json = await call('GET', `/tables/${table}/records`, {
      query: {
        'q.where': whereFrom(filter),
        'q.orderBy': orderBy,
        'q.pageNumber': page,
        'q.pageSize': pageSize,
      },
    });
    const result = json.Result || [];
    rows.push(...result.map(normalise));
    if (result.length < pageSize) break;
  }
  return rows;
}

async function insert(table, row) {
  const json = await call('POST', `/tables/${table}/records`, {
    query: { response: 'rows' },
    body: toCaspio(row),
  });
  const created = (json.Result || [])[0];
  if (!created) throw new Error(`Caspio insert into ${table} returned no row`);
  return normalise(created);
}

async function update(table, filter, fields) {
  const where = whereFrom(filter);
  if (!where) throw new Error('Refusing to update without a filter');
  const json = await call('PUT', `/tables/${table}/records`, {
    query: { 'q.where': where },
    body: toCaspio(fields),
  });
  return json.RecordsAffected ?? 0;
}

module.exports = { select, insert, update, name: 'caspio' };
