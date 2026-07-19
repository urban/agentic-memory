#!/usr/bin/env bash

set -euo pipefail

script_name="complete-open-work-items"

log() {
  printf '[%s] %s\n' "$script_name" "$*" >&2
}

fail() {
  printf '[%s] ERROR: %s\n' "$script_name" "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  [TM_AGENT=agent-name] scripts/complete-open-work-items.sh

Sequentially drains actionable open Work Items. For each Work Item, the script:

  1. selects exactly one actionable Work Item with `tm next --json`
  2. runs `codex exec --dangerously-bypass-approvals-and-sandbox` for that Work Item
  3. verifies that the Work Item is now complete
  4. runs the configured verification command
  5. creates a Git commit for that Work Item before selecting the next one

The script stops on the first Codex, tm, verification, or Git failure. It does not
call `tm complete` itself; the Codex run must implement, verify, and complete the
selected Work Item.

Environment:
  TM_AGENT                    Agent identity for tm inside Codex
                              (default: codex-work-item-runner).
  TM_COMPLETE_CWD             Directory containing .tasks and the Git repository
                              (default: repository root).
  TM_COMPLETE_ROOT            Optional Work Item id/prefix; drain only that subtree.
  TM_VERIFY_COMMAND           Verification command to run before each commit
                              (default: bun run check).
  TM_ALLOW_DIRTY_START        Set to 1 to skip the initial clean-worktree guard.
EOF
}

repo_root() {
  local script_dir
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
  cd "$script_dir/.." && pwd -P
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required but was not found in PATH."
}

require_clean_worktree() {
  local cwd="$1"

  if [[ "${TM_ALLOW_DIRTY_START:-0}" == '1' ]]; then
    log 'Skipping initial clean-worktree guard because TM_ALLOW_DIRTY_START=1.'
    return
  fi

  if [[ -n "$(git -C "$cwd" status --porcelain)" ]]; then
    git -C "$cwd" status --short >&2
    fail 'Git worktree is not clean. Commit, stash, or set TM_ALLOW_DIRTY_START=1 before running.'
  fi
}

next_work_item_json() {
  local cwd="$1"
  local root="$2"
  local next_args=(next --cwd "$cwd" --json)

  if [[ -n "$root" ]]; then
    next_args+=(--root "$root")
  fi

  tm "${next_args[@]}"
}

write_codex_prompt() {
  local prompt_file="$1"
  local cwd="$2"
  local id="$3"
  local subject="$4"
  local agent="$5"
  local verify_command="$6"

  cat >"$prompt_file" <<EOF
You are executing one Task Manager Work Item in this repository.

Repository: $cwd
Work Item ID: $id
Work Item Subject: $subject
Agent identity: $agent

Instructions:

1. Do not choose a different Work Item. Work only on Work Item $id.
2. Run \`tm validate\` and \`tm show $id\` before making changes.
3. Claim Work Item $id with the Agent identity above. If another active claim or an incomplete dependency blocks you, stop and report the exact tm error.
4. Implement the requested Work Item completely.
5. Run the verification required by the Work Item. If the Work Item does not specify a different command, run:

   \`$verify_command\`

6. Complete Work Item $id with \`tm complete\`, using a strong Result summary and exact verification evidence.
7. Run \`tm validate\` after completion.
8. Do not run \`git commit\`, do not start another Work Item, and do not modify unrelated files. This wrapper script will verify and commit after you finish.
EOF
}

run_codex_for_work_item() {
  local cwd="$1"
  local id="$2"
  local subject="$3"
  local agent="$4"
  local verify_command="$5"
  local prompt_file

  prompt_file="$(mktemp)"
  write_codex_prompt "$prompt_file" "$cwd" "$id" "$subject" "$agent" "$verify_command"

  log "Running Codex for $id: $subject"
  local codex_status=0
  TM_AGENT="$agent" codex exec \
    --dangerously-bypass-approvals-and-sandbox \
    --cd "$cwd" \
    - <"$prompt_file" || codex_status=$?

  rm -f "$prompt_file"
  return "$codex_status"
}

require_work_item_done() {
  local cwd="$1"
  local id="$2"
  local status

  status="$(tm show --cwd "$cwd" --json "$id" | jq -r '.item.status // empty')"
  if [[ "$status" != 'done' ]]; then
    fail "Work Item $id is not done after Codex run. Current status: ${status:-<missing>}."
  fi
}

run_verification() {
  local cwd="$1"
  local verify_command="$2"

  log "Running verification: $verify_command"
  (cd "$cwd" && bash -lc "$verify_command")
}

commit_work_item() {
  local cwd="$1"
  local id="$2"
  local subject="$3"

  git -C "$cwd" add -A

  if git -C "$cwd" diff --cached --quiet; then
    fail "No staged changes to commit for completed Work Item $id."
  fi

  git -C "$cwd" commit \
    -m "Complete ${subject}" \
    -m "Work Item: ${id}" \
    -m 'Completed by scripts/complete-open-work-items.sh after Codex execution and verification.'

  if [[ -n "$(git -C "$cwd" status --porcelain)" ]]; then
    git -C "$cwd" status --short >&2
    fail "Git worktree is not clean after committing Work Item $id."
  fi
}

open_work_item_count() {
  local cwd="$1"
  tm list --cwd "$cwd" --status open --json | jq '[.items[]? | recurse(.children[]?) | select(.status == "open")] | length'
}

main() {
  if [[ "${1:-}" == '-h' || "${1:-}" == '--help' ]]; then
    usage
    return 0
  fi

  if [[ "$#" -ne 0 ]]; then
    usage >&2
    fail 'Unexpected arguments.'
  fi

  require_command tm
  require_command jq
  require_command git
  require_command codex

  local cwd="${TM_COMPLETE_CWD:-$(repo_root)}"
  local agent="${TM_AGENT:-codex-work-item-runner}"
  local root="${TM_COMPLETE_ROOT:-}"
  local verify_command="${TM_VERIFY_COMMAND:-bun run check}"
  local completed_count=0

  git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null
  require_clean_worktree "$cwd"

  log "Validating task storage in $cwd."
  tm validate --cwd "$cwd" >/dev/null

  while true; do
    local next_json
    next_json="$(next_work_item_json "$cwd" "$root")"

    local id
    id="$(jq -r '.item.id // empty' <<<"$next_json")"
    if [[ -z "$id" ]]; then
      local reason
      reason="$(jq -r '.reason // "no-actionable-work"' <<<"$next_json")"
      log "No actionable Work Items remain ($reason)."
      break
    fi

    local subject
    subject="$(jq -r '.item.subject // .item.id' <<<"$next_json")"

    run_codex_for_work_item "$cwd" "$id" "$subject" "$agent" "$verify_command"
    require_work_item_done "$cwd" "$id"

    log 'Validating task storage after Codex completion.'
    tm validate --cwd "$cwd" >/dev/null

    run_verification "$cwd" "$verify_command"
    commit_work_item "$cwd" "$id" "$subject"

    completed_count=$((completed_count + 1))
  done

  log 'Validating task storage after completion loop.'
  tm validate --cwd "$cwd" >/dev/null

  local open_count
  open_count="$(open_work_item_count "$cwd")"
  if [[ "$open_count" != '0' ]]; then
    tm list --cwd "$cwd" --status open >&2
    fail "$open_count open Work Item(s) remain. Resolve the blocked or claimed Work Items and rerun the script."
  fi

  log "Completed and committed $completed_count Work Item(s)."
}

main "$@"
