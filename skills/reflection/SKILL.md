---
name: agentic-memory-reflection
version: 0.3.0
description: Dispatch to the local Agentic Memory Reflection instructions for a vault.
---

# Agentic Memory Reflection Dispatcher

Use this skill when the user asks to reflect, compact, dream, lint, consolidate, or improve an Agentic Memory vault.

This skill is intentionally thin. Reflection rules are version-specific and live inside each vault.

## Procedure

1. Locate or confirm the Agentic Memory vault root.
2. Confirm the vault has:
   - `AGENTS.md`
   - `MEMORY.md`
   - `.agentic-memory/LLM-vault-local.md`
   - `.agentic-memory/instructions/reflection.md`
3. Read `.agentic-memory/LLM-vault-local.md`.
4. Read `.agentic-memory/instructions/reflection.md`.
5. Follow the local Reflection instructions exactly.

## Missing instructions

If `.agentic-memory/instructions/reflection.md` is missing, stop and ask the user how to proceed.

Do not improvise a major Reflection workflow from this skill file alone.

## Boundaries

- Do not copy raw session logs into the vault.
- Do not delete, archive, split, merge, or materially rewrite memory without approval.
- Do not commit to Git automatically.
- Prefer local vault instructions over repository docs because the local instructions match the vault's Agentic Memory version.
