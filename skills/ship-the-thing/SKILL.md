---
name: ship-the-thing
description: Use when a build is finished or nearly finished, and whenever asked what to work on next. Checks whether anything built is sitting complete and unshipped, and forces the shortest path to one real user. Triggers on "it works", "that's done", "what should I build next", "new project", "let's build X", finishing a feature, or any moment the instinct is to start something new.
---

# Ship the thing

**The rule:** a built thing is not done until one real person has it. Before starting anything new,
check what is already finished and unshipped.

## Why this exists

An audit on 2026-08-20 found twenty registered projects, every one passing its own verify, roughly
ten built from zero in four months. An extraordinary build rate. It also found:

- **A finished, packaged, priced product** with cover art, listing copy and launch posts, built in
  a single sitting. **Never published.** Its publish checklist was untouched, and it named a file
  that did not exist — so following it literally would have uploaded nothing.
- **A rigorous brief and ten finished ad scripts** written for a live, approved client.
  **Nothing consumes any of it.** Nothing filmed, nothing published, no reference from anywhere.

Neither was registered in the spine, so nothing ever asked about them.

**The diagnosis is not a building problem. It is a finishing problem.** In the archetypes the owner
was reading that week: strong Prototyper and Builder, no Grower and no Sweeper. Ideas become working
software fast, and then nothing carries them to a first user.

## What to do

**When something is finished, ask these four in order:**

1. **Who is the one real person who gets this, and when?** A name and a date. "Operators" is not a
   name. If there is no name, the thing is not finished, it is parked.
2. **What is the shortest path from here to them?** Usually far shorter than the next feature.
3. **Does anything consume this output?** If nothing reads it, it does not exist yet — see
   `find-orphaned-output`.
4. **Is it registered in the spine?** your coverage check must be clean. An unregistered project is
   one nobody will ever be asked about again.

**When asked what to build next, check the unshipped list FIRST.** Run your health board and look for
projects that are green and quiet. Green plus quiet plus no users is the signature of a parked
deliverable. Say so before proposing anything new.

## Parked is not stalled — never nag about a decision already made

A thing the owner has **consciously dropped** is finished business. Raising it again reads as not
listening, and it trains him to ignore this check entirely. The distinction:

- **Stalled** — nobody decided anything; it just went quiet. Raise it.
- **Parked** — the owner looked at it and said not now. Record the decision where the project lives,
  keep its verify green so it stays shippable, and **stop mentioning it.**

When a park is declared, write it down in the project itself (its verify output and its own docs) so
a future session reads a decision rather than an oversight. the unpublished product above is the worked
example: parked by decision, its verify still proves the product intact, no longer an action item.

## The honest sentence

When reporting on a built thing, never let "it works" stand alone. Say **"it works and N people
have it,"** or say **"it works and nobody has it yet."** The second sentence is the whole point.

## What this does NOT mean

It does not mean shipping unsafe work. Anything touching money, publishing, legal exposure or a
real consumer still tops out at a scored proposal and the owner gates the release. Shipping faster
never means gating less.
