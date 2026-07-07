# Agentic Memory CLI

Workspace package for the `agentic-memory` executable. The CLI initializes Agentic Memory vaults, links external projects to vault projects, checks link health, answers recall questions, and provides the stable Memory Steward boundary used by capture integrations.

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

## Common workflows

### Initialize a vault

```sh
agentic-memory init /absolute/path/to/agentic-memory-vault --git --yes
```

Creates an Agentic Memory vault from the bundled template. `--git` initializes a Git repository when needed, and `--yes` confirms safe non-interactive setup.

### Link an external project

```sh
agentic-memory link \
  --vault /absolute/path/to/agentic-memory-vault \
  --project example-project \
  --project-root /absolute/path/to/project \
  --yes
```

This writes `.agentic-memory-link/config.json` in the project root, ensures `projects/example-project.md` exists in the vault, ensures `MEMORY.md` routes to that project, and attempts to exclude `.agentic-memory-link/` from the project's Git worktree.

Project identifiers are bare lowercase slugs such as `example-project`, not wiki links.

### Check link health

```sh
agentic-memory status --project-root /absolute/path/to/project --json
```

Reports whether the project-local link exists, whether it is valid, and whether the linked vault has the expected project file and `MEMORY.md` route.

### Recall from a vault

```sh
agentic-memory recall "What should I remember about Example Project?" \
  --vault /absolute/path/to/agentic-memory-vault
```

Answers a natural-language question using the Agentic Memory vault.

### Build Steward context

```sh
agentic-memory steward-context --payload payload.json --project-root . --json
```

Builds the context bundle for Memory Steward workflows. Use `--payload -` to read the capture payload from standard input.

### Run the Memory Steward

```sh
agentic-memory run-steward --payload - --project-root . --json
```

Runs the isolated Memory Steward process for a capture payload. Harness integrations should use this command as the stable execution boundary instead of calling internal modules directly.

For direct mode, provide both `--vault` and `--project`:

```sh
agentic-memory run-steward \
  --payload payload.json \
  --vault /absolute/path/to/agentic-memory-vault \
  --project example-project \
  --json
```

## Command reference

| Command                                                                      | Purpose                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------- |
| `agentic-memory init <vault-path>`                                           | Initialize a vault from the bundled template. |
| `agentic-memory link --vault <vault> --project <slug> --project-root <path>` | Link a project root to a vault project.       |
| `agentic-memory status --project-root <path>`                                | Inspect project-local link and vault health.  |
| `agentic-memory recall <question> --vault <vault>`                           | Answer a memory question from a vault.        |
| `agentic-memory steward-context --payload <path-or->`                        | Build Steward context for a capture payload.  |
| `agentic-memory run-steward --payload <path-or->`                            | Execute the Memory Steward capture boundary.  |

Add `--json` to supported commands when a script or integration needs machine-readable output.

## Development

From this package directory:

```sh
bun run check
```

From the repository root:

```sh
bun --filter='./packages/cli' run check
```
