---
name: find-orphaned-output
description: Use when a feature "works" but nobody sees its result, when a fix does not show up in the UI, when adding a field or a computed value, when auditing a codebase, or for any cleanup or sweeper pass. Finds code that computes output nothing reads and whole subsystems nothing reaches — the recurring root defect on this machine. Triggers on "the engine already does that", "it's in the data", "why doesn't it show", "clean this up", "sweep", "dead code", "what can we delete", and any migration or table added for data that must arrive from somewhere else.
---

# Find orphaned output

**The rule:** computed is not the same as consumed. Before believing a capability exists, follow the
value all the way to the surface that shows it.

## Why this exists — three occurrences, same shape

1. **Two contradiction stores.** The engine's detector found ~17 defect types; the app read a
   different store holding 3. The operator screen said "no contradiction" on accounts the engine had
   flagged. Both halves worked. They were not connected.
2. **A decorative ranking table.** A strongest-angle selector existed and was never consulted; real
   ordering was severity-first, so a weak item led over a provable one.
3. **Tracking numbers dropped at a boundary.** `the ledger project` held three certified article numbers. The
   exporter sent disputes to the app with no `tracking` field at all. The app showed three mailed
   letters with no date, no article number and no deadline. The receiving schema had **already been
   built** for exactly this, and its own migration comment named the failure: *"a stage that lies
   about DISPATCH makes OBSERVE meaningless, because no clock ever starts."* **The catcher was
   built. Nobody threw the ball.**

Each one passed every test. Tests prove a function returns a value; they do not prove anyone reads it.

## How to check

1. **Follow the value forward, not the function.** From where it is computed, to where it is stored,
   to the query that fetches it, to the template or response that renders it. Any missing link is
   the defect.
2. **Grep for the field name across the WHOLE path**, including the other repo. These breaks happen
   at boundaries between systems that are each individually correct.
3. **Compare the two stores.** When something is computed in one place and read from another, print
   both and diff. "No results" from the reader while the writer is full is the signature.
4. **Check the receiving schema.** Does the destination even have a column for this? If `pick()` or
   an equivalent filters unknown fields, your data is being dropped silently and successfully.
5. **Run the sweeper across every project:** `node sweep.mjs --registry projects.json`
   (or just `node sweep.mjs` in any single repo). It reports four things and **never deletes**:
   - **DEAD DIR** — a whole subsystem nothing outside it reaches. The big one, and the only
     check that can see a dead subsystem whose modules import *each other* and so vouch for
     themselves. That is the exact shape a retired subsystem takes.
   - **TEST-ONLY** — imported by tests and nothing else. The suite stays green; the code is dead.
   - **ORPHAN** — a module nothing imports at all.
   - **WRITERLESS** — a zero-byte file whose name appears nowhere, so nothing will ever write it.
   A project that is a *fleet of entry points* (a `workers/` directory launched by a scheduler)
   declares `"sweepIgnore": ["workers/"]` in projects.json — an explicit decision, not a silent gap.
6. **Whatever narrower gate your project already has** — but do not trust it blindly, see below.

## The gate can lie, so verify it

A project's own orphan checker reported **zero orphans** while a 55 MB retired subsystem sat in the tree,
kept alive only because 35 of 88 test files imported it and nothing in `src/` did. **Test files
importing a module is not adoption.** When checking whether something is dead, exclude the test
tree from the "who imports this" count.

## The tell

Someone says "the engine already computes that" or "it's in the data" — and cannot point at the
line that displays it. That sentence is the start of an investigation, not the end of one.
