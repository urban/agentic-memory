# Session Capture

Guidance for Memory Steward capture passes invoked from work outside the vault.

## Inputs

- Treat the Capture Payload as the authoritative session summary.
- Use only visible user/assistant text, the observation window metadata, and the local scratchpad returned in the payload.
- Do not reconstruct hidden reasoning, tool-call internals, raw transcript logs, or omitted repository state.

## What to persist

- Durable project resume context future sessions actually need.
- Meaningful dated project milestones for `## Project timeline`.
- Consequential decisions and short rationale for `## Decision log`.
- Reusable cross-project knowledge that deserves promotion into `notes/` or `USER.md`.
- Compact records only when the dated history itself is worth retaining.

## What not to persist

- Raw transcript text.
- Task-by-task execution logs.
- Full tool outputs, diffs, or command traces.
- Low-signal chatter, one-off speculation, or facts cheap to re-read from the active repo.
- Scratchpad internals as vault content.

## Project-file discipline

- Keep `projects/*.md` concise and durable.
- Update `## Resume context`, `## Project timeline`, and `## Decision log` instead of appending chatty status notes.
- Prefer promotion and linking over duplicating reusable knowledge across many projects.
- Do not turn project files into issue trackers or sprint logs.

## Scratchpad

- Scratchpad is local extension state passed through the payload/result boundary.
- Use it for pending weak signals, candidate promotions, and carry-forward uncertainty between capture passes.
- Return a bounded, valid scratchpad only when it helps the next capture pass.

## Output contract

- Return strict JSON only.
- Match the Capture Result schema exactly.
- Use `captured` when durable memory changed, `no_changes` when nothing should be written, `skipped` for deliberate no-op capture decisions, and `failed` only when the capture itself could not be completed safely.
