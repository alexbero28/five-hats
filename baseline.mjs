#!/usr/bin/env node
// baseline.mjs — take a picture of your setup BEFORE you change anything, so the change is
// measurable instead of asserted.
//
//   node baseline.mjs                     print the snapshot
//   node baseline.mjs --save              also write baseline-<date>.json here
//   node baseline.mjs --compare <file>    what moved since that snapshot
//   node baseline.mjs --registry projects.json    measure every project you own
//   node baseline.mjs --no-ai              skip reading the AI config entirely
//   node baseline.mjs --json               the snapshot on stdout, nothing written (results.mjs eats this)
//
// READ-ONLY except for the one file --save writes, in this folder, when you ask for it.
// It reads. It counts. It never edits your projects, never touches your AI config, never
// deploys, and never sends anything anywhere. There is no network call in this file.
//
// WHY THIS EXISTS. Everyone who adopts a new way of working believes it helped. Almost nobody
// can say by how much, because nobody wrote down what "before" looked like. Worse: once you have
// changed things, the old numbers are gone for good — you cannot go back and measure a state you
// no longer occupy. Ten minutes now buys you the only honest answer you will ever get to "did
// this actually improve anything."
//
// WHAT IT DELIBERATELY DOES NOT CLAIM. This counts what EXISTS. It cannot tell you what has ever
// RUN. A skill file on disk and a skill that has fired look identical from here, and the gap
// between those two is where our own 1,639 unused skills lived for two months. Where that limit
// bites, this prints the limit instead of a number.

import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !String(argv[i - 1] || '').startsWith('--'));

const target = positional[0] || '.';
const registry = val('registry');

// ---- helpers -------------------------------------------------------------------------------
function runCheck(tool, extra = []) {
  // Each check already speaks JSON. Shell out rather than reimplement, so the baseline can never
  // disagree with what the checks themselves report.
  const args = [join(HERE, tool), ...extra, '--json'];
  try {
    // maxBuffer must be explicit. On a large tree sweep's JSON exceeded the default and the
    // child's stdout was TRUNCATED mid-string, surfacing as
    //   "could not measure: Unterminated string in JSON at position 65536"
    // The principle held (it said "could not measure", not "0 findings") but the measurement
    // was lost on exactly the big repos worth measuring.
    const out = execFileSync(process.execPath, args,
      { encoding: 'utf8', stdio: 'pipe', timeout: 300000, maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(out);
  } catch (e) {
    return { __error: String(e.stderr || e.message).split('\n')[0] };
  }
}

const scope = registry ? ['--registry', registry] : [target];

// ---- 1. code the machine can see ------------------------------------------------------------
const sweep = runCheck('sweep.mjs', scope);
const code = { scanned: 0, deadDirs: 0, orphans: 0, testOnly: 0, writerless: 0, unscanned: [], error: null };
if (sweep.__error) code.error = sweep.__error;
else for (const r of sweep) {
  code.scanned += r.scanned || 0;
  code.deadDirs += (r.deadDirs || []).length;
  code.orphans += (r.orphans || []).length;
  code.testOnly += (r.testOnly || []).length;
  code.writerless += (r.writerless || []).length;
  // Languages sweep DETECTED but did not analyse are blind spots, and they must surface here
  // whether or not anything else in the project scanned fine. (This read `r.otherLangs` until
  // sweep grew per-language reporting -- a field the producer had renamed and this consumer was
  // still asking for, so every blind spot silently vanished from the baseline. Exactly the defect
  // class `find-orphaned-output` exists to catch, caught in this kit's own pipeline.)
  for (const n of (r.notAnalysed || [])) {
    code.unscanned.push({ project: r.project, lang: n.lang, files: n.files, why: n.why });
  }
}

// ---- 2. who has actually used any of it ------------------------------------------------------
const reach = runCheck('reach.mjs', scope);
const use = { reached: 0, never: 0, unknown: 0, missing: 0, error: null };
if (reach.__error) use.error = reach.__error;
else for (const r of reach) if (r.state in use) use[r.state] += 1;

// ---- 3. what is quietly decaying -------------------------------------------------------------
const drift = runCheck('drift.mjs', scope);
const decay = { serious: 0, warn: 0, info: 0, top: [], noRemote: 0, unpushed: 0, trackedSecret: 0, error: null };
if (drift.__error) decay.error = drift.__error;
else {
  for (const d of drift) {
    if (d.sev in decay) decay[d.sev] += 1;
    const w = String(d.what || '');
    // "not under version control" is STRICTLY WORSE than a missing remote, so it must count
    // toward the same gap. Matching only /no git remote/ is what let a folder with no git at
    // all be scored as backed up.
    if (/no git remote|not under version control/i.test(w)) decay.noRemote += 1;
    if (/unpushed/i.test(w)) decay.unpushed += 1;
    if (/secret file is TRACKED/i.test(w)) decay.trackedSecret += 1;
  }
  decay.top = drift.filter((d) => d.sev === 'serious').slice(0, 5).map((d) => `${d.project}: ${d.what}`);
}

// ---- 3b. how many files are hot AND large AND untested ---------------------------------------
// The same three-signal agreement fix.mjs uses — churn alone is not a finding, so this counts
// only the files where the signals agree. Captured here because "hotspots cooled" is an EARNED
// improvement, and it can only ever be shown if the before-picture recorded the heat. The first
// baselines did not, so their comparisons must say "not measured before" instead of a delta —
// this field is what stops the NEXT comparison having to say that.
const hot = runCheck('hotspots.mjs', scope);
const heat = { hot: 0, error: null };
if (hot.__error) heat.error = hot.__error;
else for (const r of hot) {
  for (const f of (r.files || []).slice(0, 8)) {
    if (f.changes >= 8 && f.lines >= 300 && (!f.tested || f.fixes >= 3)) heat.hot += 1;
  }
}

// ---- 4. how much of what you own is actually governed ----------------------------------------
const gov = { projects: 0, withVerify: 0, strengths: {}, error: null };
if (registry && existsSync(registry)) {
  try {
    const reg = JSON.parse(readFileSync(registry, 'utf8'));
    const rows = Object.entries(reg.projects || {});
    gov.projects = rows.length;
    for (const [, c] of rows) {
      if (c.verify) gov.withVerify += 1;
      const s = c.strength || '(none)';
      gov.strengths[s] = (gov.strengths[s] || 0) + 1;
    }
  } catch (e) { gov.error = e.message; }
}

// ---- 5. the AI setup itself -------------------------------------------------------------------
// Counting only. See the header: existence is not use, and this cannot close that gap.
// --no-ai skips this section entirely. Counting somebody's AI configuration is reasonable on your
// own machine and presumptuous on someone else's, and "you can turn it off" is worth more than any
// assurance about what it does. When skipped it is reported as skipped, never as a zero.
const claudeDir = join(os.homedir(), '.claude');
const skipAi = flag('no-ai');
const ai = {
  present: !skipAi && existsSync(claudeDir),
  skipped: skipAi, skills: 0, agents: 0, instructionBytes: 0, biggest: null, note: null,
};
if (ai.present) {
  const count = (sub) => { try { return readdirSync(join(claudeDir, sub)).length; } catch { return 0; } };
  ai.skills = count('skills');
  ai.agents = count('agents');
  // Instruction files are the ones that silently grow until something breaks.
  for (const f of ['CLAUDE.md', 'MEMORY.md']) {
    const p = join(claudeDir, f);
    try {
      const b = statSync(p).size;
      ai.instructionBytes += b;
      if (!ai.biggest || b > ai.biggest.bytes) ai.biggest = { file: f, bytes: b };
    } catch { /* absent */ }
  }
  ai.note = 'counts what EXISTS on disk. It cannot tell you what has ever fired.';
}

// ---- assemble ---------------------------------------------------------------------------------
// NEVER and CAN'T TELL are different facts and must never be merged. reach reported
// "0 never · 15 can't tell" while the chart claimed "15 nobody has ever touched" — asserting
// something the check had explicitly declined to assert. Module scope, because BOTH the terminal
// chart and the HTML report need it; defining it inside the terminal block crashed --report.
const useGap = [
  use.never ? `${use.never} nobody has ever touched` : '',
  use.unknown ? `${use.unknown} can't tell (name your evidence folders)` : '',
  use.missing ? `${use.missing} path missing` : '',
].filter(Boolean).join(' · ');

const snapshot = {
  takenAt: new Date().toISOString().slice(0, 10),
  scope: registry ? `registry:${basename(registry)}` : target,
  code, use, decay, heat, governance: gov, aiSetup: ai,
};

// ---- machine-readable mode ---------------------------------------------------------------------
// The snapshot on stdout, nothing written. This exists so results.mjs can consume the SAME
// numbers this file computes instead of re-deriving them — two implementations of one count is
// how a chart and a check end up disagreeing about the same disk.
if (flag('json')) { console.log(JSON.stringify(snapshot, null, 2)); process.exit(0); }

// ---- compare mode -----------------------------------------------------------------------------
if (flag('compare')) {
  const prevPath = val('compare');
  if (!prevPath || !existsSync(prevPath)) {
    console.error(`baseline: cannot read ${prevPath || '<no file given>'}`);
    process.exit(2);
  }
  const prev = JSON.parse(readFileSync(prevPath, 'utf8'));
  console.log(`# Baseline comparison\n`);
  console.log(`  before  ${prev.takenAt}   after  ${snapshot.takenAt}\n`);

  // A COMPARISON IS ONLY A COMPARISON IF BOTH SIDES LOOKED AT THE SAME THING.
  // Run this with a registry whose paths point at another machine and the after-run scans zero
  // files — then every count drops to nought and this printed "orphaned modules 158 -> 0, -158,
  // IMPROVED" with a green tick. A run that saw nothing produced the most flattering result
  // available. That is the defect this whole kit is named for, sitting in the one function whose
  // entire job is to say whether things got better.
  const measuredNothing = snapshot.code.scanned === 0 && (prev.code.scanned || 0) > 0;
  const scopeShift = prev.governance.projects && gov.projects
    && Math.abs(prev.governance.projects - gov.projects) > 0;
  if (measuredNothing) {
    console.log(`  ${'✖'} REFUSING TO COMPARE — the after-run scanned 0 files, the before-run scanned ${prev.code.scanned}.`);
    console.log('     Every count would drop to zero and read as improvement. Nothing was cleaned;');
    console.log('     nothing was looked at. Check that the registry paths exist on THIS machine.\n');
    process.exit(2);
  }
  if (scopeShift) {
    console.log(`  ! SCOPE CHANGED — ${prev.governance.projects} project(s) before, ${gov.projects} now.`);
    console.log('     Rows below mix real movement with projects entering or leaving the registry.');
    console.log('     A count that fell because something stopped being measured is not an improvement.\n');
  }
  // Direction matters per row: fewer findings is better, more reach is better.
  const rows = [
    ['projects with a verify', prev.governance.withVerify, gov.withVerify, 'up'],
    ['projects a person has used', prev.use.reached, use.reached, 'up'],
    ['projects nobody has used', prev.use.never, use.never, 'down'],
    ['dead directories', prev.code.deadDirs, code.deadDirs, 'down'],
    ['orphaned modules', prev.code.orphans, code.orphans, 'down'],
    ['test-only modules', prev.code.testOnly, code.testOnly, 'down'],
    ['serious drift', prev.decay.serious, decay.serious, 'down'],
    ['drift warnings', prev.decay.warn, decay.warn, 'down'],
  ];
  // Heat entered the snapshot after the first baselines shipped. A missing field in an old file
  // means NOT MEASURED THEN — printing "0 -> 3, worse" against a zero nobody counted would be
  // inventing a "before" the person never had.
  if (prev.heat && !prev.heat.error && !heat.error) rows.push(['hot untested files', prev.heat.hot, heat.hot, 'down']);
  for (const [label, a, b, good] of rows) {
    const d = b - a;
    const better = d === 0 ? '   ' : ((good === 'up' ? d > 0 : d < 0) ? ' ✓ ' : ' ! ');
    const sign = d > 0 ? `+${d}` : `${d}`;
    console.log(`  ${better} ${label.padEnd(28)} ${String(a).padStart(5)} -> ${String(b).padStart(5)}   ${d === 0 ? '' : sign}`);
  }
  if (!(prev.heat && !prev.heat.error) && !heat.error) {
    console.log(`      hot untested files ${String(heat.hot).padStart(15)} now — not in the before-picture, so no delta can be claimed`);
  }
  console.log('\n  ✓ = moved the right way · ! = moved the wrong way · blank = unchanged');
  console.log('  A row that did not move is not a failure. Some of these should not move.');
  process.exit(0);
}

// ---- the first-run picture ---------------------------------------------------------------------
// On a FIRST run there is no "after" to compare against, so showing a before/after chart would be
// showing a number nobody has earned yet. What CAN be shown honestly is the gap: how much of what
// you own is covered, and how much isn't. The gap is the finding. The improvement is what you do
// about it, and --compare is what proves it later.
const WIDTH = 22;
function bar(have, total) {
  if (!total) return '(nothing to measure)'.padEnd(WIDTH);
  const filled = Math.round((have / total) * WIDTH);
  return '█'.repeat(filled) + '░'.repeat(WIDTH - filled);
}
function row(label, have, total, gapWord, gapOverride) {
  const gap = total - have;
  const frac = total ? `${have}/${total}` : '—';
  const note = !total ? '' : gap === 0 ? 'all covered' : (gapOverride || `${gap} ${gapWord}`);
  console.log(`     ${label.padEnd(26)} ${bar(have, total)}  ${frac.padStart(7)}   ${note}`);
}

const totalProjects = gov.projects || (use.reached + use.never + use.unknown + use.missing);

console.log('# Baseline — where you are today\n');
console.log(`  taken ${snapshot.takenAt}   scope: ${snapshot.scope}\n`);

if (totalProjects) {
  console.log('  WHERE YOU ARE  — filled is covered, empty is the gap\n');
  if (gov.projects) {
    row('can prove it works', gov.withVerify, gov.projects, 'have no verify command');
  }
  // NEVER and CAN'T TELL are different facts and must never be merged. reach reported
  // "0 never · 15 can't tell" while this row claimed "15 nobody has ever touched" -- the chart
  // asserting something the check had explicitly declined to assert.
  row('used by a real person', use.reached, totalProjects, 'nobody has ever touched', useGap);
  row('survives a disk failure', totalProjects - decay.noRemote, totalProjects, 'exist on exactly one disk');
  console.log('');
  const cleanup = code.deadDirs + code.orphans + code.testOnly + code.writerless;
  if (cleanup) {
    console.log(`     code nothing reads         ${code.deadDirs} dead director(ies) · ${code.orphans} orphan(s) · ${code.testOnly} test-only · ${code.writerless} writerless`);
  }
  if (decay.trackedSecret) {
    console.log(`     SECRETS IN GIT HISTORY     ${decay.trackedSecret} — the one mistake a later commit cannot undo`);
  }
  if (decay.unpushed) {
    console.log(`     work not pushed anywhere   ${decay.unpushed} project(s)`);
  }
  console.log('');
  console.log('  Every empty block is a decision nobody has made yet — not a failure.');
  console.log('  Nothing above is an estimate. It is a count, taken just now, of what is on this disk.');
  console.log('  Re-run with --compare after a few weeks to see which of these actually moved.\n');
}


console.log('  WHAT YOU OWN');
if (gov.projects) {
  console.log(`     ${gov.projects} project(s) registered, ${gov.withVerify} with a verify command`);
  const s = Object.entries(gov.strengths).map(([k, v]) => `${v}x${k}`).join(' · ');
  if (s) console.log(`     verify strength: ${s}`);
} else {
  console.log('     no registry given — run with --registry projects.json to measure everything you own');
}
console.log('');

console.log('  CODE NOTHING READS');
if (code.error) console.log(`     could not measure: ${code.error}`);
else {
  console.log(`     ${code.deadDirs} dead director(ies) · ${code.orphans} orphan(s) · ${code.testOnly} test-only · ${code.writerless} writerless`);
  console.log(`     across ${code.scanned} file(s) actually analysed`);
  for (const u of code.unscanned) {
    console.log(`     NOT ANALYSED  ${u.project} — ${u.lang} (${u.files} file(s)). Treat as unscanned, not clean.`);
  }
}
console.log('');

console.log('  WHO HAS USED IT');
if (use.error) console.log(`     could not measure: ${use.error}`);
else {
  console.log(`     ${use.reached} reached a real person · ${use.never} never has · ${use.unknown} can't tell · ${use.missing} missing`);
  if (use.never) console.log('     Every "never" is a decision nobody has made yet: ship it or park it.');
}
console.log('');

console.log('  WHAT IS DECAYING');
if (decay.error) console.log(`     could not measure: ${decay.error}`);
else {
  console.log(`     ${decay.serious} serious · ${decay.warn} warn · ${decay.info} info`);
  for (const t of decay.top) console.log(`     SERIOUS  ${t}`);
}
console.log('');

console.log('  YOUR AI SETUP');
if (ai.skipped) console.log('     SKIPPED at your request (--no-ai) — not counted, not a zero');
else if (!ai.present) console.log('     no ~/.claude directory found — nothing to count');
else {
  console.log(`     ${ai.skills} skill(s) · ${ai.agents} agent(s) · ${ai.instructionBytes} bytes of standing instructions`);
  if (ai.biggest) console.log(`     largest instruction file: ${ai.biggest.file} (${ai.biggest.bytes} bytes)`);
  console.log(`     NOTE: this ${ai.note}`);
  console.log('     Nothing on disk can answer that. Your own logs can. Ask it before you add more.');
}
console.log('');

// ---- optional HTML report ----------------------------------------------------------------------
// Same numbers, in a form you can hand to somebody who will not read a terminal. Self-contained,
// written locally, opened from disk. No network request, no external asset, no tracking.
if (flag('report')) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const gapRow = (label, have, total, gapWord, gapOverride) => {
    if (!total) return '';
    const pct = Math.round((have / total) * 100);
    const gap = total - have;
    return `<div class="row"><div class="lab">${esc(label)}</div>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      <div class="num">${have}/${total}</div>
      <div class="gap">${gap === 0 ? 'all covered' : esc(gapOverride || `${gap} ${gapWord}`)}</div></div>`;
  };
  const tp = totalProjects;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Baseline ${esc(snapshot.takenAt)}</title><style>
:root{--bg:#EAEEF2;--card:#FBFCFD;--ink:#14181E;--soft:#5C6773;--line:#CCD5DE;--acc:#8A6512;--fill:#2C6753;--bad:#97402A}
@media(prefers-color-scheme:dark){:root{--bg:#0F1319;--card:#171C23;--ink:#E7EBF0;--soft:#8B97A4;--line:#2B333D;--acc:#D7A745;--fill:#6DBE9A;--bad:#D9765A}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font:16px/1.6 ui-serif,Georgia,serif;padding:40px 20px}
.wrap{max-width:820px;margin:0 auto}
h1{font:600 30px/1.15 ui-sans-serif,system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 6px}
.meta{color:var(--soft);font:500 12px/1.5 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;margin:0 0 30px}
h2{font:600 15px/1.3 ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em;margin:32px 0 14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:22px 24px}
.row{display:grid;grid-template-columns:180px 1fr 62px 1fr;gap:14px;align-items:center;margin-bottom:12px}
.lab{font:500 14px/1.3 ui-sans-serif,system-ui,sans-serif}
.track{height:12px;background:var(--line);border-radius:2px;overflow:hidden}
.fill{height:100%;background:var(--fill)}
.num{font:500 13px/1 ui-monospace,monospace;text-align:right;font-variant-numeric:tabular-nums}
.gap{font:400 13px/1.3 ui-sans-serif,system-ui,sans-serif;color:var(--soft)}
.note{color:var(--soft);font-size:14px;margin:16px 0 0}
.alert{color:var(--bad);font:500 14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:6px 0}
ul{margin:8px 0 0;padding-left:20px;color:var(--soft);font-size:14px}
@media(max-width:640px){.row{grid-template-columns:1fr;gap:4px}.num{text-align:left}}
</style></head><body><div class="wrap">
<h1>Where you are today</h1>
<p class="meta">Taken ${esc(snapshot.takenAt)} &nbsp;·&nbsp; Scope ${esc(snapshot.scope)}</p>

<h2>Coverage — filled is covered, empty is the gap</h2>
<div class="card">
${gov.projects ? gapRow('Can prove it works', gov.withVerify, gov.projects, 'have no verify command') : ''}
${gapRow('Used by a real person', use.reached, tp, 'nobody has ever touched', useGap)}
${gapRow('Survives a disk failure', tp - decay.noRemote, tp, 'exist on exactly one disk')}
<p class="note">Every empty block is a decision nobody has made yet — not a failure.
Nothing here is an estimate; it is a count taken just now of what is on this disk.</p>
</div>

<h2>Code nothing reads</h2>
<div class="card">
<p style="margin:0">${code.deadDirs} dead director${code.deadDirs === 1 ? 'y' : 'ies'} ·
${code.orphans} orphan${code.orphans === 1 ? '' : 's'} · ${code.testOnly} test-only ·
${code.writerless} writerless <span class="gap">— across ${code.scanned} file(s) actually scanned</span></p>
${code.unscanned.length ? `<p class="alert">Not analysed: ${code.unscanned.map((u) => `${esc(u.project)} — ${esc(u.lang)} (${u.files} file(s))`).join(', ')}. Treat as unscanned, not clean.</p>` : ''}
</div>

<h2>What is decaying</h2>
<div class="card">
<p style="margin:0">${decay.serious} serious · ${decay.warn} warning(s) · ${decay.info} info</p>
${decay.trackedSecret ? `<p class="alert">${decay.trackedSecret} secret file(s) tracked by git — the one mistake a later commit cannot undo.</p>` : ''}
${decay.top.length ? `<ul>${decay.top.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
</div>

<h2>Your AI setup</h2>
<div class="card">
${ai.skipped
    ? '<p style="margin:0">Skipped at your request (<code>--no-ai</code>) — not counted, and not a zero.</p>'
    : ai.present
    ? `<p style="margin:0">${ai.skills} skill(s) · ${ai.agents} agent(s) · ${ai.instructionBytes} bytes of standing instructions${ai.biggest ? ` · largest: ${esc(ai.biggest.file)} (${ai.biggest.bytes} bytes)` : ''}</p>
<p class="note"><strong>This counts what exists. It cannot tell you what has ever run.</strong>
A skill file and a skill that has fired are indistinguishable from the filesystem. Nothing on disk
can answer that — your own logs can. Ask it before you add more.</p>`
    : '<p style="margin:0">No AI configuration directory found — nothing to count.</p>'}
</div>

<p class="note" style="margin-top:30px">Re-run later with <code>--compare</code> against the saved
JSON to see which of these actually moved. That comparison, not this page, is the proof.</p>
</div></body></html>`;
  const rp = join(HERE, `baseline-${snapshot.takenAt}.html`);
  writeFileSync(rp, html);
  console.log(`  Wrote ${basename(rp)} — open it in a browser.\n`);
}

if (flag('save')) {
  const out = join(HERE, `baseline-${snapshot.takenAt}.json`);
  writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`  Saved ${basename(out)} — keep it. Re-run later with:`);
  console.log(`     node baseline.mjs --compare ${basename(out)}${registry ? ` --registry ${registry}` : ''}\n`);
} else {
  console.log('  Nothing was written. Add --save to keep this as your before-picture.\n');
}
process.exit(0);
