#!/usr/bin/env node
// start.mjs — the whole arc, one command.
//
//   node start.mjs ../my-projects        analyse, measure, and produce the plan
//   node start.mjs ../my-projects --no-ai   ...without reading the AI config at all
//
// WHY THIS EXISTS. Six commands is six chances to stop. Somebody clones this, runs the first
// check, reads something uncomfortable, and never gets to the part that says what to do about
// it. One command that goes end to end and leaves a folder of finished work on the disk is the
// difference between a tool people admire and a tool people use.
//
// WHAT IT DOES, IN ORDER:
//   1. Checks the ground   — node, git, and whether the target actually holds projects.
//   2. Scores the SETUP    — for each of the five roles, is anything making you do it?
//   3. Takes the baseline  — the before-picture, so improvement can be measured later, not asserted.
//   4. Runs the checks     — what nothing reads, who uses it, what decays, where effort goes.
//   5. Writes the plan     — every finding with its correct response and its trap.
//   6. Writes the brief    — the doctrine + findings, for their AI to execute under their gate.
//
// Step 2 is the one nothing else does. Every other check reads CODE; that one reads the operating
// setup around it and asks whether the five jobs have anything TRIGGERING them.
//
// IT STILL CHANGES NOTHING in the target. Everything it writes goes into ONE output folder,
// and the folder is the deliverable.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KIT_VERSION } from './kit-version.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const positional = argv.filter((a) => !a.startsWith('--'));
const noAi = flag('no-ai');

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const step = (n, s) => console.log(`\n${B(`[${n}/6]`)} ${B(s)}`);

// ---- 1. the ground --------------------------------------------------------------------------
// The version prints because these runs come back to us in screenshots and pasted terminals,
// and "which kit produced this?" must be answerable from the output itself.
console.log(B(`\n  Five Hats — full pass (kit ${KIT_VERSION})\n`));
console.log(DIM('  Read-only. Nothing in your projects is created, changed or deleted.'));
console.log(DIM('  Everything produced goes into one output folder.\n'));

step(1, 'Checking the ground');

const major = Number(process.versions.node.split('.')[0]);
console.log(`      node ${process.versions.node}${major < 18 ? '   ** 18+ required **' : ''}`);
if (major < 18) { console.error('\n  Node 18 or newer is required. Nothing was run.\n'); process.exit(2); }

let hasGit = false;
try { execFileSync('git', ['--version'], { stdio: 'pipe' }); hasGit = true; } catch { /* absent */ }
console.log(`      git  ${hasGit ? 'present' : 'NOT FOUND — six of eight drift checks will be skipped and will say so'}`);

// Where are the projects? A wrong answer here produces confident nonsense, so it is checked
// rather than assumed, and it refuses rather than guessing badly.
const target = path.resolve(positional[0] || '..');
if (!fs.existsSync(target)) { console.error(`\n  No such folder: ${target}\n`); process.exit(2); }

const entries = fs.readdirSync(target, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules');
const looksLikeProject = (d) => {
  const p = path.join(target, d.name);
  return ['.git', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'Gemfile', 'requirements.txt']
    .some((m) => fs.existsSync(path.join(p, m)));
};
const projects = entries.filter(looksLikeProject);

console.log(`      target  ${target}`);
console.log(`      found   ${projects.length} project-shaped folder(s) of ${entries.length} director(ies)`);

// SAY WHAT YOU EXCLUDED. Everything below this point only ever sees `projects`, so a directory
// dropped here is invisible for the rest of the run — and a folder holding real code with no
// package.json and no .git is not an empty folder, it is the WORST case: work with no version
// control at all. Printing "19 of 28" and never naming the other 9 is the same defect as every
// other one found today: a number that quietly stands in for something nobody looked at.
const skipped = entries.filter((d) => !projects.includes(d));
if (skipped.length) {
  const withFiles = skipped.filter((d) => {
    try { return fs.readdirSync(path.join(target, d.name)).some((f) => !f.startsWith('.')); }
    catch { return false; }
  });
  console.log(`      SKIPPED ${skipped.length} director(ies) with no project marker`
    + ` (no .git, package.json, pyproject.toml, go.mod, Cargo.toml, Gemfile or requirements.txt)`);
  for (const d of withFiles.slice(0, 6)) console.log(`              ${d.name}  — has files, but nothing registers it`);
  if (withFiles.length > 6) console.log(`              ...and ${withFiles.length - 6} more`);
  if (withFiles.length) {
    console.log('              These are NOT scanned below. A folder with work and no version');
    console.log('              control is the worst case, not an empty one — check them by hand.');
  }
}

if (!projects.length) {
  console.log(`\n  ${B('Nothing here looks like a code project.')}`);
  console.log('  Point this at the folder that CONTAINS your projects, not at one project:');
  console.log(`      node start.mjs ~/Developer\n`);
  console.log(DIM('  Refusing to scan is the honest answer here. A scan of the wrong folder'));
  console.log(DIM('  returns a confident, meaningless clean result.\n'));
  process.exit(1);
}

// ---- a registry, so every project gets measured the same way ---------------------------------
const OUT = path.join(HERE, 'five-hats-report');
fs.mkdirSync(OUT, { recursive: true });
const regPath = path.join(OUT, 'projects.json');
const reg = { projects: {} };
// lane: 'tier1', never 'fast'. Doctrine: any doubt at all resolves to Tier-1, and a registry
// generated by a machine that has never seen these projects is nothing BUT doubt. This field is
// unread today; the day loop tooling lands it becomes the only gate deciding what may run
// unattended, and 'fast' here would silently enrol every project a stranger ever scanned.
for (const d of projects) {
  reg.projects[d.name] = { path: path.join(target, d.name), verify: null, lane: 'tier1' };
}
fs.writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`);
console.log(DIM(`      wrote a starter registry for those ${projects.length} (verify: null — that is itself a finding)`));

const run = (tool, args, label) => {
  try {
    return execFileSync(process.execPath, [path.join(HERE, tool), ...args],
      { encoding: 'utf8', stdio: 'pipe', timeout: 600000, maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    const out = String(e.stdout || '');
    const err = String(e.stderr || '');
    // A CRASH IS NOT A RESULT. This used to return stdout whenever the child had printed
    // anything, which is right for `drift --gate` (exits 1 by design, output is valid) and
    // catastrophically wrong for a child that printed half its work and then threw. baseline
    // did exactly that — printed the chart, crashed on a ReferenceError before writing the
    // report — and this line swallowed it, so the run announced success while its most
    // important deliverable was silently missing. Distinguish the two.
    const crashed = /Error|Exception|at ModuleJob|node:internal/.test(err);
    if (crashed) {
      console.log(`      ${B('!!')} ${label} CRASHED after producing partial output:`);
      console.log(`         ${err.split('\n').find((l) => /Error/.test(l)) || err.split('\n')[0]}`);
      failures.push(label);
      return out;   // keep what it managed to print, but the run is now marked failed
    }
    if (out.trim()) return out;                     // non-zero exit by design (drift --gate)
    console.log(`      ${label}: could not run — ${String(e.message).split('\n')[0]}`);
    failures.push(label);
    return '';
  }
};

const save = (name, text) => { fs.writeFileSync(path.join(OUT, name), text); return name; };
const written = [];
// Declared before run()'s first CALL. Anything that crashes lands here, and a non-empty list
// changes the closing message from "Done" to "INCOMPLETE".
const failures = [];

// ---- 2. baseline ------------------------------------------------------------------------------
step(2, 'Scoring the operating setup against the five roles');
const archOut = run('archetypes.mjs', [target], 'archetypes');
written.push(save('00-the-five-roles.txt', archOut));
for (const l of archOut.split('\n').filter((l) => /^  [●◐○] /.test(l))) console.log(`  ${l.trim()}`);
const bloat = (archOut.match(/! \d+ bytes of standing instructions/) || [''])[0];
if (bloat) console.log(`      ${bloat.replace('! ', '')}`);

step(3, 'Taking the before-picture');
const baseArgs = ['--registry', regPath, '--save', '--report'];
if (noAi) baseArgs.push('--no-ai');
const base = run('baseline.mjs', baseArgs, 'baseline');
// baseline writes its json/html next to itself; move them into the report folder.
for (const f of fs.readdirSync(HERE)) {
  if (/^baseline-\d{4}-\d{2}-\d{2}\.(json|html)$/.test(f)) {
    fs.renameSync(path.join(HERE, f), path.join(OUT, f));
    written.push(f);
  }
}
const chart = base.split('\n').filter((l) => /█|░|NOT ANALYSED|nobody has ever|no verify/.test(l));
for (const l of chart.slice(0, 8)) console.log(`  ${l}`);

// ---- 3. the three checks ------------------------------------------------------------------------
step(4, 'Running the checks');
const sweepOut = run('sweep.mjs', ['--registry', regPath], 'sweep');
const reachOut = run('reach.mjs', ['--registry', regPath], 'reach');
const driftOut = run('drift.mjs', ['--registry', regPath], 'drift');
const hotOut = run('hotspots.mjs', ['--registry', regPath], 'hotspots');
written.push(save('01-what-nothing-reads.txt', sweepOut));
written.push(save('02-who-has-used-it.txt', reachOut));
written.push(save('03-what-is-decaying.txt', driftOut));
written.push(save('04-where-the-work-goes.txt', hotOut));
const tally = (s, re) => (s.match(re) || ['—'])[0];
console.log(`      what nothing reads   ${tally(sweepOut, /\d+ finding\(s\)[^\n]*/)}`);
console.log(`      who has used it      ${tally(reachOut, /\d+ reached[^\n]*/)}`);
console.log(`      what is decaying     ${tally(driftOut, /\d+ serious[^\n]*/)}`);
const hotLine = (hotOut.match(/start with [^\n]*/) || [''])[0].trim();
console.log(`      where the work goes  ${hotLine || 'no git history to measure'}`);

// ---- 4 + 5. the plan and the brief ---------------------------------------------------------------
step(5, 'Writing the plan');
const planOut = run('fix.mjs', ['--registry', regPath, '--brief'], 'fix');
written.push(save('05-the-plan.txt', planOut));
const counts = planOut.match(/(\d+) mechanical · (\d+) needing a decision/);
if (counts) console.log(`      ${counts[1]} mechanical (safe to automate) · ${counts[2]} needing a human decision`);

step(6, 'Writing the brief for your AI');
const brief = path.join(HERE, 'AGENT-BRIEF.md');
if (fs.existsSync(brief)) { fs.renameSync(brief, path.join(OUT, 'AGENT-BRIEF.md')); written.push('AGENT-BRIEF.md'); }
console.log('      the lanes, the seven rules, your findings, and the trap on each one');

// ---- hand it over ---------------------------------------------------------------------------------
const rel = path.relative(process.cwd(), OUT) || OUT;
if (failures.length) {
  console.log(`\n${B(`  INCOMPLETE — ${failures.join(', ')} did not finish.`)}`);
  console.log('  What follows is PARTIAL. A missing section is not a clean one.\n');
} else {
  console.log(`\n${B('  Done. Nothing in your projects was changed.')}\n`);
}
console.log(`  Everything is in ${B(rel)}:\n`);
for (const f of written.sort()) console.log(`      ${f}`);

console.log(`\n${B('  What to do next, in order:')}\n`);
console.log(`  1. Open the ${B('baseline HTML')} — that is where you are today. Keep the .json;`);
console.log('     it is the only honest "before" you will get, and re-running --compare later');
console.log('     is what proves anything improved.');
console.log(`\n  2. Read ${B('05-the-plan.txt')}. Do the MECHANICAL items first — they are cheap`);
console.log('     and they cannot bite you.');
console.log(`\n  3. Hand ${B('AGENT-BRIEF.md')} to your AI assistant. It carries how to work, not`);
console.log('     just what to fix. Let it do the mechanical half while you watch, and make it');
console.log('     bring you the judgment calls one at a time.');
console.log(`\n  4. When you want the mechanical setup done for you: ${B('node install.mjs ' + (path.relative(process.cwd(), target) || '.'))}`);
console.log('     shows the complete, literal list of what it would change — nothing happens');
console.log('     until you add --apply, and --uninstall reverses all of it.');
console.log(`\n  5. After some real work has happened, run ${B('node results.mjs ' + (path.relative(process.cwd(), target) || '.'))}.`);
console.log('     It writes a before/after page you can print and hand to someone — which is');
console.log('     why keeping today\'s baseline JSON matters: it is the "before" on that page.');
console.log(`\n  ${DIM('Anything the checks could not see says so in its own file. Read those lines')}`);
console.log(`  ${DIM('before treating a clean result as coverage.')}\n`);
process.exit(0);
