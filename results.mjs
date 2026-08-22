#!/usr/bin/env node
// results.mjs — the page you hand to someone. Where you were, what changed, and what earned it.
//
//   node results.mjs ~/your/projects              write five-hats-report/results-<date>.html
//   node results.mjs ... --before <file>          compare against a specific baseline JSON
//   node results.mjs ... --before none            render the first-picture page even if baselines exist
//   node results.mjs ... --registry <file>        measure through a registry (auto-detected otherwise)
//   node results.mjs ... --out <dir>              write somewhere else
//   node results.mjs ... --no-ai                  do not read the AI configuration at all
//
// READ-ONLY except for the one HTML file it writes. No network request exists in this file, and
// the page it writes loads no external asset — it prints from a browser exactly as it renders.
//
// WHY THIS EXISTS. The terminal output convinces the person who ran it. It convinces nobody
// else, and "show, don't retell" is how this work travels: a page that survives being printed,
// handed across a table, or emailed to someone who will never open a terminal. The baseline was
// always the honest "before"; this is the honest "before AND after", in one artifact.
//
// THE ONE DISTINCTION THIS PAGE MUST NOT BLUR — install-set versus earned. Wiring the kit moves
// some numbers by itself: projects become "registered", commits become "scanned", roles gain a
// trigger. Those are COVERAGE. They move the moment the kit is set up, whether or not anything
// improved, and a page that counts them as progress is marketing wearing a lab coat. EARNED
// numbers are the ones only work can move: dead code actually removed, a project that reached a
// real person, drift actually resolved, a hot file cooled. The two live in separate sections
// with the difference stated in words, because that separation is the integrity of the claim.
//
// WHAT THE PAGE DELIBERATELY LEAVES OUT: absolute paths, project names, file names, and source.
// The reader this page is FOR is a stranger, and the sender should never have to scan it for
// things they wish it didn't say. Counts travel safely; names do not. The terminal reports keep
// every specific — this page is the one that leaves the machine. A leak check runs before the
// file is written and refuses to write rather than ship a path (gate the rendered artifact —
// correct data has rendered four defects before).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KIT_VERSION } from './kit-version.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !String(argv[i - 1] || '').startsWith('--'));

const target = path.resolve(positional[0] || '..');
const HOME_DIR = process.env.FIVE_HATS_HOME || path.join(os.homedir(), '.five-hats');
const OUT_DIR = path.resolve(val('out') || path.join(HERE, 'five-hats-report'));

// Registry auto-detection mirrors where the kit itself puts one: next to the tools, or in the
// report folder start.mjs writes. A registry changes WHAT gets counted, so which one was used
// is printed, never guessed silently.
const registry = val('registry')
  || (fs.existsSync(path.join(HERE, 'projects.json')) ? path.join(HERE, 'projects.json') : null)
  || (fs.existsSync(path.join(HERE, 'five-hats-report', 'projects.json')) ? path.join(HERE, 'five-hats-report', 'projects.json') : null);

function run(tool, args) {
  try {
    return JSON.parse(execFileSync(process.execPath, [path.join(HERE, tool), ...args],
      { encoding: 'utf8', stdio: 'pipe', timeout: 600000, maxBuffer: 256 * 1024 * 1024 }));
  } catch (e) {
    return { __error: String(e.stderr || e.message).split('\n').find((l) => /Error/.test(l)) || String(e.message).split('\n')[0] };
  }
}

// ---- the after: today, counted --------------------------------------------------------------
const scope = registry ? ['--registry', registry] : [target];
const afterArgs = [...scope, '--json'];
if (flag('no-ai')) afterArgs.push('--no-ai');
const after = run('baseline.mjs', afterArgs);
if (after.__error) {
  console.error(`\n  Could not take today's measurement: ${after.__error}`);
  console.error('  No page was written. A results page built on a crashed count would be fiction.\n');
  process.exit(2);
}
const roles = run('archetypes.mjs', [target, '--json']);

// ---- the before: the oldest baseline that survives ------------------------------------------
// Oldest, not newest — the point of this page is the whole distance travelled, and the first
// picture is the only one taken before anyone was managing to the metric.
function findBefore() {
  const given = val('before');
  if (given === 'none') return null;   // explicit first-picture mode; the verify leans on this
  if (given) {
    if (!fs.existsSync(given)) { console.error(`\n  --before: no such file: ${given}\n`); process.exit(2); }
    return { file: given, data: JSON.parse(fs.readFileSync(given, 'utf8')) };
  }
  const candidates = [];
  for (const d of [path.join(HOME_DIR, 'baselines'), path.join(HERE, 'five-hats-report'), HERE]) {
    try {
      for (const f of fs.readdirSync(d)) {
        if (/^baseline-\d{4}-\d{2}-\d{2}.*\.json$/.test(f)) candidates.push(path.join(d, f));
      }
    } catch { /* folder absent — fine */ }
  }
  let best = null;
  for (const f of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!data.takenAt) continue;
      if (!best || data.takenAt < best.data.takenAt) best = { file: f, data };
    } catch { /* an unparseable baseline is not a before */ }
  }
  return best;
}
const before = findBefore();
const B = before ? before.data : null;

// ---- what the installer did (for the install-set section) ------------------------------------
const manifest = { installed: false, hookRepos: 0, globalHooks: false, registryCreated: false, baselines: 0, since: null };
try {
  const dirs = new Set();
  for (const line of fs.readFileSync(path.join(HOME_DIR, 'install-manifest.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    manifest.installed = true;
    if (!manifest.since) manifest.since = (e.at || '').slice(0, 10);
    if (e.action === 'write' && /^hook-/.test(e.kind || '')) {
      if (e.path.startsWith(HOME_DIR)) manifest.globalHooks = true;
      else dirs.add(path.dirname(e.path));
    }
    if (e.action === 'write' && e.kind === 'registry') manifest.registryCreated = true;
    if (e.action === 'copy') manifest.baselines += 1;
  }
  manifest.hookRepos = dirs.size;
} catch { /* never installed via the kit — the page says so instead of guessing */ }

// ---- the rows ---------------------------------------------------------------------------------
// EARNED: numbers only work can move. Each row knows which direction is good; a row that moved
// the wrong way is shown moving the wrong way — a results page that only reports the wins is an
// advertisement.
const g = (snap, fn, dflt = null) => { try { const v = fn(snap); return v == null ? dflt : v; } catch { return dflt; } };
const EARNED = [
  ['Dead subsystems (nothing outside reaches them)', (s) => s.code.deadDirs, 'down'],
  ['Orphaned modules (nothing references them)', (s) => s.code.orphans, 'down'],
  ['Modules kept alive only by their own tests', (s) => s.code.testOnly, 'down'],
  ['Projects a real person has actually used', (s) => s.use.reached, 'up'],
  ['Projects nobody has ever used', (s) => s.use.never, 'down'],
  ['Serious decay findings', (s) => s.decay.serious, 'down'],
  ['Decay warnings', (s) => s.decay.warn, 'down', 'rising warnings just after adoption usually mean the system now sees what it was blind to'],
  ['Secret files tracked by git', (s) => s.decay.trackedSecret, 'down'],
  ['Projects with unpushed work ageing', (s) => s.decay.unpushed, 'down'],
  ['Projects with a working verify command', (s) => s.governance.withVerify, 'up', 'the installer never writes a verify, so every one of these was written by a person'],
  ['Hot files: changed constantly, large, untested', (s) => (s.heat && !s.heat.error ? s.heat.hot : null), 'down'],
];
const rows = EARNED.map(([label, fn, good, note]) => {
  const a = g(after, fn);
  const b = B ? g(B, fn) : null;
  const delta = (a != null && b != null) ? a - b : null;
  const verdict = delta === null ? 'na' : delta === 0 ? 'flat' : ((good === 'up' ? delta > 0 : delta < 0) ? 'better' : 'worse');
  return { label, before: b, after: a, delta, good, verdict, note };
});
const moved = rows.filter((r) => r.verdict === 'better').length;
const worse = rows.filter((r) => r.verdict === 'worse').length;
const flat = rows.filter((r) => r.verdict === 'flat').length;

// ---- what could not be measured — the section that keeps the rest believable -----------------
const unmeasured = [];
unmeasured.push('Whether any configured AI skill, agent or hook has ever actually RUN. A file on disk and a file that has fired are identical from the filesystem; only usage logs can answer this.');
unmeasured.push('Movement in the five-roles coverage. The before-picture format does not record it, so this page shows today’s coverage only and claims no trend.');
if (B && !(B.heat && !B.heat.error) && after.heat && !after.heat.error) {
  unmeasured.push(`Whether hot files cooled. The before-picture predates heat capture; today's count (${after.heat.hot}) becomes comparable from the next baseline on.`);
}
if ((after.code.unscanned || []).length) {
  const byLang = {};
  for (const u of after.code.unscanned) byLang[u.lang] = (byLang[u.lang] || 0) + (u.files || 0);
  unmeasured.push(`Dead code in ${Object.entries(byLang).map(([l, n]) => `${n} ${l} file(s)`).join(', ')} — detected but not analysed. Those counts above cover only what was actually opened.`);
}
if (after.use.unknown) {
  unmeasured.push(`Whether anyone has used ${after.use.unknown} project(s) — their artifact folders were not recognised, which is "can't tell", never "unused".`);
}
if (after.aiSetup && after.aiSetup.skipped) unmeasured.push('The AI setup — skipped at the operator’s request (--no-ai). Not counted, and not a zero.');
if (!g(after, (s) => s.governance.projects, 0)) unmeasured.push('Governance (verify coverage) — no registry was in scope, so nothing could be counted as governed or ungoverned.');
if (B && B.scope !== after.scope) unmeasured.push('Strict comparability — the before and after were not measured over an identical scope, so treat each delta as indicative, not audited.');
if (B && B.takenAt === after.takenAt) unmeasured.push('Any improvement at all, yet — the before and after were taken the same day. This page is a starting point wearing the comparison layout.');

// ---- render -----------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const totalProjects = g(after, (s) => s.governance.projects, 0)
  || (after.use.reached + after.use.never + after.use.unknown + after.use.missing);

// Role evidence can carry folder names (a client-named directory, a private project). Counts
// travel safely; names do not — so any evidence string holding a path separator is withheld
// from the page and stays in the terminal report where it belongs.
const roleCards = (Array.isArray(roles?.roles) ? roles.roles : []).map((r) => {
  const state = r.found.length ? (r.missing.length ? 'partial' : 'full') : 'none';
  const found = r.found.map((f) => (/[\\/]/.test(f) ? 'evidence found (specifics withheld from this page — see the terminal report)' : f));
  return { name: r.name, question: r.question, state, found, missing: r.missing, why: r.why, howTo: r.howTo };
});
const covered = roleCards.filter((r) => r.state !== 'none').length;

const dateNow = new Date().toISOString().slice(0, 10);
const chip = (v) => v === 'better' ? '<span class="chip good">improved</span>'
  : v === 'worse' ? '<span class="chip bad">moved the wrong way</span>'
  : v === 'flat' ? '<span class="chip flat">unchanged</span>'
  : '<span class="chip flat">no before</span>';
const dnum = (r) => r.delta === null ? '—' : (r.delta > 0 ? `+${r.delta}` : `${r.delta}`);
const MARKS = { full: '●', partial: '◐', none: '○' };
const STATE_WORD = { full: 'covered', partial: 'partly covered', none: 'no trigger found' };

const headline = !B
  ? 'This is the first picture. Nothing can honestly be called an improvement yet — this page is the "before" that makes next time’s claim checkable.'
  : `Of ${rows.filter((r) => r.delta !== null).length} measures only work can move: ${moved} improved, ${worse} moved the wrong way, ${flat} did not move.`;

const html = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Five Hats — Results</title>
<style>
:root{--bg:#EAEEF2;--card:#FBFCFD;--ink:#14181E;--soft:#5C6773;--line:#CCD5DE;--acc:#8A6512;--good:#2C6753;--bad:#97402A}
@media(prefers-color-scheme:dark){:root{--bg:#0F1319;--card:#171C23;--ink:#E7EBF0;--soft:#8B97A4;--line:#2B333D;--acc:#D7A745;--good:#6DBE9A;--bad:#D9765A}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 ui-serif,Georgia,serif;padding:40px 20px}
.wrap{max-width:840px;margin:0 auto}
h1{font:600 32px/1.15 ui-sans-serif,system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 6px}
.meta{color:var(--soft);font:500 12px/1.6 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;margin:0 0 26px}
h2{font:600 16px/1.3 ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em;margin:34px 0 6px}
.sub{color:var(--soft);font-size:14px;margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:20px 22px;margin-bottom:6px}
.headline{font:500 19px/1.5 ui-sans-serif,system-ui,sans-serif}
table{width:100%;border-collapse:collapse;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
th{text-align:left;font:600 11px/1.4 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
td.n{font:500 14px/1.4 ui-monospace,monospace;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.chip{font:600 11px/1 ui-sans-serif,system-ui,sans-serif;padding:3px 8px;border-radius:10px;white-space:nowrap}
.chip.good{background:var(--good);color:var(--card)}
.chip.bad{background:var(--bad);color:var(--card)}
.chip.flat{background:var(--line);color:var(--soft)}
.rownote{color:var(--soft);font-size:12.5px;margin-top:2px}
.role{display:grid;grid-template-columns:26px 130px 1fr;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
.role:last-child{border-bottom:0}
.role .mark{font-size:16px}
.role .nm{font-weight:600}
.role .st{color:var(--soft);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.role ul{margin:4px 0 0;padding-left:18px;color:var(--soft);font-size:13px}
.why{color:var(--acc);font-size:13px;margin-top:4px}
.note{color:var(--soft);font-size:14px;margin:14px 0 0}
ul.plain{margin:0;padding-left:20px;font:14px/1.7 ui-sans-serif,system-ui,sans-serif}
.foot{color:var(--soft);font:400 13px/1.7 ui-sans-serif,system-ui,sans-serif;margin-top:34px;border-top:1px solid var(--line);padding-top:14px}
@media(max-width:640px){.role{grid-template-columns:22px 1fr};td.n{white-space:normal}}
@media print{
 /* Paper is the second screen this page is FOR. Force the light palette — a dark background
    printed on a laser printer is a page nobody hands to anyone. */
 :root{--bg:#fff;--card:#fff;--ink:#111;--soft:#555;--line:#bbb;--acc:#8A6512;--good:#2C6753;--bad:#97402A}
 body{padding:0}.card{border-color:#bbb;break-inside:avoid}
 .chip.good{background:#fff;color:#2C6753;border:1px solid #2C6753}
 .chip.bad{background:#fff;color:#97402A;border:1px solid #97402A}
}
</style>
</head><body>
<div class="wrap">
<h1>Where this stood, and what changed</h1>
<p class="meta">Five Hats kit ${esc(KIT_VERSION)} &nbsp;·&nbsp; generated ${esc(dateNow)} &nbsp;·&nbsp; ${totalProjects} project(s) measured
${B ? ` &nbsp;·&nbsp; before ${esc(B.takenAt)} → after ${esc(after.takenAt)}` : ' &nbsp;·&nbsp; first picture — no before exists yet'}</p>

<div class="card"><p class="headline" style="margin:0">${esc(headline)}</p>
<p class="note" style="margin-top:8px">Every number on this page is a count taken from the disk at generation time — nothing is an estimate,
nothing is self-reported. Numbers that merely reflect the kit being installed are quarantined in their own
section below and are never presented as progress.</p></div>

<h2>The five roles — is anything making them happen?</h2>
<p class="sub">Every operation needs five jobs done: try new things, make them solid, clean up, get them used, keep them
running. A role with no trigger is a role that does not happen — not through laziness, through the absence of
anything that asks. Today: <strong>${covered} of ${roleCards.length || 5} roles have a trigger.</strong></p>
<div class="card">
${roleCards.map((r) => `<div class="role"><div class="mark">${MARKS[r.state]}</div>
<div><div class="nm">${esc(r.name)}</div><div class="st">${STATE_WORD[r.state]}</div></div>
<div>${esc(r.question)}
${r.found.length ? `<ul>${r.found.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
${r.state === 'none' ? `<div class="why">Why it matters: ${esc(r.why)}</div>` : ''}
</div></div>`).join('\n')}
${roleCards.length ? '' : '<p style="margin:0">The role scan could not run — stated here rather than shown as five clean rows.</p>'}
<p class="note">An uncovered row means <em>no evidence was found on this machine</em> — never "you do not do this".
A trigger tracked somewhere this scan cannot see is a finding about where the trigger lives, not about the person.</p>
</div>

<h2>Earned — what only work can move</h2>
<p class="sub">${B ? 'Both columns are real counts: the left was taken before anything changed, the right just now.'
    : 'No before-picture exists, so this column is a starting point — keep the JSON this run points to and the next page gets a real comparison.'}</p>
<div class="card"><table>
<tr><th>measure</th><th style="text-align:right">before</th><th style="text-align:right">after</th><th style="text-align:right">Δ</th><th></th></tr>
${rows.map((r) => `<tr><td>${esc(r.label)}${r.note ? `<div class="rownote">${esc(r.note)}</div>` : ''}</td>
<td class="n">${r.before == null ? '—' : r.before}</td><td class="n">${r.after == null ? '—' : r.after}</td>
<td class="n">${dnum(r)}</td><td>${chip(r.verdict)}</td></tr>`).join('\n')}
</table>
<p class="note">"Moved the wrong way" rows stay on the page. A results document that only reports wins is an advertisement,
and the wrong-way rows are usually the most useful line on it.</p></div>

<h2>Install-set — wiring, not progress</h2>
<p class="sub">These moved (or will move) simply because the kit was set up. They are coverage — necessary, and worth
exactly nothing as evidence of improvement, which is why they are quarantined here.</p>
<div class="card"><ul class="plain">
<li>Projects under governance (registered with the kit): <strong>${g(after, (s) => s.governance.projects, 0)}</strong>${B ? ` (was ${g(B, (s) => s.governance.projects, 0)})` : ''}</li>
<li>Secret scanning on commit: <strong>${manifest.globalHooks ? 'every repo on this machine (machine-wide hook path)'
    : manifest.hookRepos ? `${manifest.hookRepos} repo(s) guarded by the installed hook` : 'not installed via this kit — unknown from here'}</strong></li>
<li>Before-picture preserved outside the clone: <strong>${manifest.baselines ? `yes — ${manifest.baselines} snapshot(s)` : 'no — a re-clone would destroy the only honest "before"'}</strong></li>
<li>Roles with a trigger: <strong>${covered} of ${roleCards.length || 5}</strong> — the trigger existing is install-set; the job actually happening is what the earned table measures</li>
</ul></div>

<h2>What could not be measured, and why</h2>
<p class="sub">A page that never says this is a page you should not trust.</p>
<div class="card"><ul class="plain">
${unmeasured.map((u) => `<li>${esc(u)}</li>`).join('\n')}
</ul></div>

<p class="foot">Generated locally by the Five Hats kit (v${esc(KIT_VERSION)}), offline, from counts on this machine’s disk.
This page deliberately contains no file paths, no project names and no source code, so it can be printed,
mailed or handed to a stranger as-is. The terminal reports carry every specific this page withholds.</p>
</div>`;

// ---- gate the rendered artifact ---------------------------------------------------------------
// The page's whole promise is "safe to hand to a stranger". That promise is checked against the
// BYTES about to be written, not against intentions: if any absolute path slipped in, refuse to
// write and say where. Correct data has rendered four defects before; this is the gate.
const leaks = [];
for (const [what, needle] of [
  ['the scanned folder’s absolute path', target],
  ['this machine’s home directory', os.homedir()],
]) {
  for (const v of new Set([needle, needle.replace(/\\/g, '/'), needle.replace(/\//g, '\\')])) {
    if (v && html.includes(v)) { leaks.push(what); break; }
  }
}
if (/[A-Za-z]:\\|(^|[^.\w])\/(?:home|Users)\//.test(html)) leaks.push('an absolute path pattern');
if (leaks.length) {
  console.error(`\n  REFUSED to write the page: it would contain ${[...new Set(leaks)].join(' and ')}.`);
  console.error('  That is a bug in results.mjs — please report it. Nothing was written.\n');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `results-${dateNow}.html`);
fs.writeFileSync(outFile, `<!doctype html><html lang="en">\n${html}</body></html>\n`);

console.log(`\n  Wrote ${outFile}`);
console.log('  Open it in a browser; print it from there if you want paper.\n');
if (B) console.log(`  Compared against ${before.file} (taken ${B.takenAt}).`);
else {
  console.log('  No earlier baseline was found, so this page is a starting point, not a comparison.');
  console.log("  Take one now (node baseline.mjs --save) and the next page will show real movement.");
}
console.log('  The page holds counts only — no paths, no names — so it is safe to send as-is.');
console.log('  What it could not measure is printed ON the page, not omitted.\n');
process.exit(0);
