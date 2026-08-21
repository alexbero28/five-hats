---
name: check-the-reach
description: Use when deciding what to work on, when something is "done", or when judging whether a project is healthy. Separates "it passes its tests" from "a real person has used it" — and pulls the lesson out of the ones that have. Triggers on "what should I work on", "is this working", "how are we doing", "what's next", "should I build X", finishing a build, or any health question about a project or the portfolio.
---

# Check the reach, not just the green

**The rule:** a passing verify says the thing *works*. It says nothing about whether it *matters*
yet. Before treating a project as healthy, ask whether anything outside the machine has touched it.

Run it: `node reach.mjs` (or `node reach.mjs --registry projects.json`)

## Why this exists

A 22/22 green board sat on top of a two-client business. A finished, packaged, priced product had
a green verify and had been unpublished for eleven days. Ten compliance-checked ad scripts existed
for a live client and nothing consumed any of them. **Green-and-unused looks identical to
green-and-thriving on every instrument that existed before this one.**

The current split is **5 reached, 17 never** — and all five are the same chain: the ledger, the
engine, the signature bot, the mail bot. Everything else has never been used by anyone.

## The two questions

**1. Has anything reached a human?** `reach.mjs` ignores source entirely and looks only at the
directories that fill up when someone outside does something — a document arrived, a letter went
out, a reply came back, somebody applied. Newest artifact = last time the world touched it. None =
never used.

**"Never reached" is not a bug.** It is a decision that has not been made: **ship it or park it.**
Both are fine. Drifting is not. A parked thing should say so in its own verify output (see
`ship-the-thing`), so it stops reading as a backlog item.

**2. What have the ones that DID reach taught you?** This is the half that gets skipped, and it is
the actual Grower job — not finding users, but *learning from the users you already have*.

Outcomes are data. Which approaches produced results and which produced nothing is answerable from
what already happened, and the answer should change what gets built next. If a project produces
outcomes, find the instrument that tallies them and **read it** — in one project that is a
`patterns` command that rolls each recurring pattern up against its real outcome record.

## The trap

Reaching for a new build when an existing one has unread outcome data. New code is more satisfying
than reading results, and it is almost always the worse move: the data you already own makes every
future client cheaper to serve, and it costs nothing to collect because it already happened.

## What this does NOT mean

It is not a nag to ship everything. Infrastructure has no users by definition and a "never
reached" row against `jarvis` or `workflow-os` is meaningless. Weight it by lane — a **tier1**
project that has never reached a human is the finding worth raising.
