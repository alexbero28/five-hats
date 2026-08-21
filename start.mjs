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
//   2. Takes the baseline  — the before-picture, so improvement can be measured later, not asserted.
//   3. Runs the checks     — what nothing reads, who uses it, what decays, where effort goes.
//   4. Writes the plan     — every finding with its correct response and its trap.
//   5. Writes the brief    — the doctrine + findings, for their AI to execute under their gate.
//
// IT STILL CHANGES NOTHING in the target. Everything it writes goes into ONE output folder,
// and the folder is the deliverable.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const positional = argv.filter((a) => !a.startsWith('--'));
const noAi = flag('no-ai');

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const step = (n, s) => console.log(`\n${B(`[${n}/5]`)} ${B(s)}`);

// ---- 1. the ground --------------------------------------------------------------------------
console.log(B('\n  Five Hats — full pass\n'));
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
for (const d of projects) {
  reg.projects[d.name] = { path: path.join(target, d.name), verify: null, lane: 'fast' };
}
fs.writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`);
console.log(DIM(`      wrote a starter registry for those ${projects.length} (verify: null — that is itself a finding)`));

const run = (tool, args, label) => {
  try {
    return execFileSync(process.execPath, [path.join(HERE, tool), ...args],
      { encoding: 'utf8', stdio: 'pipe', timeout: 600000, maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    const out = String(e.stdout || '');
    if (out.trim()) return out;                     // non-zero exit but real output (drift --gate)
    console.log(`      ${label}: could not run — ${String(e.message).split('\n')[0]}`);
    return '';
  }
};

const save = (name, text) => { fs.writeFileSync(path.join(OUT, name), text); return name; };
const written = [];

// ---- 2. baseline ------------------------------------------------------------------------------
step(2, 'Taking the before-picture');
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
step(3, 'Running the checks');
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
step(4, 'Writing the plan');
const planOut = run('fix.mjs', ['--registry', regPath, '--brief'], 'fix');
written.push(save('05-the-plan.txt', planOut));
const counts = planOut.match(/(\d+) mechanical · (\d+) needing a decision/);
if (counts) console.log(`      ${counts[1]} mechanical (safe to automate) · ${counts[2]} needing a human decision`);

step(5, 'Writing the brief for your AI');
const brief = path.join(HERE, 'AGENT-BRIEF.md');
if (fs.existsSync(brief)) { fs.renameSync(brief, path.join(OUT, 'AGENT-BRIEF.md')); written.push('AGENT-BRIEF.md'); }
console.log('      the lanes, the seven rules, your findings, and the trap on each one');

// ---- hand it over ---------------------------------------------------------------------------------
const rel = path.relative(process.cwd(), OUT) || OUT;
console.log(`\n${B('  Done. Nothing in your projects was changed.')}\n`);
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
console.log(`\n  ${DIM('Anything the checks could not see says so in its own file. Read those lines')}`);
console.log(`  ${DIM('before treating a clean result as coverage.')}\n`);
process.exit(0);
