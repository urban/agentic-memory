import { decodeCapturePayloadJson } from "@urban/agentic-memory-core/capture/CapturePayload";
import { Effect, FileSystem, Stdio, Stream } from "effect";
import { Flag } from "effect/unstable/cli";
import { toFailure } from "../failures.ts";
import { resolvePathInput } from "./path-input.ts";

type AbsolutePath = import("@urban/agentic-memory-core/link/LinkConfig").AbsolutePath;
type CapturePayload = import("@urban/agentic-memory-core/capture/CapturePayload").CapturePayload;
type CliCommandFailure = import("../output.ts").CliCommandFailure;
type Path = import("effect").Path.Path;

export const payloadFlag = Flag.string("payload").pipe(
  Flag.withDescription("Capture payload JSON file path, or '-' to read stdin"),
);

export const readPayload: (
  effectiveDirectory: AbsolutePath,
  payloadPath: string,
) => Effect.Effect<CapturePayload, CliCommandFailure, FileSystem.FileSystem | Path | Stdio.Stdio> =
  Effect.fnUntraced(function* (effectiveDirectory, payloadPath) {
    const resolvedPayloadPath =
      payloadPath === "-"
        ? payloadPath
        : yield* resolvePathInput(effectiveDirectory, payloadPath, "Payload path");
    const text =
      resolvedPayloadPath === "-"
        ? yield* Effect.gen(function* () {
            const stdio = yield* Stdio.Stdio;
            return yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
          }).pipe(
            Effect.mapError((cause) =>
              toFailure({
                code: "ReadPayloadFailed",
                message: "Failed to read capture payload from stdin",
                warnings: [String(cause)],
              }),
            ),
          )
        : yield* Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            return yield* fs.readFileString(resolvedPayloadPath);
          }).pipe(
            Effect.mapError((cause) =>
              toFailure({
                code: "ReadPayloadFailed",
                message: `Failed to read capture payload file: ${resolvedPayloadPath}`,
                warnings: [String(cause)],
              }),
            ),
          );

    return yield* decodeCapturePayloadJson(text).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "InvalidCapturePayload",
          message: `Invalid capture payload JSON: ${cause.message}`,
        }),
      ),
    );
  });
