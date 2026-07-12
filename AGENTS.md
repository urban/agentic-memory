# AGENTS

This repository defines Agentic Memory.

## Read first

1. `README.md`
2. `docs/architecture.md`
3. The specific doc, template, skill, or migration relevant to the task

## Scope

- Human-facing docs live in `docs/`.
- Copyable vault implementation lives in `packages/agentic-memory-vault-template/template/`.
- Companion skills live in `skills/`.
- Versioned migration guides and skills live in `migrations/`.

## Development Workflow

- The git base branch is `main`
- Use `bun` as the package manager

After making changes, run `bun run check` to run all validations. This will check
for linting errors, formatting issues, type errors, and run test.

## Code Quality Standards

- Always verify the exact API shape by checking signatures, parameter types, return types, setup patterns and test usage.
- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- **Make illegal states unrepresentable**: Model domain with ADTs/discriminated unions; parse inputs at boundaries into typed structures; if state can't exist, code can't mishandle it
- **Never suppress deterministic feedback**: Do not disable, mute, or bypass Effect diagnostics or linting rules with inline comments, config exceptions, or command flags. Fix the underlying issue instead so validation remains deterministic.

## Architecture and Separation of Concerns

Design orthogonal modules: changing one concern should not require changes to unrelated concerns.

- Give each module one clear responsibility and one small interface. Keep implementation details private to the module that owns them.
- Separate domain policy from mechanisms and adapters. Domain behavior must not depend on CLI parsing, filesystem layout, provider response shapes, benchmark fixtures, or other delivery details.
- Put each fact, rule, and transformation in one owning module. Callers should use that module's interface rather than duplicate its knowledge.
- Keep dependencies directional. Higher-level workflows may compose lower-level modules; lower-level modules must not import callers or encode caller-specific behavior.
- Depend on public package exports. Do not reach into another package's private source files or make callers reproduce its internal conventions.
- Keep public contracts expressed in user-facing domain terms. Do not expose internal paths, document organization, link syntax, memory layers, provider metadata, ranking details, or implementation traces unless they are explicitly part of an approved public contract.
- Treat tests as callers of the interface. Black-box and cross-package tests must assert public behavior only; tests that know implementation details belong in the package that owns that implementation.
- Keep fixtures opaque across seams. A consumer may supply a fixture through a public input, but must not inspect its internal structure to determine expected behavior.
- Avoid pass-through abstractions. Add a seam only when it hides meaningful complexity or when multiple adapters genuinely vary behind the same interface.
- When a change mixes concerns, split it into independently named modules before extending behavior. If two parts must change together, make the ownership relationship explicit and verify that the dependency points in one direction.

Before completing a change, check:

1. Can the implementation change without forcing unrelated callers or tests to change?
2. Does each piece of domain knowledge have exactly one owner?
3. Do cross-package tests know only public inputs and outputs?
4. Have internal implementation details stayed behind their owning interface?

## External Libraries

This project vendors external repositories under `.dotai/repos/`

- Use vendored repositories as read-only reference material when working with related libraries
- Distrust your built-in knowledge for external libraries, frameworks, and tools.
- Prefer library source and tests over docs.
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Before using a third party API, check the source code in `.dotai/repos/<library>` first.
- If `.dotai/repos/<library>` does not exist, run `git clone --depth 1 <library_url> .dotai/repos/<library>` to clone the library.
- Do not edit files under `.dotai/repos/`
- Do not import from `.dotai/repos/` - application code should continue importing from normal package dependencies

### Effect

When writing Effect code, inspect `.dotai/repos/effect/` for examples of idiomatic usage, tests, module structure, and API design. The `.dotai/repos/effect/LLMS.md` is an authoritative source for information about Effect patterns. Treat it as the source of truth for Effect patterns.
