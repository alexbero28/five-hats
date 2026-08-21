---
name: verify-decides-done
description: Use before claiming anything works, passes, is fixed, or is complete, and before any commit or deploy. Requires running the project's binary verify and reading its real output first. Triggers on "done", "fixed", "working", "should work", "that passes", "ready to ship", finishing an edit, or reporting a result.
---

# The verify decides done, not the model

**The rule:** run the project's binary gate and read its actual output before saying anything works.
Exit 0 or it is not done. A prediction that it will pass is not a result.

## What to run

Every registered project carries its own binary verify. Get it from the registry rather than
guessing: your health board for everything, or its single-project form for one.

## Read the failure mode, not just the colour

A health instrument can be wrong, and when it is, it is usually wrong in a way that looks like an
answer. On 2026-08-20 the board reported **RED for 21 of 22 projects whose suites all pass.** The
cause: verifies run through `bash -c`, and plain `bash` on this machine resolved to the **WSL** stub,
which has no `node` and no `python`. Every verify exited 127 "command not found" in ~175 ms and was
recorded as a failing project. One board run wrote that lie into the health log.

So when reading a result:

- **Uniform timing across unrelated projects means the runner, not the projects.** Twenty verifies
  that all "fail" in the same ~175 ms did not run.
- **Exit 127 is ERROR, not RED.** A shell that cannot find the interpreter is a question, not a
  verdict. `project.mjs` now reports it as ERROR for exactly this reason.
- **Suspiciously fast green is also suspect.** A gate that passes without doing work is not a gate.
- **A gate that reports zero problems while an obvious problem exists is itself the finding.** The
  orphan gate declared zero orphans while carrying 55 MB of them.

## Reporting honestly

- Say what you ran and what it printed. "Tests pass" without a command is not evidence.
- If it fails, say so with the output. Never soften a red into "mostly working".
- If you skipped a step, say which.
- Stop after roughly three failed attempts at the same fix and report where it stands rather than
  thrashing.

## Before a commit

Run the verify. If it is red, either fix it or say plainly in the report that you are committing
against a red gate and why. Never let a green claim stand on an unrun command.
