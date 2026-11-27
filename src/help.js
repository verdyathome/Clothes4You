// In-app user guides: Markdown files in /help, read once at start-up.
// Each file starts with a small header block:
//   ---
//   title: Recording a sale
//   order: 4
//   summary: One line shown on the Help page
//   pages: /sales/new, /sales      (pages whose "How does this work?" link opens this guide)
//   ---
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const DIR = path.join(__dirname, '..', 'help');

function parse(file) {
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  const body = m ? raw.slice(m[0].length) : raw;
  const slug = file.replace(/^\d+-/, '').replace(/\.md$/, '');
  return {
    slug,
    title: meta.title || slug,
    order: Number(meta.order) || 99,
    summary: meta.summary || '',
    pages: (meta.pages || '').split(',').map((p) => p.trim()).filter(Boolean),
    html: marked.parse(body),
    text: body.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[#*_`>|[\]()-]/g, ' ').replace(/\s+/g, ' ').trim(),
  };
}

let guides = [];
function load() {
  guides = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).map(parse).sort((a, b) => a.order - b.order)
    : [];
  return guides;
}
load();

const list = () => guides;
const get = (slug) => guides.find((g) => g.slug === slug);

// The guide for the page being viewed (longest matching path wins).
function forPath(p) {
  let best = null;
  let bestLen = -1;
  for (const g of guides) {
    for (const pg of g.pages) {
      const match = pg.endsWith('*') ? p.startsWith(pg.slice(0, -1)) : p === pg;
      if (match && pg.length > bestLen) { best = g; bestLen = pg.length; }
    }
  }
  return best;
}

function search(q) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return [];
  return guides
    .map((g) => {
      const hay = `${g.title} ${g.summary} ${g.text}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return null;
      const score = terms.reduce((s, t) => s + (g.title.toLowerCase().includes(t) ? 5 : 0) + hay.split(t).length - 1, 0);
      const at = g.text.toLowerCase().indexOf(terms[0]);
      const start = Math.max(0, at - 60);
      const snippet = (start ? '…' : '') + g.text.slice(start, start + 180) + (start + 180 < g.text.length ? '…' : '');
      return { ...g, score, snippet };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

module.exports = { list, get, forPath, search, load };
