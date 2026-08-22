#!/usr/bin/env node
// pulse.mjs — the trigger. The one thing here that makes the checks happen without you deciding to.
//
//   node pulse.mjs                    the brief: what needs attention, and what has gone stale
//   node pulse.mjs --registry <file>  point it at a specific registry
//   node pulse.mjs --quiet            print nothing when everything is fine and nothing is stale
//   node pulse.mjs --record           stamp "the full pass ran today" (start.mjs calls this)
//
// READ-ONLY except the one timestamp `--record` writes to the kit home.
//
// WHY THIS EXISTS, and it is the whole point of the kit. Every check in here is good and none of
// them matter, because nothing makes you run them. Cleanup has no deadline. "Has anyone used
// this" has no dashboard. Decay is silent by definition. A tool you have to remember is a tool
// that loses to whatever is making noise today — which is the exact diagnosis the five roles
// describe, and a kit that shipped only checks would be an instrument tray with no doctor.
//
// So this is the smallest thing that can be a trigger on a stranger's machine: it reads a
// timestamp, it is cheap enough to run on every session or every push, and it CANNOT SILENTLY
// DIE. That last property is why it is a file and not a cron job. cron, launchd and Task
// Scheduler are three different codepaths, they fail invisibly, and nothing inside this kit could
// ever tell you whether one had stopped firing — the exact "configured versus actually ran" gap
// archetypes.mjs exists to expose. A staleness stamp on disk has none of that: if the pass has
// not run, the number gets bigger, and the number is right there.
//
// WHAT IT DOES NOT DO. It does not run the full pass for you — that takes minutes and a person
// should choose the moment. It nags, precisely and once, with the command to fix it.

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

const HOME_DIR = process.env.FIVE_HATS_HOME || path.join(os.homedir(), '.five-hats');
const STAMP = path.join(HOME_DIR, 'last-pass.json');
const QUIET = flag('quiet');
const STALE_AFTER_DAYS = 14;

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const readIf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

// ---- --record: stamp that the full pass ran ---------------------------------------------------
if (flag('record')) {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const prev = (() => { try { return JSON.parse(readIf(STAMP) || '{}'); } catch { return {}; } })();
  const entry = {
    lastPass: new Date().toISOString(),
    target: val('target') || null,
    kitVersion: KIT_VERSION,
    passCount: (Number(prev.passCount) || 0) + 1,
  };
  fs.writeFileSync(STAMP, `${JSON.stringify(entry, null, 2)}\n`);
  if (!QUIET) console.log(`  pulse: recorded pass #${entry.passCount}`);
  process.exit(0);
}

// ---- how stale are we? --------------------------------------------------------------------------
let stamp = null;
try { stamp = JSON.parse(readIf(STAMP) || 'null'); } catch { stamp = null; }
const daysSince = stamp && stamp.lastPass
  ? Math.floor((Date.now() - new Date(stamp.lastPass).getTime()) / 86400000)
  : null;

// ---- the registry, if there is one -----------------------------------------------------------
const regPath = val('registry') || (fs.existsSync(path.join(HERE, 'projects.json'))
  ? path.join(HERE, 'projects.json') : null);

// ---- the cheap half of drift, on a schedule you did not have to set --------------------------
// Only SERIOUS findings. A pulse that prints warnings every session becomes wallpaper, and
// wallpaper is how a real finding gets skimmed past — the same reason every exclusion in sweep
// exists. Silence when it does not matter is what buys attention when it does.
let serious = [];
let driftFailed = null;
if (regPath) {
  try {
    const out = execFileSync(process.execPath,
      [path.join(HERE, 'drift.mjs'), '--registry', regPath, '--json'],
      { encoding: 'utf8', stdio: 'pipe', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    serious = JSON.parse(out).filter((d) => d.sev === 'serious');
  } catch (e) {
    // A CRASH IS NOT A CLEAN RESULT. Eight bugs of exactly this shape were found in this kit in
    // one day; the pulse will not become the ninth by reporting quiet because it could not look.
    driftFailed = String(e.stderr || e.message).split('\n').find((l) => /Error/.test(l))
      || String(e.message).split('\n')[0];
  }
}

// ---- print ---------------------------------------------------------------------------------------
const stale = daysSince === null || daysSince >= STALE_AFTER_DAYS;
const nothingToSay = !stale && !serious.length && !driftFailed;

if (nothingToSay && QUIET) process.exit(0);

console.log(`\n  ${B('five hats')} ${DIM(`· kit ${KIT_VERSION}`)}`);

if (driftFailed) {
  console.log(`  ${B('!!')} the decay check could not run — ${driftFailed}`);
  console.log('     This is not "nothing is decaying". Nothing was looked at.');
}

if (serious.length) {
  console.log(`  ${B(`${serious.length} serious`)}`);
  for (const d of serious.slice(0, 4)) console.log(`     ${d.project}: ${d.what}`);
  if (serious.length > 4) console.log(`     ...and ${serious.length - 4} more`);
}

if (daysSince === null) {
  console.log('  The full pass has never run here.');
  console.log(`     ${B('node start.mjs <your-projects>')}`);
} else if (stale) {
  console.log(`  The full pass has not run in ${B(`${daysSince} days`)} — the checks nothing triggers are the`);
  console.log('  three that stop happening first.');
  console.log(`     ${B('node start.mjs <your-projects>')}`);
} else if (!QUIET) {
  console.log(DIM(`  Full pass ran ${daysSince === 0 ? 'today' : `${daysSince}d ago`}`
    + `${stamp.passCount ? ` · ${stamp.passCount} total` : ''}.`));
}

if (!regPath && !QUIET) {
  console.log(DIM('  No registry — decay is NOT being checked. `node install.mjs <your-projects>` wires one.'));
}
console.log('');
process.exit(0);
