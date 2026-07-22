# Semantic stack compatibility proof

This note records the Phase 0 feasibility gate for the local semantic-index stack. The probe is advisory evidence for the initial supported target, not a normal test or CI dependency.

## Pinned stack

- `node-llama-cpp`: `3.19.1`
- `@libsql/client`: `0.17.4`
- native `libsql`: `0.5.29`
- native platform package on the verified target: `@libsql/darwin-arm64@0.5.29`
- `node-llama-cpp` platform package on the verified target: `@node-llama-cpp/mac-arm64-metal@3.19.1`

The package manifest and Bun lockfile pin these versions. The explicit `libsql` dependency prevents `@libsql/client`'s `^0.5.28` range from silently selecting another native ABI.

## Model contract

- Canonical URI: `hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf`
- Canonical filename: `embeddinggemma-300M-Q8_0.gguf`
- Hugging Face repository revision at verification: `0f741b5a6585bd53aeb15cd1372c56f2a0f65e12`
- Artifact size: `333590944` bytes
- Artifact SHA-256: `b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63`
- GGUF magic: `GGUF`
- Embedding dimensions: `768`
- Runtime normalization: node-llama-cpp/llama.cpp's default normalized embedding output

The immutable checksum is the Hugging Face linked artifact ETag and is independently recomputed by the probe before inference. The loaded model metadata and generated vector must both report 768 dimensions, and every generated value must be finite.

## License obligations

EmbeddingGemma is licensed under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms), including the incorporated [Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy). Local use must comply with those use restrictions. If Agentic Memory later distributes the model or a derivative rather than downloading it for local use, the distribution must provide the agreement and use-restriction notice, mark modified files, and include the required `Notice` text. The application must not imply that the Gemma trademark denotes Google endorsement.

The GGUF repository is public and ungated, but that availability does not replace the base model's terms.

## Verified behavior

The opt-in probe proves:

- Bun can load the pinned Metal/arm64 node-llama-cpp binary and pinned native libSQL binary.
- `resolveModelFile` with `download: false` fails for an empty cache and resolves the exact cached artifact without network fallback.
- The artifact checksum and GGUF magic match the model contract.
- node-llama-cpp loads the model, creates one 768-value finite embedding, and disposes the context, model, and runtime.
- libSQL creates a temporary `F32_BLOB(3)` table, inserts vectors through `vector32(?)`, returns the expected exact `vector_distance_cos` top-K order, persists an update, deletes a row, closes the client, and permits database removal.

No package-install, Bun native-runtime, vector-type, model-format, or license blocker was found on the verified target.

## Running the opt-in probe

The probe downloads the 333 MB model only when it is absent from the XDG-compatible cache. It is intentionally excluded from `bun run check`.

```sh
AGENTIC_MEMORY_SEMANTIC_PROBE=1 bun run --cwd packages/core probe:semantic-stack
```

Set `XDG_CACHE_HOME` to test another cache root. Without the opt-in environment variable, the command exits before network access or native model loading.

## Observations

Verified on 2026-07-21 with Bun 1.3.14, Node 26.5.0, macOS Darwin 25.3.0, and Apple arm64. These are advisory single-run observations, not performance gates. Model load includes creation of the embedding context; peak RSS is the process high-water mark reported by Bun.

- Cold process model and context load: `10952.4 ms`
- One-vector embedding: `263.9 ms`
- Peak RSS: `1023.8 MiB`
