#!/usr/bin/env node
// fix.mjs — turns findings into a PLAN. It still changes nothing.
//
//   node fix.mjs <path>                     the plan for one folder
//   node fix.mjs --registry projects.json   the plan across everything you own
//   node fix.mjs --brief                    also write AGENT-BRIEF.md for your AI to execute
//   node fix.mjs --json                     machine-readable
//
// WHY THIS EXISTS. The three checks tell you what is wrong and then stop. That is correct — a
// tool that deletes on its own is how you lose the one file that mattered — but it leaves most
// people stuck. They can see the finding and have no idea what the right response is, so nothing
// happens, which is the same outcome as never running the check.
//
// Every finding type HAS a known correct response, and most of them have a known WRONG one that
// looks right. That knowledge is the actual product. This file is that knowledge, written down.
//
// THE ONE DISTINCTION THAT MATTERS:
//
//   MECHANICAL — deterministic, reversible, no taste required. `git init`, add a remote, write a
//                .gitignore. Safe for your AI to do while you watch.
//   JUDGMENT   — someone has to decide. Is this dead subsystem really dead? Ship this project or
//                park it? No tool can answer that, and one that pretends to is lying.
//
// A plan that mixes those two is how "clean up the findings" turns into a deleted directory
// nobody meant to delete.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !String(argv[i - 1] || '').startsWith('--'));
const registry = val('registry');
const scope = registry ? ['--registry', registry] : [positional[0] || '.'];

function run(tool) {
  try {
    const out = execFileSync(process.execPath, [path.join(HERE, tool), ...scope, '--json'],
      { encoding: 'utf8', stdio: 'pipe', timeout: 300000, maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(out);
  } catch (e) {
    return { __error: String(e.stderr || e.message).split('\n')[0] };
  }
}

// ---------------------------------------------------------------------------------------------
// THE REMEDY TABLE — one entry per finding type. `trap` is the wrong move that looks right.
// ---------------------------------------------------------------------------------------------
const R = {
  notVersioned: {
    order: 1, lane: 'mechanical', title: 'Not under version control',
    why: 'There is no history and nothing to recover from. One bad afternoon and the work is gone.',
    steps: [
      'git init',
      'Write a .gitignore FIRST — before the first commit, so secrets never enter history at all.',
      'git add -A && git commit -m "initial commit"',
      'Create an empty remote and push, so it exists on a second machine.',
    ],
    trap: 'Committing first and writing .gitignore after. A secret in the first commit is in the history forever, and deleting it later does not remove it.',
  },
  noRemote: {
    order: 2, lane: 'mechanical', title: 'No remote — exists on exactly one disk',
    why: 'It is committed, but it lives in one place. A disk failure is total loss.',
    steps: [
      'Create an empty private repo on your host of choice.',
      'git remote add origin <url> && git push -u origin main',
      'If you would rather not use a host: git bundle create ../<name>.bundle --all and store that bundle elsewhere.',
    ],
    trap: 'Assuming a cloud-synced folder counts. Sync replicates a delete just as fast as it replicates a save.',
  },
  trackedSecret: {
    order: 0, lane: 'judgment', title: 'A secret is tracked by git — do this first',
    why: 'This is the one mistake a later commit cannot undo. If it has been pushed anywhere, treat it as public.',
    steps: [
      'ROTATE the credential now. Issue a new one and revoke the old.',
      'Only then remove the file from the repo and add it to .gitignore.',
      'Install a pre-commit guard so the next one is blocked before it enters history.',
    ],
    trap: 'Deleting the file and committing that. The value is still in the history, still readable, still valid. Deletion is not rotation.',
  },
  unpushed: {
    order: 3, lane: 'mechanical', title: 'Committed but never pushed',
    why: 'Invisible to every other machine, and ageing. The longer it sits the more it hurts to lose.',
    steps: ['Review the diff, then push.'],
    trap: 'Pushing without looking, on a branch you had forgotten the state of.',
  },
  noVerify: {
    order: 4, lane: 'judgment', title: 'No verify — nothing can call this project done',
    why: 'Without one command that passes or fails, nobody can tell whether it works. Not you, and not your AI.',
    steps: [
      'Write the smallest command that would fail if the project broke. `npm test`, `pytest`, even `node --check` to start.',
      'Register it, then climb: parse -> lint -> types -> tests -> live.',
      'If you genuinely cannot write one, record THAT. It is the most useful finding you have.',
    ],
    trap: 'Registering a command that always exits 0. A verify that cannot fail is worse than none — it turns the board green and stops the questions.',
  },
  weakVerify: {
    order: 5, lane: 'judgment', title: 'Critical project on a weak verify',
    why: 'A parse or lint check proves the file compiles. It cannot catch a wrong answer.',
    steps: [
      'Add one assertion about BEHAVIOUR — the output for a known input.',
      'Start with the single case that would embarrass you most if it broke.',
    ],
    trap: 'Chasing coverage. One real behavioural assertion beats fifty that only prove the code ran.',
  },
  deadDir: {
    order: 6, lane: 'judgment', title: 'A whole subsystem nothing reaches',
    why: 'It is carried, maintained and read by nobody. It is also the finding most likely to be wrong.',
    steps: [
      'Check whether it is reached at RUNTIME — a scheduler, a route, a config, a dynamic import.',
      'If it is genuinely dead: ARCHIVE it. Move it out of the tree, or tag the commit before removing it.',
      'Delete only what you can restore.',
    ],
    trap: 'Deleting because a tool said so. Confirm with the person who wrote it, or with git log, before anything leaves the tree.',
  },
  testOnly: {
    order: 7, lane: 'judgment', title: 'Reached only by its own tests',
    why: 'The suite stays green while the code is dead. This is the subtle one, and it hides for years.',
    steps: [
      'Decide whether the feature is wanted. If yes, it is unwired — connect it.',
      'If no, delete the module AND its test together.',
    ],
    trap: 'Deleting the module and leaving the test, or trusting the green suite as evidence the code is used. It is evidence the test is used.',
  },
  orphan: {
    order: 8, lane: 'judgment', title: 'Nothing references this file',
    why: 'Probably dead. Sometimes an entry point the tool does not recognise.',
    steps: [
      'Ask how it is invoked. Directly? By a scheduler? By a route? By name from config?',
      'If it is an entry point, note that — add it to sweepIgnore so it stops being reported.',
      'If nothing invokes it, archive it.',
    ],
    trap: 'Bulk-deleting the whole orphan list. It contains both dead code and every entry point the tool could not see.',
  },
  writerless: {
    order: 9, lane: 'mechanical', title: 'Empty file nothing writes to',
    why: 'Usually a log with no logger, or a leftover placeholder.',
    steps: ['Delete it, or wire up the thing that was supposed to write it.'],
    trap: 'None worth the words. This is the safest finding in the set.',
  },
  neverReached: {
    order: 10, lane: 'judgment', title: 'Built, green, and nobody has ever used it',
    why: 'This is not a bug. It is a decision nobody has made: ship it, or park it.',
    steps: [
      'SHIP: name one real person who gets it, and a date. Not "users" — a name.',
      'PARK: write the decision down where the project lives, keep its verify green, and stop thinking about it.',
      'Either is fine. Leaving it undecided is what costs you.',
    ],
    trap: 'Building one more feature first. It has never had a user; a feature will not change that.',
  },
  expired: {
    order: 11, lane: 'judgment', title: 'An experiment past its kill date',
    why: 'You set a date so it could not quietly become permanent. The date passed.',
    steps: ['Kill it, or promote it to a real project with a real verify. Then move the date or remove it.'],
    trap: 'Extending the date by reflex. The second extension means it is permanent — decide honestly.',
  },
  hotspot: {
    order: 5.5, lane: 'judgment', title: 'A file that keeps costing you',
    why: 'Changed constantly, large, and either untested or mostly fixed. This is where your time actually goes.',
    steps: [
      'Open it and ask why it changes so often. Usually it holds two or three jobs that want separating.',
      'If nothing tests it, add ONE assertion for the case that would embarrass you most. Not a suite — one.',
      'If its history is mostly fixes, that is a design signal, not a discipline problem. The shape is wrong.',
    ],
    trap: 'Treating churn alone as a defect. The core of a healthy project is usually its most-changed file, and that is correct. Hot plus large plus untested is the finding — hot on its own is not.',
  },
  notAnalysed: {
    order: 12, lane: 'judgment', title: 'A language that was NOT analysed',
    why: 'These files were never examined. This is a blind spot, not a clean result.',
    steps: [
      'Do not read the clean result for this project as coverage.',
      'Review these by hand, or with your AI, using the same questions the checks ask.',
    ],
    trap: 'Reading "0 findings" as "no problems" when most of the codebase was never opened.',
  },
};

// ---- collect ---------------------------------------------------------------------------------
const found = new Map();          // remedy key -> [{project, detail}]
const note = (key, project, detail) => {
  if (!found.has(key)) found.set(key, []);
  found.get(key).push({ project, detail });
};

const sweep = run('sweep.mjs');
if (!sweep.__error) for (const r of sweep) {
  for (const d of r.deadDirs || []) note('deadDir', r.project, `${d.dir} (${d.modules} modules, ${d.kb} KB)`);
  for (const t of r.testOnly || []) note('testOnly', r.project, t.file);
  for (const o of r.orphans || []) note('orphan', r.project, o.file);
  for (const w of r.writerless || []) note('writerless', r.project, w.file);
  for (const n of r.notAnalysed || []) note('notAnalysed', r.project, `${n.lang} — ${n.files} file(s)`);
}

// Only the files where the three signals AGREE. Churn alone is not a finding, and reporting the
// busiest file in every healthy project would bury the ones that actually hurt.
const hot = run('hotspots.mjs');
if (!hot.__error) for (const r of hot) {
  for (const f of (r.files || []).slice(0, 8)) {
    if (f.changes >= 8 && f.lines >= 300 && (!f.tested || f.fixes >= 3)) {
      const marks = [`changed ${f.changes}x`, `${f.lines} lines`];
      if (!f.tested) marks.push('no test');
      if (f.fixes >= 3) marks.push(`${f.fixes} fix commits`);
      note('hotspot', r.project, `${f.file} — ${marks.join(', ')}`);
    }
  }
}

const reach = run('reach.mjs');
if (!reach.__error) for (const r of reach) if (r.state === 'never') note('neverReached', r.name, 'no evidence anyone outside has used it');

const drift = run('drift.mjs');
if (!drift.__error) for (const d of drift) {
  const w = String(d.what || '');
  if (/not under version control/i.test(w)) note('notVersioned', d.project, w);
  else if (/no git remote/i.test(w)) note('noRemote', d.project, w);
  else if (/secret file is TRACKED/i.test(w)) note('trackedSecret', d.project, d.detail || w);
  else if (/unpushed/i.test(w)) note('unpushed', d.project, w);
  else if (/no verify wired/i.test(w)) note('noVerify', d.project, w);
  else if (/on a (parse|lint) verify/i.test(w)) note('weakVerify', d.project, w);
  else if (/spike expired/i.test(w)) note('expired', d.project, w);
}

const plan = [...found.entries()]
  .filter(([k]) => R[k])
  .map(([k, items]) => ({ key: k, ...R[k], items }))
  .sort((a, b) => a.order - b.order);

if (flag('json')) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }

// ---- print -----------------------------------------------------------------------------------
console.log('# The plan — what to do about what was found\n');
console.log('  Nothing here has been changed. This is a proposal, in the order worth doing it.\n');

if (!plan.length) {
  console.log('  No findings to act on. Check what was NOT analysed before reading that as clean.\n');
  process.exit(0);
}

const mech = plan.filter((p) => p.lane === 'mechanical');
const judge = plan.filter((p) => p.lane === 'judgment');

const render = (group, heading, blurb) => {
  if (!group.length) return;
  console.log(`\n  ${heading}`);
  console.log(`  ${blurb}\n`);
  for (const p of group) {
    console.log(`  ── ${p.title}  (${p.items.length})`);
    console.log(`     ${p.why}`);
    for (const it of p.items.slice(0, 4)) console.log(`       · ${it.project}: ${it.detail}`);
    if (p.items.length > 4) console.log(`       · ...and ${p.items.length - 4} more`);
    console.log('     DO:');
    for (const s of p.steps) console.log(`       ${s}`);
    console.log(`     TRAP: ${p.trap}\n`);
  }
};

render(mech, 'MECHANICAL — deterministic and reversible',
  'Safe to hand to your AI to do while you watch. No taste required.');
render(judge, 'JUDGMENT — someone has to decide',
  'No tool can answer these. Your AI can prepare each one; you make the call.');

console.log(`  ${mech.length} mechanical · ${judge.length} needing a decision\n`);
console.log('  Do the mechanical ones first — they are cheap and they cannot bite you.');
console.log('  Then take the judgment list one at a time. Never in bulk.\n');

// ---- the brief ---------------------------------------------------------------------------------
if (flag('brief')) {
  const L = [];
  L.push('# Remediation brief\n');
  L.push('Generated by `fix.mjs`. **Nothing has been changed yet.**\n');
  L.push('Hand this whole file to your AI assistant. It carries three things: how to work, what');
  L.push('was found, and the specific wrong move to avoid on each one.\n');
  L.push('---\n');
  L.push('## Part 1 — How to work while you do this\n');
  L.push('These are not preferences. Each one is here because skipping it cost somebody something.\n');
  L.push('**Pick a lane before you touch anything, and never renegotiate it afterwards.**\n');
  L.push('- **Fast** — docs, copy, tests, read-only screens. Do it and report.');
  L.push('- **Tier-1** — anything that changes real output. Prepare it, get it green on a branch, then STOP for a human.');
  L.push('- **Hard halt** — schema, customer data, money, legal, anything that sends or publishes. Never unattended.\n');
  L.push('If a change *could* alter real output, it is Tier-1. **Any doubt at all resolves to Tier-1.**\n');
  L.push('**The seven rules:**\n');
  L.push('1. **The verify decides done** — not you, not the model. One command, exits pass or fail.');
  L.push('   If you cannot write it for something, say so; that is the finding.');
  L.push('2. **Derive, do not recall.** Before stating anything about current state, run the thing');
  L.push('   that counts it. Remembered status is a guess wearing a suit.');
  L.push('3. **Loop the verifiable, gate the judgment.** Iterate only with a binary exit and a cap.');
  L.push('   A model that judges its own completion will loop forever and narrate progress.');
  L.push('4. **Gate the rendered artifact, not the record.** Check the bytes a person will actually');
  L.push('   receive. Correct data still renders wrong.');
  L.push('5. **Say what you could not see.** "Nothing found" and "nothing looked at" must never');
  L.push('   print the same sentence. A checker that reports clean while blind ends the search.');
  L.push('6. **Report, never act** on anything destructive. Propose, explain, and let a human decide.');
  L.push('   A cleanup tool acting on a wrong guess is how you lose the one file that mattered.');
  L.push('7. **Green is not used.** Passing tests and having a user are unrelated facts.\n');
  L.push('**Two rules specific to this brief:**\n');
  L.push('1. **Do the MECHANICAL section first.** Deterministic and reversible. Let the human watch.');
  L.push('2. **Never bulk-apply the JUDGMENT section.** One item at a time, each explained and');
  L.push('   approved before anything is removed. Archive rather than delete; delete only what can');
  L.push('   be restored.\n');
  L.push('If a finding looks wrong, it may well be. Say so rather than acting on it — a false');
  L.push('positive is more valuable feedback than a confirmed one.\n');
  L.push('---\n');
  L.push('## Part 2 — What was found\n');
  for (const [heading, group] of [['Mechanical', mech], ['Judgment', judge]]) {
    if (!group.length) continue;
    L.push(`\n## ${heading}\n`);
    for (const p of group) {
      L.push(`### ${p.title}\n`);
      L.push(`${p.why}\n`);
      L.push('Affected:\n');
      for (const it of p.items) L.push(`- \`${it.project}\` — ${it.detail}`);
      L.push('\nDo:\n');
      for (const s of p.steps) L.push(`- ${s}`);
      L.push(`\n**Trap:** ${p.trap}\n`);
    }
  }
  const out = path.join(HERE, 'AGENT-BRIEF.md');
  fs.writeFileSync(out, `${L.join('\n')}\n`);
  console.log(`  Wrote AGENT-BRIEF.md — hand that file to your AI.\n`);
}
process.exit(0);
