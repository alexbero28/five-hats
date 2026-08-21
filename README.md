# Five Hats

**The operating system we run our work on, packaged so you can run it too.**

This is not a prompt library and not a framework. It is the small set of things we added around
the AI after discovering that the elaborate setup we'd built around it had, measurably, never
run.

**Nothing in this repo deletes, sends, spends, or deploys.** Node 18+ is the only requirement. No
install, no dependencies, no account, no network call anywhere in it.

The repo is in two halves and the line between them is marked in `SETUP.md`. The first half
**cannot change anything on your machine** — it reads, counts, and prints. The second half changes
things, and every step in it says what it touches and how to undo it. You can stop at the end of
the first half and still get most of the value.

---

## Start here — back up, measure, then look

```bash
# 0. keep a copy of your current setup. you cannot measure against a baseline you no longer have
cp -r ~/.claude ~/.claude.backup-$(date +%Y-%m-%d)

# 1. the before-picture
node baseline.mjs .. --save

# 2. the three answers your test suite never gives you
node sweep.mjs ../your-repo     # what nothing reads
node reach.mjs ../your-repo     # has a real person ever used this
node drift.mjs ../your-repo     # what is quietly decaying
```

Every command above is read-only, except `--save`, which writes one JSON file into this folder
because you asked it to.

If you only ever use this repo for those commands, it was worth cloning.

> **Scope, stated up front.** `reach.mjs`, `drift.mjs` and the spine are **language-agnostic** —
> they work the same on Python, Go, Swift or anything else. `sweep.mjs` analyses **JavaScript,
> TypeScript and Python**; it detects Go, Rust, Ruby and PHP and says plainly that it is not
> analysing them, and why. Run `node sweep.mjs --langs` to see the whole table.
> `reach.mjs` guesses at folder names and says **"can't tell"** when it doesn't recognise yours.
> `drift.mjs` needs git for six of its eight checks. Knowing what a tool cannot see is worth more
> than a clean report from one that was blind.

---

## Why this exists

Every business needs five jobs done: someone tries new things (**Prototyper**), someone makes them
solid (**Builder**), someone cleans up (**Sweeper**), someone gets them used (**Grower**), someone
keeps them running (**Maintainer**).

Give a capable model to one person and two of those jobs go vertical. The other three don't slow
down — they stop. And they share one trait that explains why: **nothing ever makes you do them.**
Cleanup has no deadline. "Has anyone actually used this?" has no dashboard. Decay is silent by
definition. They lose every contest against whatever is making noise today, and they lose it to the
absence of a trigger, not to laziness.

So this repo is triggers. One for each job nothing else asks you to do.

### What we found when we finally measured our own setup

We had an agent factory with relays and worker packets. A four-tier model-routing ladder. A library
of **1,639 skills** with a retrieval system. Five overlapping doctrine documents. A memory file for
instant session resume that had grown to 3,217 words.

Then we measured it:

- The agent factory had **run zero jobs in three weeks** while every piece of real work went direct.
- The 1,639 skills had **never been loaded. Not once.**
- The 3,217-word memory file **could not be parsed by the tool that read it** — so "instant resume,"
  the one function it all existed for, had been silently broken for weeks.

Nothing failed loudly. It looked sophisticated the entire time.

**Every upgrade since has been a subtraction.** 1,639 skills became 9 that fire on a trigger.
The agent factory became direct execution with a gate. Five doctrine layers became one page. The
3,217-word file became a five-line checkpoint.

Then we added the small things in this repo. That's the whole story.

---

## `baseline.mjs` — the before-picture

Everyone who adopts a new way of working believes it helped. Almost nobody can say by how much,
because nobody wrote down what "before" looked like — and once you've changed things, that state is
gone for good.

```bash
node baseline.mjs .. --save                          # the before-picture
node baseline.mjs .. --save --report                  # ...plus an HTML page you can show someone
node baseline.mjs .. --compare baseline-2026-08-21.json   # what actually moved
```

It records what you own, how much has a verify, how much code nothing reads, how many projects a
real person has used, what's decaying, and how large your AI setup has grown. Then it tells you
which way each number went:

```
  ✓  projects with a verify        3 ->    11   +8
  ✓  projects nobody has used     18 ->     6   -12
  !  drift warnings               18 ->    21   +3
```

**What it refuses to claim:** it counts what *exists*. It cannot tell you what has ever *run* — a
skill file and a skill that has fired look identical from the filesystem. Where that limit bites it
prints the limit instead of a number. That exact gap is where our own 1,639 never-loaded skills
lived for two months.

---

## `fix.mjs` — what to actually do about it

The checks tell you what is wrong and then stop. That is correct — a tool that deletes on its own
is how you lose the one file that mattered — but on its own it leaves people stuck. They can see
the finding, have no idea what the right response is, and nothing happens. Same outcome as never
having run it.

```bash
node fix.mjs ../your-repo            # the plan, in the order worth doing it
node fix.mjs ../your-repo --brief    # ...and AGENT-BRIEF.md to hand to your AI
```

Every finding type has a known correct response, and most have a known WRONG one that looks right.
`fix.mjs` is that knowledge written down. It changes nothing.

The distinction it draws is the whole point:

| | |
|---|---|
| **MECHANICAL** | Deterministic, reversible, no taste required — `git init`, add a remote, delete an empty file. Safe to let your AI do while you watch. |
| **JUDGMENT** | Someone has to decide. Is this dead subsystem really dead? Ship this project or park it? No tool can answer that, and one that pretends to is lying to you. |

Each item carries its **trap** — the wrong move that looks right:

> **A secret is tracked by git.** Deleting the file and committing that. The value is still in
> the history, still readable, still valid. Deletion is not rotation.

> **A whole subsystem nothing reaches.** Deleting because a tool said so. Confirm with the person
> who wrote it, or with git log, before anything leaves the tree.

`--brief` writes a file you hand to your AI assistant. It carries the lanes, the seven rules, the
findings, and the traps — enough for someone else's AI to work the way this one does, with the
human still holding every irreversible decision.

---

## The three checks

### `sweep.mjs` — the Sweeper

Finds code nothing reads. Four checks:

| | |
|---|---|
| **DEAD DIR** | A whole subsystem nothing outside it reaches. **The big one.** A dead subsystem *vouches for itself* — 24 modules importing each other all look busy — so per-file checks can never see it. Only counting references from *outside* the directory exposes it. |
| **TEST-ONLY** | Imported by tests and nothing else. The suite stays green while the code is dead. |
| **ORPHAN** | A module nothing imports at all. |
| **WRITERLESS** | A zero-byte file whose name appears nowhere — nothing will ever write it. |

**Languages.** Different languages name modules in completely different ways, and guessing produces
confident nonsense rather than a missed finding. Measured on a real 187-file Python project: only
**11 of 40** live modules are referenced by filename, while **40 of 40** are referenced by import.
So "just add `.py` to the extension list" would report 29 of 40 live modules dead — a 72%
false-positive rate, worse than no check at all.

| | |
|---|---|
| **JavaScript · TypeScript** | dead dir · test-only · orphan |
| **Python** | test-only · orphan — *not* dead dir, because the package directory usually **is** the project, so "nothing outside reaches it" is trivially true |
| **Go · Rust · Ruby · PHP** | detected and declared, **not** analysed. Go imports a package path, never a filename, so no per-file reference exists to count |

If your project loads modules **dynamically** — `importlib.import_module()`, `await import(path)` —
sweep says so and tells you to check ORPHAN findings against your plugin wiring, because no amount
of reading source can see a reference built at runtime.

It is deliberately quiet about things that only *look* dead: scratch folders, `archive/`, vendored
and minified assets, browser userscripts, and anything named in `package.json` scripts. If your
project is a *fleet of entry points* — a `workers/` folder launched by a scheduler — add
`"sweepIgnore": ["workers/"]` to its registry entry rather than reading 80 false findings.

**First run on the codebase it was built for it found 55 MB of retired engine**, still in the
tree, kept alive entirely by its own tests, while that project's own orphan checker reported zero
problems.

### `reach.mjs` — the Grower

Asks the question no dashboard asks: **has a real person outside this ever used it?**

It ignores your source code completely and watches only the folders that fill up when somebody
*else* acts — a document arrives, an order comes in, a reply lands. The newest file in those
folders is the last time the world touched this project. None at all means nobody ever has.

Point it at your own evidence folders with `"reachPaths": ["out/", "responses/"]`.

**First run: five projects had reached a human. Eighteen never had — and all of them passed every
check.** Green-and-unused looks identical to green-and-thriving on every other instrument.

"Never reached" is not a bug. It is a decision nobody has made: **ship it or park it.**

### `drift.mjs` — the Maintainer

The gap between what a system claims and what is true. Eight checks:

- a critical project running on a weak verify
- no verify wired at all
- an experiment past its kill date (`"expires"` in the registry)
- no git remote — one disk failure from gone
- commits sitting unpushed and ageing
- **a secret file tracked by git** — the one mistake a later commit cannot undo
- a large uncommitted working tree
- nobody running the checks (set `HEALTH_LOG` to your own health-run log)

`--gate` exits 1 on anything **serious**, so it can sit in a git hook or a cron job and stay silent
until it matters. **First run found a commit unpushed for 81 days.**

---

## The spine — one command across everything you own

The three checks work on a bare folder. The spine is what makes them a system.

Copy `projects.example.json` to `projects.json`, list what you own, and give each one **a verify**:

```bash
node bin/project.mjs list          # the registry
node bin/project.mjs health --all  # run EVERY project's own verify
node bin/project.mjs scan          # any folder here NOT under the spine
node bin/project.mjs secrets       # secret audit across all of them
node bin/project.mjs add <name> --path ../<name> --verify '<binary cmd>'
```

**The `verify` field is the whole idea.** One command per project that exits 0 for pass and
non-zero for fail. Not your opinion, not the model's — a third thing that decides when work is
done.

If you cannot write that command for something you own, **that is the most useful finding this
repo will give you.** It means nobody can currently tell whether it works, including you.

`scan` is what keeps the registry honest: it flags any folder sitting outside the system. A project
nothing asks about is a project that rots for free.

---

## The guard — the one mistake you cannot undo

```bash
node bin/secret-guard.mjs --audit .     # scan a folder now
node bin/secret-guard.mjs --staged      # as a pre-commit hook
node bin/secret-guard.mjs --push        # as a pre-push backstop
```

An API key deleted in a later commit is still in your history and still compromised. This blocks it
at the commit, before it becomes permanent. Wire it once, machine-wide, and it protects every repo
you own:

```bash
git config --global core.hooksPath /path/to/your/hooks
```

See `SETUP.md` for the hook files.

---

## `skills/` — for Claude Code users

Nine skills encoding the rules these tools came from — derive don't recall, the verify decides done,
gate the rendered artifact, report never act, a built thing isn't done until one real person has it.

Copy any of them into `~/.claude/skills/`. They load on a trigger and cost roughly 100 tokens each
until they fire. That ratio is the entire lesson from the 1,639 skills that never loaded: a skill
that fires is worth a thousand that sit in a library.

Ignore this folder entirely if you don't use Claude Code — everything else here is standalone.

---

## The rest of it

- **`DOCTRINE.md`** — the operating model itself: the three decisions to take away from the model,
  the lanes, loop discipline, and the eight rules with what each one cost to learn. Read this if you
  want the *why*; the tools are downstream of it.
- **`SETUP.md`** — adopting this from scratch, including what never to copy from someone else's
  machine.
- **`verify.mjs`** — this repo's own binary verify. It runs every tool, and it fails if any private
  or machine-specific reference gets into the repo. We eat our own cooking.

---

## Three rules everything here follows

1. **They report. You decide.** Nothing here deletes, sends, or spends. A cleanup tool that acts on
   its own is how you lose the one file that mattered.
2. **They try hard not to cry wolf.** Every exclusion exists because a real false positive trained
   someone to skim past real findings. If a check starts producing noise, fix the *check*, never
   the threshold.
3. **They tell you what they cannot see.** No tool here claims to be complete. "Nothing found" and
   "nothing looked at" must never print the same sentence.

## Credit

The five roles are **Boris Cherny's** — he built Claude Code and described how job titles were
dissolving on his team as the work compressed into fewer people holding more of it at once. This
repo is one attempt at making all five available to a person working alone: the two a model
amplifies for free, and the three it will happily let you forget.

Use, copy, change, or strip this for parts, in anything including commercial work. MIT licensed —
the full text is in `LICENSE` and it fits on one screen.

---

## Questions, or it found something strange

**Open an issue** — that's the fastest route, and the answer helps whoever hits it next.

If you'd rather write privately, or you're not a GitHub user: **alexis.milander28@gmail.com**.

Worth saying: if one of these checks reports something you believe is wrong, that is a genuinely
useful message to send. Every exclusion in `sweep.mjs` exists because a real false positive taught
someone to skim past real findings, and a check that cries wolf is worse than no check at all. If
it produces noise on your codebase, the check is what should change.
