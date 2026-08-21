#!/usr/bin/env node
// sweep.mjs - the SWEEPER pass. Finds what nothing reads, across EVERY registered project.
//
//   node bin/sweep.mjs                 report on every project in the registry
//   node bin/sweep.mjs <name>          one project
//   node bin/sweep.mjs --json          machine-readable
//
// IT NEVER DELETES. A sweeper that deletes on its own is how you lose the one file that
// mattered. This finds and reports; a human decides. Same rule as every other Tier-1 gate here.
//
// WHY THIS EXISTS. Cleanup has no deadline and blocks nothing, so it loses to building every
// single time. The evidence on this machine: a 55 MB dead engine sat in the tree for three weeks,
// 1,639 skills that were never registered sat for two months, and a deploy config pointed at a
// retired app until somebody went looking. None of it was found by a tool. It was found by
// getting suspicious, which does not scale.
//
// THREE CHECKS, chosen because each one has already caught something real here:
//
//   1. ORPHANED MODULE - a source file no other source file imports. Caught
//      an export script superseded one day after it was written.
//   2. TEST-ONLY MODULE - imported by tests and by nothing else. This is the subtle one:
//      the suite stays green and the code is dead. one retired subsystem was 55 MB kept alive by
//      35 test files and zero src imports, which is exactly why that repo's own orphan gate
//      reported clean.
//   3. WRITERLESS FILE - a zero-byte file nothing writes to. a log file in a real project
//      is a log file with no logger.
//
// FALSE-POSITIVE DISCIPLINE. A module counts as referenced if any source file imports it, OR its
// filename appears in package.json scripts, OR any .md in the project mentions it. Matching is on
// the full filename WITH extension - matching on the stem is how "round" matched "round 1" in 111
// files and produced a confidently wrong answer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.USERPROFILE || process.env.HOME || '.';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');

const expand = (p) => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
const SRC_EXT = new Set(['.mjs', '.js', '.cjs']);
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out',
  'graphify-out', '__pycache__', '.venv', 'venv',
  // Not our code, or deliberately disposable. Reporting these is how a checker gets ignored.
  'browser_profile', 'backups', 'fixtures', 'vendor', 'cache', '.cache']);

// A path that is scratch BY NAME is throwaway on purpose — flagging it is noise, and worse, it
// trains the reader to skim past real findings. Same for an underscore-prefixed script, which is
// this codebase's convention for a one-off.
const isScratch = (p) => /(^|[\\/])(scratch|sandbox|tmp|scrap)[^\\/]*[\\/]/i.test(p)
  || /(^|[\\/])_[^\\/]*\.[cm]?js$/.test(p)
  // Vendored and browser-served assets are loaded by a <script> tag, not imported by JS, so
  // "nothing imports it" is meaningless for them. htmx.min.js is not a dead module.
  || /(^|[\\/])(public|static|assets|dist)[\\/]/i.test(p)
  || /\.min\.[cm]?js$/i.test(p)
  // Userscripts run inside a browser extension and archives are kept on purpose.
  || /\.user\.[cm]?js$/i.test(p)
  || /(^|[\\/])(archive|archived|legacy)[^\\/]*[\\/]/i.test(p);

// Files whose emptiness is CORRECT and says nothing about whether code reads them.
const emptyIsFine = (base) => base === '__init__.py' || base === '.gitkeep' || base === '.keep'
  || base === 'LOCK' || base === 'LOG' || base === 'py.typed'
  || /-(wal|shm|journal)$/.test(base)           // SQLite sidecars
  || /\.(lock|pid|sock|tmp)$/i.test(base);
  // NOTE: .log is deliberately NOT excluded. An empty log whose filename appears nowhere in the
  // source is a log nothing will ever write — that is exactly how a log file in a real project
  // was found. An empty log that IS named in the code has simply not logged yet, and the
  // reference check below already lets that through.

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p, out, depth + 1); }
    else out.push(p);
  }
  return out;
}

const isTest = (p) => /(^|[\\/])(test|tests|__tests__|spec)[\\/]/i.test(p) || /\.(test|spec)\.[cm]?js$/i.test(p);

function sweepProject(name, cfg) {
  const root = expand(cfg.path);
  const finding = { project: name, root, deadDirs: [], orphans: [], testOnly: [], writerless: [], error: null };
  if (!fs.existsSync(root)) { finding.error = 'path not found'; return finding; }

  // PER-PROJECT OPT-OUT, the same idiom as _ignore in this registry: an explicit decision beats a
  // silent gap. Some projects are a FLEET of entry points — a workers/ directory where every file
  // is launched by a scheduler, not imported by anything. "Nothing imports it" is meaningless
  // there, and reporting 83 of them buries the findings that matter. Add to projects.json:
  //     "sweepIgnore": ["workers/", "backtest/"]
  const ignore = Array.isArray(cfg.sweepIgnore) ? cfg.sweepIgnore : [];
  const ignored = (rel) => ignore.some((g) => rel === g || rel.startsWith(g.replace(/\/*$/, '/')));

  const files = walk(root).filter((f) => !ignored(path.relative(root, f).replace(/\\/g, '/')));
  const src = files.filter((f) => SRC_EXT.has(path.extname(f)));

  // SAY WHAT YOU COULD NOT SEE. This tool reads JavaScript only. Run it on a Python, PHP, Ruby or
  // Go project and it will scan nothing, find nothing, and — before this line existed — print a
  // clean result. That is an instrument reporting success while blind, which is the exact failure
  // this kit exists to catch. It would be absurd to ship it with that bug.
  finding.scanned = src.length;
  finding.otherLangs = [...new Set(files.map((f) => path.extname(f))
    .filter((e) => ['.py', '.rb', '.php', '.go', '.rs', '.java', '.cs', '.ts', '.tsx'].includes(e)))];
  const srcNonTest = src.filter((f) => !isTest(f));
  const srcTest = src.filter(isTest);

  // Everything that could name a module: source text, package scripts, and prose.
  const readAll = (list) => list.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } });
  const nonTestText = readAll(srcNonTest).join('\n');
  const testText = readAll(srcTest).join('\n');
  let scripts = '';
  try { scripts = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {}); } catch { /* none */ }
  const docs = readAll(files.filter((f) => path.extname(f) === '.md')).join('\n');

  // An entry point is referenced by the world, not by the tree — but ONLY at the top of the
  // project or of src/. A nested panel/server.mjs is not an entry point just because it is
  // called server.mjs, and treating it as one is how 55 MB of dead engine stayed invisible.
  const ENTRY = /^(src\/)?(index|main|server|cli|app)\.[cm]?js$/i;

  for (const f of srcNonTest) {
    const base = path.basename(f);
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (ENTRY.test(rel) || isScratch(f)) continue;

    // MATCH ON parent/base, NOT base alone. `server.mjs` appears in a project that has both
    // src/server.mjs and panel/server.mjs, so basename matching credits one file's imports to
    // the other and both look alive. The parent directory is what an import specifier carries
    // (`../panel/stage-runner.mjs`), so it disambiguates. Top-level files fall back to basename.
    const parent = path.basename(path.dirname(f));
    const needle = parent && parent !== path.basename(root) ? `${parent}/${base}` : base;
    const count = (text, s) => {
      let n = 0, i = 0;
      while ((i = text.indexOf(s, i)) !== -1) { n += 1; i += s.length; }
      return n;
    };
    // ...but a bare basename still counts WHEN IT IS UNAMBIGUOUS. Plenty of real calls pass only
    // the filename (`run('state-snapshot.mjs')`), and requiring the parent would mark every one
    // of those dead. Only trust the bare name when exactly one file in the project has it —
    // otherwise we are back to crediting panel/server.mjs with src/server.mjs's imports.
    const unique = srcNonTest.filter((x) => path.basename(x) === base).length === 1;
    const refs = (text) => count(text, needle) + (unique && needle !== base ? count(text, base) : 0);
    // A file often names itself in its own header comment; that is not a reference.
    const inSrc = refs(nonTestText) - refs(fs.readFileSync(f, 'utf8'));
    const inTests = refs(testText);
    // DOCS ONLY COUNT FOR ENTRY POINTS. A CLI under bin/ is invoked by a human reading a doc, so
    // being documented IS its reference. A module under src/ or lib/ is invoked by code — prose
    // mentioning it proves nothing. Letting docs vouch for library modules is what hid
    // one retired subsystem: 55 MB, zero src imports, kept "alive" by its own README.
    // A file at the PROJECT ROOT is an entry point by convention — you run it directly. Requiring
    // bin/ or scripts/ marked every root-level CLI as an orphan, which is how a tool ends up
    // reporting itself as dead code on its own first run.
    const isEntry = /(^|[\\/])(bin|scripts)[\\/]/.test(f) || !rel.includes('/');
    // The registry's own verify command is a reference. A project's verify.mjs is invoked by the
    // board on every run; nothing in the tree imports it, and that is correct.
    const inVerify = (cfg.verify || '').includes(base);
    const named = scripts.includes(base) || inVerify || (isEntry && docs.includes(base));
    const size = fs.statSync(f).size;

    if (inSrc === 0 && inTests > 0 && !named) {
      finding.testOnly.push({ file: rel, kb: Math.round(size / 102.4) / 10, testRefs: inTests });
    } else if (inSrc === 0 && inTests === 0 && !named) {
      finding.orphans.push({ file: rel, kb: Math.round(size / 102.4) / 10 });
    }
  }

  // ---- DEAD DIRECTORY -------------------------------------------------------------------
  // The check the other three structurally cannot make. A dead SUBSYSTEM vouches for itself:
  // panel/ has 24 modules that import each other, so every one of them looks referenced, while
  // nothing outside panel/ has touched it in weeks. Counting references per file can never see
  // this. Counting references per DIRECTORY, from outside that directory only, sees it instantly.
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || SKIP_DIR.has(d.name) || d.name.startsWith('.')) continue;
    if (['test', 'tests', 'docs', 'migrations', 'data', 'public', 'static', 'assets'].includes(d.name)) continue;
    if (ignored(d.name) || isScratch(`${d.name}/x.mjs`)) continue;  // scratch/archive are kept on purpose
    const dirFiles = files.filter((f) => path.relative(root, f).replace(/\\/g, '/').startsWith(`${d.name}/`));
    const mods = dirFiles.filter((f) => SRC_EXT.has(path.extname(f)) && !isTest(f));
    if (mods.length < 3) continue;                       // too small to call a subsystem
    const outside = srcNonTest.filter((f) => !path.relative(root, f).replace(/\\/g, '/').startsWith(`${d.name}/`));
    const outsideText = readAll(outside).join('\n');
    const fromOutside = outsideText.split(`${d.name}/`).length - 1;
    const fromTests = testText.split(`${d.name}/`).length - 1;
    if (fromOutside === 0) {
      const kb = Math.round(dirFiles.reduce((n, f) => { try { return n + fs.statSync(f).size; } catch { return n; } }, 0) / 1024);
      finding.deadDirs.push({ dir: `${d.name}/`, modules: mods.length, kb, testRefs: fromTests });
    }
  }

  for (const f of files) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (st.size !== 0) continue;
    const base = path.basename(f);
    if (emptyIsFine(base) || isScratch(f)) continue;
    const written = nonTestText.includes(base) || scripts.includes(base) || docs.includes(base);
    if (!written) finding.writerless.push({ file: path.relative(root, f).replace(/\\/g, '/') });
  }
  return finding;
}


// ---------------------------------------------------------------------------------------------
// WHERE DO WE LOOK? Works three ways, in order, so there is nothing to set up before the first run:
//
//   node sweep.mjs                    scan the current folder as one project
//   node sweep.mjs ../some-repo       scan that folder
//   node sweep.mjs --registry projects.json    scan every project listed in a registry
//
// The registry is the grown-up version (see projects.example.json) and is entirely optional. Most
// people should just run it in a repo and look at what comes back.
function resolveTargets(argv) {
  const rIdx = argv.indexOf('--registry');
  const regPath = rIdx !== -1 ? argv[rIdx + 1]
    : (fs.existsSync('projects.json') ? 'projects.json' : null);
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--registry');

  if (regPath && fs.existsSync(regPath)) {
    let reg;
    try { reg = JSON.parse(fs.readFileSync(regPath, 'utf8')); }
    catch (e) { console.error(`cannot read ${regPath}: ${e.message}`); process.exit(1); }
    const home = process.env.USERPROFILE || process.env.HOME || '.';
    const ex = (p) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p);
    let rows = Object.entries(reg.projects || {}).map(([n, c]) => [n, { ...c, path: ex(c.path) }]);
    if (positional.length) rows = rows.filter(([n]) => positional.includes(n));
    if (!rows.length) { console.error('registry matched no projects'); process.exit(1); }
    return rows;
  }
  const dir = path.resolve(positional[0] || '.');
  if (!fs.existsSync(dir)) { console.error(`no such folder: ${dir}`); process.exit(1); }
  return [[path.basename(dir), { path: dir }]];
}

// ---- run ---
const projects = resolveTargets(argv);

const results = projects.map(([n, c]) => sweepProject(n, c));

if (asJson) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

console.log('# Sweeper pass — what nothing reads\n');

// Blind spots first, before any findings — otherwise "nothing found" reads as "all clear".
const blind = results.filter((r) => !r.error && r.scanned === 0);
for (const r of blind) {
  const langs = r.otherLangs.length ? r.otherLangs.join(', ') : 'no recognised source files';
  console.log(`  ${r.project}`);
  console.log(`     NOT CHECKED — no JavaScript here (found: ${langs}).`);
  console.log('     This tool reads .js/.mjs/.cjs only. Treat this project as UNSCANNED, not clean.\n');
}

let total = 0;
for (const r of results) {
  if (r.scanned === 0 && !r.error) continue;
  const n = r.deadDirs.length + r.orphans.length + r.testOnly.length + r.writerless.length;
  if (r.error) { console.log(`  ${r.project.padEnd(22)} ${r.error}`); continue; }
  if (!n) continue;
  total += n;
  console.log(`  ${r.project}`);
  // ROLL UP BY DIRECTORY. "panel/ is dead" is ONE decision; 24 separate lines about panel/ is a
  // wall the reader skims. A whole directory going dark is also a bigger, clearer finding than
  // any single file in it.
  const roll = (list, label) => {
    const byDir = new Map();
    for (const o of list) {
      const dir = o.file.includes('/') ? o.file.slice(0, o.file.indexOf('/')) : '.';
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(o);
    }
    for (const [dir, items] of byDir) {
      const kb = Math.round(items.reduce((n, i) => n + i.kb, 0));
      if (items.length >= 4 && dir !== '.') {
        console.log(`     ${label} ${dir}/  — ${items.length} modules, ${kb} KB, nothing in src imports any of them`);
      } else {
        for (const o of items) {
          const extra = o.testRefs ? `, ${o.testRefs} test refs` : '';
          console.log(`     ${label} ${o.file}  (${o.kb} KB${extra})`);
        }
      }
    }
  };
  for (const d of r.deadDirs) {
    const t = d.testRefs ? ` — only its own tests reach it (${d.testRefs} refs)` : ' — nothing reaches it at all';
    console.log(`     DEAD DIR    ${d.dir}  ${d.modules} modules, ${d.kb} KB${t}`);
  }
  roll(r.testOnly, 'TEST-ONLY  ');
  roll(r.orphans, 'ORPHAN     ');
  for (const o of r.writerless) console.log(`     WRITERLESS  ${o.file}  (0 bytes, no writer)`);
  console.log('');
}

// "Nothing found" and "nothing looked at" are completely different results and must never print
// the same sentence. Always state the denominator.
const scannedTotal = results.reduce((n, r) => n + (r.scanned || 0), 0);
if (!total && !scannedTotal) {
  console.log('  NOTHING WAS SCANNED — no JavaScript found. This is not a clean result.\n');
} else if (!total) {
  console.log(`  Nothing found — all ${scannedTotal} JavaScript file(s) are read by something.\n`);
} else {
  console.log(`${total} finding(s) across ${results.filter((r) => r.deadDirs.length + r.orphans.length + r.testOnly.length + r.writerless.length).length} project(s).`);
  console.log('DEAD DIR is the big one: a whole subsystem nothing outside it reaches.');
  console.log('TEST-ONLY is the subtle one: the suite stays green while the code is dead.');
  console.log('Nothing was deleted. Decide each one, then archive rather than delete.');
}
process.exit(0);
