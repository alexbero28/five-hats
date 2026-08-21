#!/usr/bin/env node
// hotspots.mjs — where the work actually hurts.
//
//   node hotspots.mjs <path>                 one project
//   node hotspots.mjs --registry <file>      everything you own
//   node hotspots.mjs --months 12            how far back to look (default 12)
//   node hotspots.mjs --json
//
// READ-ONLY. It reads git history and counts lines. It changes nothing and runs no AI.
//
// WHY THIS EXISTS. The other checks answer "what is dead", "who used it" and "what is decaying".
// None of them answer the question people actually feel: WHERE IS THIS SLOW AND PAINFUL. That
// question has a cheap, deterministic answer hiding in git history, and almost nobody looks.
//
// THE SIGNAL. A file that changes constantly is where your effort goes. A file that is large is
// expensive to change. A file with no test is dangerous to change. A file that is repeatedly
// FIXED is one you keep getting wrong. Individually each is weak. Together they identify, with
// no cleverness at all, the handful of files that eat a disproportionate share of a team's life.
//
// WHAT THIS IS NOT. It does not read your code for meaning, judge quality, or find bugs. It
// cannot: it is counting, not comprehending. A hot file is not automatically a bad file — the
// core of a healthy project is usually its most-changed file, and that is correct. What deserves
// attention is hot AND large AND untested AND repeatedly fixed. The output says which is which
// instead of implying that churn alone is a defect.
//
// The judgment about what to DO belongs to a human, and the reading-for-meaning belongs to your
// AI, which can open these files. This just tells it which ten to open first.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !String(argv[i - 1] || '').startsWith('--'));
const MONTHS = Number(val('months') || 12);
const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const expand = (p) => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

// Git Bash on Windows, plain sh elsewhere. Same selection drift.mjs makes.
const SHELL = (() => {
  if (process.platform !== 'win32') return 'bash';
  for (const c of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) {
    if (fs.existsSync(c)) return c;
  }
  return 'bash';
})();
const sh = (cwd, cmd) => {
  const r = spawnSync(SHELL, ['-c', `cd "${cwd}" && ${cmd}`], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return (r.status === 0 && r.stdout) ? r.stdout : '';
};

const CODE = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.php', '.go',
  '.rs', '.java', '.cs', '.swift', '.kt', '.sql', '.sh']);
const SKIP = /(^|\/)(node_modules|dist|build|vendor|\.venv|venv|__pycache__|coverage|graphify-out)\//;
const isTest = (p) => /(^|\/)(tests?|__tests__|spec)\//i.test(p)
  || /(^|\/)test_[^/]*$/i.test(p) || /_test\.[a-z]+$/i.test(p) || /\.(test|spec)\.[a-z]+$/i.test(p);

function analyse(name, root) {
  const out = { project: name, root, files: [], error: null, commits: 0, noGit: false };
  if (!fs.existsSync(root)) { out.error = 'path not found'; return out; }
  if (!fs.existsSync(path.join(root, '.git'))) {
    // SAY WHAT YOU CANNOT SEE. Without history there is no churn signal at all — this is not a
    // project with no hotspots, it is a project this check cannot look at.
    out.noGit = true;
    return out;
  }

  const since = `--since="${MONTHS} months ago"`;
  // One pass: commit marker lines, then the files that commit touched.
  const log = sh(root, `git log ${since} --no-merges --format="@@%H|%s" --name-only 2>/dev/null`);
  if (!log.trim()) { out.error = `no commits in the last ${MONTHS} months`; return out; }

  const churn = new Map();   // file -> {n, fixes, authors:Set}
  let fixCommit = false, commits = 0, author = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) {
      commits += 1;
      const subject = line.slice(line.indexOf('|') + 1);
      fixCommit = /\b(fix|bug|hotfix|revert|broken|regression|patch)\b/i.test(subject);
      continue;
    }
    const f = line.trim();
    if (!f || SKIP.test(f) || !CODE.has(path.extname(f))) continue;
    if (!churn.has(f)) churn.set(f, { n: 0, fixes: 0 });
    const c = churn.get(f);
    c.n += 1;
    if (fixCommit) c.fixes += 1;
  }
  out.commits = commits;

  // Which files does a test even mention? Cheap proxy — a stem match inside any test file.
  const testText = [];
  const walk = (d, depth = 0) => {
    if (depth > 6) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      const rel = path.relative(root, p).replace(/\\/g, '/');
      if (e.isDirectory()) { if (!SKIP.test(`${rel}/`)) walk(p, depth + 1); }
      else if (isTest(rel) && CODE.has(path.extname(e.name))) {
        try { testText.push(fs.readFileSync(p, 'utf8')); } catch { /* skip */ }
      }
    }
  };
  walk(root);
  const allTests = testText.join('\n');

  for (const [rel, c] of churn) {
    if (isTest(rel)) continue;                 // a busy test file is not a hotspot
    const abs = path.join(root, rel);
    let lines = 0;
    try { lines = fs.readFileSync(abs, 'utf8').split('\n').length; } catch { continue; }  // deleted since
    const base = path.basename(rel);
    const stem = base.slice(0, base.length - path.extname(base).length);
    const tested = allTests.includes(base) || new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(allTests);
    // Effort concentrates where churn meets size. Both matter; neither alone is a finding.
    const score = c.n * Math.log10(Math.max(lines, 10));
    out.files.push({ file: rel, changes: c.n, fixes: c.fixes, lines, tested, score });
  }
  out.files.sort((a, b) => b.score - a.score);
  return out;
}

// ---- targets ---------------------------------------------------------------------------------
const regPath = val('registry') || (fs.existsSync('projects.json') ? 'projects.json' : null);
let targets;
if (regPath && fs.existsSync(regPath)) {
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  targets = Object.entries(reg.projects || {}).map(([n, c]) => [n, expand(c.path)]);
} else {
  const dir = path.resolve(positional[0] || '.');
  targets = [[path.basename(dir), dir]];
}

const results = targets.map(([n, r]) => analyse(n, r));
if (flag('json')) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

// ---- report -----------------------------------------------------------------------------------
console.log(`# Hotspots — where the work actually goes  ${`(last ${MONTHS} months)`}\n`);

const blind = results.filter((r) => r.noGit || r.error);
for (const r of blind) {
  const why = r.noGit ? 'no git history — churn cannot be measured at all here' : r.error;
  console.log(`  ${r.project}`);
  console.log(`     NOT MEASURED — ${why}. This is not "no hotspots".\n`);
}

let shown = 0;
for (const r of results) {
  if (r.noGit || r.error || !r.files.length) continue;
  shown += 1;
  const risky = r.files.filter((f) => !f.tested || f.fixes >= 2);
  console.log(`  ${r.project}   ${`${r.commits} commits`}`);
  for (const f of r.files.slice(0, 6)) {
    const marks = [];
    if (!f.tested) marks.push('NO TEST');
    if (f.fixes >= 2) marks.push(`${f.fixes} fix commits`);
    const tag = marks.length ? `  <- ${marks.join(' · ')}` : '';
    console.log(`     ${String(f.changes).padStart(3)} changes  ${String(f.lines).padStart(5)} lines   ${f.file}${tag}`);
  }
  if (risky.length) {
    const top = risky[0];
    console.log(`     ${'\u2192'} start with ${top.file} — changed ${top.changes}x, ${top.lines} lines`
      + `${top.tested ? '' : ', nothing tests it'}${top.fixes >= 2 ? `, ${top.fixes} of those were fixes` : ''}`);
  }
  console.log('');
}

if (!shown) {
  console.log('  Nothing measurable. Every target either has no git history or no commits in the window.\n');
} else {
  console.log('  Churn is where your effort goes. It is NOT a defect on its own — the core of a');
  console.log('  healthy project is usually its most-changed file, and that is correct.');
  console.log('  What earns attention is CHANGED OFTEN + LARGE + UNTESTED, or a file whose history');
  console.log('  is mostly fixes. Those are the ones costing you time you have not noticed.\n');
  console.log('  This counts. It does not read your code for meaning and cannot tell you WHY a');
  console.log('  file is hot. That part is yours, or your AI\'s — this just says which to open first.\n');
}
process.exit(0);
