#!/usr/bin/env node
// gates.mjs - the GATEKEEPER instrument. Can your checks actually fail?
//
//   node gates.mjs ../your-repo          every gate in one project
//   node gates.mjs --registry projects.json
//   node gates.mjs ../your-repo --json
//   node gates.mjs --probe               prove these rules still catch what they are named for
//
// READ-ONLY. It reads source and counts files. It changes nothing and runs no AI.
//
// WHY THIS EXISTS. Every other instrument here asks a question about the CODE — what nothing
// reads, what nobody used, what is decaying. None of them asks whether the things that answer
// those questions are capable of answering "no".
//
// The evidence, all of it from one twelve-hour audit of the machine this kit came off. A guard
// against unattended sending was written as a regex built by string concatenation, so its `\s`
// became a literal `s` and it could not match the one spelling anyone would ever write. The same
// guard walked `.mjs` files in a repo whose product is six Python files — in one of those two
// repos there was exactly ONE `.mjs` file, the gate itself, which the loop skipped: the body
// executed zero times, forever. A mail packager refused every envelope when a folder was empty,
// on behalf of "the letter" — and the first line that opened a letter came nine lines AFTER the
// refusal. A pipeline stage passed a hardcoded empty list where evidence belonged, so its one
// critical rule could never fire on any input. A session check ran a tool with no argument and
// silently measured a different project than the one it named.
//
// Five defects, five green checks, and not one of them could have printed anything else. The cost
// was two days of a legal attestation being auto-ticked under a line that read `ok`.
//
// THE ONE QUESTION. All five are the same proposition: the check's output was a constant function
// of its subject. Green was not evidence — it was the only value the expression could take. So
// this does not ask whether your code looks careful. It asks, five ways, whether a gate is
// STRUCTURALLY CAPABLE OF FAILING.
//
// WHY ONLY FIVE RULES. Six more were drafted and two were measured into the ground on six real
// repos before shipping. "An empty literal passed to a check" produced 22 hits and zero defects —
// seven were function definitions with default parameters, twelve were tests deliberately
// exercising the null path. "A guard pattern never named in a test" produced 13 hits and zero
// defects, and its two loudest pointed at the best-defended regexes in the survey: guards carrying
// a hand-written probe three lines below themselves, which is the fix, not the bug. A gate that
// flags the code which already solved the problem teaches you to dismiss it. Both were cut.
//
// The five that shipped produced one hit across roughly 1,600 files, and it was a real one.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const probeOnly = argv.includes('--probe');
const expand = (p) => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
const SELF = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// A file whose JOB is to say no. The rules below only look inside these, because "can this fail"
// is only an interesting question about something that is supposed to be able to.
const GATE_FILE = /(^|[\\/])(verify|check|guard|gate|lint|audit|validate|preflight)[^\\/]*\.(mjs|js|cjs|ts|py)$/i;
const TEST_FILE = /(^|[\\/])(tests?|spec|__tests__)[\\/]|\.(test|spec)\.(mjs|js|cjs|ts)$|(^|[\\/])test_[^\\/]*\.py$/i;
const SKIP_DIR = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', 'coverage', '.venv', 'venv', '__pycache__', 'five-hats-report']);
const ASSET = /\.(png|jpe?g|gif|svg|ico|pdf|lock|min\.js|map|woff2?|ttf|zip|gz|db|sqlite3?)$/i;

function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else out.push(p);
  }
  return out;
}

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * COMMENTS OUT, LINE NUMBERS INTACT.
 *
 * The first run of this instrument flagged three files, and all three were the same false positive:
 * it had found the broken regex quoted inside the POST-MORTEM COMMENT that documents the fix. The
 * two repos carrying the most careful write-up of this exact defect were the two it accused of
 * having it.
 *
 * That is the failure mode this whole kit is built around — a check that points at the code which
 * already solved the problem teaches you to dismiss the check. So comments are blanked before any
 * rule reads the source, and blanked CHARACTER FOR CHARACTER so every reported line number still
 * points where it did.
 */
function stripComments(src, isPy) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  if (isPy) return src.replace(/(^|\s)#[^\n]*/g, (m) => blank(m));
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length)));
}

// ---------------------------------------------------------------------------------------------
// RULE 1 — VACUOUS CORPUS. The gate inspects a set of files the repo does not contain.
//
// Deliberately WIDER than "the extension filter misses the dominant language", which was the first
// formulation and which misses the commonest case: a hardcoded list of filenames that stopped
// being the whole list. Both are the same defect — the verdict is decided by corpus selection
// rather than by the code — so both are asked the same way: what does this gate look at, and what
// does the repo actually hold?
//
// It fires hardest on the case that needs no judgement at all: a filter that resolves to zero or
// one file, where the one is the gate itself. That is not an inference, it is a count.
// ---------------------------------------------------------------------------------------------
const EXT_FILTER = /\/\\\.\(([a-z0-9|]+)\)\$\/|endsWith\(\s*['"`]\.([a-z0-9]+)['"`]|\*\*?\/\*\.([a-z0-9]+)/gi;

function vacuousCorpus(gate, src, files, rel) {
  const out = [];
  const exts = new Set();
  for (const m of src.matchAll(EXT_FILTER)) {
    const g = m[1] || m[2] || m[3] || '';
    for (const e of g.split('|')) if (e) exts.add(e.toLowerCase());
  }
  if (!exts.size) return out;

  // Only count files the gate could plausibly reach: source, not assets.
  const source = files.filter((f) => !ASSET.test(f));
  const matching = source.filter((f) => exts.has(path.extname(f).slice(1).toLowerCase()));
  const others = matching.filter((f) => path.resolve(f) !== path.resolve(gate));

  if (matching.length === 0) {
    out.push({ sev: 'serious', what: `inspects .${[...exts].join('/.')} and this project has none`,
      detail: `${rel} walks for .${[...exts].join(', .')} — nothing here matches. The loop body never runs.` });
    return out;
  }
  if (others.length === 0) {
    out.push({ sev: 'serious', what: `inspects .${[...exts].join('/.')} and the only match is itself`,
      detail: `${rel} is the ONLY .${[...exts].join('/.')} file here. Gates normally skip themselves, so this inspects nothing.` });
    return out;
  }

  // The dominant language the gate cannot see. Only meaningful once the project is big enough for
  // "dominant" to mean anything — below that, a small polyglot repo trips it for no reason.
  const byExt = new Map();
  for (const f of source) {
    const e = path.extname(f).slice(1).toLowerCase();
    if (e) byExt.set(e, (byExt.get(e) || 0) + 1);
  }
  const total = [...byExt.values()].reduce((a, b) => a + b, 0);
  if (total >= 12) {
    for (const [ext, n] of byExt) {
      if (n / total < 0.35 || exts.has(ext)) continue;
      if (!/^(mjs|js|cjs|ts|tsx|jsx|py|rb|go|rs|java|php|sh)$/.test(ext)) continue;
      out.push({ sev: 'warn', what: `inspects .${[...exts].join('/.')}, but this project is ${Math.round((n / total) * 100)}% .${ext}`,
        detail: `${rel} cannot see ${n} .${ext} file(s) — the majority of the source it is meant to gate.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// RULE 2 — ESCAPE-EATEN PATTERN. A regex built from a quoted string lost its backslashes.
//
// `new RegExp('AUTO_SEND' + '\s*=\s*true')` compiles to /AUTO_SENDs*=s*true/, because in a quoted
// JS string `\s` is simply `s`. The result is a valid regex that matches nothing anyone would
// write, and a guard built on it reports clean on every input forever.
//
// This is a fact about the lexer, not a judgement about the code, which is why it is the cheapest
// true positive in the set. Regex LITERALS are safe by construction and are never flagged; so are
// correctly doubled `\\s` and Python raw strings.
// ---------------------------------------------------------------------------------------------
const DYNAMIC_RE = /(?:new\s+RegExp\s*\(|[^\w.]RegExp\s*\(|re\.(?:compile|search|match|fullmatch|sub|findall|split)\s*\()/g;
const EATEN = /(?<!\\)\\[sdwSDWbAZ]/;

function escapeEaten(src, rel) {
  const out = [];
  for (const m of src.matchAll(DYNAMIC_RE)) {
    const open = m.index + m[0].length;
    const chunk = src.slice(open, open + 400);
    const end = chunk.indexOf('\n\n');
    const arg = end === -1 ? chunk : chunk.slice(0, end);
    // Every quoted literal inside the argument expression, minus Python raw strings.
    for (const lit of arg.matchAll(/(^|[^r\w])(['"])((?:[^\\\n]|\\.)*?)\2/gi)) {
      const body = lit[3];
      if (!EATEN.test(body)) continue;
      out.push({
        sev: 'serious',
        what: 'a regex built from a quoted string loses its escapes',
        detail: `${rel}:${lineOf(src, m.index)} — "${body.slice(0, 40)}" becomes literal letters. `
          + 'Use a regex literal, or double the backslashes. It compiles, and matches nothing.',
      });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// RULE 3 — SWALLOWED FAILURE. A gate catches its own error and says nothing.
//
// A `catch {}` inside the file whose job is to fail the build turns a broken check into a passing
// one. Measured across six repos this found nothing — every empty catch in gate-shaped code either
// handled the failure or carried a comment explaining itself. That is the point: it costs nothing
// and it is the cheapest insurance against the day a gate stops gating.
//
// A catch with a COMMENT in it is deliberate and is never flagged. That exclusion is load-bearing:
// without it this rule would have fired five times on six repos, every one a false positive.
// ---------------------------------------------------------------------------------------------
const SWALLOW = /catch\s*(?:\([^)]*\))?\s*\{\s*\}|except[^\n:]*:\s*\n\s*pass\b/g;

function swallowed(src, rel) {
  const out = [];
  for (const m of src.matchAll(SWALLOW)) {
    out.push({ sev: 'warn', what: 'a gate swallows its own failure',
      detail: `${rel}:${lineOf(src, m.index)} — an empty catch here turns a broken check into a passing one. `
        + 'If it is deliberate, say so in the braces; a comment is enough and this stops asking.' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// RULE 4 — ALWAYS-TRUE ASSERTION. An assertion that cannot fail.
//
// Rare, free to check, and unambiguous when it happens. Zero hits on six repos.
// ---------------------------------------------------------------------------------------------
const TAUTOLOGY = [
  /assert(?:\.ok)?\s*\(\s*(?:true|1)\s*[,)]/gi,
  /expect\s*\(\s*(true)\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*true\s*\)/gi,
  /assertTrue\s*\(\s*True\s*\)/g,
  /assert\s+True\b/g,
];

function tautology(src, rel) {
  const out = [];
  for (const re of TAUTOLOGY) {
    for (const m of src.matchAll(re)) {
      out.push({ sev: 'serious', what: 'an assertion that cannot fail',
        detail: `${rel}:${lineOf(src, m.index)} — \`${m[0].trim()}\` passes on every input, including a broken one.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// RULE 5 — A TEST FILE THAT ASSERTS NOTHING.
//
// A file in the test tree with no assertion in it is a green tick for work nobody checked.
//
// THE EXCLUSION IS THE WHOLE RULE. Shared fixtures and helpers live in the test tree and correctly
// contain no assertions. Without the exclusion this fired once on six repos and was wrong once —
// a 0% true-positive rate, which is how a check gets switched off. A file only counts as a test if
// it DECLARES one.
// ---------------------------------------------------------------------------------------------
const DECLARES_TEST = /(^|[^\w])(test|it|describe)\s*\(|def\s+test_|class\s+\w*Test\w*\s*\(/;
const ASSERTS = /\bassert\b|\bexpect\s*\(|\.should\b|assertEqual|assertTrue|assertRaises|t\.(deepEqual|equal|ok)/;

function testWithoutAssertions(src, rel) {
  if (!DECLARES_TEST.test(src)) return [];      // a helper, not a test
  if (ASSERTS.test(src)) return [];
  return [{ sev: 'serious', what: 'a test file that asserts nothing',
    detail: `${rel} declares tests and contains no assertion. It passes whatever the code does.` }];
}

// ---------------------------------------------------------------------------------------------
// THE PROBE. Every rule here is itself a gate, so every rule here has to prove it can still fire.
//
// This is not decoration. The defect that started this instrument was a guard that had silently
// stopped matching, under a line that printed `ok` on every run. Shipping these five rules with no
// evidence that they still catch their own canonical examples would repeat it exactly.
//
// Each rule gets a POSITIVE case it must catch and a NEGATIVE case it must leave alone. The
// negative half matters as much: a rule that cries wolf gets switched off, and a switched-off
// rule and a broken one are the same thing.
// ---------------------------------------------------------------------------------------------
const PROBES = [
  ['escape-eaten catches the real one',
    () => escapeEaten("const g = new RegExp(['AUTO','SEND'].join('_') + '\\s*=\\s*true');", 'x').length === 1],
  ['escape-eaten leaves a regex literal alone',
    () => escapeEaten('const g = /\\bAUTO_SEND\\s*=\\s*true/;', 'x').length === 0],
  ['escape-eaten leaves a correctly doubled escape alone',
    () => escapeEaten("const g = new RegExp('AUTO_SEND' + '\\\\s*=');", 'x').length === 0],
  ['swallowed catches an empty catch',
    () => swallowed('try { check(); } catch {}', 'x').length === 1],
  ['swallowed leaves an explained catch alone',
    () => swallowed('try { check(); } catch { /* deliberate: absence is the answer */ }', 'x').length === 0],
  // This pair exists because the rule broke exactly here. Comment-stripping was added upstream to
  // stop the escape rule reading post-mortems, and it silently turned every EXPLAINED catch into an
  // empty one -- 0 findings became 3, all false, in one edit. The probe is the only reason that was
  // caught before it shipped.
  ['swallowed still sees the explanation after any upstream stripping',
    () => swallowed('try { a(); } catch { /* deliberate */ }', 'x').length === 0
       && swallowed('try { a(); } catch {}', 'x').length === 1],
  ['tautology catches assert.ok(true)',
    () => tautology('assert.ok(true);', 'x').length === 1],
  ['tautology leaves a real assertion alone',
    () => tautology('assert.ok(rows.length > 0);', 'x').length === 0],
  ['a test with no assertion is caught',
    () => testWithoutAssertions("test('does a thing', () => { build(); });", 'x').length === 1],
  ['a helper with no assertion is left alone',
    () => testWithoutAssertions('export function scratchDb() { return open(":memory:"); }', 'x').length === 0],
  ['a real test is left alone',
    () => testWithoutAssertions("test('x', () => { assert.equal(1, 1); });", 'x').length === 0],
];

function runProbes() {
  const failed = PROBES.filter(([, fn]) => { try { return !fn(); } catch { return true; } });
  return { total: PROBES.length, failed: failed.map(([name]) => name) };
}

// ---------------------------------------------------------------------------------------------
function resolveTargets() {
  const rIdx = argv.indexOf('--registry');
  const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--registry');
  // An explicit path argument WINS over an ambient registry, the same way it does in the other
  // instruments. A fallback that overrides a path somebody actually typed is a silent wrong answer.
  const regPath = rIdx !== -1 ? argv[rIdx + 1]
    : (pos.length === 0 && fs.existsSync('projects.json') ? 'projects.json' : null);
  if (regPath && fs.existsSync(regPath)) {
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    return Object.entries(reg.projects || {}).map(([n, c]) => [n, { ...c, path: expand(c.path) }]);
  }
  const dir = path.resolve(pos[0] || '.');
  if (!fs.existsSync(dir)) { console.error(`no such folder: ${dir}`); process.exit(1); }
  return [[path.basename(dir), { path: dir }]];
}

const probe = runProbes();

if (probeOnly) {
  console.log('\n# Gate probe — can these rules still catch what they are named for?\n');
  for (const [name] of PROBES) {
    const bad = probe.failed.includes(name);
    console.log(`  ${bad ? 'CANNOT' : 'ok    '}  ${name}`);
  }
  console.log(`\n  ${probe.total - probe.failed.length} of ${probe.total} probes pass`);
  console.log('  A rule that cannot catch its own example is not a rule. So is one that cries wolf.');
  process.exit(0);
}

const results = [];
for (const [name, cfg] of resolveTargets()) {
  const root = expand(cfg.path);
  if (!fs.existsSync(root)) { results.push({ project: name, missing: true, findings: [] }); continue; }
  const files = walk(root);
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const findings = [];
  let gatesRead = 0;

  for (const f of files) {
    const r = rel(f);
    if (ASSET.test(f)) continue;
    const isGate = GATE_FILE.test(r);
    const isTest = TEST_FILE.test(r);
    if (!isGate && !isTest) continue;
    const raw = read(f);
    if (!raw) continue;
    // NEVER ANALYSE ITSELF. The same line every guard in this family carries, for the same reason:
    // this file holds probe strings that are deliberate examples of the defects it looks for, and
    // an instrument that reports its own test fixtures as findings is noise on its first run.
    if (path.resolve(f) === path.resolve(SELF)) continue;
    const src = stripComments(raw, /\.py$/i.test(f));

    if (isGate) {
      gatesRead += 1;
      findings.push(...vacuousCorpus(f, src, files, r));
      findings.push(...escapeEaten(src, r));
      // RAW, not stripped. The exclusion that makes this rule survive contact with careful code
      // is "a catch carrying an explanation is deliberate" -- and blanking comments first turns
      // every explained catch into an empty one. Measured: this rule went from 0 findings to 3,
      // all false, the moment comment-stripping was added upstream of it.
      findings.push(...swallowed(raw, r));
    }
    if (isTest) {
      findings.push(...testWithoutAssertions(src, r));
    }
    findings.push(...tautology(src, r));
  }

  results.push({ project: name, root, gatesRead, scanned: files.length, findings });
}

if (asJson) {
  // Flat finding list, the shape drift already speaks, so the aggregators need no new vocabulary.
  console.log(JSON.stringify(results.flatMap((r) => (r.findings.length
    ? r.findings.map((f) => ({ project: r.project, ...f }))
    : [{ project: r.project, sev: 'info', what: 'no vacuous gates found', detail: `${r.gatesRead} gate file(s) read` }])), null, 2));
  process.exit(0);
}

console.log('\n# Gatekeeper — can your checks actually fail?\n');

// BLIND SPOTS FIRST. "Nothing found" and "nothing looked at" must never print the same sentence.
if (probe.failed.length) {
  console.log(`  ⚠ ${probe.failed.length} of this instrument's own probes FAILED — its findings below are not trustworthy:`);
  for (const f of probe.failed) console.log(`     ${f}`);
  console.log('');
}
const blind = results.filter((r) => !r.missing && r.gatesRead === 0);
if (blind.length) {
  console.log('  NO GATE FILES FOUND (nothing here is named like a check, so nothing was examined)');
  for (const r of blind) console.log(`     ${r.project.padEnd(22)} ${r.scanned} file(s) scanned, 0 gate-shaped`);
  console.log('');
}

let n = 0;
for (const r of results) {
  if (r.missing) { console.log(`  ${r.project.padEnd(22)} MISSING`); continue; }
  if (!r.findings.length) continue;
  console.log(`  ${r.project}`);
  for (const f of r.findings.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'serious' ? -1 : 1))) {
    console.log(`     ${f.sev.toUpperCase().padEnd(8)} ${f.what}`);
    console.log(`     ${' '.repeat(8)} ${f.detail}`);
    n += 1;
  }
  console.log('');
}

const gates = results.reduce((a, r) => a + (r.gatesRead || 0), 0);
console.log(`  ${n} finding(s) across ${results.length} project(s) · ${gates} gate file(s) read`
  + ` · ${probe.total - probe.failed.length}/${probe.total} self-probes pass`);
console.log('  A check that has never failed and a check that CANNOT fail look identical from outside.');
console.log('  This is the only instrument here that is about the instruments.');
process.exit(0);
