#!/usr/bin/env node
// reach.mjs - the GROWER instrument. Which built things have actually reached a human?
//
//   node bin/reach.mjs           every registered project
//   node bin/reach.mjs --json
//
// WHY THIS EXISTS. The board answers "does it pass its tests". Nothing answered "has anyone ever
// used it". Those are completely different questions, and only the second one is the business.
//
// The evidence that this gap is real: a finished, packaged, priced product sat unpublished for
// eleven days with a green verify; ten compliance-checked ad scripts were written for a live
// client and nothing consumed any of them; and a 22/22 board sat on top of a two-client business.
// Green and unused looks identical to green and thriving on every instrument that existed.
//
// HOW IT DECIDES. Code changes when the BUILDER works. Artifacts change when a USER shows up.
// So this ignores source entirely and looks only at the directories that fill up because someone
// outside the machine did something: a document arrived, a letter went out, a reply came back,
// somebody applied. The newest file in those directories is the last time the world touched this
// project. If there are none, the project has never been used by anyone.
//
// Add project-specific evidence paths in projects.json:  "reachPaths": ["out/", "responses/"]

import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const expand = (p) => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

// Works with no setup at all:
//   node reach.mjs                 the current folder
//   node reach.mjs ../some-repo    that folder
//   node reach.mjs --registry projects.json    every project in a registry
function resolveTargets() {
  const rIdx = argv.indexOf('--registry');
  const regPath = rIdx !== -1 ? argv[rIdx + 1] : (fs.existsSync('projects.json') ? 'projects.json' : null);
  const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--registry');
  if (regPath && fs.existsSync(regPath)) {
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    return Object.entries(reg.projects || {}).map(([n, c]) => [n, { ...c, path: expand(c.path) }]);
  }
  const dir = path.resolve(pos[0] || '.');
  if (!fs.existsSync(dir)) { console.error(`no such folder: ${dir}`); process.exit(1); }
  return [[path.basename(dir), { path: dir }]];
}

// Directories that only grow when a real person does something. Deliberately NOT src/, lib/,
// bin/, test/ — those grow when the builder works, which proves nothing about reach.
const EVIDENCE = ['evidence', 'out', 'responses', 'mail', 'applications', 'clients', 'uploads',
  'inbox', 'received', 'submissions', 'orders', 'invoices'];
const SKIP = new Set(['node_modules', '.git', '__pycache__', 'dist', 'build', 'coverage']);

function newestUnder(dir, best = { at: 0, file: null }, n = { count: 0 }, depth = 0) {
  if (depth > 6) return best;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return best; }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) newestUnder(p, best, n, depth + 1);
    else {
      let st; try { st = fs.statSync(p); } catch { continue; }
      n.count += 1;
      if (st.mtimeMs > best.at) { best.at = st.mtimeMs; best.file = p; }
    }
  }
  return best;
}

const now = Date.now();
const rows = [];

for (const [name, cfg] of resolveTargets()) {
  const root = expand(cfg.path);
  if (!fs.existsSync(root)) { rows.push({ name, state: 'missing' }); continue; }

  const custom = Array.isArray(cfg.reachPaths) ? cfg.reachPaths : [];
  const dirs = [];
  for (const c of custom) { const p = path.join(root, c); if (fs.existsSync(p)) dirs.push(p); }
  // Evidence dirs can sit at the root or one level down (clients/<slug>/evidence).
  const scan = (base, depth) => {
    let entries; try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(base, e.name);
      if (EVIDENCE.includes(e.name.toLowerCase())) dirs.push(p);
      else if (depth < 2) scan(p, depth + 1);
    }
  };
  scan(root, 0);

  // "I looked and nobody has used it" and "I don't know where your artifacts land" are different
  // answers, and reporting the second as the first is a confident negative built on ignorance.
  // This tool guesses at folder names; when none of them exist, say so instead of accusing.
  if (!dirs.length) { rows.push({ name, state: 'unknown', lane: cfg.lane }); continue; }
  let best = { at: 0, file: null }; const n = { count: 0 };
  for (const d of new Set(dirs)) best = newestUnder(d, best, n);
  if (!best.file) { rows.push({ name, state: 'never', lane: cfg.lane, dirs: dirs.length }); continue; }
  rows.push({
    name, state: 'reached', lane: cfg.lane, artifacts: n.count,
    days: Math.floor((now - best.at) / 86400000),
    last: path.relative(root, best.file).replace(/\\/g, '/'),
  });
}

if (asJson) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const reached = rows.filter((r) => r.state === 'reached').sort((a, b) => a.days - b.days);
const never = rows.filter((r) => r.state === 'never');

console.log('# Reach — has anyone outside the machine ever used this?\n');
console.log('  REACHED (a real artifact exists)');
if (!reached.length) console.log('     none');
for (const r of reached) {
  const age = r.days === 0 ? 'today' : r.days === 1 ? 'yesterday' : `${r.days}d ago`;
  const warn = r.days > 30 ? '   << gone quiet' : '';
  console.log(`     ${r.name.padEnd(22)} ${String(r.artifacts).padStart(4)} artifacts   last ${age}${warn}`);
}
console.log('\n  NEVER REACHED (the folders exist and are empty — nobody has used it)');
if (!never.length) console.log('     none');
for (const r of never) console.log(`     ${r.name.padEnd(22)} ${r.lane === 'tier1' ? 'tier1' : ''}`);

const unknown = rows.filter((r) => r.state === 'unknown');
if (unknown.length) {
  console.log("\n  CAN'T TELL (none of the folders I look for exist here)");
  for (const u of unknown) console.log(`     ${u.name.padEnd(22)} ${u.lane === 'tier1' ? 'tier1' : ''}`);
  console.log('     ^ This is NOT "unused" — it means I do not know where your artifacts land.');
  console.log('       Tell me: add "reachPaths": ["out/", "invoices/"] to the project in your registry.');
}

console.log(`\n  ${reached.length} reached · ${never.length} never · ${unknown.length} can't tell`
  + ` · ${rows.filter((r) => r.state === 'missing').length} missing`);
console.log('  A green verify says the thing works. This says whether it matters yet.');
console.log('  "Never reached" is not a bug — it is a decision waiting to be made: ship it or park it.');
process.exit(0);
