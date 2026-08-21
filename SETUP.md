# Setup

**Read this section before running anything.**

Everything in this repo is divided into two halves, and the line between them is marked. The first
half **cannot change anything on your machine** — it reads, counts, and prints. The second half
changes things, and every step in it says what it touches and how to undo it.

You can stop at the end of the first half and still get most of the value. Plenty of people should.

---

## Part One — nothing here changes anything

### Step 0. Back up your current setup first

Not because this repo will damage it. Because **you cannot measure an improvement against a
baseline you no longer have.** Once you start changing things, the old state is gone, and "I think
it's better" is the only answer you'll ever be able to give.

Take a copy of whatever holds your setup today:

```bash
# your AI configuration
cp -r ~/.claude ~/.claude.backup-$(date +%Y-%m-%d)

# any project that isn't already backed up somewhere other than this disk
git -C ../your-repo bundle create ~/your-repo-$(date +%Y-%m-%d).bundle --all
```

If your setup already lives in git with a remote, you're done — that *is* the backup. If it
doesn't, that fact is itself one of the findings this repo is about to hand you.

**Restoring is the inverse of the above, and nothing below prevents you from doing it at any point.**

### Step 1. Take the baseline — the before-picture

```bash
node baseline.mjs .. --save --report
```

Reads. Counts. Writes only the files you asked for — `baseline-<date>.json` from `--save`, and
`baseline-<date>.html` from `--report` — both in this folder. No network call exists anywhere in
that file, and the HTML page loads no external asset, so it works offline and tracks nothing.

Open the HTML in a browser. It is the version to show someone who will not read a terminal.

It records what you own, how much of it has a verify, how much code nothing reads, how many
projects a real person has ever used, what's decaying, and how big your AI setup has grown. Keep
the file. It is the only honest "before" you will get, and in a month it's the difference between
*"this helped"* and *"this took 18 projects nobody used down to 6."*

**What it does not claim.** It counts what exists on disk. It cannot tell you what has ever *run* —
a skill file and a skill that has fired look identical from the filesystem. Where that limit bites,
it prints the limit instead of inventing a number. That gap is where our own 1,639 never-loaded
skills lived for two months.

### Step 2. Run the three checks

```bash
node sweep.mjs ../your-repo     # what nothing reads
node reach.mjs ../your-repo     # has a real person ever used this
node drift.mjs ../your-repo     # what is quietly decaying
```

Read what comes back before you change anything. The first run is the most informative one you'll
ever get, because it's the only run where nobody has been managing to the metric.

Two findings tend to land hardest: a **DEAD DIR** you'd forgotten was in there, and a project
`reach` says **nobody has ever used.**

> **What these cannot see.** `reach.mjs` and `drift.mjs` are language-agnostic. `sweep.mjs`
> analyses JavaScript, TypeScript and Python, and *names* the languages it will not analyse
> instead of skipping them silently — `node sweep.mjs --langs` prints the full table.
> `reach.mjs` says **"can't tell"** when it doesn't recognise your folder names. `drift.mjs` needs
> git for six of its eight checks.

---

## ── Everything below this line changes something ──

Each step names exactly what it touches and how to reverse it. None of it is required. Do them one
at a time and re-run the baseline between them if you want to see each one's effect on its own.

---

## Part Two — the changes, each reversible

### Step 3. Wire the spine

**Touches:** creates `projects.json` in *this* folder. Nothing else, anywhere.
**Undo:** delete the file.

```bash
cp projects.example.json projects.json
```

Edit it. One entry per project you own. The only field that really matters:

```json
{
  "projects": {
    "your-app": {
      "path": "../your-app",
      "verify": "npm test",
      "lane": "tier1",
      "strength": "tests"
    }
  }
}
```

**`verify` is one command that exits 0 for pass and non-zero for fail.** Not a description of how to
test it — the actual command. Then:

```bash
node bin/project.mjs health --all   # runs every project's own verify
node bin/project.mjs scan           # flags folders not under the spine
```

`health --all` runs *your* commands, so it does whatever they do. If any of your verify commands
have side effects, that's worth knowing before you run it across everything at once — and it's
worth fixing, because a verify with side effects can't be run freely, which defeats the point.

`scan` will find projects you forgot you had. Register them or add them to `_ignore` — an explicit
decision beats a silent gap.

**If you cannot write the verify command for a project, write that down and leave the entry in.**
That project is the one where nobody, including you, can currently tell whether it works.

#### The verify-strength ladder

Declare `strength` honestly. `drift` flags a critical project running on a weak one.

| | |
|---|---|
| `parse` | it compiles. Proves almost nothing. |
| `lint` | style and obvious errors. Still cannot catch a wrong answer. |
| `types` | interfaces line up. |
| `tests` | behaviour is asserted. |
| `live` | exercised end to end against something real. |

Climbing this ladder on the projects that matter is most of what "improving your setup" actually
means.

### Step 4. Wire the secret guard

**Touches:** your **global git configuration**, which affects **every repository on this machine**,
including ones you haven't created yet. This is the most invasive step in the repo. Read the check
below before running anything.

**Undo:** `git config --global --unset core.hooksPath`, or restore the previous value.

#### Check this first — it is not optional

```bash
git config --global core.hooksPath
```

- **If that prints nothing**, you have no global hooks and it's safe to continue.
- **If that prints a path, STOP.** You already have global hooks. Setting a new path *silently
  replaces* them — your existing hooks stop running and nothing tells you. Instead, add the guard
  to the hooks directory you already have, by appending the line from below to the `pre-commit` and
  `pre-push` files already living there.

#### If you have no existing hooks

```bash
mkdir -p ~/git-hooks

printf '#!/bin/sh\nnode /absolute/path/to/five-hats/bin/secret-guard.mjs --staged || exit 1\n' > ~/git-hooks/pre-commit
printf '#!/bin/sh\nnode /absolute/path/to/five-hats/bin/secret-guard.mjs --push || exit 1\n'   > ~/git-hooks/pre-push

chmod +x ~/git-hooks/pre-commit ~/git-hooks/pre-push
git config --global core.hooksPath ~/git-hooks
```

Audit what's already in your history without wiring anything at all:

```bash
node bin/secret-guard.mjs --audit .     # read-only, changes nothing
```

Two things worth knowing. Overriding with `--no-verify` should be a deliberate, logged exception and
never a habit. And a leaked key must be **rotated**, not just deleted — deleting leaves it in
history, where it is still readable and still compromised.

### Step 5. Install the skills *(Claude Code only)*

**Touches:** copies files into `~/.claude/skills/`. Does not modify existing skills unless one of
yours happens to share a name — check first.
**Undo:** delete the nine directories you copied in.

```bash
ls ~/.claude/skills/            # check for name collisions FIRST
cp -r skills/* ~/.claude/skills/
```

Nine skills. They sit dormant and cost roughly 100 tokens each until a trigger fires.

Resist the urge to add fifty more. The lesson that produced this repo is that a library of 1,639
skills had never loaded once, while nine that fire on a trigger changed how the work actually ran.

### Step 6. Adopt the memory model

**Touches:** three files you create in your own project. Nothing automatic, nothing global.
**Undo:** they're your files.

This is a discipline, not a tool, and it's the one that decays fastest without enforcement. Three
files, each with exactly one job:

**`STATE.md` — the sole authority for current state.** Only current state. Cap the live section at
five lines and hold the cap:

```markdown
## Checkpoint (max 5 lines)
- Last green: <the verify result>
- Current phase: <what is being worked on>
- Next action: <the single next thing>
- Blocked on: <gates / external waits>
- Deep history → DECISIONS.md
```

**`DECISIONS.md` — append-only, dated.** Every entry a decision and why. Never rewritten. This is
where history goes so it stops colonising `STATE.md`.

**`RULES.md` — your hard invariants, and the only place they're defined.** Short. If a rule appears
in two files, one of them will drift and you won't know which.

The rules that keep this working:

- **Never write down a number you could count.** Counts go stale silently. Run the command.
- **History never lives in the state file.** The moment it does, current state becomes unfindable.
- **Enforce the cap mechanically.** Ours regrew past 3,000 words on discipline alone, then broke the
  tool that read it, and nothing complained for weeks.

`DOCTRINE.md` has the full reasoning.

---

## Part Three — measure what actually changed

Give it a couple of weeks of real work. Then:

```bash
node baseline.mjs .. --compare baseline-<date>.json
```

```
  ✓  projects with a verify        3 ->    11   +8
  ✓  projects nobody has used     18 ->     6   -12
  ✓  dead directories              4 ->     1   -3
  !  drift warnings               18 ->    21   +3
```

Rows that moved the wrong way are the useful ones. Drift warnings going *up* after adoption is
normal and good — it usually means the system is now seeing things it was blind to before, not that
things got worse. That distinction is exactly why you took the before-picture.

---

## Validate the repo itself

```bash
node verify.mjs     # this repo's own binary gate — read-only
```

23 checks. It runs every tool, proves the spine works against the shipped example, and fails if any
private or machine-specific reference gets into the repo. We eat our own cooking.

---

## What you end up with

- Every project you own has **one command that says whether it works.**
- A single pass tells you which of them a **real person has actually used.**
- Secrets **cannot enter git history** on this machine.
- Three jobs that nothing used to trigger now have something that triggers them.
- A **before and after** you can actually show someone, instead of a feeling.
- Your AI can be turned loose much further than before, because what it produces is checked by
  something that doesn't hallucinate.

None of it is clever. All of it is the thing nobody gets around to.
