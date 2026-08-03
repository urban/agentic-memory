# Recall local synthesis setup

Recall requires a separately managed local Qwen synthesis server in addition to the shared EmbeddingGemma model used for semantic indexing. This guide records the exact Apple-silicon stack that passed the Slice 1 compatibility gate.

Agentic Memory is only a client of this stack. It never installs, downloads, starts, stops, supervises, or restarts `llama-server` or Qwen. The root `start:llama` script is an explicit foreground convenience command for a user who has already installed and verified the pinned artifacts.

## Verified compatibility stack

| Component                   | Verified pin                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `llama-server`              | `llama.cpp` release `b10081`, commit `60f6a17704163e0273bfadb9abb30deb14270f7f`                                                     |
| Apple arm64 release archive | `llama-b10081-bin-macos-arm64.tar.gz`, 10,609,315 bytes, SHA-256 `ad6d5372d9a7283c458cd4918a083d9d002fd82c7a3c3241b8fe571ed0dc1729` |
| Synthesis model             | `Qwen/Qwen3-4B-GGUF` revision `bc640142c66e1fdd12af0bd68f40445458f3869b`, `Qwen3-4B-Q4_K_M.gguf`                                    |
| Effect AI provider          | `@effect/ai-openai-compat@4.0.0-beta.100`                                                                                           |
| Effect                      | `effect@4.0.0-beta.100`                                                                                                             |

The JavaScript dependency pins are recorded in `packages/core/package.json` and `bun.lock`. Treat the server, model artifact, fixed alias, and Effect AI package as one compatibility unit.

## 1. Confirm the supported target

The verified target is Apple-silicon macOS:

```sh
test "$(uname -s)" = Darwin
test "$(uname -m)" = arm64
```

Both commands must succeed. Intel Macs, Linux, Windows, and non-Metal acceleration are not yet verified. Allow at least 3 GB of free disk space for the model plus space for the server archive and extracted binaries.

## 2. Install the pinned `llama-server`

Download the exact upstream Apple arm64 release archive:

```sh
LLAMA_CPP_VERSION=b10081
LLAMA_CPP_ARCHIVE="llama-${LLAMA_CPP_VERSION}-bin-macos-arm64.tar.gz"
LLAMA_CPP_ARCHIVE_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/${LLAMA_CPP_ARCHIVE}"

mkdir -p "$HOME/.local/opt"
curl --fail --location --retry 3 \
  --output "$HOME/.local/opt/$LLAMA_CPP_ARCHIVE" \
  "$LLAMA_CPP_ARCHIVE_URL"

printf '%s  %s\n' \
  ad6d5372d9a7283c458cd4918a083d9d002fd82c7a3c3241b8fe571ed0dc1729 \
  "$HOME/.local/opt/$LLAMA_CPP_ARCHIVE" \
  | shasum -a 256 --check

tar -xzf "$HOME/.local/opt/$LLAMA_CPP_ARCHIVE" -C "$HOME/.local/opt"
export LLAMA_CPP_HOME="$HOME/.local/opt/llama-b10081"
"$LLAMA_CPP_HOME/llama-server" --version
```

The version command must identify build `10081` at commit `60f6a1770` for Darwin arm64. Keep the extracted dynamic libraries beside the binary.

## 3. Download the pinned Qwen artifact

The URI pins an immutable Hugging Face revision instead of following `main`:

```sh
MODEL_DIR="$HOME/.local/share/agentic-memory/models"
MODEL_FILE="$MODEL_DIR/Qwen3-4B-Q4_K_M.gguf"
MODEL_URI="https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf?download=true"

mkdir -p "$MODEL_DIR"
curl --fail --location --retry 3 --continue-at - \
  --output "$MODEL_FILE" \
  "$MODEL_URI"
```

The model is supplied under Apache-2.0. Review the [pinned repository license](https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/bc640142c66e1fdd12af0bd68f40445458f3869b/LICENSE) before use.

## 4. Verify model identity

The exact artifact contract is:

- URI: `https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf?download=true`
- filename: `Qwen3-4B-Q4_K_M.gguf`
- size: `2,497,280,256` bytes
- SHA-256: `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`

Verify both size and content:

```sh
test "$(stat -f '%z' "$MODEL_FILE")" = 2497280256
printf '%s  %s\n' \
  7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5 \
  "$MODEL_FILE" \
  | shasum -a 256 --check
```

Do not continue if either check fails.

## 5. Configure the local paths

Copy the example environment file and replace both filesystem paths with the verified absolute locations:

```sh
cp .env.local.example .env.local
```

The ignored `.env.local` must define:

```sh
LLAMA_CPP_HOME=/absolute/path/to/llama-b10081
AGENTIC_MEMORY_QWEN_MODEL=/absolute/path/to/Qwen3-4B-Q4_K_M.gguf
AGENTIC_MEMORY_SYNTHESIS_URL=http://127.0.0.1:8080/v1
```

There is no implicit synthesis endpoint. Recall accepts only loopback HTTP hosts (`localhost`, `127.0.0.0/8`, or `::1`) and rejects credentials, query strings, fragments, redirects, public provider selection, and public model selection.

## 6. Start the server on loopback

From the repository root, start the explicit foreground command in a dedicated terminal:

```sh
bun run start:llama
```

The script sources `.env.local` and invokes the pinned binary and model with:

```sh
"$LLAMA_CPP_HOME/llama-server" \
  --model "$AGENTIC_MEMORY_QWEN_MODEL" \
  --host 127.0.0.1 \
  --port 8080 \
  --alias agentic-memory-qwen3-4b \
  --ctx-size 16384 \
  --jinja \
  --reasoning off \
  --n-gpu-layers 99
```

Do not replace `127.0.0.1` with `0.0.0.0`, a LAN address, or a public hostname. This is an unauthenticated loopback service. Keep the terminal open; lifecycle management remains the user's responsibility.

The fixed settings are a `16,384`-token context, Jinja chat templates, the `agentic-memory-qwen3-4b` alias, Metal offload, and non-thinking mode. Agentic Memory also enforces non-thinking mode per request with temperature `0`, a maximum of 768 output tokens, a 60-second timeout, and no retries.

## 7. Export the Recall endpoint

The server terminal receives the endpoint from `.env.local`, but other shells that run the CLI need the same value:

```sh
export AGENTIC_MEMORY_SYNTHESIS_URL=http://127.0.0.1:8080/v1
```

## 8. Check health, model identity, and Recall readiness

Wait for model loading to finish, then run:

```sh
curl --fail --silent --show-error http://127.0.0.1:8080/v1/health | jq .
curl --fail --silent --show-error http://127.0.0.1:8080/v1/models \
  | jq --exit-status '.data | any(.id == "agentic-memory-qwen3-4b")'

agentic-memory status --vault /absolute/path/to/agentic-memory-vault
agentic-memory status --vault /absolute/path/to/agentic-memory-vault --json
```

`/v1/models` must contain the exact `agentic-memory-qwen3-4b` ID. Status reports Recall ready only when the semantic index is current and synthesis status is `ready`. Its local probes use a three-second timeout, no retries, disabled redirects, no memory evidence, and no inference.

## 9. Run the opt-in compatibility proof

With the pinned server running and the endpoint exported, run:

```sh
AGENTIC_MEMORY_QWEN_COMPATIBILITY=1 \
  bun run --cwd packages/core probe:local-qwen
```

The probe verifies Effect AI structured generation, schema acceptance, `answered` and `not_found`, per-request non-thinking behavior, precise failure mapping, pre-request non-loopback rejection, and the absence of a hosted fallback. It is not an answer-quality benchmark and is not part of `bun run check`.

## 10. Troubleshoot and upgrade safely

- **Server version differs:** reinstall `b10081`; a Homebrew binary or another `llama-server` on `PATH` is not the verified server.
- **Archive or model checksum fails:** do not run the artifact. Delete it and download it again from the pinned URI.
- **Server is unavailable:** confirm the foreground process is running and the server and endpoint both use port 8080.
- **Model is incompatible:** confirm the fixed alias, model file, `--jinja`, and `--reasoning off` settings.
- **Metal initialization fails:** confirm Apple arm64, available memory, and the Apple arm64 server archive.
- **Port 8080 is occupied:** stop or reconfigure the other user-managed process and keep the endpoint consistent.

`llama.cpp` releases quickly and Qwen template behavior is version-sensitive. Any server, model revision, quantization, alias, or Effect AI version change requires repeating the compatibility proof and human verification, then updating all pins together. Do not introduce a hosted fallback or bypass Effect AI.
