# Pi Memory Capture

Pi Memory Capture is a Pi extension for Agentic Memory. It lets an explicitly initialized project capture durable, high-signal session context into a central Agentic Memory vault without saving raw transcripts or tool output.

## What it does

After you initialize a project, the extension:

- watches Pi session-boundary events such as compaction, shutdown, tree navigation, fork, and clone
- captures only bounded visible user/assistant text from the current branch since the last successful capture marker
- keeps local capture state in `.pi/agentic-memory-capture/`
- invokes an isolated Memory Steward Pi process in the target vault
- lets the Memory Steward update the smallest appropriate Agentic Memory files, such as `projects/*.md`, `notes/*.md`, `USER.md`, or occasional `records/*.md`
- stores minimal Pi custom-entry markers so later capture passes do not duplicate successful work

The extension is opt-in per project. Automatic capture is enabled only when `.pi/agentic-memory-capture/config.json` exists and is valid.

## What it does not capture

The v1 capture payload intentionally excludes:

- raw Pi session logs
- raw tool calls or tool results
- command output dumps
- full file outputs, diffs, or hidden reasoning
- project-local/global prompts, skills, or extensions in the Memory Steward process

## Requirements

- Pi installed, authenticated, and runnable as `pi` from your shell
- an Agentic Memory vault with `.agentic-memory/LLM-outside-vault.md`
- this repository's dependencies installed with Bun

From the Agentic Memory repository root:

```bash
bun install
```

If the Memory Steward child process should use a non-default Pi binary, set:

```bash
export PI_MEMORY_CAPTURE_PI_BIN=/absolute/path/to/pi
```

## Install

This package is currently intended for local checkout installation.

### Global install for all Pi projects

```bash
pi install /absolute/path/to/agentic-memory/packages/pi-memory-capture
```

The extension loads globally, but automatic capture still does nothing until each project is initialized.

### Project-local install

From the project where you want the extension available:

```bash
pi install -l /absolute/path/to/agentic-memory/packages/pi-memory-capture
```

`-l` writes the package entry to project-local `.pi/settings.json`.

### Manual symlink install

You can also place the extension in Pi's auto-discovery directory:

```bash
mkdir -p ~/.pi/agent/extensions/pi-memory-capture
ln -s /absolute/path/to/agentic-memory/packages/pi-memory-capture/src/index.ts \
  ~/.pi/agent/extensions/pi-memory-capture/index.ts
```

Use `.pi/extensions/pi-memory-capture/index.ts` instead of `~/.pi/agent/extensions/...` for a project-local symlink.

Reload Pi after installation with `/reload`, or start a new Pi session.

## Initialize a project

In the target project, run:

```text
/memory-capture-init /absolute/path/to/agentic-memory-vault [[projects/example-project]]
```

If arguments are omitted, the command prompts for them in interactive Pi. You may also set a default vault path:

```bash
export AGENTIC_MEMORY_VAULT=/absolute/path/to/agentic-memory-vault
```

Initialization validates the vault, writes `.pi/agentic-memory-capture/config.json` and `scratchpad.json`, may create the target project file after confirmation, ensures a route in `MEMORY.md`, and adds `.pi/agentic-memory-capture/` to `.git/info/exclude` when possible.

## Commands

- `/memory-capture-init [vaultPath] [projectLink]` — initialize or update capture config for the current project
- `/memory-capture` — run a manual capture pass
- `/memory-capture-status` — show config, latest capture/failure marker, automatic-capture state, and pending scratchpad candidates

Automatic capture runs at natural task boundaries and is timeout-bounded/fail-open so it should not cancel session operations.
