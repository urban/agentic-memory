# Session Capture

Guidance for Memory Steward capture passes invoked from work outside the vault.

## Inputs

- Treat the Capture Payload as the authoritative bounded session input.
- Use only visible user/assistant text and the project route in the payload.
- Do not reconstruct hidden reasoning, tool-call internals, raw transcript logs, image content, omitted tool output, or omitted repository state.

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

## Decision report

- Return a bounded `decisionReport` for both `captured` and `no_changes` outcomes.
- Summarize observable rationale only; do not reveal hidden reasoning or chain-of-thought.
- Explain why selected destinations were appropriate and why plausible destinations were skipped.
- Do not quote raw transcript text, raw prompts, tool output, command output, diffs, secrets, or unbounded generated text.
- Use concise non-sensitive prose for `decisionSummary`, destination `reason` fields, durable signals, duplicate signals, and privacy notes.

## Output contract

- Return strict JSON only.
- Match the Capture Result schema exactly.
- Use `captured` when durable memory changed and `no_changes` when nothing should be written.
- Include `filesChanged` and `warnings` arrays when present.
- Include `decisionReport` with `decisionSummary`, `durability`, `selectedDestinations`, `skippedDestinations`, `durableSignals`, `duplicateSignals`, and `privacyNotes`.
- Use memory layer values `MEMORY`, `USER`, `project`, `notes`, `maps`, `records`, `people`, or `sources`.
