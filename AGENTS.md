# AGENTS

This repository defines Agentic Memory.

## Read first

1. `README.md`
2. `docs/architecture.md`
3. The specific doc, template, skill, or migration relevant to the task

## Scope

- Human-facing docs live in `docs/`.
- Copyable vault implementation lives in `template/`.
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
