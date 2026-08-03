# Agentic Memory

Agentic Memory is a local-first memory system for AI agents. It gives agents a small, navigable Markdown vault for durable context without forcing them to load an entire note collection into the context window.

This repository is not itself a memory vault. It defines the system, documents the operating model, and provides a clean starter vault from the `@urban/agentic-memory-vault-template` workspace package.

## Why use it

Use Agentic Memory when you want agents to remember useful context across sessions while keeping that memory:

- **plain Markdown** — readable in any editor and friendly to Obsidian
- **local-first and Git-auditable** — owned by the user, reviewable through diffs
- **low-context** — organized for progressive disclosure instead of prompt dumps
- **structured but simple** — maps, projects, notes, people, sources, and records have clear roles
- **portable** — harness-specific instructions can point at the same vault

## How it works

An Agentic Memory vault has two planes:

- **Memory content**: `MEMORY.md`, `USER.md`, `maps/`, `projects/`, `notes/`, `people/`, `sources/`, and `records/`.
- **LLM control plane**: `.agentic-memory/`, which contains mode-specific LLM contracts with the vault version, concise agent instructions, templates, and adapter snippets.

Humans browse and edit the content plane. Agents reach the control plane through one of the entry points below, then load memory in stages: root memory, lean user context, then only the relevant map, project, note, person, record, or source.

## Two agent entry points

Agentic Memory supports two main agent use cases.

### 1. Vault-local memory

Use this when the current working directory is the root of an initialized Agentic Memory vault: it has `.agentic-memory/`, root memory files, content folders, `AGENTS.md`, and `USER.md`.

A coding harness that starts in this directory should automatically read the root `AGENTS.md`. That file is the entry point; it routes the agent to `.agentic-memory/LLM-vault-local.md`, which then routes to `MEMORY.md`, `USER.md`, optional instruction files, and only the relevant memory content. The memory adapter is not needed for this mode.

### 2. Outside-vault memory persistence

Use this when an agent is working outside the Agentic Memory vault but should also preserve durable information in that vault.

After initializing a vault, copy/adapt its `.agentic-memory/adapters/MEMORY_ADAPTER.md` into a harness entry point such as a user-level `AGENTS.md`, `CLAUDE.md`, Pi `APPEND_SYSTEM.md`, or a local project equivalent. The adapter checks whether the current working directory itself contains `.agentic-memory/`; if not, it routes directly to the central vault's `.agentic-memory/LLM-outside-vault.md`, keeps the current project task primary, and uses the vault as secondary memory only when it is useful.

If a global memory adapter is active while the harness starts with a current working directory that contains `.agentic-memory/`, the vault-local entry point wins. The adapter is redundant in that context and should not cause a second cross-project memory flow.

Other patterns, such as Reflection, migration, human browsing in Obsidian, or multiple harnesses sharing one vault, are variants of these two agent entry points rather than separate startup paths.

## Quick start

1. **Install dependencies in this checkout.**

   ```sh
   bun install
   ```

2. **Install the local CLI on your `PATH`.** The CLI package at `packages/cli/` exposes the `agentic-memory` executable. Link it with Bun so every terminal example below works from any directory on this computer:

   ```sh
   cd /absolute/path/to/agentic-memory-repo/packages/cli
   bun link
   bun link -g @urban/agentic-memory-cli
   ```

   Because this is a local link, keep the repository at that path or rerun these commands after moving it. Bun writes global executables to the directory printed by:

   ```sh
   bun pm bin -g
   ```

   Make sure that directory is in your shell `PATH`. With Bun's default macOS/Linux install, add this once to your shell profile (`~/.zshrc`, `~/.bashrc`, or equivalent):

   ```sh
   export PATH="$HOME/.bun/bin:$PATH"
   ```

   Restart your shell or source the profile, then verify the command resolves from outside this repository:

   ```sh
   cd /tmp
   which agentic-memory
   agentic-memory --help
   ```

3. **Create your vault and provision the embedding model.** Use `agentic-memory` to copy the canonical vault template to a permanent local folder that you control:

   ```sh
   agentic-memory init /absolute/path/to/agentic-memory-vault --git --yes
   cd /absolute/path/to/agentic-memory-vault
   ```

   The shared Git-style `-C` flag provides the base directory for relative CLI paths without
   changing the process working directory. For example, this initializes the same vault as the
   absolute-path command above:

   ```sh
   agentic-memory -C /absolute/path/to init agentic-memory-vault --git --yes
   ```

   `init` also ensures the approved embedding model is available in the shared local cache. The first run downloads about 334 MB when the model is absent and reports progress on stderr; later runs reuse it across vaults. Git is optional, but recommended because agents will update plain Markdown and you can review every memory change as a diff. The raw template lives at `packages/vault-template/template/` for manual inspection or copying.

4. **Add the first routing memory.** Open `MEMORY.md` and add only the top-level context future agents should see early: active projects, major domains, and links to maps or project files you expect to create. Keep this file small.

5. **Add stable owner context.** Open `USER.md` and add durable facts about the vault owner, long-lived preferences, communication style, and glossary terms. Keep transient tasks out of this file.

6. **Choose how outside-vault work should connect to the vault.**
   - **Harness adapter route:** copy `.agentic-memory/adapters/MEMORY_ADAPTER.md` from your new vault into the relevant user-level or project-level harness entry point, such as `AGENTS.md`, `CLAUDE.md`, Pi `APPEND_SYSTEM.md`, or another harness-specific instruction file. Replace `/absolute/path/to/memory-vault` with your vault's real absolute path. After that, agents working in other repositories can use the vault for durable memory while keeping the current project instructions primary.
   - **Project-local link route:** from an external project, create a local link to one vault project with:

     ```sh
     agentic-memory -C /absolute/path/to/project link --vault ../agentic-memory-vault --project example-project --yes
     agentic-memory -C /absolute/path/to/project status --json
     ```

     This writes `.agentic-memory-link/config.json` using the `projectSlug` contract, ensures the target project file exists in the vault, ensures `MEMORY.md` routes to it, and validates the link health.

7. **Build the local semantic index.** Indexing is explicit; `init` and `recall` do not index managed Markdown automatically:

   ```sh
   agentic-memory index --vault /absolute/path/to/agentic-memory-vault
   ```

   Vault-oriented commands resolve relative paths from `-C`, so the equivalent contextual form
   is `agentic-memory -C /absolute/path/to index --vault agentic-memory-vault`.

   Run `index` again after changing managed memory; unchanged files are skipped. To safely remove all per-vault derivative index state while preserving Markdown and the shared model, run:

   ```sh
   agentic-memory index --vault /absolute/path/to/agentic-memory-vault --delete
   ```

   Rebuild with the explicit delete command followed by `index`. This is also the recovery sequence when status reports an incompatible or invalid index.

8. **Configure local synthesis and inspect complete Recall readiness.** Recall also requires the separately managed, loopback-only Qwen server described in the [local synthesis setup guide](docs/recall-local-synthesis-setup.md). Start the pinned server, export its endpoint, and inspect both prerequisites:

   ```sh
   export AGENTIC_MEMORY_SYNTHESIS_URL=http://127.0.0.1:8080/v1
   agentic-memory status --vault /absolute/path/to/agentic-memory-vault
   agentic-memory status --vault /absolute/path/to/agentic-memory-vault --json
   ```

   A ready result reports semantic status `ready`, synthesis status `ready`, and `Recall ready: yes`. Missing or invalid configuration, an unavailable server, and an incompatible model alias are normal not-ready status results. Status sends no memory evidence and performs no inference.

   Recall accepts one singular factual question, retrieves only through EmbeddingGemma and libSQL exact-cosine search, hydrates current Markdown, and asks the local Qwen model for one structured grounded claim. Source files are excluded. Unsupported multipart questions and operational failures exit nonzero; absent, insufficient, or conflicting eligible evidence returns `not_found`.

   ```sh
   agentic-memory recall "What latency constraint applies to Alpha retry scheduling?" \
     --vault /absolute/path/to/agentic-memory-vault \
     --json
   ```

9. **Start using the vault with an agent.** Pick one of the two supported entry points:
   - **Vault-local use:** start your coding harness with the vault as the current working directory. The harness should read the root `AGENTS.md`, which routes it into `.agentic-memory/LLM-vault-local.md` and then to the right memory files.
   - **Outside-vault use:** install the adapter route above when you want startup-time durable memory routing outside the vault. Use the project-local link route above when a concrete external project should persist into one specific vault project and tooling such as Pi capture should manage that link.

10. **Optional: add the Pi capture extension to an external project.** From this repository root:

```sh
pi install /absolute/path/to/agentic-memory-repo/packages/pi-memory-capture
```

Or install it only for one project:

```sh
pi install -l /absolute/path/to/agentic-memory-repo/packages/pi-memory-capture
```

Then, inside the target project in Pi:

```text
/memory-capture-init /absolute/path/to/agentic-memory-vault example-project
/memory-capture-status
```

`[[projects/example-project]]` is still accepted by `/memory-capture-init`, but the canonical `0.4.0` identifier is the bare slug `example-project`. The extension uses the same `.agentic-memory-link/config.json` contract as `agentic-memory link` and sends capture runs through `agentic-memory run-steward`.

11. **Let memory grow through use.** During work, ask the agent to create or update maps, projects, notes, people, sources, and records only when the information is durable enough to help future sessions. Review the Markdown changes, commit useful memory, and prune or revise anything that should not persist.

## Semantic index operating notes

- Markdown remains the source of truth. The per-vault `.agentic-memory/index/` database is generated, disposable, and Git-ignored; the shared model is outside the vault, so neither artifact should appear in vault Git status.
- The model cache is `$XDG_CACHE_HOME/agentic-memory/models/` when `XDG_CACHE_HOME` is an absolute path, otherwise `~/.cache/agentic-memory/models/`. The approved `embeddinggemma-300M-Q8_0.gguf` artifact is 333,590,944 bytes (about 334 MB decimal).
- `init` is the only semantic-index command that may use the network. `index` resolves existing local state only; offline initialization succeeds only when the model is already cached. `status --vault` additionally probes the configured loopback synthesis server but never performs inference or sends memory evidence.
- The verified initial native target is Apple silicon macOS (`darwin-arm64`, Metal). Other operating-system and architecture combinations are not yet verified as supported targets. See [semantic stack compatibility](docs/semantic-stack-compatibility.md) for pinned native packages and probe evidence.
- Human-readable results and JSON results go to stdout. Model download progress and operational failures go to stderr, so `--json` stdout remains one machine-readable document.

The template package is intentionally clean: its content folders start empty and `USER.md` is only a scaffold, so a new vault does not inherit example memory. For a concrete reference graph, inspect `examples/basic/`. The example intentionally omits `.agentic-memory/`; pair it with the template control plane if you want to operate it as a full vault.

## Repository layout

```text
docs/                                      # human-facing guides and reference docs
examples/basic/                            # small example memory graph
skills/reflection/                         # companion skill dispatcher for Reflection
migrations/                                # versioned migration guides and migration skills
packages/vault-template/                   # canonical clean copyable Agentic Memory vault
```

## Guides

- [Architecture](docs/architecture.md) — what the vault contains and why the two-plane design exists.
- [Schema](docs/schema.md) — required files, frontmatter, statuses, naming rules, and budgets.
- [Operating model](docs/operating-model.md) — how agents should load, write, promote, and close out memory work.
- [Linking and maps](docs/linking-and-maps.md) — how navigation, memory maps, project routes, and semantic links work.
- [Cross-project persistence](docs/cross-project-persistence.md) — how agents preserve durable memory while working in other repos.
- [Memory adapter](docs/memory-adapter.md) — how to connect outside-vault agents to a central Agentic Memory vault.
- [Capture observability](docs/capture-observability.md) — opt-in local traces and logs for Pi capture and Steward diagnostics.
- [Recall local synthesis setup](docs/recall-local-synthesis-setup.md) — pinned Apple-silicon Qwen server setup and compatibility proof.
- [Reflection workflow](docs/reflection-workflow.md) — maintenance, compaction, graph health, and promotion review.
- [Migration](docs/migration.md) — migration philosophy and versioned migration structure.
