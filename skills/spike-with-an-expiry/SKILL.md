---
name: spike-with-an-expiry
description: Use when starting an experiment, a throwaway, a proof of concept, or anything you are not yet sure is worth keeping. Registers it with a kill-or-promote date so it cannot quietly become permanent. Triggers on "let's try", "quick test", "prototype", "spike", "proof of concept", "just to see if", "throwaway", "experiment", or scaffolding something whose future is genuinely undecided.
---

# Spike with an expiry

**The rule:** an experiment gets a **date** at which it is killed or promoted. Not a plan to
decide later — a date, written into the registry, that something else checks.

## Why this exists

Prototyping is not the weakness here; it is the strength. The failure is that **prototypes become
permanent by default**, because nothing ever forces the decision:

- one project ran to **1,132 commits** before being archived
- a retired subsystem is **55 MB** of dead engine still in the tree, kept alive only by its own tests
- one engine burned **~895,000 tokens** on a single client file before being replaced

None of those were bad ideas. All three were experiments nobody ever explicitly ended, and every
one of them cost more to unwind than it would have cost to kill.

## How to register one

```
add a row to your registry with "lane": "fast"
```

then add an expiry to its row in `projects.json`:

```json
"expires": "2026-09-15"
```

`drift.mjs` reads that field. Before the date it reports the spike as *inside its window*; after
it, as **SERIOUS — kill it or promote it**. That is the whole mechanism: the deadline is enforced
by something other than your memory.

## Choosing the date

**Two weeks is usually right.** Long enough to learn the thing, short enough that you still
remember why you started. If you cannot name a date, the honest reading is that this is not an
experiment — it is a project, and it should be registered as one with a real verify.

## What happens at the date

Exactly three moves, and "leave it" is not among them:

- **PROMOTE** — it earned its place. Give it a real verify, drop the `expires` field, treat it as a
  project. Now `check-the-reach` starts asking whether anyone uses it.
- **KILL** — move it to `~/_archive-YYYY-MM-DD/` and remove it from the registry. Archive, never
  delete; the cost of keeping a folder is zero and the cost of losing the one that mattered is not.
- **EXTEND, once, with a reason written down.** A second extension means you are avoiding the
  decision, and the honest move then is to kill it.

## The tell

You are about to build something and the phrase in your head is "just to see if this works." That
is a spike. Give it a date now, while you still don't care about it — nobody has ever successfully
set a kill date on something they had already fallen in love with.
