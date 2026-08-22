#!/usr/bin/env node
// drift.mjs - the MAINTAINER pass. Notices the system decaying before a human does.
//
//   node drift.mjs                 the current folder
//   node drift.mjs ../some-repo    that folder
//   node drift.mjs --registry projects.json    everything in a registry
//   node drift.mjs --gate          exit 1 if anything SERIOUS is drifting (for a hook or a cron)
//   node drift.mjs --json
//
// WHY THIS EXISTS. Every defect in the audit that produced this tool — a health board reporting 21
// healthy projects as failing, notes claiming work had never been sent while it was already in the
// post, data dropped silently at a boundary between two systems, a safety guard that had never
// been able to catch anything — was found because a human got suspicious. Not one was surfaced by
// a tool. A system that cannot notice its own decay outsources that job to somebody's mood.
//
// EIGHT CHECKS, each cheap enough to run on a schedule. Nothing here changes a single file.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const argv = process.argv.slice(2);
const expand = (p) => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
const gate = argv.includes('--gate');
const asJson = argv.includes('--json');


// Git Bash, never the WSL stub — the same trap that made the board lie. See project.mjs.
function resolveBash() {
  if (process.env.WFOS_BASH && fs.existsSync(process.env.WFOS_BASH)) return process.env.WFOS_BASH;
  if (process.platform !== 'win32') return 'bash';
  for (const c of ['C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) if (fs.existsSync(c)) return c;
  return 'bash';
}
const BASH = resolveBash();
const git = (cwd, cmd) => {
  const r = spawnSync(BASH, ['-c', `cd "${cwd}" && ${cmd}`], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
};

// Works with no setup:  node drift.mjs  ·  node drift.mjs ../some-repo  ·  --registry projects.json
// Without a registry the lane/strength/expiry checks are skipped — they need a registry to exist.
// Everything git-related still runs, and that is where most of the real findings come from.
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
  return [[path.basename(dir), { path: dir, _noRegistry: true }]];
}

const findings = [];
const add = (sev, project, what, detail) => findings.push({ sev, project, what, detail });
const today = new Date().toISOString().slice(0, 10);

for (const [name, cfg] of resolveTargets()) {
  const root = expand(cfg.path);
  if (!fs.existsSync(root)) { add('serious', name, 'path missing', root); continue; }

  // 1. A TIER-1 PROJECT ON A WEAK VERIFY. Money, law, publishing and real consumers ride on
  //    these. A syntax check that only proves the file parses is not a safety net, and
  //    GREEN.parse reads identically to GREEN.tests at a glance.
  if (!cfg._noRegistry && cfg.lane === 'tier1' && ['parse', 'lint'].includes(cfg.strength)) {
    add('warn', name, `tier1 on a ${cfg.strength} verify`, 'a parse check cannot catch a wrong answer');
  }
  // 2. NO VERIFY AT ALL.
  if (!cfg._noRegistry && !cfg.verify) add('serious', name, 'no verify wired', 'nothing can call this project done');

  // SAY WHAT YOU CANNOT SEE. Four checks above read fields that only a registry supplies, so a
  // bare-path run silently skips them — including "no verify wired", which is the whole thesis.
  // Without this line that run printed "nothing drifting · 0 serious" for a project that scores
  // SERIOUS the moment a registry exists. The one place in this repo that broke its own rule.
  if (cfg._noRegistry) {
    add('info', name, 'NOT CHECKED: verify, lane, strength, expiry',
      'these live in a registry — re-run with --registry projects.json to include them');
  }

  // 3. AN EXPIRED SPIKE. A prototype with no kill date becomes permanent — this repo carries a
  //    1,132-commit archived engine and a 55 MB orphan that were both once experiments.
  if (cfg.expires) {
    if (cfg.expires < today) add('serious', name, `spike expired ${cfg.expires}`, 'kill it or promote it — decide, do not drift');
    else add('info', name, `spike expires ${cfg.expires}`, 'still inside its window');
  }

  // NO VERSION CONTROL AT ALL. This used to `continue` straight past every remaining check,
  // which meant the WORST case produced NO finding — and a consumer counting "projects with a
  // no-remote warning" then scored it as safely backed up. A folder with no git, holding loose
  // files, was reported as "survives a disk failure: all covered". Reported clean because
  // nothing looked, on the one subject where being wrong costs you the work itself.
  // No git is strictly WORSE than a missing remote, so it emits the stronger finding.
  // ASK GIT, do not look for a folder. `fs.existsSync(root/.git)` is wrong for the most ordinary
  // layout there is: a project that lives INSIDE a larger repository has no .git of its own, and
  // is perfectly versioned. Checking for the folder reported 234 tracked files, with a GitHub
  // remote, as "no git at all — nothing to recover".
  //
  // This is the second version of this check to be wrong, in opposite directions. It first
  // `continue`d past everything and said nothing (a fail-open, caught by an outside reviewer);
  // the fix then asserted the OPPOSITE OF THE TRUTH about somebody's backups, which is worse —
  // a silent miss leaves you where you were, a false assertion moves you somewhere wrong.
  // Both versions shared one cause: inferring a fact from a proxy instead of asking the
  // authority. git rev-parse IS the authority, and it costs one process.
  const topLevel = git(root, 'git rev-parse --show-toplevel');
  if (!topLevel) {
    add('serious', name, 'not under version control',
      'no git at all — nothing to push, nothing to recover, no history to fall back on');
    continue;
  }
  // A subdirectory of a repo is versioned BY that repo; every check below is about the repo it
  // belongs to, so run them there and say which one, or the reader cannot act on the finding.
  const owned = path.resolve(topLevel) !== path.resolve(root);
  const gitRoot = owned ? path.resolve(topLevel) : root;
  if (owned) {
    add('info', name, 'versioned by a parent repository',
      `tracked in ${path.basename(gitRoot)} — the checks below describe that repo, not this folder alone`);
  }

  // 4. NO REMOTE. One disk failure from gone.
  const remote = git(gitRoot, 'git remote');
  if (!remote) {
    add('warn', name, 'no git remote', 'exists on exactly one disk — bundle it or add a remote');
  } else {
    // 5. UNPUSHED WORK AGEING. Committed but never pushed is invisible to every other machine.
    const branch = git(gitRoot, 'git rev-parse --abbrev-ref HEAD');
    let ahead = git(gitRoot, `git rev-list --count origin/${branch}..HEAD 2>/dev/null`);
    let where = `${branch} is ahead of origin`;
    if (ahead === null) {
      // origin/<branch> does not exist — the branch has never been pushed at all (or HEAD is
      // detached). The old code returned null here and reported NOTHING, which is the same
      // fail-open found six times today: the WORST unpushed case — commits that exist on no
      // remote anywhere — was the one case that produced no finding. Count against every
      // remote instead, which is what "unpushed" actually means.
      ahead = git(gitRoot, 'git rev-list --count HEAD --not --remotes');
      where = `${branch} has never been pushed to any remote`;
    }
    if (ahead && Number(ahead) > 0) {
      const when = git(gitRoot, 'git log -1 --format=%ct');
      const days = when ? Math.floor((Date.now() / 1000 - Number(when)) / 86400) : 0;
      if (days >= 3) add('warn', name, `${ahead} commit(s) unpushed for ${days}d`, where);
    }
  }

  // 6. A SECRET UNDER VERSION CONTROL. The one mistake that cannot be undone by a later commit.
  // .env.example / .sample / .template hold PLACEHOLDERS and are supposed to be committed —
  // flagging them as leaked secrets is crying wolf in the one category that must stay credible.
  const tracked = git(gitRoot,
    "git ls-files | grep -E '(^|/)\\.env($|\\.)|secrets/.*\\.env$' "
    + "| grep -vE '\\.(example|sample|template|dist)$' | head -5");
  if (tracked) add('serious', name, 'secret file is TRACKED by git', tracked.split('\n').join(', '));

  // 7. A LARGE UNCOMMITTED TREE. Work nobody can review, restore, or reason about.
  const dirty = git(gitRoot, 'git status --porcelain | wc -l');
  if (dirty && Number(dirty) >= 25) {
    add('info', name, `${Number(dirty)} uncommitted files`, 'large enough that a mistake is hard to unpick');
  }
}

// 8. IS ANYONE RUNNING THE CHECKS AT ALL? Point HEALTH_LOG at whatever file your own health run
//    appends to, and this warns when nobody has run it in a week — because nothing is checking
//    the checkers otherwise. Skipped entirely when unset, rather than nagging about a file you
//    were never going to have.
if (process.env.HEALTH_LOG) {
  try {
    const days = Math.floor((Date.now() - fs.statSync(process.env.HEALTH_LOG).mtimeMs) / 86400000);
    if (days >= 7) add('warn', '(your board)', `health check not run in ${days}d`, 'nothing is checking the checkers');
  } catch { add('warn', '(your board)', 'HEALTH_LOG points at nothing', process.env.HEALTH_LOG); }
}

if (asJson) { console.log(JSON.stringify(findings, null, 2)); process.exit(0); }

const order = { serious: 0, warn: 1, info: 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.project.localeCompare(b.project));
const n = (s) => findings.filter((f) => f.sev === s).length;

console.log('# Drift — what is decaying while nobody is looking\n');
if (!findings.length) console.log('  nothing drifting.\n');
let last = null;
for (const f of findings) {
  if (f.sev !== last) { console.log(`  ${f.sev.toUpperCase()}`); last = f.sev; }
  console.log(`     ${f.project.padEnd(22)} ${f.what}`);
  console.log(`     ${' '.repeat(22)} ${f.detail}`);
}
console.log(`\n  ${n('serious')} serious · ${n('warn')} warn · ${n('info')} info`);
console.log('  Drift is not failure. It is the gap between what you think is true and what is.');

process.exit(gate && n('serious') > 0 ? 1 : 0);
