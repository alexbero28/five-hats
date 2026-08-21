#!/usr/bin/env node
// secret-guard.mjs -- the Five Hats "nothing private goes live" gate.
//
// Runs from git hooks (pre-commit + pre-push) installed machine-wide via a global
// core.hooksPath, so EVERY repo on this machine -- present and future -- is covered
// by the SAME rule, the same way the spine governs every project. The lesson from
// the RENDER_API_KEY leak (committed in a repo, untracked too late) is baked in
// here: block the secret at COMMIT time (never enters history) with a PUSH backstop.
//
//   node secret-guard.mjs --staged            # pre-commit: scan the staged diff
//   node secret-guard.mjs --push              # pre-push: read stdin ranges, scan new commits
//   node secret-guard.mjs --audit [dir]       # scan a repo's TRACKED files (manual audit)
//   node secret-guard.mjs --scan-file <path>  # scan one file (ad hoc)
//
// Exit 0 = clean. Exit 1 = a secret was found (blocks the git operation).
// A real false positive can be forced through with `git commit/push --no-verify`,
// which is deliberate friction, not a silent hole.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// --- what counts as "private information" -------------------------------------
// FILE names that must never be committed (the .env class + private keys).
const SECRET_FILE = [
  /(^|\/)\.env$/i,
  /(^|\/)\.env\.(?!example$|sample$|template$|dist$|defaults$)[^/]+$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)(service-account|gcloud-credentials|credentials)\.json$/i,
];

// CONTENT patterns -- high-confidence, low-false-positive credential shapes.
const SECRET_CONTENT = [
  ['Render API key',        /\brnd_[A-Za-z0-9]{24,}\b/],
  ['Anthropic API key',     /\bsk-ant-[A-Za-z0-9_-]{24,}\b/],
  ['OpenAI API key',        /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/],
  ['GitHub token',          /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/],
  ['GitHub fine-grained PAT', /\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ['AWS access key id',     /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token',           /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API key',        /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe live secret',    /\b(?:sk|rk)_live_[0-9A-Za-z]{24,}\b/],
  ['Twilio key',            /\bSK[0-9a-fA-F]{32}\b/],
  ['Vercel token',          /\bvcp_[A-Za-z0-9]{24,}\b/],
  ['Netlify PAT',           /\bnfp_[A-Za-z0-9]{26,}\b/],
  ['Supabase access token', /\bsbp_[A-Za-z0-9]{36,}\b/],
  ['Supabase publishable',  /\bsb_publishable_[A-Za-z0-9_-]{20,}\b/],
  ['Supabase secret key',   /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ['Private key block',     /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ['DB URL with password',  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/i, realDbUrl],
  ['Service-role/secret JWT', /\b(?:SERVICE_ROLE|SECRET|PRIVATE|ACCESS)_?KEY\s*[:=]\s*["']?eyJ[A-Za-z0-9_-]{20,}/i],
];

// DB URLs are the classic false-positive source (docs + test fixtures). Only treat
// one as a real leak when the credentials look real: no template syntax, and a
// password that isn't a placeholder word or a trivially short fixture value.
const DICT_CRED = /^(?:u|p|user|users|username|pass|passwd|password|secret|admin|root|test|tester|example|dummy|foo|bar|baz|changeme|db|database|guest|demo|user\d*|pass\d*)$/i;
function realDbUrl(match) {
  const url = match[0];
  if (/\$\{|\{\{|[<>]/.test(url)) return false;               // template placeholder
  const cred = url.match(/:\/\/([^:@/\s]+):([^@/\s]+)@/);
  if (!cred) return false;
  const [, user, pass] = cred;
  if (DICT_CRED.test(user) || DICT_CRED.test(pass)) return false; // placeholder creds
  if (pass.length <= 4) return false;                          // fixture value
  return true;                                                 // looks like a real credential
}

// If a matched line clearly holds a placeholder, it is not a real secret.
const PLACEHOLDER = /(example|sample|placeholder|your[_-]|changeme|dummy|redacted|<[^>]*>|\bxxx+\b|\.\.\.|fake|test[_-]?only|\bREPLACE\b)/i;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function redact(s) {
  if (s.length <= 8) return s[0] + '***';
  return s.slice(0, 4) + '…' + s.slice(-2) + ` (${s.length} chars)`;
}

const findings = [];
function checkPath(p) {
  for (const re of SECRET_FILE) if (re.test(p)) {
    findings.push({ kind: 'file', where: p, what: 'secret-class file (never commit this)' });
    return;
  }
}
function checkAddedLine(file, lineNo, text) {
  if (PLACEHOLDER.test(text)) return;
  for (const [name, re, validator] of SECRET_CONTENT) {
    const m = text.match(re);
    if (m && (!validator || validator(m))) {
      findings.push({ kind: 'content', where: `${file}:${lineNo}`, what: name, sample: redact(m[0]) });
    }
  }
}

// Parse a unified diff (git diff -U0 ...) and scan ADDED lines only.
function scanDiff(diffText) {
  let file = null, newLine = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).replace(/^b\//, '');
      file = p === '/dev/null' ? null : p;
    } else if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)/);
      newLine = m ? parseInt(m[1], 10) : 0;
    } else if (raw.startsWith('+') && !raw.startsWith('+++')) {
      if (file) checkAddedLine(file, newLine, raw.slice(1));
      newLine++;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      newLine++;
    }
  }
}

function report(context) {
  if (!findings.length) return 0;
  console.error(`\n\x1b[41m\x1b[97m  SECRET-GUARD: blocked ${context} — private information detected  \x1b[0m`);
  for (const f of findings) {
    const tail = f.sample ? `  [${f.sample}]` : '';
    console.error(`  ✖ ${f.what}\n      ${f.where}${tail}`);
  }
  console.error(`\nNothing was committed/pushed. Fix it by removing the secret and putting it in an`);
  console.error(`untracked .env (already gitignored). If this is a genuine false positive, you can`);
  console.error(`override with --no-verify — but that is a deliberate exception, not a habit.\n`);
  return 1;
}

// --- modes --------------------------------------------------------------------
function modeStaged() {
  const cwd = process.cwd();
  const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACM'], cwd)
    .split('\n').map((s) => s.trim()).filter(Boolean);
  names.forEach(checkPath);
  scanDiff(git(['diff', '--cached', '-U0', '--diff-filter=ACM'], cwd));
  return report('commit');
}

function modePush() {
  const cwd = process.cwd();
  const input = fs.readFileSync(0, 'utf8').trim();
  if (!input) return 0;
  const Z = '0000000000000000000000000000000000000000';
  for (const line of input.split('\n')) {
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (!localSha || localSha === Z) continue; // branch deletion
    // The base of the diff. `sha^` is WRONG for a ROOT commit -- it has no parent, git errors,
    // and (before this fix) the catch below swallowed it and the push reported clean without
    // having scanned a single byte. That is a guard failing OPEN, on exactly the push that
    // matters most: the first one, to a brand-new repository. Diff against the empty tree
    // instead, which is what "everything this commit adds" means for a first commit.
    const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    let base;
    if (!remoteSha || remoteSha === Z) {
      // new branch: only the commits not already on a remote
      const list = git(['rev-list', localSha, '--not', '--remotes'], cwd).trim();
      if (!list) continue;
      const shas = list.split('\n');
      const oldest = shas[shas.length - 1];
      let hasParent = true;
      try { git(['rev-parse', '--verify', '--quiet', `${oldest}^`], cwd); } catch { hasParent = false; }
      base = hasParent ? `${oldest}^` : EMPTY_TREE;
    } else {
      base = remoteSha;
    }
    try {
      const names = git(['diff', '--name-only', '--diff-filter=ACM', base, localSha], cwd)
        .split('\n').map((s) => s.trim()).filter(Boolean);
      names.forEach(checkPath);
      scanDiff(git(['diff', '-U0', '--diff-filter=ACM', base, localSha], cwd));
    } catch (e) {
      // FAIL CLOSED. If the range cannot be resolved this hook did not look at anything, and
      // letting the push through would be a clean result from an instrument that never ran.
      // Refusing is recoverable in one flag; a leaked credential in public history is not.
      findings.push({
        kind: 'unscannable',
        where: `${base}..${localSha}`,
        what: `could not diff this range, so NOTHING was scanned (${String(e.message).split('\n')[0]})`,
      });
    }
  }
  return report('push');
}

function modeAudit(dir) {
  const cwd = dir || process.cwd();
  const tracked = git(['ls-files'], cwd).split('\n').map((s) => s.trim()).filter(Boolean);
  for (const rel of tracked) {
    checkPath(rel);
    const abs = path.join(cwd, rel);
    let buf;
    try { buf = fs.readFileSync(abs); } catch { continue; }
    if (buf.includes(0)) continue; // binary
    buf.toString('utf8').split('\n').forEach((t, i) => checkAddedLine(rel, i + 1, t));
  }
  if (!findings.length) { console.log(`secret-guard: clean — ${tracked.length} tracked files, no secrets.`); return 0; }
  return report(`audit of ${cwd}`);
}

function modeScanFile(p) {
  checkPath(p);
  const buf = fs.readFileSync(p);
  if (!buf.includes(0)) buf.toString('utf8').split('\n').forEach((t, i) => checkAddedLine(p, i + 1, t));
  return report(`scan of ${p}`);
}

const arg = process.argv[2];
let code = 0;
if (arg === '--staged') code = modeStaged();
else if (arg === '--push') code = modePush();
else if (arg === '--audit') code = modeAudit(process.argv[3]);
else if (arg === '--scan-file') code = modeScanFile(process.argv[3]);
else { console.error('usage: secret-guard.mjs --staged | --push | --audit [dir] | --scan-file <path>'); code = 2; }
process.exit(code);
