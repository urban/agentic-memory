# Semantic stack compatibility proof

This note records the Phase 0 feasibility gate and the sustained production lifecycle proof for the local semantic-index stack. The probe is advisory evidence for the initial supported target, not a normal test or CI dependency.

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

`EmbeddingModelLive` now owns one lazy embedding session per application layer. Constructing the CLI runtime, explicit model inspection and installation, status inspection, and a current no-op index do not acquire native inference resources. The first embedding request validates the artifact and acquires one node-llama-cpp runtime, one loaded model, and one embedding context. Calls within that layer are serialized through the same context. Closing the CLI runtime finalizes the context, model, and runtime once in that order.

The opt-in probe exercises the actual CLI entry point and production `EmbeddingModelLive`, semantic-index, Recall, and `ManagedRuntime` composition. It proves:

- Bun loads the pinned Metal/arm64 node-llama-cpp binary and pinned native libSQL binary.
- `init` validates the exact cached artifact without acquiring a native inference session.
- One changed-index process indexes 34 managed documents and 34 embedding inputs with one runtime, one model, and one context.
- The index process reports lifecycle events in the order `runtime_acquired → model_acquired → context_acquired → context_disposed → model_disposed → runtime_disposed`.
- The resulting index is current and Recall-ready, and normal completion leaves no `index.lock`.
- All 34 stored vectors can be extracted from libSQL and are finite, 768-dimensional values.
- A separate real Recall process embeds a query, executes exact-cosine search, returns an answer, and finalizes its one native session in the same order.

No package-install, Bun native-runtime, vector-type, model-format, lifecycle-reuse, or unguarded Metal blocker was found on the verified target.

## Running the opt-in probe

The probe downloads the 333 MB model only when it is absent from the XDG-compatible cache. It is intentionally excluded from `bun run check`. Run it with `GGML_METAL_NO_RESIDENCY` absent; the probe rejects a guarded environment rather than silently changing Metal behavior.

```sh
unset GGML_METAL_NO_RESIDENCY
AGENTIC_MEMORY_SEMANTIC_PROBE=1 bun run --cwd packages/core probe:semantic-stack
```

Set `XDG_CACHE_HOME` to test another cache root. Without the opt-in environment variable, the command exits before network access or native model loading. During the explicit probe only, `EmbeddingModelLive` writes acquisition and finalization evidence to stderr; normal commands do not emit these diagnostics.

## Sustained lifecycle observations

Verified on 2026-07-28 with Bun 1.3.14, node-llama-cpp 3.19.1, llama.cpp prebuilt release `b10068`, macOS Darwin 25.5.0, and Apple arm64 Metal. `GGML_METAL_NO_RESIDENCY` was unset. These are advisory single-run end-to-end observations, not performance gates.

- Initialization with an already cached and validated model: `925.6 ms`; no runtime, model, or context acquired.
- Production indexing of 34 managed documents and 34 serial embedding inputs: `13631.1 ms`; one runtime, one model, and one context acquired and finalized once.
- Post-index status inspection: `692.8 ms`; `index.status` was `current`, `recallReady` was `true`, and no lock remained.
- Production Recall with one query embedding and exact search: `2323.2 ms`; exit code zero and one orderly native-session lifecycle.
- Stored-vector validation: all 34 generated vectors contained exactly 768 finite values.
- Unguarded Metal result: passed with process exit code zero for initialization, indexing, status, and Recall; no `GGML_METAL_NO_RESIDENCY` guardrail is required by this evidence.

The earlier 2026-07-21 Phase 0 hand-built smoke observation measured a `10952.4 ms` cold model/context load, a `263.9 ms` one-vector embedding, and `1023.8 MiB` peak RSS. The sustained proof supersedes that hand-built path as the compatibility gate because it measures production composition; the earlier figures remain historical context rather than release thresholds.
