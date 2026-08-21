---
name: gate-the-artifact
description: Use before anything leaves the system to a human — a letter, a PDF, an email, a client-facing page, published copy, an ad script, an exported document. Check the RENDERED bytes, not the stored record. Triggers on "send", "mail", "publish", "export", "render", "the data is correct", generating any document, or gating client-facing output.
---

# Gate the rendered artifact, not the record

**The rule:** validate the bytes the recipient actually receives. Correct data renders wrong output
all the time, and every check that reads the database will pass while it happens.

## Why this exists

Four real defects reached finished documents while every gate was green, because each gate read the
stored record and the record was correct:

- Operator-only annotations — route codes, harm screens, a "VERIFY ADDRESS" note — printed on the
  copy a customer would sign and a regulator would receive.
- Letters went out with `[YOUR PHONE]` and `[YOUR EMAIL]` unresolved on the page.
- A letter said "I have enclosed" while the envelope contained no enclosure — false on its face.
- A fabricated organization address printed on a statutory cancellation notice as the place a
  consumer mails a cancellation.

## What to do

1. **Render, then read.** Produce the actual output and inspect it. Not the model, not the JSON —
   the page, the PDF text layer, the email body, the published HTML.
2. **Fail closed with an allow-list, never an allow-anything filter.** A filter asks "does this
   contain something bad" and fails open on everything it did not anticipate. An allow-list asks
   "is every element here one I named" and fails closed. one project's client-view module is the
   reference implementation: the client page is BUILT from named fields, so operator vocabulary is
   structurally unable to reach it.
3. **Refuse to render on an unresolved placeholder.** Any `[BRACKET]`, `{{token}}` or empty
   substitution is a hard stop, not a warning.
4. **Check claims against enclosures.** If the text says a document is attached, assert the
   attachment exists.
5. **Grep the rendered bytes for what must never appear** — internal ids, statute cites in consumer
   copy, personal data, operator notes, test addresses, ISO timestamps in human text.

## Known gates on this machine

| Surface | The gate |
|---|---|
| A customer-facing status page | an allow-list of permitted fields, and a generator that refuses to write if anything else appears |
| An outgoing envelope or package | a builder that strips internal notes and asserts every claimed enclosure actually exists |
| A document sent for signature | a render target carrying no internal annotations, which refuses to render with an unresolved placeholder |
| Published or advertising copy | a claims gate encoding your regulator's hard limits, binary pass/fail |
| A public marketing site | a copy verify that runs before deploy |

Build each one as an ALLOW-list. A forbidden-list fails open on everything you did not anticipate;
an allow-list fails closed.

## The tell

"The data is correct" or "the test passes" offered as evidence that the output is safe. Those are
statements about the record. Ask to see the artifact.
