---
name: watch-for-drift
description: Use at the start of a working session, before trusting any dashboard or status report, and on any schedule or recurring check. Finds the gap between what the system claims and what is true — unpushed work ageing, secrets under version control, weak verifies on Tier-1 projects, expired prototypes, a board nobody runs. Triggers on "how are things", "anything broken", "health check", "is everything ok", setting up a recurring check, or resuming after time away.
---

# Watch for drift

**The rule:** the system must notice its own decay. If a human getting suspicious is the only
detector, the detector is a mood.

Run it: `node drift.mjs` · `--gate` exits 1 on anything serious, so it can
sit in a hook or a scheduled loop.

## Why this exists

Every defect found on 2026-08-20 — a health board reporting 21 healthy projects as failing, notes
claiming nothing had been mailed while eight certified letters were in flight, tracking numbers
dropped at a system boundary, client PII sitting in a memory file — **was found because the owner
got suspicious.** Not one was surfaced by a tool. Everything was green the whole time.

## What it checks, and why each one

| Check | The failure it maps to |
|---|---|
| Tier-1 on a `parse`/`lint` verify | GREEN·parse reads exactly like GREEN·tests at a glance, and only one of them can catch a wrong answer |
| No verify wired | nothing can call that project done |
| Expired spike | a prototype with no kill date becomes permanent — see `spike-with-an-expiry` |
| No git remote | one disk failure from gone |
| Commits unpushed and ageing | work invisible to every other machine; one sat 81 days |
| A secret TRACKED by git | the single mistake a later commit cannot undo |
| Board not run recently | nothing is checking the checkers |

## Reading it honestly

**Drift is not failure.** It is the distance between what you believe and what is true, and it
grows silently by default. Most warnings are acceptable states you have chosen — a local-only repo
is fine *if you decided that*. The finding is the ones you did not decide.

**Serious means act.** A tracked secret and an expired spike do not age well: one is a disclosure
that cannot be retracted, the other is how a 1,132-commit archived engine and a 55 MB orphan both
came to exist.

**Do not tune away a real finding to get a clean run.** The instrument is only worth having while
it can still say something you did not want to hear. When a category cries wolf — `.env.example`
files reported as leaked secrets — fix the *check*, never the threshold.

## What this does NOT cover

Correctness. Drift watches the shape of the system, not whether the code is right — that is the
verify's job, and `verify-decides-done` owns it.
