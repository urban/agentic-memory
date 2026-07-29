# Semantic stack support and verification

This note defines the verified native target for the local semantic-index stack and the opt-in procedure used to validate production compatibility. It is a support record and maintainer runbook, not a performance benchmark or normal CI dependency.

## Support status

The verified target is Apple silicon macOS (`darwin-arm64`) using Metal. Other operating-system and architecture combinations are not yet verified as supported targets, even if their native packages install successfully.

Normal `bun run check` remains model-free. Native runtime, model, vector-storage, and end-to-end CLI compatibility are covered by the explicit probe described below.

## Verified stack

- `node-llama-cpp`: `3.19.1`
- `@libsql/client`: `0.17.4`
- native `libsql`: `0.5.29`
- verified libSQL platform package: `@libsql/darwin-arm64@0.5.29`
- verified node-llama-cpp platform package: `@node-llama-cpp/mac-arm64-metal@3.19.1`

The package manifest and Bun lockfile are the source of truth for dependency versions. The explicit `libsql` dependency prevents `@libsql/client`'s compatible-version range from silently selecting a different native ABI.

## Model contract

- Canonical URI: `hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf`
- Canonical filename: `embeddinggemma-300M-Q8_0.gguf`
- Artifact size: `333590944` bytes
- Artifact SHA-256: `b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63`
- GGUF magic: `GGUF`
- Embedding dimensions: `768`
- Runtime normalization: node-llama-cpp/llama.cpp's default normalized embedding output

The application validates the artifact checksum and GGUF magic before inference. The loaded model metadata and every generated vector must report 768 dimensions, and every generated value must be finite.

## Third-party terms

EmbeddingGemma is subject to terms and use restrictions separate from Agentic Memory. See the repository's [third-party notices](../THIRD_PARTY_NOTICES.md) for the model source, governing terms, and distribution notice.

## Production lifecycle contract

`EmbeddingModelLive` owns one lazy embedding session per application layer:

- Constructing the CLI runtime, inspecting or installing the model, checking status, and running a current no-op index do not acquire native inference resources.
- The first embedding request validates the artifact and acquires one node-llama-cpp runtime, one loaded model, and one embedding context.
- Embedding calls within the layer are serialized through that context.
- Closing the CLI runtime finalizes the context, model, and runtime once, in dependency order.

The opt-in probe exercises the real CLI entry point and production `EmbeddingModelLive`, semantic-index, Recall, and `ManagedRuntime` composition. It verifies that:

- Bun loads the pinned Metal/arm64 node-llama-cpp and native libSQL binaries.
- `init` validates the cached artifact without acquiring an inference session.
- A multi-document index run reuses one runtime, model, and context.
- Native resources are acquired and finalized in the expected order.
- Stored vectors are finite and 768-dimensional.
- The resulting index is current and Recall-ready, with no remaining `index.lock`.
- A separate Recall process embeds a query, performs exact-cosine search, returns an answer, and finalizes its native session.

## Running the opt-in probe

The probe downloads the approximately 334 MB model only when it is absent from the XDG-compatible cache. Run it with `GGML_METAL_NO_RESIDENCY` absent; the probe rejects a guarded environment rather than silently changing Metal behavior.

```sh
unset GGML_METAL_NO_RESIDENCY
AGENTIC_MEMORY_SEMANTIC_PROBE=1 bun run --cwd packages/core probe:semantic-stack
```

Set `XDG_CACHE_HOME` to test another cache root. Without `AGENTIC_MEMORY_SEMANTIC_PROBE=1`, the command exits before network access or native model loading. During the explicit probe only, `EmbeddingModelLive` writes acquisition and finalization evidence to stderr; normal commands do not emit these diagnostics.

## Latest verification

Last verified on 2026-07-28 with Bun 1.3.14, node-llama-cpp 3.19.1, llama.cpp prebuilt release `b10068`, macOS Darwin 25.5.0, and Apple arm64 Metal. `GGML_METAL_NO_RESIDENCY` was unset.

The production probe successfully initialized a temporary vault, indexed 34 managed documents and validated all 34 stored vectors, reported a current and Recall-ready index without a remaining lock, and completed a real Recall query. Indexing and Recall each used one orderly native-session lifecycle. No package-install, native-runtime, vector-type, model-format, lifecycle-reuse, or unguarded Metal blocker was found on the verified target.

Refresh this evidence when the pinned native packages, Bun runtime, llama.cpp build, model artifact, or embedding-session lifecycle changes.
