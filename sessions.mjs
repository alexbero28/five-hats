#!/usr/bin/env node
// sessions.mjs — did the way you WORK change? Counted from the sessions you already had.
//
//   node sessions.mjs                     before vs after install, and what to do about it
//   node sessions.mjs --since 2026-09-01  split at a date instead of the install date
//   node sessions.mjs --json              machine-readable (pulse.mjs reads this)
//   node sessions.mjs --save              also write the verdict to the kit home for the pulse
//
// READ-ONLY except the one small verdict file --save writes to the kit home. No network request.
//
// WHY THIS EXISTS. Every other check here measures PROJECTS — dead code, reach, decay. None of
// them measured the thing the kit is actually trying to change: how the AI and the person work
// together, session after session. And the installer has a hole exactly there. Almost everyone
// already has a CLAUDE.md and a settings.json, and the installer rightly never edits either — so
// for most people the standing rules sit BESIDE their CLAUDE.md, unloaded, and the session hooks
// are printed rather than wired. The kit installs and the part that shapes behaviour never runs.
//
// Asking people to trust us and edit their CLAUDE.md up front is the wrong answer. The right one
// is evidence: measure the sessions, and only when the part that DID load has moved the numbers,
// say "now load the rest" — with the exact line, one consent, reversible.
//
// THE BEFORE ALREADY EXISTS. Claude Code keeps session transcripts on disk (about 30 days by
// default). So the before-picture does not have to be recorded in advance and waited for — it
// is sitting there on the day of install. That is the difference between "come back in a month"
// and a comparison that starts on day one.
//
// WHAT IT COUNTS, AND WHAT IT CANNOT. Every number below is a count of something that happened in
// a transcript — a tool that ran, a file that was written, words the person typed. It does not
// judge whether an answer was GOOD; nothing honest can do that from a log. Two rows are
// heuristics (they match phrases) and say so. Nothing is ever printed from a transcript: counts
// travel, content does not.
//
// AND IT IS A BEFORE/AFTER, NOT AN EXPERIMENT. The projects, the model and the month changed too.
// The verdict says "the numbers moved while this was installed", never "this caused it".

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { KIT_VERSION } from './kit-version.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };

const HOME_DIR = process.env.FIVE_HATS_HOME || path.join(os.homedir(), '.five-hats');
const MANIFEST = path.join(HOME_DIR, 'install-manifest.jsonl');
const VERDICT_FILE = path.join(HOME_DIR, 'sessions.json');
const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR
  ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
  : path.join(os.homedir(), '.claude');
const DOCTRINE_FILE = 'five-hats-doctrine.md';

// Below these, a rate is noise and the row says "not enough yet" instead of a number.
const MIN_SESSIONS = 8;
const MIN_CLAIMS = 5;
const MIN_PROMPTS = 20;
// Under this many prompts a session cannot show a habit either way — see measure().
const MIN_PROMPTS_PER_SESSION = 3;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const readIf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

// ---- what counts as what ------------------------------------------------------------------------
// A turn that tells the person the work is finished.
const DONE = /\b(done|fixed|all green|passes|passing|works now|is working|completed?|shipped|ready to (ship|merge|deploy))\b/i;
// A command that could have proven it. Deliberately broad: the question is "did anything run", not
// "did the right thing run" — that second question needs the project's registry, not a transcript.
const RUN = /\b(test|tests|verify|pytest|jest|vitest|mocha|cargo\s+(test|check|build)|go\s+(test|vet|build)|tsc|eslint|lint|npm\s+run|pnpm|yarn|make|build)\b/i;
// The person telling the AI it got something wrong. A heuristic, labelled as one everywhere.
const CORRECTION = /\b(that'?s (wrong|not (right|it|what i))|not what i (asked|meant|wanted)|you (didn'?t|did not|forgot|missed|broke)|(didn'?t|doesn'?t|does not|did not) work|still (broken|failing|wrong|not working)|try again|undo that|revert (that|it)|wrong (file|one|thing))\b/i;
// Writing down where things stand — the memory model actually being used.
const MEMORY_FILE = /(^|[\\/])(STATE|DECISIONS|MEMORY|HANDOFF)\.md$|[\\/]memory[\\/]/i;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  if (content.some((b) => b && b.type === 'tool_result')) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
}

// A prompt the PERSON typed — not a tool result, not a harness injection, not a resumed summary.
function isRealPrompt(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain || o.isCompactSummary) return false;
  const t = textOf(o.message && o.message.content).trim();
  if (!t) return false;
  return !/^(<|Caveat:|\[Request interrupted)/.test(t);
}

function readSession(file) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return null; }
  if (size === 0 || size > MAX_FILE_BYTES) return null;
  const lines = (readIf(file) || '').split('\n');
  const s = { start: null, prompts: 0, corrections: 0, claims: 0, backed: 0, skill: false, memory: false };
  let turn = null;
  const closeTurn = () => {
    if (turn && turn.lastText && DONE.test(turn.lastText)) {
      s.claims += 1;
      if (turn.ran) s.backed += 1;
    }
  };
  for (const line of lines) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.isSidechain) continue;
    if (!s.start && o.timestamp) s.start = o.timestamp;
    if (isRealPrompt(o)) {
      closeTurn();
      turn = { ran: false, lastText: '' };
      s.prompts += 1;
      if (CORRECTION.test(textOf(o.message.content))) s.corrections += 1;
      continue;
    }
    if (o.type !== 'assistant' || !turn || !o.message || !Array.isArray(o.message.content)) continue;
    for (const b of o.message.content) {
      if (!b) continue;
      if (b.type === 'text' && b.text && b.text.trim()) turn.lastText = b.text;
      if (b.type !== 'tool_use') continue;
      const inp = b.input || {};
      if (b.name === 'Skill') s.skill = true;
      if ((b.name === 'Bash' || b.name === 'PowerShell') && RUN.test(String(inp.command || ''))) turn.ran = true;
      if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(b.name)
        && MEMORY_FILE.test(String(inp.file_path || inp.notebook_path || ''))) s.memory = true;
    }
  }
  closeTurn();
  return s.prompts ? s : null;
}

function allSessions() {
  const dir = path.join(CLAUDE_HOME, 'projects');
  let groups;
  try { groups = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const out = [];
  for (const g of groups) {
    if (!g.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(dir, g.name)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const s = readSession(path.join(dir, g.name, f));
      if (s && s.start) out.push(s);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// ---- windows ------------------------------------------------------------------------------------
function manifestDates() {
  const t = readIf(MANIFEST);
  if (!t) return { installedAt: null, wiredAt: null };
  let installedAt = null; let wiredAt = null;
  for (const line of t.split('\n').filter(Boolean)) {
    try {
      const e = JSON.parse(line);
      if (!installedAt || e.at < installedAt) installedAt = e.at;
      if (e.kind === 'doctrine-import' && (!wiredAt || e.at < wiredAt)) wiredAt = e.at;
    } catch { /* a corrupt line is install.mjs's to report */ }
  }
  return { installedAt, wiredAt };
}

function measure(all) {
  // A ONE-PROMPT SESSION IS NOT EVIDENCE OF A HABIT. "Did a skill fire", "was anything written
  // down" — neither can happen in a session that asked one question and closed, yet each such stub
  // used to pull a per-session rate down exactly as hard as a 300-turn day. Measured on a real
  // machine, six of eleven sessions in one window were 1-2 prompts, and they moved a rate 20+
  // points on their own. Stubs are counted and reported, never scored: what they measure is how
  // often someone opened a window, which is not the question.
  const list = all.filter((s) => s.prompts >= MIN_PROMPTS_PER_SESSION);
  const stubs = all.length - list.length;
  const sum = (k) => list.reduce((n, s) => n + (typeof s[k] === 'boolean' ? Number(s[k]) : s[k]), 0);
  const sessions = list.length;
  const prompts = sum('prompts');
  const claims = sum('claims');
  return {
    sessions,
    stubs,
    from: all.length ? all[0].start.slice(0, 10) : null,
    to: all.length ? all[all.length - 1].start.slice(0, 10) : null,
    // proportions in 0..100, or null when there is too little to say anything
    backed: claims >= MIN_CLAIMS ? Math.round((100 * sum('backed')) / claims) : null,
    skills: sessions >= MIN_SESSIONS ? Math.round((100 * sum('skill')) / sessions) : null,
    memory: sessions >= MIN_SESSIONS ? Math.round((100 * sum('memory')) / sessions) : null,
    corrections: prompts >= MIN_PROMPTS ? Math.round((1000 * sum('corrections')) / prompts) / 10 : null,
    claims,
    prompts,
  };
}

// OUTCOMES ARE SCORED; ACTIVITY IS SHOWN. A skill firing is activity — fewer fires can mean the
// work got more disciplined or that fewer tokens went on skills nobody needed, and a count cannot
// tell which. Scoring it "up is better" would reward spend. So it prints for context and never
// votes; only rows where the direction is unambiguous decide the verdict.
const ROWS = [
  { key: 'backed', label: '"done" claims with a check run in the same turn', unit: '%', better: 'up', points: 10 },
  { key: 'memory', label: 'sessions that wrote down where things stand', unit: '%', better: 'up', points: 10 },
  { key: 'corrections', label: 'corrections per 100 prompts (heuristic)', unit: '', better: 'down', points: 1 },
  { key: 'skills', label: 'sessions where a skill fired', unit: '%', better: null, points: 10 },
];
const SCORED = ROWS.filter((r) => r.better).length;

function compare(a, b) {
  const rows = ROWS.map((r) => {
    const x = a[r.key]; const y = b[r.key];
    if (x === null || y === null) return { ...r, before: x, after: y, move: 'unknown' };
    const d = y - x;
    if (!r.better) return { ...r, before: x, after: y, delta: Math.round(d * 10) / 10, move: 'info' };
    const good = r.better === 'up' ? d : -d;
    // Corrections also need a RELATIVE drop — 2.0 to 1.0 per 100 means something, 30 to 29 does not.
    const bigEnough = Math.abs(d) >= r.points && (r.key !== 'corrections' || Math.abs(d) >= 0.25 * Math.max(x, y));
    return { ...r, before: x, after: y, delta: Math.round(d * 10) / 10, move: !bigEnough ? 'flat' : good > 0 ? 'better' : 'worse' };
  });
  return { rows, better: rows.filter((r) => r.move === 'better').length, worse: rows.filter((r) => r.move === 'worse').length };
}

// ---- what is actually loading -------------------------------------------------------------------
function loadState() {
  const claudeMd = readIf(path.join(CLAUDE_HOME, 'CLAUDE.md'));
  const doctrineAlongside = fs.existsSync(path.join(CLAUDE_HOME, DOCTRINE_FILE));
  const doctrineLoaded = claudeMd !== null
    && (claudeMd.includes(DOCTRINE_FILE) || claudeMd.includes('Installed by five-hats'));
  const settings = [readIf(path.join(CLAUDE_HOME, 'settings.json')), readIf(path.join(CLAUDE_HOME, 'settings.local.json'))].join('\n');
  const hooksLoaded = /pulse\.mjs|memory\.mjs/.test(settings);
  return { hasClaudeMd: claudeMd !== null, doctrineAlongside, doctrineLoaded, hooksLoaded };
}

// ---- the verdict --------------------------------------------------------------------------------
function decide() {
  const sessions = allSessions();
  const load = loadState();
  const { installedAt, wiredAt } = manifestDates();
  const since = val('since');
  const base = { kit: KIT_VERSION, at: new Date().toISOString(), load, installedAt, wiredAt };

  if (sessions === null) {
    return { ...base, verdict: 'blind', headline: `no session transcripts at ${path.join(CLAUDE_HOME, 'projects')} — nothing to count` };
  }
  const split = since || installedAt;
  if (!split) {
    const m = measure(sessions);
    return { ...base, verdict: 'before-only', before: m,
      headline: `${m.sessions} past session(s) counted — this is your before-picture. Install, work, then run this again` };
  }

  // Install-to-wire is the window where only the parts that load on their own were active.
  const cut = (lo, hi) => sessions.filter((s) => (!lo || s.start >= lo) && (!hi || s.start < hi));
  const before = measure(cut(null, split));
  if (wiredAt && !since) {
    const installed = measure(cut(split, wiredAt));
    const wired = measure(cut(wiredAt, null));
    if (wired.sessions < MIN_SESSIONS) {
      return { ...base, verdict: 'wait', before, after: installed, wired,
        headline: `standing rules loaded ${wiredAt.slice(0, 10)} — ${MIN_SESSIONS - wired.sessions} more session(s) before the effect can be read` };
    }
    const c = compare(installed, wired);
    const verdict = c.worse && !c.better ? 'unwire' : 'keep';
    return { ...base, verdict, before, after: installed, wired, comparison: c,
      headline: verdict === 'unwire'
        ? 'since the standing rules loaded, the numbers got WORSE and none got better — they are not earning their place'
        : `standing rules loaded: ${c.better} better, ${c.worse} worse since they started loading` };
  }

  const after = measure(cut(split, null));
  if (before.sessions < MIN_SESSIONS) {
    return { ...base, verdict: 'no-before', before, after,
      headline: `only ${before.sessions} session(s) before ${split.slice(0, 10)} — there is no honest before-picture to compare with` };
  }
  if (after.sessions < MIN_SESSIONS) {
    return { ...base, verdict: 'wait', before, after,
      headline: `${MIN_SESSIONS - after.sessions} more session(s) before a before/after means anything` };
  }
  const c = compare(before, after);
  const fullyLoaded = load.doctrineLoaded && load.hooksLoaded;
  let verdict;
  if (fullyLoaded) verdict = 'loaded';
  else if (c.better >= 2 && c.worse === 0) verdict = 'wire';
  else verdict = 'hold';
  const headline = {
    loaded: `everything is loading: ${c.better} better, ${c.worse} worse than before install`,
    wire: `${c.better} of ${SCORED} outcomes improved and none got worse — with the standing rules still NOT loading. Time to load them`,
    hold: `${c.better} better, ${c.worse} worse — not enough to recommend changing your CLAUDE.md yet`,
  }[verdict];
  return { ...base, verdict, before, after, comparison: c, headline };
}

const result = decide();

if (flag('save')) {
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(VERDICT_FILE, `${JSON.stringify({ at: result.at, verdict: result.verdict, headline: result.headline }, null, 2)}\n`);
  } catch { /* the verdict still prints; the pulse will just ask again next time */ }
}

if (flag('json')) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// ---- print --------------------------------------------------------------------------------------
const fmt = (v, unit) => (v === null || v === undefined ? DIM('not enough yet') : `${v}${unit}`);
console.log(B(`\n  Five Hats — how the work changed (kit ${KIT_VERSION})\n`));
const windowLine = (name, m) => m && console.log(`  ${name.padEnd(9)} ${m.sessions} session(s)`
  + `${m.from ? DIM(`  ${m.from} → ${m.to}`) : ''}`
  + `${m.stubs ? DIM(`  · ${m.stubs} one-or-two-prompt session(s) counted but not scored`) : ''}`);
windowLine('before', result.before);
windowLine('after', result.after);
windowLine('rules on', result.wired);

const table = result.comparison ? result.comparison.rows : result.before ? ROWS.map((r) => ({ ...r, before: result.before[r.key] })) : [];
if (table.length) {
  console.log('');
  for (const r of table) {
    const mark = { better: '▲ better', worse: '▼ worse', flat: '· flat', info: DIM(`· ${r.delta > 0 ? '+' : ''}${r.delta} (not scored)`), unknown: DIM('? cannot tell') }[r.move] || '';
    const after = 'after' in r ? `  →  ${fmt(r.after, r.unit).padEnd(6)}  ${mark}` : '';
    console.log(`  ${r.label.padEnd(50)} ${fmt(r.before, r.unit)}${after}`);
  }
}

console.log(`\n  ${B(result.headline)}`);

const L = result.load;
if (['wire', 'hold', 'wait', 'no-before', 'before-only'].includes(result.verdict) && !(L.doctrineLoaded && L.hooksLoaded)) {
  console.log('\n  What is loading in your sessions right now:');
  console.log(`     standing rules  ${L.doctrineLoaded ? 'loading' : L.doctrineAlongside ? `NOT loading — ${DOCTRINE_FILE} sits beside your CLAUDE.md, nothing imports it` : 'not installed'}`);
  console.log(`     session hooks   ${L.hooksLoaded ? 'loading' : 'NOT loading — your settings.json was left untouched'}`);
}
if (result.verdict === 'wire') {
  console.log(`\n  ${B('The one change:')} add a single import line to your CLAUDE.md. See it first, then consent:`);
  console.log(`     ${B('node install.mjs --wire-doctrine')}            shows the exact line, changes nothing`);
  console.log(`     ${B('node install.mjs --wire-doctrine --apply')}    adds it; --uninstall takes it back out`);
  if (!L.hooksLoaded) console.log(DIM('     The session hooks are printed by `node install.mjs <projects>` — paste them into settings.json.'));
  console.log(DIM('     This command will then compare the sessions AFTER that line with the ones before it.'));
}
if (result.verdict === 'unwire') {
  console.log('\n  Remove the import line from your CLAUDE.md (or run node install.mjs --uninstall).');
  console.log(DIM('  A rule that makes the work worse is not doctrine, it is weight.'));
}
console.log(DIM('\n  Counted, never read out: nothing from a transcript is printed. Two rows match phrases and'));
console.log(DIM('  are heuristics. This is a before/after, not an experiment — the projects and the month changed too.'));
console.log(DIM('  WHICH skills fire follows the kind of work, not the quality of it, which is why that row'));
console.log(DIM('  never votes. Sessions under three prompts are counted but scored in nothing.\n'));
process.exit(0);
