#!/usr/bin/env node
// sweep.mjs - the SWEEPER pass. Finds what nothing reads.
//
//   node sweep.mjs                     scan the current folder
//   node sweep.mjs <path>              scan that folder
//   node sweep.mjs --registry <file>   scan every project in a registry
//   node sweep.mjs --json              machine-readable
//   node sweep.mjs --langs             print what it can and cannot analyse, and why
//
// IT NEVER DELETES. A sweeper that deletes on its own is how you lose the one file that
// mattered. This finds and reports; a human decides.
//
// WHY THIS EXISTS. Cleanup has no deadline and blocks nothing, so it loses to building every
// single time. The evidence: a 55 MB dead engine sat in a tree for three weeks, 1,639 skills
// that were never registered sat for two months, and a deploy config pointed at a retired app
// until somebody went looking. None of it was found by a tool. It was found by getting
// suspicious, which does not scale.
//
// FOUR CHECKS, each of which has already caught something real:
//
//   1. DEAD DIR - a whole subsystem nothing outside it reaches. The big one.
//   2. TEST-ONLY - imported by tests and by nothing else. The subtle one: the suite stays
//      green and the code is dead.
//   3. ORPHAN - a source file nothing references at all.
//   4. WRITERLESS - a zero-byte file nothing writes to.
//
// LANGUAGES. Different languages name their modules in completely different ways, and getting
// that wrong produces confident nonsense rather than a missed finding. Measured on a real
// 187-file Python project: only 11 of 40 live modules are ever referenced by filename, while
// 40 of 40 are referenced by import. So "just add .py to the extension list" would have
// reported 29 of 40 live modules dead - a 72% false-positive rate, which is worse than no
// check at all because it teaches people to ignore the output.
//
// Every language therefore declares what can honestly be computed for it (see LANGS below),
// and this prints that declaration rather than implying full coverage. `--langs` shows it.

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const HOME = process.env.USERPROFILE || process.env.HOME || '.';

const expand = (p) => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out',
  'graphify-out', '__pycache__', '.venv', 'venv', 'site-packages', '.pytest_cache', '.mypy_cache',
  'vendor', 'target', 'Pods',
  // Not our code, or deliberately disposable. Reporting these is how a checker gets ignored.
  'browser_profile', 'backups', 'fixtures', 'cache', '.cache']);

// ---------------------------------------------------------------------------------------------
// LANGUAGE CAPABILITY TABLE — the honest answer to "what can you actually tell me?"
//
// `checks` is the whole point. A language lists ONLY what can be computed correctly for it.
// Anything absent is reported as not-checked rather than silently skipped, because a clean
// result from an instrument that never looked is the failure this whole kit exists to catch.
// ---------------------------------------------------------------------------------------------
const LANGS = {
  js: {
    name: 'JavaScript',
    ext: ['.mjs', '.js', '.cjs'],
    checks: ['deadDir', 'testOnly', 'orphan'],
    // JS import specifiers carry the extension, so the filename WITH extension is the needle.
    // Matching on the stem is how "round" matched "round 1" in 111 files and produced a
    // confidently wrong answer.
    style: 'filename',
    entry: /^(src\/)?(index|main|server|cli|app)\.[cm]?js$/i,
    isTest: (p) => /(^|[\\/])(test|tests|__tests__|spec)[\\/]/i.test(p) || /\.(test|spec)\.[cm]?js$/i.test(p),
  },
  ts: {
    name: 'TypeScript',
    ext: ['.ts', '.tsx'],
    checks: ['deadDir', 'testOnly', 'orphan'],
    // TS/ESM imports usually DROP the extension (`from './thing'`), so match the stem as a path
    // segment as well as the full filename.
    style: 'stem-or-filename',
    entry: /^(src\/)?(index|main|server|cli|app)\.tsx?$/i,
    isTest: (p) => /(^|[\\/])(test|tests|__tests__|spec)[\\/]/i.test(p) || /\.(test|spec)\.tsx?$/i.test(p),
  },
  py: {
    name: 'Python',
    // DEAD DIR is deliberately absent. In Python the top-level package directory usually IS the
    // whole project, so "nothing outside it reaches it" is trivially true and the check inverts:
    // tested against 5 real Python repos it produced exactly one finding, and that finding was
    // wrong (a 342-module package in a repo with 2 files outside it).
    checks: ['testOnly', 'orphan'],
    ext: ['.py'],
    style: 'import',
    entry: /^[^/]+\.py$/,          // a root-level script is run directly
    isTest: (p) => /(^|[\\/])(tests?)[\\/]/i.test(p) || /(^|[\\/])test_[^\\/]*\.py$/i.test(p) || /_test\.py$/i.test(p),
  },
  // ---- detected, declared, NOT analysed -------------------------------------------------------
  go: {
    name: 'Go', ext: ['.go'], checks: [],
    why: 'Go imports a package PATH, never a filename, so no per-file reference exists to count. '
       + 'File-level dead code needs a real parser here; counting cannot do it.',
  },
  rs: {
    name: 'Rust', ext: ['.rs'], checks: [],
    why: 'modules are declared with `mod`, and the file/module mapping needs the crate graph.',
  },
  rb: {
    name: 'Ruby', ext: ['.rb'], checks: [],
    why: '`require_relative` drops the extension and autoloading resolves by constant name.',
  },
  php: {
    name: 'PHP', ext: ['.php'], checks: [],
    why: 'PSR-4 autoloading resolves by class name, so nothing in the source names the file.',
  },
  other: {
    name: 'Other', ext: ['.java', '.cs', '.swift', '.kt'], checks: [],
    why: 'no reference grammar has been written and verified for this language yet.',
  },
};

const EXT_TO_LANG = {};
for (const [key, L] of Object.entries(LANGS)) for (const e of L.ext) EXT_TO_LANG[e] = key;

if (argv.includes('--langs')) {
  console.log('# sweep — what can be analysed, and what cannot\n');
  for (const [, L] of Object.entries(LANGS)) {
    if (L.checks.length) {
      const ALL = ['deadDir', 'testOnly', 'orphan'];
      const missing = ALL.filter((c) => !L.checks.includes(c));
      const gap = missing.length ? `   (no ${missing.join(', ')})` : '';
      console.log(`  ${L.name.padEnd(12)} ${L.checks.join(' · ')}${gap}`);
    }
    else console.log(`  ${L.name.padEnd(12)} NOT ANALYSED — ${L.why}`);
  }
  console.log('\n  A language is never silently skipped. If it is here and unsupported, sweep says so on every run.');
  process.exit(0);
}

// A path that is scratch BY NAME is throwaway on purpose — flagging it is noise, and worse, it
// trains the reader to skim past real findings.
const isScratch = (p) => /(^|[\\/])(scratch|sandbox|tmp|scrap)[^\\/]*[\\/]/i.test(p)
  || /(^|[\\/])_[^\\/]*\.[cm]?js$/.test(p)
  // Vendored and browser-served assets are loaded by a <script> tag, not imported, so
  // "nothing imports it" is meaningless for them. htmx.min.js is not a dead module.
  || /(^|[\\/])(public|static|assets|dist)[\\/]/i.test(p)
  || /\.min\.[cm]?js$/i.test(p)
  || /\.user\.[cm]?js$/i.test(p)
  || /(^|[\\/])(archive|archived|legacy)[^\\/]*[\\/]/i.test(p);

// Files whose emptiness is CORRECT and says nothing about whether code reads them.
const emptyIsFine = (base) => base === '__init__.py' || base === '.gitkeep' || base === '.keep'
  || base === 'LOCK' || base === 'LOG' || base === 'py.typed'
  || /-(wal|shm|journal)$/.test(base)
  || /\.(lock|pid|sock|tmp)$/i.test(base);

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name) && !e.name.endsWith('.egg-info')) walk(p, out, depth + 1); }
    else out.push(p);
  }
  return out;
}

const countStr = (text, s) => {
  let n = 0, i = 0;
  while ((i = text.indexOf(s, i)) !== -1) { n += 1; i += s.length; }
  return n;
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// How each language NAMES a module in a reference. This is the part that must not be guessed.
function referenceCounter(langKey, ctx) {
  const { base, stem, parent, uniqueBase, uniqueStem } = ctx;
  const L = LANGS[langKey];

  if (L.style === 'filename') {
    // Match parent/base, not base alone: `server.mjs` exists in both src/ and panel/, so
    // basename matching credits one file's imports to the other and both look alive.
    const needle = parent ? `${parent}/${base}` : base;
    return (text) => countStr(text, needle) + (uniqueBase && needle !== base ? countStr(text, base) : 0);
  }

  if (L.style === 'stem-or-filename') {
    const needle = parent ? `${parent}/${base}` : base;
    const stemNeedle = parent ? `${parent}/${stem}` : stem;
    return (text) => countStr(text, needle)
      + (uniqueBase && needle !== base ? countStr(text, base) : 0)
      + (uniqueStem ? countStr(text, `/${stem}'`) + countStr(text, `/${stem}"`) + countStr(text, stemNeedle) : 0);
  }

  // Python: a module is named by its STEM inside import grammar, never by its filename.
  // Anchoring to the keyword is what keeps the stem from matching ordinary prose.
  const s = esc(stem);
  const pats = [
    new RegExp(`\\bimport\\s+[\\w.]*\\b${s}\\b`, 'g'),
    new RegExp(`\\bfrom\\s+[\\w.]*\\b${s}\\b\\s+import`, 'g'),
    new RegExp(`\\bfrom\\s+\\.+\\s*import\\s+[^\\n]*\\b${s}\\b`, 'g'),
    new RegExp(`\\b${s}\\.py\\b`, 'g'),
  ];
  // `stem.attr` only counts when the stem is unambiguous — otherwise a common word like
  // `config.get` credits every config.py in the tree.
  if (uniqueStem) pats.push(new RegExp(`\\b${s}\\.[a-zA-Z_]`, 'g'));
  return (text) => pats.reduce((n, p) => n + ((text.match(p) || []).length), 0);
}

function sweepProject(name, cfg) {
  const root = expand(cfg.path);
  const finding = {
    project: name, root, deadDirs: [], orphans: [], testOnly: [], writerless: [],
    scanned: 0, byLang: {}, notAnalysed: [], error: null,
  };
  if (!fs.existsSync(root)) { finding.error = 'path not found'; return finding; }

  // PER-PROJECT OPT-OUT. Some projects are a FLEET of entry points — a workers/ directory where
  // every file is launched by a scheduler, not imported. "Nothing imports it" is meaningless
  // there, and reporting 83 of them buries the findings that matter.
  //     "sweepIgnore": ["workers/", "backtest/"]
  const ignore = Array.isArray(cfg.sweepIgnore) ? cfg.sweepIgnore : [];
  const ignored = (rel) => ignore.some((g) => rel === g || rel.startsWith(g.replace(/\/*$/, '/')));

  const files = walk(root).filter((f) => !ignored(path.relative(root, f).replace(/\\/g, '/')));
  const rel = (f) => path.relative(root, f).replace(/\\/g, '/');
  const readAll = (list) => list.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } });

  // Group every source file by the language that owns its extension.
  const byLang = {};
  for (const f of files) {
    const k = EXT_TO_LANG[path.extname(f)];
    if (k) (byLang[k] ||= []).push(f);
  }

  let scripts = '';
  try { scripts = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {}); } catch { /* none */ }
  const docs = readAll(files.filter((f) => path.extname(f) === '.md')).join('\n');
  const allSourceText = readAll(files.filter((f) => EXT_TO_LANG[path.extname(f)])).join('\n');

  for (const [langKey, langFiles] of Object.entries(byLang)) {
    const L = LANGS[langKey];

    // SAY WHAT YOU CANNOT SEE — per language, on every run, even when other languages scanned
    // fine. The old version only warned when NOTHING was scanned, so a mixed JavaScript/Python
    // project got a confident report with no mention that 121 Python files were never opened.
    if (!L.checks.length) {
      finding.notAnalysed.push({ lang: L.name, files: langFiles.length, why: L.why });
      continue;
    }

    finding.byLang[L.name] = langFiles.length;
    finding.scanned += langFiles.length;

    // DYNAMIC LOADING BREAKS COUNTING, so say so instead of crying wolf. A plugin architecture
    // loads modules by NAME at runtime — `importlib.import_module(name)`, `await import(path)` —
    // and no amount of reading the source can see that reference. Caught on a real project where
    // two prompt modules were reported orphaned while main.py loaded them dynamically by config.
    // The finding is not suppressed (it might still be dead) but it is no longer stated flatly.
    const DYNAMIC = langKey === 'py'
      ? /\bimportlib\.import_module\s*\(|\b__import__\s*\(|spec_from_file_location\s*\(/
      : /\bimport\s*\(\s*[^'"`)]|\brequire\s*\(\s*[^'"`)]/;
    if (DYNAMIC.test(readAll(langFiles).join('\n'))) {
      finding.dynamicLoad = finding.dynamicLoad || [];
      if (!finding.dynamicLoad.includes(L.name)) finding.dynamicLoad.push(L.name);
    }

    const srcNonTest = langFiles.filter((f) => !L.isTest(rel(f)));
    const srcTest = langFiles.filter((f) => L.isTest(rel(f)));
    const nonTestText = readAll(srcNonTest).join('\n');
    const testText = readAll(srcTest).join('\n');

    for (const f of srcNonTest) {
      const base = path.basename(f);
      const stem = base.slice(0, base.length - path.extname(base).length);
      const r = rel(f);
      if (L.entry.test(r) || isScratch(f)) continue;
      // FILE-BASED ROUTING. A file under api/ or pages/ IS the route — the framework invokes it
      // by its path, and nothing imports it, ever. Reporting `api/stripe-webhook.js` as dead code
      // is a confident lie about a live payment endpoint, and it teaches the reader to skim.
      // The convention is the reference here, exactly as a docs mention is for a bin/ CLI.
      if (/(^|\/)(api|pages|routes|functions|endpoints)\//i.test(r)) continue;
      // Python conventions that mean "this is run, not imported".
      if (langKey === 'py') {
        if (['__init__.py', '__main__.py', 'setup.py', 'conftest.py', 'manage.py'].includes(base)) continue;
        let self = '';
        try { self = fs.readFileSync(f, 'utf8'); } catch { /* unreadable */ }
        if (/if\s+__name__\s*==\s*['"]__main__['"]/.test(self)) continue;  // a runnable script
      }

      const parentDir = path.basename(path.dirname(f));
      const parent = parentDir && parentDir !== path.basename(root) ? parentDir : '';
      const uniqueBase = srcNonTest.filter((x) => path.basename(x) === base).length === 1;
      const uniqueStem = srcNonTest.filter((x) => {
        const b = path.basename(x);
        return b.slice(0, b.length - path.extname(b).length) === stem;
      }).length === 1;

      const count = referenceCounter(langKey, { base, stem, parent, uniqueBase, uniqueStem });
      let selfText = '';
      try { selfText = fs.readFileSync(f, 'utf8'); } catch { /* unreadable */ }
      // A file often names itself in its own header comment; that is not a reference.
      const inSrc = count(nonTestText) - count(selfText);
      const inTests = count(testText);

      // DOCS ONLY COUNT FOR ENTRY POINTS. A CLI under bin/ is invoked by a human reading a doc,
      // so being documented IS its reference. A module under src/ is invoked by code — prose
      // mentioning it proves nothing. Letting docs vouch for library modules is what hid a
      // 55 MB subsystem kept "alive" by its own README.
      const isEntry = /(^|[\\/])(bin|scripts)[\\/]/.test(f) || !r.includes('/');
      const inVerify = (cfg.verify || '').includes(base);
      const named = scripts.includes(base) || inVerify || (isEntry && docs.includes(base));
      let size = 0;
      try { size = fs.statSync(f).size; } catch { /* gone */ }
      const kb = Math.round(size / 102.4) / 10;

      if (inSrc <= 0 && inTests > 0 && !named) {
        finding.testOnly.push({ file: r, kb, testRefs: inTests, lang: L.name });
      } else if (inSrc <= 0 && inTests === 0 && !named) {
        finding.orphans.push({ file: r, kb, lang: L.name });
      }
    }

    // ---- DEAD DIRECTORY, only where it is honest ---------------------------------------------
    // The check the other three structurally cannot make: a dead SUBSYSTEM vouches for itself,
    // because its 24 modules import each other and every one looks referenced. Counting
    // references from OUTSIDE the directory sees it instantly.
    if (!L.checks.includes('deadDir')) continue;
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || SKIP_DIR.has(d.name) || d.name.startsWith('.')) continue;
      if (['test', 'tests', 'docs', 'migrations', 'data', 'public', 'static', 'assets'].includes(d.name)) continue;
      if (ignored(d.name) || isScratch(`${d.name}/x.mjs`)) continue;
      if (finding.deadDirs.some((x) => x.dir === `${d.name}/`)) continue;
      const dirFiles = files.filter((f) => rel(f).startsWith(`${d.name}/`));
      const mods = dirFiles.filter((f) => L.ext.includes(path.extname(f)) && !L.isTest(rel(f)));
      if (mods.length < 3) continue;
      // A directory holding essentially the whole project cannot be "unreached" in any
      // meaningful sense — there is nothing outside it to do the reaching.
      const outside = srcNonTest.filter((f) => !rel(f).startsWith(`${d.name}/`));
      if (outside.length < 3) continue;
      const fromOutside = readAll(outside).join('\n').split(`${d.name}/`).length - 1;
      const fromTests = testText.split(`${d.name}/`).length - 1;
      if (fromOutside === 0) {
        const kb = Math.round(dirFiles.reduce((n, f) => {
          try { return n + fs.statSync(f).size; } catch { return n; }
        }, 0) / 1024);
        finding.deadDirs.push({ dir: `${d.name}/`, modules: mods.length, kb, testRefs: fromTests });
      }
    }
  }

  // ---- WRITERLESS — language-agnostic, so it runs over everything -----------------------------
  // NOTE: .log is deliberately NOT excluded. An empty log whose filename appears nowhere in the
  // source is a log nothing will ever write.
  for (const f of files) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (st.size !== 0) continue;
    const base = path.basename(f);
    if (emptyIsFine(base) || isScratch(f)) continue;
    const written = allSourceText.includes(base) || scripts.includes(base) || docs.includes(base);
    if (!written) finding.writerless.push({ file: rel(f) });
  }
  return finding;
}

// ---------------------------------------------------------------------------------------------
// WHERE DO WE LOOK? Three ways, in order, so there is nothing to set up before the first run.
function resolveTargets(args) {
  const rIdx = args.indexOf('--registry');
  const regPath = rIdx !== -1 ? args[rIdx + 1]
    : (fs.existsSync('projects.json') ? 'projects.json' : null);
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--registry');

  if (regPath && fs.existsSync(regPath)) {
    let reg;
    try { reg = JSON.parse(fs.readFileSync(regPath, 'utf8')); }
    catch (e) { console.error(`cannot read ${regPath}: ${e.message}`); process.exit(1); }
    let rows = Object.entries(reg.projects || {}).map(([n, c]) => [n, { ...c, path: expand(c.path) }]);
    if (positional.length) rows = rows.filter(([n]) => positional.includes(n));
    if (!rows.length) { console.error('registry matched no projects'); process.exit(1); }
    return rows;
  }
  const dir = path.resolve(positional[0] || '.');
  if (!fs.existsSync(dir)) { console.error(`no such folder: ${dir}`); process.exit(1); }
  return [[path.basename(dir), { path: dir }]];
}

// ---- run ---
const results = resolveTargets(argv).map(([n, c]) => sweepProject(n, c));

if (asJson) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

console.log('# Sweeper pass — what nothing reads\n');

// Blind spots FIRST, before any findings — otherwise "nothing found" reads as "all clear".
for (const r of results) {
  if (r.error || (!r.notAnalysed.length && r.scanned)) continue;
  console.log(`  ${r.project}`);
  if (!r.scanned) console.log('     NOTHING WAS ANALYSED HERE — treat this project as UNSCANNED, not clean.');
  for (const n of r.notAnalysed) {
    console.log(`     NOT ANALYSED  ${n.lang} (${n.files} file(s)) — ${n.why}`);
  }
  console.log('');
}

let total = 0;
for (const r of results) {
  const n = r.deadDirs.length + r.orphans.length + r.testOnly.length + r.writerless.length;
  if (r.error) { console.log(`  ${r.project.padEnd(22)} ${r.error}`); continue; }
  if (!n) continue;
  total += n;
  const langs = Object.entries(r.byLang).map(([k, v]) => `${k} ${v}`).join(' · ');
  console.log(`  ${r.project}${langs ? `   [analysed: ${langs}]` : ''}`);
  // ROLL UP BY DIRECTORY. "panel/ is dead" is ONE decision; 24 separate lines is a wall the
  // reader skims.
  const roll = (list, label) => {
    const byDir = new Map();
    for (const o of list) {
      const dir = o.file.includes('/') ? o.file.slice(0, o.file.indexOf('/')) : '.';
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(o);
    }
    for (const [dir, items] of byDir) {
      const kb = Math.round(items.reduce((a, i) => a + i.kb, 0));
      if (items.length >= 4 && dir !== '.') {
        console.log(`     ${label} ${dir}/  — ${items.length} modules, ${kb} KB, nothing references any of them`);
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
  if (r.dynamicLoad && r.orphans.length) {
    console.log(`     ! this project loads ${r.dynamicLoad.join('/')} modules DYNAMICALLY (by name, at runtime).`);
    console.log('       Those references cannot be seen by reading source, so check ORPHAN findings');
    console.log('       against your plugin/config wiring before believing them.');
  }
  console.log('');
}

// "Nothing found" and "nothing looked at" are completely different results and must never print
// the same sentence. Always state the denominator.
const scannedTotal = results.reduce((n, r) => n + (r.scanned || 0), 0);
const blindTotal = results.reduce((n, r) => n + r.notAnalysed.reduce((a, x) => a + x.files, 0), 0);
if (!total && !scannedTotal) {
  console.log('  NOTHING WAS ANALYSED. This is not a clean result.\n');
} else if (!total) {
  console.log(`  Nothing found — all ${scannedTotal} analysed file(s) are read by something.`);
  if (blindTotal) console.log(`  ${blindTotal} file(s) in unsupported languages were NOT analysed (see above).`);
  console.log('');
} else {
  console.log(`${total} finding(s) across ${results.filter((r) => r.deadDirs.length + r.orphans.length + r.testOnly.length + r.writerless.length).length} project(s).`);
  console.log('DEAD DIR is the big one: a whole subsystem nothing outside it reaches.');
  console.log('TEST-ONLY is the subtle one: the suite stays green while the code is dead.');
  if (blindTotal) console.log(`${blindTotal} file(s) were NOT analysed at all — run --langs to see why.`);
  console.log('Nothing was deleted. Decide each one, then archive rather than delete.');
}
process.exit(0);
