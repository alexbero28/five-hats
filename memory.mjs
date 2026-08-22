#!/usr/bin/env node
// memory.mjs — the sixth job nothing triggers: writing down where you are.
//
//   node memory.mjs read              where are we? (wire to SessionStart)
//   node memory.mjs check             did the checkpoint move this session? (wire to Stop)
//   node memory.mjs note "<text>"     append a dated decision, instantly
//   node memory.mjs set --next "..." [--phase "..."] [--green "..."] [--hold "..."]
//
// WHY THIS EXISTS, and it is the most expensive lesson on this machine. The operating model has
// STATE.md for current state and DECISIONS.md for history. Both are good. Both were built. And
// over one intense two-day stretch of real work — a public release, a licence decision, an
// installer, eleven bug fixes of a single defect class, three rounds with an outside reviewer —
// STATE.md was not written once and DECISIONS.md gained zero entries. A fresh session opening the
// next morning would have read a two-day-old checkpoint and been told to go do something
// unrelated.
//
// The cause is not laziness and not a missing file format. It is the same cause as every other
// job in this kit: WRITING MEMORY HAS NO TRIGGER. It never blocks anything, it is never urgent,
// and so it loses every contest against the work itself — right up until the moment somebody
// resumes and finds the map two days stale.
//
// So this is small on purpose. `note` is one line and instant, because a decision recorded when
// it is made costs nothing and a decision recorded at the end of the day is already lost. `check`
// never blocks; it reminds. And `read` is what a session opens with, so a stale checkpoint is
// visible before anyone acts on it rather than after.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const cmd = (argv[0] || 'read').replace(/^--/, '');
const val = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const HOME_DIR = process.env.FIVE_HATS_HOME || path.join(os.homedir(), '.five-hats');

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const readIf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex').slice(0, 16);

// Walk UP from the working directory. This is what makes it load "with every project" — you open
// any folder inside a project and the memory for that project is found, without configuration.
function findState(start = process.cwd()) {
  let d = path.resolve(start);
  for (let i = 0; i < 12; i += 1) {
    const p = path.join(d, 'STATE.md');
    if (fs.existsSync(p)) return p;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

const BEGIN = '<!-- FIVE-HATS:CHECK:BEGIN -->';
const END = '<!-- FIVE-HATS:CHECK:END -->';

// The checkpoint is read between markers when they exist, and otherwise from the first list under
// a "## Checkpoint" heading — so a STATE.md somebody wrote by hand still works.
function readCheckpoint(statePath) {
  const t = readIf(statePath) || '';
  const m = t.indexOf(BEGIN);
  if (m !== -1) {
    const e = t.indexOf(END, m);
    if (e !== -1) return t.slice(m + BEGIN.length, e).trim();
  }
  const h = t.search(/^##\s+Checkpoint/im);
  if (h === -1) return '';
  return t.slice(h).split('\n').slice(1).filter((l) => l.trim().startsWith('-')).join('\n').trim();
}

function ageDays(p) {
  try { return Math.floor((Date.now() - fs.statSync(p).mtimeMs) / 86400000); } catch { return null; }
}

// ---- resolve ----------------------------------------------------------------------------------
const statePath = findState(val('in') || process.cwd());
if (!statePath) {
  if (cmd === 'check') process.exit(0);          // nothing to nag about
  console.log(`\n  No STATE.md found above ${process.cwd()}.`);
  console.log('  This is where "where are we" lives. Create one, or run install.mjs.\n');
  process.exit(cmd === 'read' ? 0 : 2);
}
const projectDir = path.dirname(statePath);
const decisionsPath = path.join(projectDir, 'DECISIONS.md');
const stampPath = path.join(HOME_DIR, `session-${sha(projectDir)}.json`);

// ---- read: what a session opens with -----------------------------------------------------------
if (cmd === 'read') {
  const cp = readCheckpoint(statePath);
  const age = ageDays(statePath);
  console.log(`\n  ${B('where we are')} ${DIM(`· ${path.basename(projectDir)}`)}`);
  if (!cp) {
    console.log('     The checkpoint is EMPTY. Nothing here says what we were doing.');
  } else {
    for (const line of cp.split('\n').slice(0, 6)) console.log(`     ${line.replace(/^-\s*/, '')}`);
  }
  // A stale checkpoint is worse than none: it is confidently wrong, and a resuming session will
  // act on it. Two days of real work once left this file untouched while the map said something
  // else entirely.
  if (age !== null && age >= 2) {
    console.log(`\n     ${B(`! this was last written ${age} day(s) ago.`)} If work has happened since,`);
    console.log('       what you just read is out of date — fix it before acting on it:');
    console.log(`       ${DIM('node memory.mjs set --next "..."')}`);
  }
  // Snapshot for `check` to compare against at the end of the session.
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(stampPath, JSON.stringify({ at: new Date().toISOString(), hash: sha(cp), dir: projectDir }));
  } catch { /* a missing snapshot costs a reminder, never a run */ }
  console.log('');
  process.exit(0);
}

// ---- check: did anything get written down? -----------------------------------------------------
if (cmd === 'check') {
  let prev = null;
  try { prev = JSON.parse(readIf(stampPath) || 'null'); } catch { prev = null; }
  if (!prev) process.exit(0);
  const now = sha(readCheckpoint(statePath));
  if (now !== prev.hash) process.exit(0);        // it moved — nothing to say
  // NEVER BLOCKS. A reminder that can fail a session is a reminder somebody disables by Friday.
  console.log(`\n  ${B('the checkpoint did not move this session.')}`);
  console.log('  If work happened, the next session will read a map that predates it.');
  console.log(`     ${DIM('node memory.mjs set --next "the single next thing"')}`);
  console.log(`     ${DIM('node memory.mjs note "what was decided, and why"')}\n`);
  process.exit(0);
}

// ---- note: a decision, recorded the moment it is made -------------------------------------------
if (cmd === 'note') {
  const text = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!text) { console.error('  memory.mjs note "what was decided, and why"'); process.exit(2); }
  const today = new Date().toISOString().slice(0, 10);
  const existing = readIf(decisionsPath) || `# DECISIONS\n\n> Append-only. Dated. Never rewritten.\n`;
  const n = (existing.match(/^\- \*\*D-\d+/gm) || []).length + 1;
  const entry = `- **D-${String(n).padStart(3, '0')} - ${today}** ${text}\n`;
  fs.writeFileSync(decisionsPath, `${existing.replace(/\n+$/, '')}\n${entry}`);
  console.log(`  logged D-${String(n).padStart(3, '0')} in ${path.basename(decisionsPath)}`);
  process.exit(0);
}

// ---- set: rewrite the checkpoint, capped --------------------------------------------------------
if (cmd === 'set') {
  const fields = [
    ['Last green', val('green')],
    ['Current phase', val('phase')],
    ['Next action', val('next')],
    ['Blocked on', val('hold')],
  ];
  const old = readCheckpoint(statePath).split('\n');
  const pick = (label, given) => {
    if (given !== null) return `- ${label}: ${given}`;
    const prior = old.find((l) => l.toLowerCase().includes(label.toLowerCase()));
    return prior || `- ${label}:`;
  };
  // FIVE LINES, ENFORCED. The cap is the whole mechanism: it regrew past 3,000 words once on
  // discipline alone and silently broke the tool that parsed it. A cap that a tool enforces is a
  // cap; a cap in a comment is a wish.
  const body = [...fields.map(([l, v]) => pick(l, v)), '- Deep history → DECISIONS.md'].join('\n');
  let t = readIf(statePath) || `# STATE\n\n## Checkpoint (max 5 lines)\n\n${BEGIN}\n${END}\n`;
  if (!t.includes(BEGIN)) {
    const h = t.search(/^##\s+Checkpoint/im);
    t = h === -1 ? `${t.replace(/\n+$/, '')}\n\n## Checkpoint (max 5 lines)\n\n${BEGIN}\n${END}\n`
      : `${t.slice(0, h)}## Checkpoint (max 5 lines)\n\n${BEGIN}\n${END}\n`;
  }
  const a = t.indexOf(BEGIN); const b = t.indexOf(END, a);
  fs.writeFileSync(statePath, `${t.slice(0, a + BEGIN.length)}\n${body}\n${t.slice(b)}`);
  console.log(`  checkpoint updated in ${path.basename(statePath)} (5 lines)`);
  for (const l of body.split('\n')) console.log(`     ${l.replace(/^-\s*/, '')}`);
  process.exit(0);
}

console.error(`  unknown command: ${cmd}\n  read · check · note · set`);
process.exit(2);
