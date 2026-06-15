# Agentic Memory Adapter

Central Agentic Memory vault:

`/absolute/path/to/memory-vault`

At startup:

1. If the current working directory contains `.agentic-memory/`, stop using this adapter. The harness is already inside an Agentic Memory vault; follow that directory's local entry point instead. Do not check ancestor directories.
2. If the current working directory does not contain `.agentic-memory/`, keep the current project instructions primary. When durable memory is useful, read `.agentic-memory/LLM-outside-vault.md` located within the Central Agentic Memory vault.
