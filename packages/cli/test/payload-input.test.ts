import * as BunServices from "@effect/platform-bun/BunServices";
import { decodeAbsolutePath } from "@urban/agentic-memory-core/link/LinkConfig";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, ManagedRuntime, Sink, Stdio, Stream } from "effect";
import { afterAll } from "vitest";
import { readPayload } from "../src/commands/payload-input.ts";

const validPayloadJson =
  '{"version":1,"projectSlug":"agentic-memory-cli","messages":[{"role":"user","text":"hello"}]}';

const PayloadInputRuntime = ManagedRuntime.make(BunServices.layer);

const withPayloadInputRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R | BunServices.BunServices>,
) =>
  PayloadInputRuntime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
  );

describe("capture payload CLI input", () => {
  afterAll(() => PayloadInputRuntime.dispose());

  it.effect("reads and decodes a payload file", () =>
    withPayloadInputRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-payload-input-",
          });
          const payloadPath = `${tempRoot}/payload.json`;
          yield* fs.writeFileString(payloadPath, validPayloadJson);

          const payload = yield* readPayload(yield* decodeAbsolutePath(tempRoot), "payload.json");

          assert.strictEqual(payload.projectSlug, "agentic-memory-cli");
          assert.deepStrictEqual(payload.messages, [{ role: "user", text: "hello" }]);
        }),
      ),
    ),
  );

  it.effect("reads and decodes a payload from stdin", () =>
    withPayloadInputRuntime(
      decodeAbsolutePath("/").pipe(
        Effect.flatMap((effectiveDirectory) => readPayload(effectiveDirectory, "-")),
        Effect.provideService(
          Stdio.Stdio,
          Stdio.make({
            args: Effect.succeed([]),
            stdout: () => Sink.drain,
            stderr: () => Sink.drain,
            stdin: Stream.make(new TextEncoder().encode(validPayloadJson)),
          }),
        ),
        Effect.map((payload) => {
          assert.strictEqual(payload.projectSlug, "agentic-memory-cli");
          assert.deepStrictEqual(payload.messages, [{ role: "user", text: "hello" }]);
        }),
      ),
    ),
  );

  it.effect("maps invalid JSON to an invalid capture payload failure", () =>
    withPayloadInputRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-payload-input-invalid-",
          });
          const payloadPath = `${tempRoot}/payload.json`;
          yield* fs.writeFileString(payloadPath, "not-json");

          const failure = yield* readPayload(
            yield* decodeAbsolutePath(tempRoot),
            "payload.json",
          ).pipe(Effect.flip);

          assert.strictEqual(failure.code, "InvalidCapturePayload");
          assert.include(failure.message, "Invalid capture payload JSON:");
        }),
      ),
    ),
  );

  it.effect("maps file read errors to a read payload failure", () =>
    withPayloadInputRuntime(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const tempRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-payload-input-missing-",
          });
          const payloadPath = `${tempRoot}/missing.json`;

          const failure = yield* readPayload(
            yield* decodeAbsolutePath(tempRoot),
            "missing.json",
          ).pipe(Effect.flip);

          assert.strictEqual(failure.code, "ReadPayloadFailed");
          assert.strictEqual(
            failure.message,
            `Failed to read capture payload file: ${payloadPath}`,
          );
        }),
      ),
    ),
  );
});
