# Cross-Project Persistence

Cross-project persistence is the common outside-vault Agentic Memory workflow: agents working outside a central memory vault use that vault as persistent secondary memory.

A global or project-level memory adapter points the harness at the vault by absolute path, checks whether the current working directory contains `.agentic-memory/`, and routes outside-vault sessions to `.agentic-memory/LLM-outside-vault.md` in the central vault. The agent's primary responsibility is still the current task in the current project. Its secondary responsibility is to preserve durable, high-signal memory that will help future sessions and future projects.

When the current working directory contains `.agentic-memory/`, this mode is not needed; use the vault-local `AGENTS.md` entry point instead.

## Project-local links and CLI setup

Some outside-vault workflows also keep a local project-to-vault link at:

```text
.agentic-memory-link/config.json
```

The `0.4.0` contract uses a bare `projectSlug`, not a wiki-link:

```json
{
  "version": 1,
  "vaultPath": "/absolute/path/to/agentic-memory-vault",
  "projectSlug": "example-project"
}
```

Create or refresh that local link with the CLI:

```sh
agentic-memory link --vault /absolute/path/to/agentic-memory-vault --project example-project --project-root /absolute/path/to/project --yes
```

This command also ensures `projects/example-project.md` exists in the vault, ensures `MEMORY.md` routes to `[[projects/example-project]]`, and attempts to add `.agentic-memory-link/` to `.git/info/exclude` in the external project.

Inspect the resulting health with:

```sh
agentic-memory status --project-root /absolute/path/to/project --json
```

Humans and setup tools usually use `init`, `link`, and `status` directly. Harness integrations should treat `agentic-memory run-steward` as the stable steward execution boundary rather than calling internal core modules directly.

## Purpose

Most agent sessions are project-oriented. A session should usually correspond to:

- an existing project in `projects/`
- an umbrella project that routes several subprojects
- a project candidate that may become durable after repeated sessions

Project memory helps the agent resume work without storing full chat logs or re-reading unnecessary source files. The best memory eventually transcends a single project and becomes reusable atomic knowledge.

## What belongs in project memory

Project files should capture high-level information that is not cheaply derived from source files:

- purpose, goals, and objectives
- durable current state
- key decisions and rationale
- open questions and unresolved tradeoffs
- next useful context for future sessions
- routing to records, notes, maps, sources, people, repos, or subprojects
- user observations that arose in the project and may matter elsewhere

Do not store routine implementation facts, source-code summaries, or file details that future agents can cheaply re-read from the repository.

## User observations

Some project observations are really about the user of the memory system:

- how the user communicates
- what certain phrases mean to the user
- how the user likes responses formatted
- prompting and LLM workflow patterns
- repeated tech-selection rationale
- recurring decision heuristics

Store compact stable user context in `USER.md`. If the pattern needs detail, evidence, or semantic links, create or update an atomic note in `notes/` and link to it from `USER.md` and relevant project files.

Use confidence labels:

- **Explicit** — the user stated it directly.
- **Repeated** — observed across projects or many sessions.
- **Observed** — observed in one project or a small number of sessions.
- **Inferred** — plausible but lower-confidence; verify before relying on it.

## Promotion into reusable memory

Project files are staging areas for discoveries. They should not become the permanent home for patterns that apply across projects.

Promote project-specific observations into `notes/` or `USER.md` when they are:

- repeated across two or more projects or many sessions
- useful for future decisions beyond the source project
- not cheaply re-derived from current project files
- expressible as one reusable idea, preference, rationale, workflow, or pattern
- stable enough to trust, or explicitly marked as inferred / lower-confidence
- better represented once than duplicated in many project files

After promotion:

1. create or update the atomic note or `USER.md` entry
2. link originating project files to the new source of truth
3. remove or compact duplicate project-local wording when safe
4. preserve dated history in `records/` if the evolution matters

## Projects versus maps

Use `projects/` when the file tracks an effort's state, goals, decisions, and open loops.

Use `maps/` when the file frames a domain or category and routes to supporting projects, notes, records, people, or sources.

An umbrella effort can start as a project when it has active state. Later, if its main value becomes organizing a reusable domain, create or update a memory map and leave the completed/archived project as historical state.

## Session close behavior

At natural stopping points, agents should proactively evaluate what future sessions need to remember and make the smallest useful memory update without requiring explicit prompting.

Typical updates:

- update an existing project file's current state or open questions
- create a project candidate when repeated work suggests a recurring effort
- add a compact record for meaningful work, decisions, or handoff context
- update `USER.md` for stable owner facts or communication preferences
- promote repeated patterns into atomic notes
- update maps when routing changes

Do not derail the current task for memory maintenance. Prefer small, reviewable, Git-auditable edits.

## Pi capture extension

The Pi Memory Capture extension is one concrete outside-vault integration built on the same local link contract.

- It is opt-in per project and stays inert until `.agentic-memory-link/config.json` exists and is valid.
- It captures bounded visible user/assistant text only, not raw transcripts, tool output, diffs, or hidden reasoning.
- It runs periodic `agent_end` capture, and forced flushes on `session_before_tree` and `session_shutdown`.
- It sends steward work through `agentic-memory run-steward`, which launches an isolated Pi Memory Steward process inside the vault.

Use `/memory-capture-init /absolute/path/to/agentic-memory-vault example-project` inside Pi to create the link interactively. `[[projects/example-project]]` is still accepted there, but the canonical `0.4.0` identifier is the bare slug `example-project`.
