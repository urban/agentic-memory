# Agentic Memory CLI

Workspace package for the `agentic-memory` executable. The CLI initializes Agentic Memory vaults, manages their local semantic indexes, reports semantic readiness and project-link health, answers recall questions, and provides the stable Memory Steward boundary used by capture integrations.

## Install `agentic-memory` on your `PATH`

From a local checkout of this repository:

```sh
bun install
cd /absolute/path/to/agentic-memory/packages/cli
bun link
bun link -g @urban/agentic-memory-cli
```

This exposes the executable as `agentic-memory`. Because this is a local link, keep the repository at that path or rerun the link commands after moving it.

Bun writes global executables to the directory printed by:

```sh
bun pm bin -g
```

Make sure that directory is in your shell `PATH`. With Bun's default macOS/Linux install, add this once to your shell profile (`~/.zshrc`, `~/.bashrc`, or equivalent):

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

If `bun pm bin -g` prints a different directory, add that directory instead:

```sh
export PATH="/path/printed/by/bun-pm-bin-g:$PATH"
```

Restart your shell or source the profile, then verify the CLI resolves from outside this repository:

```sh
cd /tmp
which agentic-memory
agentic-memory --help
```

All examples below assume `agentic-memory` is available on `PATH`; that is the default supported invocation form.

## Resolve paths from another directory

The shared Git-style `-C <directory>` flag makes that existing directory the base for relative
vault paths without changing process state. The CLI resolves and reports vault paths as absolute
paths. For example:

```sh
agentic-memory -C /absolute/path/to init agentic-memory-vault --git --yes
agentic-memory -C /absolute/path/to index --vault agentic-memory-vault
agentic-memory -C /absolute/path/to recall "What should I remember?" --vault agentic-memory-vault
agentic-memory -C /absolute/path/to status --vault agentic-memory-vault
```

Without `-C`, relative paths resolve from the real invocation directory.

## Common workflows

### Initialize a vault

```sh
agentic-memory init /absolute/path/to/agentic-memory-vault --git --yes
```

Creates an Agentic Memory vault from the bundled template. `--git` initializes a Git repository when needed, and `--yes` confirms safe non-interactive setup.

Initialization also installs the approved 333,590,944-byte (about 334 MB) embedding model when it is not already in the shared cache. Download progress is written to stderr. The cache is `$XDG_CACHE_HOME/agentic-memory/models/` when `XDG_CACHE_HOME` is absolute and `~/.cache/agentic-memory/models/` otherwise. Rerunning `init` reuses a valid cached model.

`init` is the only semantic workflow that may download. The verified initial native target is Apple silicon macOS; see the repository's [semantic stack compatibility note](../../docs/semantic-stack-compatibility.md) for the supported native stack evidence.

### Build a vault semantic index

```sh
agentic-memory index --vault /absolute/path/to/agentic-memory-vault
```

This explicitly creates or incrementally updates generated per-vault state from managed Markdown. Repeated runs skip unchanged files. `index` is local-only and fails if the model is absent; run `init` to provision it. Indexing is never triggered automatically by `init` or `recall`.

Delete only the generated per-vault database and related derivative files with:

```sh
agentic-memory index --vault /absolute/path/to/agentic-memory-vault --delete
```

Deletion preserves Markdown and the shared model and is safe to repeat. Use the delete flag, then run `index` again to recover when vault status reports an incompatible or invalid index.

### Check Recall readiness

```sh
agentic-memory status --vault /absolute/path/to/agentic-memory-vault
agentic-memory status --vault /absolute/path/to/agentic-memory-vault --json
```

Vault mode inspects the vault, embedding model, semantic index, and configured local synthesis server without downloading, loading a model for inference, sending memory evidence, or modifying the database. It reports `ready` only when the semantic index is current and synthesis is ready. Synthesis status distinguishes missing or invalid configuration, an unavailable server, an incompatible or missing fixed model alias, and ready. A completed inspection exits successfully even for `not_ready` or `invalid`; execution or encoding failures are nonzero.

Synthesis checks call only the configured loopback server's `/v1/health` and `/v1/models` endpoints with a three-second timeout, no retries, and redirects disabled. Follow the repository's [local synthesis setup guide](../../docs/recall-local-synthesis-setup.md) before expecting Recall readiness.

### Link an external project

```sh
agentic-memory -C /absolute/path/to/project link \
  --vault /absolute/path/to/agentic-memory-vault \
  --project example-project \
  --yes
```

This writes `.agentic-memory-link/config.json` in the project root, ensures `projects/example-project.md` exists in the vault, ensures `MEMORY.md` routes to that project, and attempts to exclude `.agentic-memory-link/` from the project's Git worktree.

Project identifiers are bare lowercase slugs such as `example-project`, not wiki links.

### Check link health

```sh
agentic-memory -C /absolute/path/to/project status --json
```

Reports whether the project-local link exists, whether it is valid, and whether the linked vault has the expected project file and `MEMORY.md` route.

This is the separate project-link status mode. Use `--vault` for semantic readiness and `-C` for link health at an external project.

### Recall from a vault

Start the pinned, user-managed local Qwen server and export its loopback endpoint as described in the [local synthesis setup guide](../../docs/recall-local-synthesis-setup.md). Then ask one singular factual question:

```sh
agentic-memory recall "What should I remember about Example Project?" \
  --vault /absolute/path/to/agentic-memory-vault \
  --json
```

Recall requires a current semantic index, embeds the question with EmbeddingGemma, searches through libSQL exact cosine ordering, hydrates current Markdown, prepares bounded safe evidence, and synthesizes at most one grounded claim through the local Qwen model. Source files are always excluded; there is no source-inclusion flag, lexical fallback, deterministic answer fallback, hosted fallback, or public provider/model selector.

Public JSON contains only `status`, `question`, `answer`, and `warnings`. Absent, insufficient, or unresolvedly conflicting eligible evidence returns `not_found`. Multipart input and operational failures exit nonzero with actionable guidance.

### Build Steward context

```sh
agentic-memory -C /absolute/path/to/project steward-context --payload payload.json --json
```

Builds the context bundle for Memory Steward workflows. Use `--payload -` to read the capture payload from standard input.

### Run the Memory Steward

```sh
agentic-memory -C /absolute/path/to/project run-steward --payload - --json
```

Runs the isolated Memory Steward process for a capture payload. Harness integrations should use this command as the stable execution boundary instead of calling internal modules directly.

For direct mode, provide both `--vault` and `--project`:

```sh
agentic-memory -C /absolute/path/to/project run-steward \
  --payload payload.json \
  --vault /absolute/path/to/agentic-memory-vault \
  --project example-project \
  --json
```

## Command reference

| Command                                                             | Purpose                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `agentic-memory init <vault-path>`                                  | Initialize a vault and ensure the shared model is installed. |
| `agentic-memory index --vault <vault>`                              | Create or incrementally update local derivative index state. |
| `agentic-memory index --vault <vault> --delete`                     | Delete only local derivative index state.                    |
| `agentic-memory -C <project> link --vault <vault> --project <slug>` | Link a project root to a vault project.                      |
| `agentic-memory status --vault <vault>`                             | Inspect semantic and local synthesis readiness.              |
| `agentic-memory -C <project> status`                                | Inspect project-local link and vault health.                 |
| `agentic-memory recall <question> --vault <vault>`                  | Answer a memory question from a vault.                       |
| `agentic-memory steward-context --payload <path-or->`               | Build Steward context for a capture payload.                 |
| `agentic-memory run-steward --payload <path-or->`                   | Execute the Memory Steward capture boundary.                 |

Add `--json` to supported commands when a script or integration needs machine-readable output.

Human and JSON results use stdout. Model download progress and operational failures use stderr, preserving a single JSON document on stdout. Apart from model installation during `init`, semantic index commands are offline; status may contact only the configured loopback synthesis server. Generated databases are under the Git-ignored `.agentic-memory/index/`; models never live in the vault.

## Development

From this package directory:

```sh
bun run check
```

From the repository root:

```sh
bun --filter='./packages/cli' run check
```
