import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  decodeBenchmarkResultJson,
  encodeBenchmarkResultJson,
  renderHumanResult,
} from "../src/BenchmarkReport.ts";
import { parseArguments, usage } from "../src/bench.ts";

it("accepts only complete update, comparison, JSON, and help modes", () => {
  assert.deepEqual(parseArguments([]), { _tag: "valid", options: { json: false, update: false } });
  assert.deepEqual(parseArguments(["--update", "--json"]), {
    _tag: "valid",
    options: { json: true, update: true },
  });
  for (const argument of ["--vault", "--filter", "--tag", "--case", "--fixture"]) {
    assert.strictEqual(parseArguments([argument])._tag, "invalid");
  }
});

it.effect("keeps invalid human and JSON boundaries equivalent and schema-valid", () =>
  Effect.gen(function* () {
    const result = {
      _tag: "invalid_arguments" as const,
      message: "Unsupported benchmark argument: --vault",
      usage,
    };
    const json = yield* encodeBenchmarkResultJson(result);
    assert.deepEqual(yield* decodeBenchmarkResultJson(json), result);
    assert.include(renderHumanResult(result), result.message);
    assert.include(renderHumanResult(result), usage);
  }),
);
