---
name: onboard-to-spine
description: Use when starting a new project, creating a new project directory, or finding an unregistered one. Registers it with a real binary verify so it is governed, or records an explicit decision to ignore it. Triggers on "new project", "let's build X", "start a repo", scaffolding anything, or a coverage check that is not clean.
---

# Onboard it, or ignore it on purpose

**The rule:** every directory in your projects folder is either registered with a binary verify or listed in
`_ignore` with a reason. A directory that is neither is a project running with no intelligence
watching it, and nobody will ever be asked about it again.

## Why this exists

Two real projects were found running dark: a finished, packaged product that was never published,
and a set of compliance-checked ad scripts for a live client that nothing consumed. Neither was
registered, so no board ever showed them and no session ever raised them. Registration is not
bookkeeping — **it is what makes a thing get asked about.**

## Register it

Add a row to your registry (see `projects.example.json`):

```json
"<name>": {
  "path": "../<name>",
  "verify": "<binary command, exit 0 = healthy>",
  "lane": "fast | tier1",
  "strength": "parse | lint | types | tests | live"
}
```

Then your coverage check must come back clean — nothing unlisted.

- **lane:** `tier1` for anything touching money, publishing, legal exposure or a real consumer —
  those never auto-ship. `fast` for everything else.
- **strength:** state honestly what the verify actually proves, weakest to strongest —
  `parse` < `lint` < `types` < `tests` < `live`. GREEN·parse must never read like GREEN·tests.

## Writing a verify worth having

The verify is the whole point, so make it assert what would actually be wrong.

- **Code:** its test suite.
- **Documents or copy:** gate the CLAIMS. One project's verify checks its ad scripts against the
  hard limits its regulator imposes, and exits non-zero on a prohibited promise, a banned fee
  structure, or a call-to-action that would breach the rules.
- **A product or deliverable:** assert it is intact and shippable. one product project's verify
  checks every asset exists, the zip is readable, every product page is actually inside it, and the
  publish checklist names a file that exists — which is how it caught a checklist pointing at a
  filename that did not exist.
- **Money or publishing repos:** use a NON-EXECUTING verify (a syntax check) so a health probe never
  runs live trading or posting code.

**It must run under Git Bash**, because that is what the board shells to. A verify that only passes
in PowerShell reports a false red — see `reference-health-board-needs-git-bash`. Prefer
dependency-free Node over shelling to platform tools: GNU tar in Git Bash reads a leading `C:\` as a
remote host and cannot read zips at all.

## Ignoring on purpose

Scratch, mirrors and vendored tooling go in `_ignore` in `projects.json`, **with a reason**. That is
an explicit decision, which is the opposite of a silent gap.

## Keeping archives out of the way

Put dated archive folders OUTSIDE your projects folder (e.g. `../_archive-YYYY-MM-DD`). An archive inside the
scan root trips the scan forever and tempts a permanent exception.
