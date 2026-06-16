# Capture observability

Agentic Memory capture telemetry is an opt-in local diagnostics surface for the Pi capture extension and `agentic-memory run-steward` CLI. It describes operational decisions and outcomes, not durable memory content.

Telemetry is disabled by default. Enable it for local development with:

```sh
export AGENTIC_MEMORY_OTEL_ENABLED=true
export AGENTIC_MEMORY_OTEL_BASE_URL=http://127.0.0.1:27686
```

When enabled, traces and structured logs are exported to motel-compatible OTLP endpoints:

- traces: `http://127.0.0.1:27686/v1/traces`
- logs: `http://127.0.0.1:27686/v1/logs`

Exporter failures are fail-open: capture and normal Pi operation continue if motel is unavailable.

## Services

Stable service names:

- `agentic-memory-pi-capture` — Pi extension capture runtime
- `agentic-memory-cli` — CLI commands such as `run-steward`

Both services attach capture correlation attributes when available:

- `capture.run_id`
- `capture.attempt_id`
- `capture.trigger_kind`
- `capture.project_slug`

## What is emitted

Capture spans include workflow status, skip reasons, schedule counts, observation counts, payload warning counts, steward status, retry count, changed-file count, marker count, bounded decision-report summary metadata, and Steward diagnostic session pointer metadata when available.

Logs are reserved for narrative decisions and outcomes such as skipped captures, steward retry failures, and terminal steward results.

Telemetry must not include raw transcript text, raw payload JSON, prompts, responses, tool output, diffs, secrets, or full Steward Pi session contents. The saved Steward Pi session is the local diagnostic artifact for full inspection.

## Motel query examples

```sh
curl "http://127.0.0.1:27686/api/services"

curl "http://127.0.0.1:27686/api/traces/search?service=agentic-memory-pi-capture&attr.capture.project_slug=example-project"

curl "http://127.0.0.1:27686/api/spans/search?service=agentic-memory-pi-capture&attr.capture.status=below_threshold"

curl "http://127.0.0.1:27686/api/logs/search?service=agentic-memory-pi-capture&attr.capture.attempt_id=<attempt-id>"

curl "http://127.0.0.1:27686/api/logs/search?service=agentic-memory-cli&attr.capture.attempt_id=<attempt-id>"
```

Use the `capture.attempt_id` value to correlate Pi extension activity with CLI Steward execution across process boundaries.
