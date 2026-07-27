#!/usr/bin/env bun

import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect, ManagedRuntime, Path } from "effect";
import { loadBenchmarkCases } from "./BenchmarkCase.ts";
import { runBenchmarkSuite } from "./BenchmarkRunner.ts";
import { encodeBenchmarkSuiteResultJson } from "./BenchmarkReport.ts";

type BenchmarkSuiteReport = import("./BenchmarkRunner.ts").BenchmarkSuiteReport;
type BenchOptions = {
  readonly json: boolean;
  readonly vaultPath?: string;
};

type ParsedArguments =
  | { readonly _tag: "valid"; readonly options: BenchOptions }
  | { readonly _tag: "help" }
  | { readonly _tag: "invalid"; readonly message: string };

const usage = [
  "Usage: bun run bench [--json] [--vault <path>]",
  "",
  "Runs every retrieval benchmark fixture against the public agentic-memory recall CLI.",
].join("\n");

const parseArguments = (args: ReadonlyArray<string>): ParsedArguments => {
  const parse = (remaining: ReadonlyArray<string>, options: BenchOptions): ParsedArguments => {
    const [argument, ...rest] = remaining;
    if (argument === undefined) {
      return { _tag: "valid", options };
    }
    if (argument === "--help" || argument === "-h") {
      return { _tag: "help" };
    }
    if (argument === "--json") {
      return parse(rest, { ...options, json: true });
    }
    if (argument === "--vault") {
      const [vaultPath, ...afterVault] = rest;
      return vaultPath === undefined
        ? { _tag: "invalid", message: "--vault requires a path." }
        : parse(afterVault, { ...options, vaultPath });
    }
    return { _tag: "invalid", message: `Unknown argument: ${argument}` };
  };

  return parse(args, { json: false });
};

const formatList = (values: ReadonlyArray<string>): string =>
  values.length === 0 ? "none" : values.join(", ");

export const renderHumanReport = (report: BenchmarkSuiteReport): string => {
  const heading = `Agentic Memory retrieval benchmark: ${report.status.toUpperCase()}`;
  const counts = `Cases: ${report.caseCount} (${report.passCount} pass, ${report.failCount} fail)`;
  const latency = `Latency: p50 ${report.latency.p50Ms}ms, p95 ${report.latency.p95Ms}ms`;
  const cases = report.cases.flatMap((benchmarkCase) => {
    const marker = benchmarkCase.status === "pass" ? "✓" : "✗";
    const recallStatus =
      benchmarkCase.recallStatus === undefined ? "" : ` [${benchmarkCase.recallStatus}]`;
    const summary = `${marker} ${benchmarkCase.id} ${benchmarkCase.durationMs}ms${recallStatus}`;
    if (benchmarkCase.status === "pass") {
      return [summary];
    }

    return [
      summary,
      `  failed gates: ${formatList(benchmarkCase.failedGates)}`,
      `  required facts missing: ${formatList(benchmarkCase.requiredFactsMissing)}`,
      `  forbidden facts present: ${formatList(benchmarkCase.forbiddenFactsPresent)}`,
      `  command: ${benchmarkCase.command.join(" ")}`,
    ];
  });

  return [heading, counts, latency, ...cases].join("\n");
};

const reportFailureDiagnostics = (report: BenchmarkSuiteReport): Effect.Effect<void> => {
  const diagnostics = report.cases
    .filter((benchmarkCase) => benchmarkCase.status === "fail")
    .map((benchmarkCase) => {
      const stderr = benchmarkCase.stderr.trim();
      const suffix = stderr.length === 0 ? "" : `: ${stderr}`;
      return `${benchmarkCase.id} failed (${benchmarkCase.failedGates.join(", ")})${suffix}`;
    });

  return diagnostics.length === 0 ? Effect.void : Console.error(diagnostics.join("\n"));
};

const BenchmarkRuntime = ManagedRuntime.make(BunServices.layer);

export const runBenchmarkCli = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
  const parsed = parseArguments(args);
  if (parsed._tag === "help") {
    yield* Console.log(usage);
    return;
  }
  if (parsed._tag === "invalid") {
    yield* Console.error(`${parsed.message}\n${usage}`);
    process.exitCode = 2;
    return;
  }

  const path = yield* Path.Path;
  const casesPath = yield* path.fromFileUrl(new URL("../fixtures/queries.json", import.meta.url));
  const defaultVaultPath = yield* path.fromFileUrl(
    new URL("../fixtures/basic-vault", import.meta.url),
  );
  const benchmarkCases = yield* loadBenchmarkCases(casesPath);
  const report = yield* runBenchmarkSuite({
    vaultPath: parsed.options.vaultPath ?? defaultVaultPath,
    benchmarkCases,
  });

  if (parsed.options.json) {
    const json = yield* encodeBenchmarkSuiteResultJson(report);
    yield* Console.log(json);
    yield* reportFailureDiagnostics(report);
  } else {
    yield* Console.log(renderHumanReport(report));
  }

  if (report.status === "fail") {
    process.exitCode = 1;
  }
});

if (import.meta.main) {
  const { BunRuntime } = await import("@effect/platform-bun");
  BunRuntime.runMain(
    BenchmarkRuntime.contextEffect.pipe(
      Effect.flatMap((context) =>
        Effect.provideContext(runBenchmarkCli(Bun.argv.slice(2)), context),
      ),
      Effect.ensuring(BenchmarkRuntime.disposeEffect),
    ),
  );
}
