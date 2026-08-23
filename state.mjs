#!/usr/bin/env node
// state.mjs - the CONTINUITY instrument. Does a new session know where you left off?
//
//   node state.mjs                    every project: what its STATE file says vs what git says
//   node state.mjs --write            bring every STATE file up to date
//   node state.mjs --write --quiet    what the hook runs
//   node state.mjs ~/path/to/projects scan a folder instead of using a registry
//
// READ-ONLY WITHOUT --write. It prints what would change and changes nothing.
//
// WHY THIS EXISTS. `SETUP.md` in this kit already tells you to keep a STATE.md, to cap it at five
// lines, and to treat it as the sole authority for current state. That advice is correct and it is
// not enough, because it is advice: it asks a person to remember to write a file whose entire
// purpose is that nobody should have to remember anything.
//
// THE EVIDENCE THAT THIS GAP IS REAL, from the machine this kit came off. We had the writer. It was
// correct, idempotent, and tested. It was also wired to nothing -- the session-close hook ran three
// other things and never it -- so the state file went stale the moment anyone stopped typing the
// command by hand. It then spent a full day describing THE WRONG REPOSITORY: a file headed with one
// project's name, carrying an archived project's commit, with a green-looking check above it
// because the check was pointed at the wrong repo too.
//
// The symptom, for months, was: "I keep upgrading the intelligence and it goes stale. A new session
// never picks up exactly where we left off. I don't know what I'm doing wrong."
//
// The answer was: nothing. A system built to replace memory must never require memory to run. That
// is the whole idea here, and it is why this file exists rather than another paragraph in SETUP.md.
//
// WHAT IT WRITES, AND WHAT IT WILL NOT TOUCH. Only the block between the two marker comments, which
// is machine-generated from git. Anything you wrote yourself -- the five-line checkpoint, the next
// action, your own notes -- is never edited, never reordered, never removed. A file that has no
// markers gets them inserted under its first heading with every existing line preserved.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const QUIET = argv.includes('--quiet');
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const expand = (p) => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
const root = argv.find((a) => !a.startsWith('--'));

const BEGIN = '<!-- STATE:GIT:BEGIN -->';
const END = '<!-- STATE:GIT:END -->';
// STATE FILES BELONG WITH YOUR WORK, NOT INSIDE THIS KIT.
//
// The first version wrote them into `five-hats/state/` and gitignored it. This kit's own
// verify.mjs refused that immediately -- it scans the working tree for private references and
// found project names and commit subjects sitting in the repo. It is right to: an ignore rule is
// one `git add -f` away from publishing somebody's work, and a tool has no business storing the
// data it describes.
//
// So they land in a dotfolder beside the projects they are about, where they are yours.
const STATE_DIR = path.join(expand(root || '.'), '.five-hats-state');

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * GIT DECIDES WHAT IS A REPO, not a walk looking for a .git folder.
 *
 * The first version of this walked upward from each project path. On the machine it was written
 * for, the HOME DIRECTORY was itself a repository -- so three projects that were not under version
 * control resolved to it, and would have had the home directory's commit written into their state
 * as though it were their own. `rev-parse --show-toplevel` does not make that mistake, because git
 * stops where git stops. Ask the tool instead of reimplementing its rules.
 */
function repoRoot(dir) {
  try { return path.resolve(git(dir, ['rev-parse', '--show-toplevel'])); } catch { return null; }
}

/** Projects from a registry if there is one, otherwise every git repo one level under a folder. */
function projects() {
  const registry = path.join(HERE, 'projects.json');
  if (!root && fs.existsSync(registry)) {
    const reg = JSON.parse(fs.readFileSync(registry, 'utf8'));
    return Object.entries(reg.projects || {})
      .map(([name, p]) => ({ name, dir: path.resolve(HERE, expand(p.path || p)) }))
      .filter((p) => fs.existsSync(p.dir));
  }
  const base = expand(root || '.');
  if (!fs.existsSync(base)) {
    console.error(`No such folder: ${base}`);
    process.exit(1);
  }
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => ({ name: e.name, dir: path.join(base, e.name) }));
}

/** What git says, in the words a person reads on the way back in. */
function snapshot(dir) {
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(dir, ['log', '-1', '--format=%h — %s']);
  const when = git(dir, ['log', '-1', '--format=%cI']);
  let dirty = '';
  try { dirty = git(dir, ['status', '--porcelain']); } catch { /* ignore */ }
  const n = dirty ? dirty.split('\n').filter(Boolean).length : 0;
  let remote = '(no remote)';
  try {
    const ahead = git(dir, ['rev-list', '--count', `origin/${branch}..HEAD`]);
    remote = ahead === '0' ? `in sync with origin/${branch}` : `${ahead} commit(s) UNPUSHED`;
  } catch { /* no upstream is a fact, not an error */ }
  return [
    `- branch: \`${branch}\``,
    `- HEAD: \`${head}\``,
    `- last commit: ${when}`,
    `- working tree: ${n ? `${n} uncommitted change(s)` : 'clean'}`,
    `- remote: ${remote}`,
  ].join('\n');
}

/** Create or repair the file, without ever losing a line somebody wrote. */
function ensure(file, name) {
  if (fs.existsSync(file)) {
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes(BEGIN) && src.includes(END)) return { existed: true };
    if (!WRITE) return { existed: true, note: 'would add markers' };
    const lines = src.split('\n');
    const at = lines.findIndex((l) => /^#\s/.test(l));
    lines.splice(at === -1 ? 0 : at + 1, 0, '', BEGIN, '- not yet snapshotted', END, '');
    fs.writeFileSync(file, lines.join('\n'));
    return { existed: true, note: 'markers added' };
  }
  if (!WRITE) return { note: 'would create' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    `# STATE — ${name}`,
    '',
    'Read this first on the way back in. The block below is written from git and is not yours to',
    'edit; everything under it is yours and is never touched by tooling.',
    '',
    BEGIN,
    '- not yet snapshotted',
    END,
    '',
    '## Checkpoint',
    '<!-- Five lines. No commit hashes — the block above already has them. What is true NOW. -->',
    '- (nothing yet)',
    '',
    '## Next action',
    '- (unset)',
    '',
  ].join('\n'));
  return { note: 'created' };
}

/** Replace only what is between the markers. */
function apply(file, block) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  if (a === -1 || b === -1 || b < a) return { skipped: 'markers missing or out of order' };
  const next = src.slice(0, a + BEGIN.length) + '\n' + block + '\n' + src.slice(b);
  if (next === src) return { same: true };
  if (WRITE) fs.writeFileSync(file, next);
  return { changed: true };
}

const rows = [];
for (const p of projects()) {
  const repo = repoRoot(p.dir);
  if (!repo) { rows.push({ name: p.name, state: 'not a git repo' }); continue; }
  const file = path.join(STATE_DIR, `STATE-${p.name}.md`);
  const made = ensure(file, p.name);
  if (!fs.existsSync(file)) { rows.push({ name: p.name, state: made.note || 'would create' }); continue; }
  const r = apply(file, snapshot(repo));
  rows.push({
    name: p.name,
    state: r.skipped ? `SKIPPED — ${r.skipped}` : r.same ? 'current' : (WRITE ? 'updated' : 'STALE'),
    note: made.note,
  });
}

if (QUIET && !rows.some((r) => /SKIPPED/.test(r.state))) process.exit(0);

const stale = rows.filter((r) => r.state === 'STALE' || r.state === 'updated');
console.log(`\n# Continuity — does a new session know where you left off?\n`);
for (const r of rows) {
  console.log(`  ${r.name.padEnd(24)} ${r.state}${r.note ? `  (${r.note})` : ''}`);
}
console.log(`\n  ${rows.length} project(s) · ${stale.length} ${WRITE ? 'updated' : 'out of date'}`
  + ` · files in ${path.relative(process.cwd(), STATE_DIR) || 'state/'}`);

if (!WRITE && stale.length) {
  console.log('\n  Nothing was written. `node state.mjs --write` brings them up to date.');
  console.log('  Then wire it to run on its own — a state file you have to remember to update');
  console.log('  is the problem it was meant to solve. `node install.mjs --help` does that.');
}
process.exit(0);
