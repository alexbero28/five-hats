#!/usr/bin/env node
// archetypes.mjs — score an OPERATING SETUP against the five roles.
//
//   node archetypes.mjs <path>          score the setup around this folder
//   node archetypes.mjs --json
//
// READ-ONLY. It looks for configuration and evidence. It changes nothing and runs no AI.
//
// WHY THIS EXISTS. Every other check in this kit reads CODE. None of them read the thing that
// decides how the code gets made: the operating setup around it. Five jobs have to get done —
// Prototyper, Builder, Sweeper, Grower, Maintainer — and with a capable AI the first two go
// vertical while the other three stop, because nothing ever makes you do them.
//
// So the question is not "is your code good". It is: FOR EACH OF THE FIVE, IS THERE ANYTHING
// IN THIS SETUP THAT WOULD MAKE YOU DO IT? A role with no trigger is a role that does not
// happen, no matter how much anyone intends to.
//
// WHAT IT DOES NOT DO — and this is the whole discipline. It never guesses. It reports EVIDENCE
// FOUND and EVIDENCE ABSENT, and those are different claims. Absence of evidence is not proof a
// role is uncovered: somebody may track usage in an analytics product this cannot see. Every
// absent row says "no evidence here" rather than "you do not do this", and the difference is the
// difference between a finding and an accusation.
//
// It also cannot tell what has ever RUN. A configured hook and a hook that fires look identical
// on disk. Where it can find a log or a run record it says so; where it cannot, it says that too.
// That gap is where 1,639 never-loaded skills lived for two months.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const ROOT = path.resolve(positional[0] || '.');
const HOME = os.homedir();

const has = (...p) => fs.existsSync(path.join(...p));
const readIf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const sizeOf = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
const countDir = (p) => { try { return fs.readdirSync(p).length; } catch { return 0; } };

// Every project-ish folder under ROOT, plus ROOT itself.
const kids = (() => {
  try {
    return fs.readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => path.join(ROOT, d.name));
  } catch { return []; }
})();
const scopes = [ROOT, ...kids];
const anyScope = (fn) => scopes.filter(fn);

// ---------------------------------------------------------------------------------------------
// THE AI SETUP ITSELF — what is configured, and how heavy it has become.
// ---------------------------------------------------------------------------------------------
const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', '.windsurfrules',
  path.join('.github', 'copilot-instructions.md'), path.join('.claude', 'CLAUDE.md')];

const ai = { files: [], bytes: 0, skills: 0, agents: 0, commands: 0, mcp: 0, hooks: 0 };
for (const s of scopes) {
  for (const f of INSTRUCTION_FILES) {
    const p = path.join(s, f);
    if (fs.existsSync(p)) { ai.files.push({ file: path.relative(ROOT, p) || f, bytes: sizeOf(p) }); ai.bytes += sizeOf(p); }
  }
  ai.skills += countDir(path.join(s, '.claude', 'skills'));
  ai.agents += countDir(path.join(s, '.claude', 'agents'));
  ai.commands += countDir(path.join(s, '.claude', 'commands'));
  for (const m of ['.mcp.json', path.join('.cursor', 'mcp.json')]) {
    const t = readIf(path.join(s, m));
    if (t) { try { ai.mcp += Object.keys(JSON.parse(t).mcpServers || {}).length; } catch { /* unparseable */ } }
  }
  for (const st of ['settings.json', 'settings.local.json']) {
    const t = readIf(path.join(s, '.claude', st));
    if (t) { try { const j = JSON.parse(t); ai.hooks += Object.keys(j.hooks || {}).length; } catch { /* unparseable */ } }
  }
}
// The user-level setup counts too — it applies to every project on the machine.
const userClaude = path.join(HOME, '.claude');
if (fs.existsSync(userClaude)) {
  ai.skills += countDir(path.join(userClaude, 'skills'));
  ai.agents += countDir(path.join(userClaude, 'agents'));
  const t = readIf(path.join(userClaude, 'settings.json'));
  if (t) { try { ai.hooks += Object.keys(JSON.parse(t).hooks || {}).length; } catch { /* unparseable */ } }
  for (const f of ['CLAUDE.md']) {
    const p = path.join(userClaude, f);
    if (fs.existsSync(p)) { ai.files.push({ file: `~/.claude/${f}`, bytes: sizeOf(p) }); ai.bytes += sizeOf(p); }
  }
}

// ---------------------------------------------------------------------------------------------
// THE FIVE ROLES. Each asks: is there anything here that would MAKE you do this job?
// `found` is evidence seen. `absent` is evidence not seen — never a claim about the person.
// ---------------------------------------------------------------------------------------------
const roles = [];
const role = (name, question, found, missing, why, howTo) =>
  roles.push({ name, question, found, missing, why, howTo });

// --- PROTOTYPER: does anything stop an experiment becoming permanent? -------------------------
const expiries = anyScope((s) => {
  const t = readIf(path.join(s, 'projects.json'));
  return t.includes('"expires"');
});
role('PROTOTYPER', 'Does anything stop an experiment quietly becoming permanent?',
  expiries.map((s) => `kill-date field in ${path.relative(ROOT, s) || '.'}/projects.json`),
  expiries.length ? [] : ['no kill-date or expiry field found in any registry'],
  'A spike with no expiry becomes infrastructure by default — nobody ever decides to keep it, it just stays.',
  'Give every experiment a date. When the date passes, kill it or promote it — but decide.');

// --- BUILDER: can anything say "done"? --------------------------------------------------------
const builderFound = [];
const withTests = anyScope((s) => {
  const pkg = readIf(path.join(s, 'package.json'));
  return /"(test|check|verify)"\s*:/.test(pkg) || has(s, 'pytest.ini') || has(s, 'tox.ini')
    || /\[tool\.pytest/.test(readIf(path.join(s, 'pyproject.toml')));
});
if (withTests.length) builderFound.push(`${withTests.length} project(s) with a test/verify script`);
const ci = anyScope((s) => has(s, '.github', 'workflows') || has(s, '.gitlab-ci.yml') || has(s, '.circleci'));
if (ci.length) builderFound.push(`${ci.length} project(s) with CI configured`);
const registry = anyScope((s) => readIf(path.join(s, 'projects.json')).includes('"verify"'));
if (registry.length) builderFound.push('a registry with verify commands');
role('BUILDER', 'Can anything other than you declare work finished?',
  builderFound,
  builderFound.length ? [] : ['no test script, CI config or verify command found anywhere'],
  'Without one command that passes or fails, nobody can tell whether it works — not you, and not your AI.',
  'Write the smallest command that would fail if the project broke. Then let it, not an opinion, decide done.');

// --- SWEEPER: does anything find what nothing reads? -------------------------------------------
const sweepTools = [];
for (const s of scopes) {
  const pkg = readIf(path.join(s, 'package.json'));
  for (const t of ['knip', 'depcheck', 'ts-prune', 'unimported', 'madge']) if (pkg.includes(`"${t}"`)) sweepTools.push(t);
  if (readIf(path.join(s, 'requirements.txt')).includes('vulture')) sweepTools.push('vulture');
}
// Look in every scope, not just ROOT — the kit usually sits NEXT TO the projects it checks,
// so checking only the top level missed it sitting one folder away.
if (scopes.some((s) => has(s, 'sweep.mjs') && has(s, 'drift.mjs'))) sweepTools.push('five-hats sweep');
role('SWEEPER', 'Does anything look for what nothing reads any more?',
  [...new Set(sweepTools)],
  sweepTools.length ? [] : ['no dead-code or unused-dependency tooling found'],
  'Cleanup has no deadline and blocks nothing, so it loses every contest against whatever is urgent. It is not skipped through laziness — nothing triggers it.',
  'Run a sweep on a schedule, not when you feel like it. The trigger is the whole point.');

// --- GROWER: does anything ask whether a real person used it? ----------------------------------
const growerFound = [];
const evidenceDirs = ['out', 'output', 'outbox', 'responses', 'uploads', 'exports', 'deliveries', 'sent'];
const withEvidence = anyScope((s) => evidenceDirs.some((d) => has(s, d)));
if (withEvidence.length) growerFound.push(`${withEvidence.length} project(s) with an output/evidence folder`);
const analytics = anyScope((s) => {
  const pkg = readIf(path.join(s, 'package.json'));
  return /posthog|mixpanel|amplitude|plausible|segment|umami/i.test(pkg);
});
if (analytics.length) growerFound.push(`${analytics.length} project(s) with analytics wired`);
role('GROWER', 'Does anything ask whether a real person has ever used this?',
  growerFound,
  growerFound.length ? [] : ['no analytics and no output/evidence folders found'],
  'Green-and-unused looks identical to green-and-thriving on every instrument except the one that bothers to ask. Passing tests and having a user are unrelated facts.',
  'Point something at the folders that fill up when somebody ELSE acts. Then "never reached" becomes a decision — ship it or park it.');

// --- MAINTAINER: does anything watch for decay? -------------------------------------------------
const maintFound = [];
const gitHooks = anyScope((s) => {
  const d = path.join(s, '.git', 'hooks');
  try { return fs.readdirSync(d).some((f) => !f.endsWith('.sample')); } catch { return false; }
});
if (gitHooks.length) maintFound.push(`${gitHooks.length} project(s) with active git hooks`);
const globalHooks = spawnSync('git', ['config', '--global', 'core.hooksPath'], { encoding: 'utf8' });
if ((globalHooks.stdout || '').trim()) maintFound.push('a machine-wide git hooks path');
const scanners = anyScope((s) => {
  const pkg = readIf(path.join(s, 'package.json'));
  return /gitleaks|trufflehog|detect-secrets|husky|lint-staged/i.test(pkg)
    || has(s, '.pre-commit-config.yaml') || has(s, '.gitleaks.toml');
});
if (scanners.length) maintFound.push(`${scanners.length} project(s) with a secret/lint gate`);
const bots = anyScope((s) => has(s, '.github', 'dependabot.yml') || has(s, 'renovate.json'));
if (bots.length) maintFound.push(`${bots.length} project(s) with dependency automation`);
role('MAINTAINER', 'Does anything notice when things quietly rot?',
  maintFound,
  maintFound.length ? [] : ['no git hooks, secret scanning or dependency automation found'],
  'Decay is silent by definition — that is what makes it decay. Nothing announces an unpushed commit ageing, a secret entering history, or a check nobody runs.',
  'Put one gate in front of the irreversible things: commit, push, deploy. Silent until it matters.');

// ---- report -------------------------------------------------------------------------------------
if (argv.includes('--json')) {
  console.log(JSON.stringify({ root: ROOT, aiSetup: ai, roles }, null, 2));
  process.exit(0);
}

const MARK = { full: '●', partial: '◐', none: '○' };
const state = (r) => (r.found.length ? (r.missing.length ? 'partial' : 'full') : 'none');

console.log('\n# The five roles — is anything making you do each one?\n');
console.log(`  setup scanned: ${ROOT}`);
console.log(`  ${scopes.length - 1} project folder(s) + the machine-level AI configuration\n`);

for (const r of roles) {
  const st = state(r);
  console.log(`  ${MARK[st]} ${r.name.padEnd(11)} ${st === 'none' ? 'NO TRIGGER FOUND' : st === 'partial' ? 'partly covered' : 'covered'}`);
  for (const f of r.found) console.log(`      found    ${f}`);
  for (const m of r.missing) console.log(`      absent   ${m}`);
  if (st === 'none') {
    console.log(`      why it matters  ${r.why}`);
    console.log(`      what closes it  ${r.howTo}`);
  }
  console.log('');
}

const covered = roles.filter((r) => state(r) !== 'none').length;
console.log(`  ${covered} of 5 roles have something triggering them.\n`);

console.log('  YOUR AI SETUP, COUNTED');
if (!ai.files.length && !ai.skills && !ai.mcp) {
  console.log('     nothing found — no instruction files, skills or MCP servers in this tree\n');
} else {
  for (const f of ai.files.slice(0, 5)) console.log(`     ${String(f.bytes).padStart(7)} bytes  ${f.file}`);
  console.log(`     ${ai.skills} skill(s) · ${ai.agents} agent(s) · ${ai.commands} command(s) · ${ai.mcp} MCP server(s) · ${ai.hooks} hook event(s)`);
  if (ai.bytes > 20000) {
    console.log(`     ! ${ai.bytes} bytes of standing instructions. Past about 20 KB these stop being read`);
    console.log('       carefully by anyone, including the model. Ours reached 3,217 words and');
    console.log('       silently broke the tool that parsed it. Nothing complained for weeks.');
  }
  console.log('');
}

console.log('  WHAT THIS COULD NOT DETERMINE');
console.log('     Which of the above has ever actually RUN. A configured hook and a hook that');
console.log('     fires look identical on disk, and that gap is where a 1,639-skill library sat');
console.log('     unused for two months. Your own logs can answer it. Ask before adding more.\n');
console.log('     An "absent" row means no evidence was found HERE — not that you do not do it.');
console.log('     If you track usage somewhere this cannot see, that row is wrong and the finding');
console.log('     is that the trigger lives outside the repo.\n');
process.exit(0);
