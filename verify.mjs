#!/usr/bin/env node
// verify.mjs — this kit's own binary gate. Exit 0 = healthy.
//
// A kit that preaches "every project needs one command that returns pass or fail" and does not
// have one itself would be worth ignoring. This is that command.
//
//   node verify.mjs

import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const fail = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { fail.push(m); console.log(`  FAIL ${m}`); };
console.log('five-hats-kit verify\n');

const CHECKS = ['sweep.mjs', 'reach.mjs', 'drift.mjs', 'baseline.mjs', 'fix.mjs', 'hotspots.mjs'];
// start.mjs is checked for presence and parse but NOT run here: it refuses (exit 1) when its
// target holds no project-shaped folders, which is correct behaviour and would fail this gate.
const TOOLS = ['bin/project.mjs', 'bin/secret-guard.mjs', 'start.mjs'];

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
    if (e.name === '.git' || e.name === 'node_modules') continue;
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

console.log(fail.length ? `\nFAILED (${fail.length})` : '\nfive-hats-kit OK');
process.exit(fail.length ? 1 : 0);
