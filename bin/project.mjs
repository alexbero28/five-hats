#!/usr/bin/env node
// project.mjs -- the project-agnostic spine of the Five Hats. Makes the SAME
// closing-the-loop machinery work on EVERY project, not one. Reads projects.json
// (the registry) and answers "is this project healthy?" by running that project's
// OWN binary verify command -- the general form of the "fitness gate". Correctness
// is universal (every project has a verify); win-rate/outcome signal is optional
// and project-specific (a project may register an outcome_adapter).
//
// This is what generalizes the work: loop-architect reads a project's verify from
// here, autonomy-track records runs per project, and `health --all` is one board
// across the whole portfolio.
//
// READ-ONLY + BOUNDED: it RUNS each project's verify (observing exit code) but
// never edits project files, never commits, never deploys. It only reads the
// registry and reports. A missing/failing verify is a finding, not a tool crash.
//
// Usage:
//   node bin/project.mjs list                 # the registry + reachability
//   node bin/project.mjs health <name>        # run one project's verify
//   node bin/project.mjs health --all         # health board across all projects
//   node bin/project.mjs verify-of <name>     # print the binary verify (for loops)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PM = path.resolve(HERE, '..');
const REGISTRY = path.join(PM, 'projects.json');

function expand(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function loadFull() {
  if (!fs.existsSync(REGISTRY)) { console.error(`project.mjs: no registry at ${REGISTRY}`); process.exit(2); }
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
}

function loadRegistry() {
  return loadFull().projects || {};
}

function resolveDir(p) {
  const root = expand(p.path);
  const dir = p.cwd ? path.join(root, p.cwd) : root;
  return { root, dir };
}

// WHICH BASH - 2026-08-20. THE BOARD WAS REPORTING THE WHOLE PORTFOLIO RED WHILE IT WAS GREEN.
//
// This spawned plain 'bash', and on this machine PATH resolves that to
// %LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe - the WSL stub. WSL has no node and no python on
// its PATH, and its filesystem root is different (~ resolves differently there than in the Windows profile). So
// every node/python verify exited 127 "command not found" in ~175ms and the board printed RED for
// 21 of 22 projects whose suites actually pass. The only GREEN was the one verify made of nothing
// but grep.
//
// That is the worst possible failure for a health instrument: it did not break loudly, it lied
// quietly, and the lie was recorded into health-log.jsonl as an all-red board.
//
// Git Bash is the shell these verifies are written for. It is found next to git itself, which is
// the robust way to locate it - wherever git came from, its bash is a sibling. The WindowsApps
// stub is rejected by name because resolving it is always wrong here.
function resolveBash() {
  if (process.env.WFOS_BASH && fs.existsSync(process.env.WFOS_BASH)) return process.env.WFOS_BASH;
  if (process.platform !== 'win32') return 'bash';
  const candidates = [];
  // Derive from git.exe: <git>/cmd/git.exe -> <git>/bin/bash.exe
  const which = spawnSync('where', ['git'], { encoding: 'utf8' });
  if (which.status === 0) {
    for (const line of (which.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      candidates.push(path.join(path.dirname(path.dirname(line)), 'bin', 'bash.exe'));
    }
  }
  candidates.push(
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
  );
  for (const c of candidates) {
    if (c && !/WindowsApps/i.test(c) && fs.existsSync(c)) return c;
  }
  return 'bash';   // last resort; the note below will say what happened
}
const BASH = resolveBash();

// Run a project's binary verify. Returns { state, exit, ms, note }.
//   state: 'green' | 'red' | 'no-verify' | 'missing-path' | 'error'
function runVerify(p, { timeoutMs = 600000 } = {}) {
  const { root, dir } = resolveDir(p);
  if (!fs.existsSync(root)) return { state: 'missing-path', note: `path not found: ${root}` };
  if (!p.verify) return { state: 'no-verify', note: 'no verify command wired yet' };
  const started = Date.now();
  const res = spawnSync(BASH, ['-c', p.verify], {
    cwd: dir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
  });
  // A shell that cannot find the interpreter is an ERROR, not a red project. 127 is the shell's
  // own "command not found" - conflating it with a failing suite is precisely how this went
  // unnoticed, because RED looks like a result and ERROR looks like a question.
  if (res.status === 127) {
    return {
      state: 'error',
      ms: Date.now() - started,
      note: `shell could not find the command (exit 127) using ${BASH}. `
        + 'Set WFOS_BASH to a bash that has node/python on PATH.',
    };
  }
  const ms = Date.now() - started;
  if (res.error) {
    if (res.error.code === 'ENOENT') return { state: 'error', ms, note: 'bash not found to run verify' };
    if (res.error.code === 'ETIMEDOUT') return { state: 'error', ms, note: `timed out after ${Math.round(ms / 1000)}s` };
    return { state: 'error', ms, note: res.error.message };
  }
  return { state: res.status === 0 ? 'green' : 'red', exit: res.status, ms, note: p.verify };
}

function fmtMs(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 90000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

const MARK = { green: 'GREEN', red: 'RED  ', 'no-verify': 'NO-VERIFY', 'missing-path': 'NO-PATH', error: 'ERROR' };

function cmdList() {
  const reg = loadRegistry();
  console.log('# Five Hats -- project registry\n');
  for (const [name, p] of Object.entries(reg)) {
    const { root } = resolveDir(p);
    const exists = fs.existsSync(root) ? 'ok ' : 'MISSING';
    console.log(`  ${name.padEnd(20)} [${p.lane || '?'}·${p.strength || '?'}] ${exists}  ${expand(p.path)}${p.cwd ? '/' + p.cwd : ''}`);
    console.log(`  ${' '.repeat(20)} verify: ${p.verify || '(none wired)'}`);
    if (p.outcome_adapter) console.log(`  ${' '.repeat(20)} outcome-adapter: ${p.outcome_adapter}`);
  }
  console.log('\n_verify = the binary gate a loop drives to green. (none wired) = a gap to close before looping there._');
}

// Exit-code severity: 0 healthy, 3 no-verify (a GAP, not green), 1 real failure.
function severity(state) {
  if (state === 'green') return 0;
  if (state === 'no-verify') return 3;
  return 1; // red | error | missing-path
}
// Board label folds gate STRENGTH into a green mark so GREEN.parse (syntax only)
// never reads the same as GREEN.tests (a real suite).
function label(state, p) {
  return state === 'green' ? `GREEN·${p.strength || '?'}` : (MARK[state] || state);
}

const HEALTH_LOG = path.join(PM, 'self-improve-runs', 'health-log.jsonl');
function appendHealthLog(results) {
  try {
    fs.mkdirSync(path.dirname(HEALTH_LOG), { recursive: true });
    fs.appendFileSync(HEALTH_LOG, `${JSON.stringify({ ts: new Date().toISOString(), results })}\n`);
  } catch { /* history is best-effort; never block the board */ }
}

function cmdHealth(arg) {
  const reg = loadRegistry();
  if (arg && arg !== '--all') {
    const p = reg[arg];
    if (!p) { console.error(`project.mjs: unknown project '${arg}'. Try: ${Object.keys(reg).join(', ')}`); process.exit(2); }
    const r = runVerify(p);
    console.log(`${label(r.state, p)}  ${arg}  ${fmtMs(r.ms)}`);
    console.log(`  ${r.note}`);
    process.exit(severity(r.state));
  }
  // --all board
  console.log('# Health board -- all projects (GREEN.<strength>: parse<lint<types<tests<live)\n');
  let worst = 0;
  const rows = [];
  const results = {};
  for (const [name, p] of Object.entries(reg)) {
    const r = runVerify(p);
    rows.push([name, r]);
    results[name] = r.state;
    const sev = severity(r.state);                       // 1 hard-fail > 3 gap > 0 ok
    if (sev === 1) worst = 1;
    else if (sev === 3 && worst !== 1) worst = 3;
    console.log(`  ${label(r.state, p).padEnd(12)} ${name.padEnd(20)} ${fmtMs(r.ms).padStart(6)}  ${r.state === 'green' ? '' : r.note}`);
  }
  appendHealthLog(results);
  const green = rows.filter(([, r]) => r.state === 'green').length;
  const noverify = rows.filter(([, r]) => r.state === 'no-verify').length;
  console.log(`\n  ${green}/${rows.length} green` + (noverify ? `  ·  ${noverify} without a verify (close these gaps)` : ''));
  console.log('  (history appended to self-improve-runs/health-log.jsonl -> session-start prints deltas)');
  process.exit(worst);
}

function cmdVerifyOf(name) {
  const reg = loadRegistry();
  const p = reg[name];
  if (!p) { console.error(`unknown project '${name}'`); process.exit(2); }
  if (!p.verify) { console.error(`project '${name}' has no verify wired`); process.exit(1); }
  const { dir } = resolveDir(p);
  console.log(JSON.stringify({ name, cwd: dir, verify: p.verify, lane: p.lane }, null, 2));
}

// scan: enforce that EVERY dir under the scan root is either registered or
// explicitly ignored -- so nothing (present or future) silently escapes the
// intelligence. Read-only. Exit 3 (a gap) if any unclaimed dir exists.
function cmdScan() {
  const full = loadFull();
  const reg = full.projects || {};
  const scanRoot = expand(full._scan_root || '..');
  const ignore = new Set(full._ignore || []);
  if (!fs.existsSync(scanRoot)) { console.error(`scan: root not found: ${scanRoot}`); process.exit(2); }

  // basenames of registered projects that live directly under the scan root
  const registered = new Set();
  for (const p of Object.values(reg)) {
    const root = expand(p.path);
    if (path.dirname(root) === scanRoot) registered.add(path.basename(root));
  }

  const dirs = fs.readdirSync(scanRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '.git')
    .map((e) => e.name);

  const unclaimed = dirs.filter((d) => !registered.has(d) && !ignore.has(d));
  console.log(`# Five Hats -- coverage scan of ${scanRoot}\n`);
  console.log(`  registered under root: ${[...registered].sort().join(', ') || '(none)'}`);
  console.log(`  ignored (by design):   ${[...ignore].sort().join(', ') || '(none)'}`);
  if (unclaimed.length === 0) {
    console.log('\n  ✓ every dir is registered or ignored -- the spine covers the whole folder.');
    process.exit(0);
  }
  console.log(`\n  ⚠ ${unclaimed.length} dir(s) OUTSIDE the spine -- register or add to _ignore:`);
  for (const d of unclaimed) console.log(`      ${d}   ->  node bin/project.mjs add ${d} --path ../${d} --verify '<binary cmd>'`);
  console.log('\n  (a dir that is neither registered nor ignored is a project running without the intelligence.)');
  process.exit(3);
}

// add: one-command onboarding so a new project joins the spine with the full
// column (verify, lane, strength, state). Writes the registry in place.
function cmdAdd(argv) {
  const name = argv.find((a) => !a.startsWith('--'));
  if (!name) { console.error("usage: project.mjs add <name> --path <p> [--cwd <c>] [--verify '<cmd>'] [--lane fast|tier1] [--strength parse|lint|types|tests|live] [--state <s>] [--note '<n>']"); process.exit(2); }
  const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const full = loadFull();
  full.projects = full.projects || {};
  if (full.projects[name]) { console.error(`add: '${name}' already registered. Edit projects.json to change it.`); process.exit(2); }
  const entry = {
    path: flag('path', `../${name}`),
    cwd: flag('cwd', ''),
    verify: flag('verify', null),
    lane: flag('lane', 'tier1'),
    strength: flag('strength', flag('verify', null) ? 'lint' : 'parse'),
    state: flag('state', null),
    note: flag('note', 'Registered via project.mjs add. Set a real binary verify to close the gap.'),
  };
  full.projects[name] = entry;
  fs.writeFileSync(REGISTRY, `${JSON.stringify(full, null, 2)}\n`);
  console.log(`✓ registered '${name}' [${entry.lane}·${entry.strength}]`);
  console.log(`  path:   ${entry.path}${entry.cwd ? '/' + entry.cwd : ''}`);
  console.log(`  verify: ${entry.verify || '(none -- wire a binary verify next; this is a GAP, not green)'}`);
  if (!entry.verify) process.exit(3);
}

// secrets: run the machine-wide secret-guard audit over every registered repo's
// TRACKED files. The pre-commit/pre-push hooks are the continuous guard; this is
// the on-demand board ("is anything private already committed anywhere?"). Exit 3
// if any repo has a finding, so `node os.mjs secrets && <ship>` composes.
function cmdSecrets() {
  const reg = loadRegistry();
  const guard = path.join(PM, 'bin', 'secret-guard.mjs');
  let dirty = 0, scanned = 0;
  console.log('# secret-guard audit — tracked files, every registered repo\n');
  for (const [name, p] of Object.entries(reg)) {
    const dir = expand(p.path);
    if (!fs.existsSync(path.join(dir, '.git'))) continue;
    scanned++;
    const r = spawnSync(process.execPath, [guard, '--audit', dir], { encoding: 'utf8' });
    if (r.status === 0) {
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } else {
      dirty++;
      console.log(`  \x1b[31m✖ ${name}\x1b[0m`);
      const lines = (r.stdout + r.stderr).split('\n').filter((l) => /✖|:\d+/.test(l));
      lines.forEach((l) => console.log(`      ${l.trim()}`));
    }
  }
  console.log(`\n  ${scanned} repo(s) scanned · ${dirty === 0 ? 'all clean' : dirty + ' with findings'}`);
  process.exit(dirty === 0 ? 0 : 3);
}

const argv = process.argv.slice(2);
const [cmd, arg] = argv;
switch (cmd) {
  case 'list': cmdList(); break;
  case 'health': cmdHealth(arg); break;
  case 'verify-of': cmdVerifyOf(arg); break;
  case 'scan': cmdScan(); break;
  case 'secrets': cmdSecrets(); break;
  case 'add': cmdAdd(argv.slice(1)); break;
  default:
    console.error('usage: project.mjs list | health <name|--all> | verify-of <name> | scan | secrets | add <name> --path ... [--verify ...]');
    process.exit(2);
}
