# Doctrine

The tools in this repo are downstream of this document. If you only adopt one thing, adopt this —
the checks are just what makes it stick when nobody is watching.

---

## The premise

Most people try to upgrade their AI by writing better prompts. The upgrade that actually changes the
output is **a system around the model**: something that decides what is true, something that decides
what is done, and something that decides what is allowed to ship.

A model is an extraordinary executor and an unreliable judge — of its own work most of all. So the
entire discipline reduces to moving three decisions out of its hands.

| Decision | Who holds it | Why |
|---|---|---|
| **What is true** | A command that counts it | Memory, notes and a confident summary are the same category of evidence: a guess wearing a suit. |
| **What is done** | A verify that exits 0 or 1 | A model will report success on work it did not do, fluently. An exit code cannot be fluent. |
| **What ships** | A lane, and a human at the gate | Irreversible actions are the only ones you cannot iterate your way out of. |

Hold those three and you can let a model run **much harder** than most people dare to, because the
blast radius is bounded by something that does not hallucinate.

This is the part people get backwards. They assume rules and gates slow the AI down. The opposite is
true: the reason most people keep their model on a short leash is that they cannot verify its
output, so every task needs them watching. Give it a verify and the leash gets much longer without
getting more dangerous.

---

## The lanes — how far autonomy goes

Classify every change into exactly one lane **before the work starts.** The lane sets the autonomy.
It is never renegotiated afterwards by whoever wants to ship.

| Lane | What's in it | How far it runs |
|---|---|---|
| **Fast** | docs, copy, tests, read-only screens, cleanup | Runs and commits itself. |
| **Tier-1** | anything that changes real output | May loop to green **on a branch**, then HALTS for a human. |
| **Hard halt** | schema, migrations, customer data, money, legal, anything that sends or publishes | Never runs unattended at all. Prepare the change, stop, report. |

**The litmus.** If the change could alter real output — or break a guarantee you've made — it is
Tier-1. **Any doubt at all resolves to Tier-1.**

The single most valuable property of this scheme is that it is decided in advance. A lane chosen
after the diff exists is a lane chosen by someone who wants to be finished.

---

## Loop discipline

A model may iterate unattended only with a **manifest** declaring all four of:

1. a **binary exit** — a verify command that exits 0 when the work is genuinely done;
2. a **hard cap** — maximum iterations and maximum time or tokens;
3. a **stall window** — halt after K identical failures;
4. a **declared scope** — files or directories it may not cross.

Miss any one and the loop is refused. Only the **fast** lane may loop unattended; Tier-1 prepares
the diff and halts.

**The verify — not the model — decides done.** A model that judges its own completion will iterate
forever and narrate progress the whole way down. The deterministic exit is the only thing standing
between "working autonomously" and burning money in a circle.

Auto-halt on: cap reached, stall detected, scope crossed, any Tier-1 trigger, or an exit condition
that cannot be evaluated. A human is required at every halt.

---

## The eight rules, and what each cost to learn

None of these were designed. Each is the shortest sentence that would have prevented a specific,
expensive mistake.

### 1. The verify decides done — not the model, and not you.
Every project gets one command that returns pass or fail and nothing else. Work is finished when
that command is green and at no other moment.

> **What it cost.** A model will report success on work it did not do, and it will be articulate
> about it. If you cannot write that command for something you own, that is the most useful finding
> you'll get all week — it means nobody can currently tell whether it works.

### 2. Derive, don't recall.
Before stating anything about current state — what is done, what was sent, how many exist, what is
deployed — run the thing that counts it.

> **What it cost.** The status you remember is the status as of the last time someone checked, which
> is never now. Every "I think we already did that" is a guess.

### 3. One lane per change, and the lane sets the autonomy.
See the table above. Chosen before the work, never after.

> **What it cost.** Scope expands silently. A change that "was just a copy fix" reaches the
> output path, and nothing stopped it because nobody had classified it while it was still small.

### 4. Loop the verifiable. Gate the judgment.
Bounded loops only, with a manifest. Judgment calls halt for a human.

> **What it cost.** An unbounded loop doesn't fail — it succeeds at the wrong thing, repeatedly,
> while reporting progress.

### 5. Gate the rendered artifact, not the record.
Before anything reaches a human — a document, an invoice, an email, a published page — check the
bytes they will actually receive, not the database row behind them.

> **What it cost.** Correct data still produced **four separate defects** in a document about to be
> handed to a person. Everything upstream was verified and green. Rendering was where it broke, and
> rendering is the only part the recipient ever sees.

### 6. Every check must say what it could not see.
A tool reports what it examined *and what it skipped*. "Nothing found" and "nothing looked at" must
never print the same sentence.

> **What it cost.** A checker that reports clean while blind is worse than no checker, because it
> ends the search. Found in our own sweeper: it reads JavaScript only, and on a mixed project it
> printed a clean result over files it had never opened — the exact defect it was written to catch,
> living inside the tool that catches it.

### 7. Report. Never act.
Checks find things and print them. They do not delete, send, spend, or deploy. A human reads the
finding and decides.

> **What it cost.** A cleanup tool trusted to act on its own is how you lose the one file that
> mattered — on the day its heuristic was slightly wrong and nobody was watching.

### 8. Green is not used.
Passing every check and having a single user are unrelated facts. Track them separately, because
only one of them is the business.

> **What it cost.** Twenty-three projects, every one passing its own verify. **Five had ever reached
> a human.** Green-and-unused looks identical to green-and-thriving on every instrument except the
> one that bothers to ask.

---

## Memory: derive it, don't accumulate it

The failure mode is specific and it is nearly universal among people who use AI seriously.

You start keeping a context file so sessions resume fast. It works. So you add to it. It keeps
working, so you keep adding. Eventually it holds history, decisions, war stories and current state
all at once — and the current-state part, the only part with a shelf life, is now buried in
paragraphs that were true months ago.

Ours reached **3,217 words** and silently stopped being parseable by the tool that read it. Resume
had been broken for weeks. Nothing complained, because nothing was checking.

The fix that held:

- **One file is the sole authority for current state**, and it holds *only* current state.
- That file's live section is **capped** — ours is five lines — and something mechanical enforces the
  cap, because discipline alone regrew it once already.
- **History goes somewhere else.** An append-only decision log, dated, never rewritten.
- **Counts are never written down.** Anything countable gets counted at read time by a command. A
  number in a document is a number that was true once.

The general principle: **state is derived, never remembered.** Anything you can compute, compute.
Anything you write down, treat as a claim with a date on it.

---

## What to subtract first

If you have an elaborate AI setup already, run this before adding anything from this repo:

**Ask which parts of it have ever actually fired.** Not "is it configured correctly" — whether it
has run, and when, and what it produced. Most setups have never been asked.

In ours the answer was an agent factory that hadn't run in three weeks, 1,639 skills that had never
loaded once, and a memory file that broke the tool reading it. All three looked like upgrades on the
day they were built. None of them came with anything that would later ask whether they were earning
their place.

That question is the one this whole repo is built around. Everything else is a way of making sure
someone asks it again next month.
