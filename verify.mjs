#!/usr/bin/env node
// verify.mjs — this kit's own binary gate. Exit 0 = healthy.
//
// A kit that preaches "every project needs one command that returns pass or fail" and does not
// have one itself would be worth ignoring. This is that command.
//
//   node verify.mjs

import fs, { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { KIT_VERSION } from './kit-version.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fail = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { fail.push(m); console.log(`  FAIL ${m}`); };
console.log('five-hats-kit verify\n');

const CHECKS = ['sweep.mjs', 'reach.mjs', 'drift.mjs', 'baseline.mjs', 'fix.mjs', 'hotspots.mjs', 'archetypes.mjs', 'pulse.mjs'];
// start.mjs is checked for presence and parse but NOT run here: it refuses (exit 1) when its
// target holds no project-shaped folders, which is correct behaviour and would fail this gate.
// install.mjs and results.mjs refuse for the same reason, and both get their own full-exercise
// checks (7 and 8 below) against a sandbox instead — running them bare would prove less.
const TOOLS = ['bin/project.mjs', 'bin/secret-guard.mjs', 'start.mjs', 'install.mjs', 'results.mjs', 'kit-version.mjs'];

// 1. Everything the README promises is actually here.
for (const f of [...CHECKS, ...TOOLS, 'README.md', 'DOCTRINE.md', 'SETUP.md', 'projects.example.json', '.private-terms.example']) {
  existsSync(join(root, f)) ? ok(`${f} present`) : bad(`missing ${f}`);
}

// 2. The example registry parses. A broken example is worse than none.
try {
  const j = JSON.parse(readFileSync(join(root, 'projects.example.json'), 'utf8'));
  if (!j.projects || !Object.keys(j.projects).length) bad('example registry has no projects');
  else ok(`example registry parses (${Object.keys(j.projects).length} samples)`);
} catch (e) { bad(`example registry is invalid JSON: ${e.message}`); }

// 3. Every tool parses.
for (const f of [...CHECKS, ...TOOLS]) {
  try { execFileSync(process.execPath, ['--check', join(root, f)], { stdio: 'pipe' }); ok(`${f} parses`); }
  catch (e) { bad(`${f}: ${String(e.stderr || e).split('\n')[0]}`); }
}

// 4. THE ONE THAT MATTERS. Each check must actually RUN with zero configuration and exit 0.
//    Parsing proves the file compiles. This proves a stranger's first command works — which is
//    the only thing standing between "interesting" and "they never ran it".
for (const f of CHECKS) {
  try {
    const out = execFileSync(process.execPath, [join(root, f), root],
      { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
    if (!out.trim()) bad(`${f} ran but printed nothing`);
    else ok(`${f} runs with no config`);
  } catch (e) { bad(`${f} failed to run: ${String(e.stderr || e.message).split('\n')[0]}`); }
}

// 4a. EVERY OUTPUT MODE, not just the default one. `--report` and `--save` take separate code
//     paths, and a ReferenceError in the HTML path shipped because this gate only ever ran
//     baseline bare. The run that produced the report announced success with the report missing.
try {
  const tmp = join(root, '.verify-tmp');
  execFileSync(process.execPath, [join(root, 'baseline.mjs'), root, '--save', '--report', '--no-ai'],
    { encoding: 'utf8', stdio: 'pipe', timeout: 120000, cwd: root });
  const made = readdirSync(root).filter((f) => /^baseline-\d{4}-\d{2}-\d{2}\.(json|html)$/.test(f));
  if (made.length === 2) ok('baseline.mjs --save --report writes both files');
  else bad(`baseline --save --report produced ${made.length} file(s), expected 2`);
  for (const f of made) unlinkSync(join(root, f));
  if (existsSync(tmp)) unlinkSync(tmp);
} catch (e) {
  bad(`baseline --save --report failed: ${String(e.stderr || e.message).split('\n').find((l) => /Error/.test(l)) || String(e.message).split('\n')[0]}`);
}

// 4b. The spine needs a registry to do anything, so prove it works against the shipped EXAMPLE —
//     the same file a stranger copies in step 3 of SETUP.md. Never clobber a real one.
const reg = join(root, 'projects.json');
const hadReg = existsSync(reg);
try {
  if (!hadReg) writeFileSync(reg, readFileSync(join(root, 'projects.example.json'), 'utf8'));
  const out = execFileSync(process.execPath, [join(root, 'bin/project.mjs'), 'list'],
    { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
  out.trim() ? ok('bin/project.mjs runs against the example registry') : bad('bin/project.mjs printed nothing');
} catch (e) {
  bad(`bin/project.mjs failed to run: ${String(e.stderr || e.message).split('\n')[0]}`);
} finally {
  if (!hadReg && existsSync(reg)) unlinkSync(reg);
}

// 4c. The guard must run AND find nothing here. This doubles as proof the kit ships no secrets.
try {
  execFileSync(process.execPath, [join(root, 'bin/secret-guard.mjs'), '--audit', root],
    { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
  ok('bin/secret-guard.mjs runs and finds no secret in this kit');
} catch (e) {
  bad(`secret-guard flagged this kit or failed: ${String(e.stdout || e.stderr || e.message).split('\n')[0]}`);
}

// 4d. THE TRIGGER. pulse is the only reason the checks happen without somebody deciding to, so
//     its two states both need proving: silent when fresh (or it becomes wallpaper and real
//     findings get skimmed), loud when stale (or it is not a trigger at all).
try {
  const ph = join(root, '.verify-pulse');
  const env = { ...process.env, FIVE_HATS_HOME: ph };
  // Strip ANSI before asserting. The stale line reads `has not run in ${B('30 days')}`, so a
  // naive regex fails on the bold escape sitting between the words — a check that fails for a
  // reason that has nothing to do with the behaviour is worse than no check.
  const strip = (t) => t.replace(/\[[0-9;]*m/g, '');
  const run = (args) => strip(execFileSync(process.execPath, [join(root, 'pulse.mjs'), ...args],
    { encoding: 'utf8', stdio: 'pipe', timeout: 30000, env }));

  const never = run([]);
  if (!/never run/i.test(never)) bad('pulse: a machine that has never run the pass is not told so');
  else ok('pulse says so when the full pass has never run');

  run(['--record', '--quiet']);
  const fresh = run(['--quiet']);
  if (fresh.trim()) bad('pulse: --quiet printed on a fresh stamp — it will become wallpaper');
  else ok('pulse is silent when the pass is fresh');

  // age the stamp past the window and demand the nag
  const sf = join(ph, 'last-pass.json');
  const j = JSON.parse(readFileSync(sf, 'utf8'));
  j.lastPass = new Date(Date.now() - 30 * 86400000).toISOString();
  writeFileSync(sf, JSON.stringify(j));
  const stale = run(['--quiet']);
  if (!/has not run in [0-9]+ days/i.test(stale)) bad('pulse: a 30-day-stale setup was not nagged');
  else ok('pulse nags when the pass has gone stale');

  fs.rmSync(ph, { recursive: true, force: true });
} catch (e) {
  bad(`pulse checks failed: ${String(e.stderr || e.message).split('\n')[0]}`);
}

// 4d-bis. VERSION CONTROL, BOTH DIRECTIONS. This check has now been wrong twice in opposite
//     directions — first silent on the worst case, then asserting "no git at all" about 234
//     tracked files in a parent repo. Neither version had a test. Both directions get one now.
try {
  // OUTSIDE any repo. The first version of this fixture sat inside the kit's own git repo, so
  // the "unversioned" folder was correctly reported as versioned — the check failed for a reason
  // that had nothing to do with the behaviour, which is its own kind of wrong.
  const fx = join(os.tmpdir(), 'five-hats-verify-vc');
  fs.rmSync(fx, { recursive: true, force: true });
  fs.mkdirSync(join(fx, 'repo', 'child'), { recursive: true });
  fs.mkdirSync(join(fx, 'loose'), { recursive: true });
  writeFileSync(join(fx, 'repo', 'child', 'a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(fx, 'loose', 'a.mjs'), 'export const a = 1;\n');
  const g = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  g(['init', '-q'], join(fx, 'repo'));
  g(['add', '-A'], join(fx, 'repo'));
  g(['-c', 'user.email=v@v.v', '-c', 'user.name=V', 'commit', '-qm', 'init'], join(fx, 'repo'));

  const drift = (p) => execFileSync(process.execPath, [join(root, 'drift.mjs'), p, '--json'],
    { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });

  const child = JSON.parse(drift(join(fx, 'repo', 'child')));
  if (child.some((d) => /not under version control/i.test(d.what))) {
    bad('drift: a tracked subdirectory of a repo is reported as having no version control');
  } else ok('drift does not call a tracked subdirectory "not under version control"');

  const loose = JSON.parse(drift(join(fx, 'loose')));
  if (!loose.some((d) => /not under version control/i.test(d.what) && d.sev === 'serious')) {
    bad('drift: a genuinely unversioned folder was NOT reported serious');
  } else ok('drift still catches a genuinely unversioned folder');

  fs.rmSync(fx, { recursive: true, force: true });
} catch (e) {
  bad(`version-control checks failed: ${String(e.stderr || e.message).split('\n')[0]}`);
}

// 4d-ter. The installer must write skills where the AI actually READS them. Hard-coding ~/.claude
//     put them somewhere inert while reporting success, on any machine using CLAUDE_CONFIG_DIR.
try {
  const cfg = join(root, '.verify-cfg');
  fs.rmSync(cfg, { recursive: true, force: true });
  fs.mkdirSync(join(cfg, 'studio', 'skills'), { recursive: true });
  fs.mkdirSync(join(cfg, 'fx', 'app'), { recursive: true });
  writeFileSync(join(cfg, 'fx', 'app', 'package.json'), '{"name":"a"}\n');
  const out = execFileSync(process.execPath,
    [join(root, 'install.mjs'), join(cfg, 'fx'), '--registry', join(cfg, 'p.json')],
    { encoding: 'utf8', stdio: 'pipe', timeout: 60000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: join(cfg, 'studio'), FIVE_HATS_HOME: join(cfg, 'h') } });
  const toStudio = (out.match(/WRITE .*studio[\\/]skills[\\/]/g) || []).length;
  const toHome = /WRITE .*[\\/]\.claude[\\/]skills[\\/]/.test(out);
  if (!toStudio) bad('installer ignores CLAUDE_CONFIG_DIR — skills would land where nothing reads them');
  else if (toHome) bad('installer wrote skills to ~/.claude despite CLAUDE_CONFIG_DIR being set');
  else ok(`installer honours CLAUDE_CONFIG_DIR (${toStudio} skills to the configured dir)`);
  fs.rmSync(cfg, { recursive: true, force: true });
} catch (e) {
  bad(`CLAUDE_CONFIG_DIR check failed: ${String(e.stderr || e.message).split('\n')[0]}`);
}

// 4d-quater. THE UNDO RECORD MUST COVER EVERY WRITE. FIVE_HATS_HOME sandboxes the manifest, but
//     the skills destination comes from CLAUDE_CONFIG_DIR / the homedir — so a run somebody
//     believed was isolated wrote nine LIVE directories and recorded them in a throwaway file,
//     and a later --uninstall said "nothing recorded as installed" while all nine sat there.
try {
  const s = join(os.tmpdir(), 'five-hats-verify-halfiso');
  fs.rmSync(s, { recursive: true, force: true });
  fs.mkdirSync(join(s, 'fx', 'app'), { recursive: true });
  writeFileSync(join(s, 'fx', 'app', 'package.json'), '{"name":"a"}\n');
  const env = { ...process.env, FIVE_HATS_HOME: join(s, 'sandbox') };
  delete env.CLAUDE_CONFIG_DIR;
  let refused = false;
  try {
    execFileSync(process.execPath,
      [join(root, 'install.mjs'), join(s, 'fx'), '--registry', join(s, 'p.json'), '--apply'],
      { encoding: 'utf8', stdio: 'pipe', timeout: 60000, env });
  } catch (e) { refused = /half-isolated/i.test(String(e.stdout || '') + String(e.stderr || '')); }
  if (!refused) bad('installer allows a half-isolated apply — writes the undo record cannot reach');
  else ok('installer refuses a half-isolated apply (sandboxed manifest, live skills)');
  fs.rmSync(s, { recursive: true, force: true });
} catch (e) {
  bad(`half-isolation check failed: ${String(e.stderr || e.message).split('\n')[0]}`);
}

// 4d-quinquies. The hook must pin pulse to the registry THIS repo was installed with. Falling
//     back to the kit's own projects.json printed warnings about unrelated projects on commit,
//     and a finding attached to the wrong thing sends the reader somewhere that was never wrong.
try {
  const s = join(os.tmpdir(), 'five-hats-verify-pin');
  fs.rmSync(s, { recursive: true, force: true });
  fs.mkdirSync(join(s, 'fx', 'app'), { recursive: true });
  writeFileSync(join(s, 'fx', 'app', 'package.json'), '{"name":"a"}\n');
  spawnSync('git', ['init', '-q'], { cwd: join(s, 'fx', 'app') });
  const regPath = join(s, 'mine.json');
  execFileSync(process.execPath,
    [join(root, 'install.mjs'), join(s, 'fx'), '--registry', regPath, '--apply'],
    { encoding: 'utf8', stdio: 'pipe', timeout: 60000,
      env: { ...process.env, FIVE_HATS_HOME: join(s, 'h'), CLAUDE_CONFIG_DIR: join(s, 'cfg') } });
  const hook = readFileSync(join(s, 'fx', 'app', '.git', 'hooks', 'pre-commit'), 'utf8');
  if (!hook.includes('--registry') || !hook.includes('mine.json')) {
    bad('hook does not pin pulse to the registry this repo was installed with');
  } else ok('hook pins pulse to its own registry, not the kit default');
  fs.rmSync(s, { recursive: true, force: true });
} catch (e) {
  bad(`registry-pin check failed: ${String(e.stderr || e.message).split('\n')[0]}`);
}

// 4e. THE SKILLS. The kit shipped nine and installed none — files in a folder are not behaviour.
//     The installer must offer them, and must NEVER overwrite one the person already has.
try {
  const fakeHome = join(root, '.verify-skillhome');
  fs.mkdirSync(join(fakeHome, '.claude', 'skills'), { recursive: true });
  // install REFUSES a target with no project-shaped folders — correct behaviour, so give it one.
  const fxRoot = join(root, '.verify-sk-fx');
  fs.mkdirSync(join(fxRoot, 'app'), { recursive: true });
  writeFileSync(join(fxRoot, 'app', 'package.json'), '{"name":"a"}\n');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, FIVE_HATS_HOME: join(root, '.verify-sk-home') };
  const dry = execFileSync(process.execPath,
    [join(root, 'install.mjs'), fxRoot, '--registry', join(root, '.verify-sk.json')],
    { encoding: 'utf8', stdio: 'pipe', timeout: 60000, env });
  const offered = (dry.match(/WRITE .*skills\//g) || []).length;
  const have = readdirSync(join(root, 'skills')).length;
  if (offered !== have) bad(`installer offered ${offered} skills, kit ships ${have}`);
  else ok(`installer offers all ${have} skills on a machine that has none`);

  // now plant one and prove it is refused rather than replaced
  fs.mkdirSync(join(fakeHome, '.claude', 'skills', 'watch-for-drift'), { recursive: true });
  writeFileSync(join(fakeHome, '.claude', 'skills', 'watch-for-drift', 'SKILL.md'), 'MINE — do not overwrite\n');
  const dry2 = execFileSync(process.execPath,
    [join(root, 'install.mjs'), fxRoot, '--registry', join(root, '.verify-sk.json')],
    { encoding: 'utf8', stdio: 'pipe', timeout: 60000, env });
  if (!/already present and NOT overwritten/.test(dry2) || /WRITE .*watch-for-drift/.test(dry2)) {
    bad('installer would overwrite a skill the user already had');
  } else ok('installer refuses to overwrite an existing skill, and names it');

  fs.rmSync(fakeHome, { recursive: true, force: true });
  fs.rmSync(join(root, '.verify-sk-home'), { recursive: true, force: true });
  fs.rmSync(fxRoot, { recursive: true, force: true });
} catch (e) {
  bad(`skill-install checks failed: ${String(e.stderr || e.message).split('\n')[0]}`);
}

// 5. Nothing personal ships. This kit is meant to be handed to strangers, so the check that it
//    carries no private data is part of being healthy — not a thing to remember to do.
//    Two families: business/client names, and paths that only exist on the machine it came from.
// The terms themselves live in an untracked `.private-terms` file, NOT in this source. Hard-coding
// them here made the gate its own leak: publishing the checker would publish a tidy roster of every
// private project, client and brand it was written to protect. Copy `.private-terms.example` to
// `.private-terms` (already gitignored) and put your own words in it.
const termsFile = join(root, '.private-terms');
let terms = [];
if (existsSync(termsFile)) {
  terms = readFileSync(termsFile, 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}
const LEAK = terms.length
  ? new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i')
  : null;
// NOTE: `process.env.USERPROFILE || process.env.HOME` is deliberately NOT matched here. It is
// portable cross-platform code — the opposite of a machine-specific path — and flagging it trained
// the reader to skim past the two real leaks sitting next to it on the first run of this check.
const MACHINE = /(project-memory|C:\\Users|\/c\/Users|~\/repo\b)/i;
const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'five-hats-report'].includes(e.name)) continue;  // generated output, not repo content
    const p = join(d, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const files = walk(root).filter((f) => /\.(mjs|md|json)$/.test(f))
  .filter((f) => f !== fileURLToPath(import.meta.url));
const rel = (f) => f.slice(root.length + 1);

// SAY WHAT YOU CANNOT SEE. With no term list this check has not run, and reporting "no private
// references" would be a clean result from an instrument that never looked.
if (!LEAK) {
  ok('private-reference check SKIPPED — no .private-terms file (copy .private-terms.example). NOT a clean result.');
} else {
  const leaks = files.filter((f) => LEAK.test(readFileSync(f, 'utf8')));
  leaks.length ? bad(`private references found in: ${leaks.map(rel).join(', ')}`)
    : ok(`no private references (${terms.length} term(s) checked)`);
}

const machine = files.filter((f) => MACHINE.test(readFileSync(f, 'utf8')));
machine.length ? bad(`machine-specific paths found in: ${machine.map(rel).join(', ')}`)
  : ok('no machine-specific paths');

// 6. The skills, if shipped, must each have frontmatter or they will never load.
const sk = join(root, 'skills');
if (existsSync(sk)) {
  const badSkills = readdirSync(sk).filter((d) => {
    const f = join(sk, d, 'SKILL.md');
    return !existsSync(f) || !readFileSync(f, 'utf8').startsWith('---');
  });
  badSkills.length ? bad(`skills missing frontmatter: ${badSkills.join(', ')}`)
    : ok(`${readdirSync(sk).length} skills well-formed`);
}

// 7. THE INSTALLER, round-tripped in a sandbox. install.mjs is the only file here that changes
//    anything, so its whole contract is checked, not assumed: the dry run writes nothing, the
//    apply writes only what it disclosed, a second apply proposes nothing, the hook it wires
//    fails LOUD-BUT-OPEN when its runtime is gone, and uninstall leaves the tree byte-identical.
//    Every clause below is a promise SETUP.md now makes to strangers; an unchecked promise is
//    how the core.hooksPath bug shipped the first time.
const BASH = (() => {
  if (process.platform !== 'win32') return 'bash';
  for (const c of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) {
    if (existsSync(c)) return c;
  }
  return null;   // the WindowsApps stub is a lie; better to say "could not test" than to test wrong
})();
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; } })();

function treeHash(root) {
  // Content + relative path, sorted — mtimes deliberately excluded, bytes are the claim.
  const files = [];
  const walkT = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      e.isDirectory() ? walkT(p) : files.push(p);
    }
  };
  walkT(root);
  const h = [];
  for (const f of files.sort()) {
    h.push(`${f.slice(root.length)}:${createHash('sha256').update(readFileSync(f)).digest('hex')}`);
  }
  return h.join('\n');
}

if (!hasGit) {
  ok('installer round trip SKIPPED — git not found on this machine. NOT a clean result.');
} else {
  const sb = fs.mkdtempSync(join(os.tmpdir(), 'five-hats-verify-'));
  // CLAUDE_CONFIG_DIR is set alongside FIVE_HATS_HOME on purpose: a run that sandboxes the
  // manifest but not the skills destination is exactly what install now refuses, and this check
  // was doing it. The rule caught the kit's own gate — which is the rule working.
  const env = { ...process.env, FIVE_HATS_HOME: join(sb, 'home'), CLAUDE_CONFIG_DIR: join(sb, 'cfg') };
  const reg = join(sb, 'projects.json');
  const inst = (args) => spawnSync(process.execPath, [join(root, 'install.mjs'), ...args],
    { encoding: 'utf8', env, timeout: 120000 });
  try {
    const proj = join(sb, 'projects');
    fs.mkdirSync(join(proj, 'app1'), { recursive: true });
    fs.mkdirSync(join(proj, 'app2'), { recursive: true });
    writeFileSync(join(proj, 'app1', 'package.json'), '{"name":"app1","scripts":{"test":"node -e 0"}}\n');
    writeFileSync(join(proj, 'app2', 'main.py'), 'print(1)\n');
    writeFileSync(join(proj, 'app2', 'requirements.txt'), '');
    for (const a of ['app1', 'app2']) execFileSync('git', ['-C', join(proj, a), 'init', '-q'], { stdio: 'pipe' });
    // app2 already has a hook that is NOT ours — it must survive install AND uninstall untouched.
    writeFileSync(join(proj, 'app2', '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho theirs\n');

    const virgin = treeHash(sb);

    // 7a. the DRY RUN is the default and must write NOTHING.
    const dry = inst([proj, '--registry', reg]);
    if (dry.status === 0 && treeHash(sb) === virgin && !existsSync(join(sb, 'home'))) {
      ok('install.mjs dry run discloses and writes nothing');
    } else bad(`install.mjs dry run wrote something or failed (exit ${dry.status})`);

    // 7b. apply does exactly what it said, and only tier1 / null-verify enters the registry.
    const ap = inst([proj, '--registry', reg, '--apply']);
    const regJson = existsSync(reg) ? JSON.parse(readFileSync(reg, 'utf8')) : null;
    const entries = regJson ? Object.values(regJson.projects || {}) : [];
    if (ap.status === 0
      && existsSync(join(proj, 'app1', '.git', 'hooks', 'pre-commit'))
      && existsSync(join(proj, 'app1', '.git', 'hooks', 'pre-push'))
      && entries.length === 2
      && entries.every((e) => e.verify === null && e.lane === 'tier1')
      && readFileSync(join(proj, 'app2', '.git', 'hooks', 'pre-commit'), 'utf8').includes('theirs')) {
      ok('install.mjs --apply wires hooks; never writes a verify, never a lane but tier1, never over an existing hook');
    } else bad(`install.mjs --apply broke its contract (exit ${ap.status})`);

    // 7c. the manifest exists, parses, and is stamped with the kit version.
    const mf = join(sb, 'home', 'install-manifest.jsonl');
    let lines = [];
    try { lines = readFileSync(mf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* falls through to bad */ }
    if (lines.length && lines.every((l) => l.v === KIT_VERSION) && existsSync(join(sb, 'home', 'UNDO.md'))) {
      ok(`install manifest is parseable, versioned (${lines.length} entries) and UNDO.md exists`);
    } else bad('install manifest missing, unparseable, or unversioned');

    // 7d. IDEMPOTENT — the second apply proposes nothing and appends nothing.
    const again = inst([proj, '--registry', reg, '--apply']);
    const linesAfter = readFileSync(mf, 'utf8').split('\n').filter(Boolean).length;
    if (/nothing to do/i.test(again.stdout) && linesAfter === lines.length) {
      ok('install.mjs is idempotent — a second apply proposes nothing');
    } else bad('a second --apply proposed or wrote something');

    // 7e. THE HOOK WITHOUT A RUNTIME. It must step aside with a message a human can tell apart
    //     from both "clean" and "blocked", and it must exit 0 — a hook that bricks every commit
    //     on a machine with no node visible is the worst outcome this kit can produce.
    if (!BASH) {
      ok('hook-without-node check SKIPPED — no usable bash found to run the hook. NOT a clean result.');
    } else {
      const hk = spawnSync(BASH, [join(proj, 'app1', '.git', 'hooks', 'pre-commit')],
        { encoding: 'utf8', env: { ...env, FIVE_HATS_NODE: join(sb, 'no-such-node') }, cwd: join(proj, 'app1') });
      const said = `${hk.stdout}${hk.stderr}`;
      if (hk.status === 0 && /NOT checked for secrets/.test(said) && /SKIPPED/.test(said)) {
        ok('the hook without node exits 0 and says, distinguishably, that nothing was scanned');
      } else bad(`hook without node: exit ${hk.status}, message ${/NOT checked/.test(said) ? 'ok' : 'MISSING'}`);
    }

    // 8. THE RESULTS PAGE — checked BEFORE uninstall so the sandbox registry still exists, and
    //    pinned to it with explicit --registry and --before flags. The first version of this
    //    check let results.mjs auto-detect, and on a machine with a real five-hats-report/ the
    //    auto-detection found the REAL baselines — so the check passed or failed depending on
    //    what the machine happened to hold. A verify that depends on ambient state is the
    //    board-lies-quietly defect again, inside the gate itself. Output goes to a SECOND temp
    //    dir so 8's files cannot poison 7f's byte-identical comparison.
    //
    //    The page's one promise is "safe to hand to a stranger", so the check is on the BYTES:
    //    no absolute path from this machine, no project name, the honesty sections present, the
    //    version stamped, and the first run saying "first picture" instead of faking a delta.
    const sb2 = fs.mkdtempSync(join(os.tmpdir(), 'five-hats-verify-out-'));
    try {
      const out1 = join(sb2, 'out1');
      const r1 = spawnSync(process.execPath,
        [join(root, 'results.mjs'), proj, '--registry', reg, '--before', 'none', '--out', out1, '--no-ai'],
        { encoding: 'utf8', env, timeout: 300000 });
      const page1 = existsSync(out1) ? readdirSync(out1).filter((f) => /^results-.*\.html$/.test(f)) : [];
      const html1 = page1.length ? readFileSync(join(out1, page1[0]), 'utf8') : '';
      const leak = [sb, sb.replace(/\\/g, '/'), os.homedir(), os.homedir().replace(/\\/g, '/'), 'app1']
        .find((n) => n && html1.includes(n));
      if (r1.status === 0 && html1.length
        && html1.includes(KIT_VERSION) && /first picture/i.test(html1)
        && /Earned/.test(html1) && /Install-set/.test(html1) && /could not be measured/i.test(html1)
        && !leak && !/https?:\/\//.test(html1)) {
        ok('results.mjs first run: honest, versioned, sectioned, and free of paths, names and external refs');
      } else bad(`results.mjs first run failed the page gate (exit ${r1.status}${leak ? `, leaked: ${leak}` : ''})`);

      // 8a. and with a before-picture, it must show movement rather than assert it.
      const bj = spawnSync(process.execPath,
        [join(root, 'baseline.mjs'), '--registry', reg, '--json', '--no-ai'],
        { encoding: 'utf8', env, timeout: 300000 });
      let compared = false;
      try {
        const prev = JSON.parse(bj.stdout);
        prev.takenAt = '2020-01-01';
        prev.code.orphans += 2;                       // a fake past, worse by exactly two
        const bf = join(sb2, 'before.json');
        writeFileSync(bf, JSON.stringify(prev));
        const out2 = join(sb2, 'out2');
        const r2 = spawnSync(process.execPath,
          [join(root, 'results.mjs'), proj, '--registry', reg, '--before', bf, '--out', out2, '--no-ai'],
          { encoding: 'utf8', env, timeout: 300000 });
        const page2 = existsSync(out2) ? readdirSync(out2).filter((f) => /^results-.*\.html$/.test(f)) : [];
        const html2 = page2.length ? readFileSync(join(out2, page2[0]), 'utf8') : '';
        compared = r2.status === 0 && /before 2020-01-01/.test(html2) && />-2</.test(html2) && /improved/.test(html2);
      } catch { /* compared stays false */ }
      compared ? ok('results.mjs --before shows the actual delta (-2) instead of asserting improvement')
        : bad('results.mjs --before did not render the known delta');
    } finally {
      fs.rmSync(sb2, { recursive: true, force: true });
    }

    // 7f. UNINSTALL — the tree comes back byte-identical, and the home folder is gone. Last,
    //     so it also proves that generating the results pages above changed nothing in the tree.
    const un = inst(['--uninstall']);
    if (un.status === 0 && treeHash(sb) === virgin && !existsSync(join(sb, 'home'))) {
      ok('install.mjs --uninstall restores the tree byte-identical');
    } else bad(`uninstall left the tree changed (exit ${un.status})`);
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
}

console.log(fail.length ? `\nFAILED (${fail.length})` : '\nfive-hats-kit OK');
process.exit(fail.length ? 1 : 0);
