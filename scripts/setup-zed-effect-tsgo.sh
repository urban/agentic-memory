#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[setup-zed-effect-tsgo] %s\n' "$*" >&2
}

fail() {
  printf '[setup-zed-effect-tsgo] ERROR: %s\n' "$*" >&2
  exit 1
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

platform_name() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *) fail "Unsupported OS: $(uname -s). This script supports macOS and Linux." ;;
  esac
}

arch_name() {
  case "$(uname -m)" in
    arm64 | aarch64) printf 'arm64' ;;
    x86_64 | amd64) printf 'x64' ;;
    armv7l | armv6l) printf 'arm' ;;
    *) fail "Unsupported architecture: $(uname -m)." ;;
  esac
}

zed_roots() {
  if [[ "$(platform_name)" == 'darwin' ]]; then
    printf '%s\0' \
      "$HOME/Library/Application Support/Zed/extensions/work/tsgo" \
      "$HOME/Library/Application Support/Zed Preview/extensions/work/tsgo"
  else
    printf '%s\0' \
      "${XDG_DATA_HOME:-$HOME/.local/share}/zed/extensions/work/tsgo" \
      "${XDG_DATA_HOME:-$HOME/.local/share}/zed-preview/extensions/work/tsgo"
  fi
}

find_zed_tsgo_binaries() {
  local platform
  local arch
  platform="$(platform_name)"
  arch="$(arch_name)"

  if [[ -n "${ZED_TSGO_PATH:-}" ]]; then
    [[ -f "$ZED_TSGO_PATH" ]] || fail "ZED_TSGO_PATH does not point to a file: $ZED_TSGO_PATH"
    printf '%s\0' "$ZED_TSGO_PATH"
    return
  fi

  local root
  while IFS= read -r -d '' root; do
    [[ -d "$root" ]] || continue
    find "$root" \
      -path "*/@typescript/native-preview-${platform}-${arch}/lib/tsgo" \
      -type f \
      -print0
  done < <(zed_roots)
}

version_or_empty() {
  local binary="$1"
  "$binary" --version 2>/dev/null || true
}

ensure_project_effect_tsgo() {
  command -v bun >/dev/null 2>&1 || fail 'bun is required but was not found in PATH.'

  if [[ ! -d node_modules ]]; then
    log 'node_modules not found; running bun install.'
    bun install >&2
  fi

  local effect_binary
  effect_binary="$(bun run --silent effect-tsgo get-exe-path)"
  [[ -f "$effect_binary" ]] || fail "@effect/tsgo binary not found at: $effect_binary"
  chmod 755 "$effect_binary"

  local project_version
  project_version="$(version_or_empty "$(bun pm bin)/tsgo")"
  if [[ "$project_version" == *'+effect-tsgo.'* ]]; then
    log "Project tsgo is already patched: $project_version"
  else
    log 'Patching project @typescript/native-preview with effect-tsgo.'
    bun run --silent effect-tsgo patch >&2
    project_version="$(version_or_empty "$(bun pm bin)/tsgo")"
    [[ "$project_version" == *'+effect-tsgo.'* ]] || fail "Project tsgo patch failed. Version was: ${project_version:-<empty>}"
  fi

  printf '%s' "$effect_binary"
}

patch_zed_binary() {
  local effect_binary="$1"
  local zed_binary="$2"
  local zed_version

  zed_version="$(version_or_empty "$zed_binary")"
  if [[ "$zed_version" == *'+effect-tsgo.'* ]]; then
    log "Zed tsgo is already patched: $zed_binary ($zed_version)"
    return
  fi

  local backup_path
  backup_path="${zed_binary}.original.$(date +%Y%m%d%H%M%S)"

  log "Backing up Zed tsgo to: $backup_path"
  cp "$zed_binary" "$backup_path"

  log "Copying effect-tsgo into Zed tsgo path: $zed_binary"
  cp "$effect_binary" "$zed_binary"
  chmod 755 "$zed_binary"

  if [[ "$(platform_name)" == 'darwin' ]]; then
    command -v codesign >/dev/null 2>&1 || fail 'codesign is required on macOS but was not found.'
    log 'Ad-hoc signing patched Zed tsgo binary for macOS Gatekeeper.'
    codesign --force --sign - "$zed_binary" >/dev/null
  fi

  zed_version="$(version_or_empty "$zed_binary")"
  [[ "$zed_version" == *'+effect-tsgo.'* ]] || fail "Zed tsgo patch failed for $zed_binary. Version was: ${zed_version:-<empty>}"
  log "Patched Zed tsgo successfully: $zed_version"
}

main() {
  cd "$(repo_root)"

  [[ -f package.json ]] || fail 'Run this script from inside the project package.'

  local effect_binary
  effect_binary="$(ensure_project_effect_tsgo)"

  local binaries=()
  local zed_binary
  while IFS= read -r -d '' zed_binary; do
    binaries+=("$zed_binary")
  done < <(find_zed_tsgo_binaries)

  if [[ "${#binaries[@]}" -eq 0 ]]; then
    fail "Could not find Zed's tsgo binary. Install the Zed tsgo extension, open a TypeScript file once so Zed downloads it, then rerun this script. You can also set ZED_TSGO_PATH=/absolute/path/to/tsgo."
  fi

  for zed_binary in "${binaries[@]}"; do
    patch_zed_binary "$effect_binary" "$zed_binary"
  done

  log 'Done. Fully quit and reopen Zed, then restart the TypeScript language server.'
}

main "$@"
