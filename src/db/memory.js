// In-memory backend for local testing (DATA_BACKEND=memory). Data is lost on restart.
const { TABLES } = require('../config');

const store = {};
const counters = {};
const attachments = {};
const idField = Object.fromEntries(Object.values(TABLES).map((t) => [t.name, t.id]));

function matches(row, filter) {
  return Object.entries(filter).every(([k, v]) => (v === null ? row[k] == null : row[k] === v));
}

async function select(table, filter = {}, orderBy) {
  let rows = (store[table] || []).filter((r) => matches(r, filter)).map((r) => ({ ...r }));
  if (orderBy) {
    const [field, dir] = orderBy.trim().split(/\s+/);
    const sign = /desc/i.test(dir || '') ? -1 : 1;
    rows.sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0));
  }
  return rows;
}

async function insert(table, row) {
  store[table] = store[table] || [];
  counters[table] = (counters[table] || 0) + 1;
  const created = { ...row, PK_ID: counters[table], [idField[table]]: counters[table] };
  store[table].push(created);
  return { ...created };
}

async function update(table, filter, fields) {
  let n = 0;
  for (const row of store[table] || []) {
    if (matches(row, filter)) {
      Object.assign(row, fields);
      n++;
    }
  }
  return n;
}

async function remove(table, filter) {
  const before = (store[table] || []).length;
  store[table] = (store[table] || []).filter((r) => !matches(r, filter));
  return before - store[table].length;
}

async function uploadAttachment(table, field, pkId, file) {
  attachments[`${table}/${field}/${pkId}`] = { buffer: file.buffer, contentType: file.mimetype };
  const row = (store[table] || []).find((r) => r.PK_ID === Number(pkId));
  if (row) row[field] = `/${file.filename}`;
}

async function downloadAttachment(table, field, pkId) {
  return attachments[`${table}/${field}/${pkId}`] || null;
}

module.exports = { select, insert, update, remove, uploadAttachment, downloadAttachment, name: 'memory' };
