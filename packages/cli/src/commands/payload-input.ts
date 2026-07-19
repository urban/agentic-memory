import { decodeCapturePayloadJson } from "@urban/agentic-memory-core/capture/CapturePayload";
import { Effect, FileSystem, Stdio, Stream } from "effect";
import { Flag } from "effect/unstable/cli";
import { toFailure } from "../output.ts";

type CapturePayload = import("@urban/agentic-memory-core/capture/CapturePayload").CapturePayload;
type CliCommandFailure = import("../output.ts").CliCommandFailure;

export const payloadFlag = Flag.string("payload").pipe(
  Flag.withDescription("Capture payload JSON file path, or '-' to read stdin"),
);

export const readPayload: (
  payloadPath: string,
) => Effect.Effect<CapturePayload, CliCommandFailure, FileSystem.FileSystem | Stdio.Stdio> =
  Effect.fnUntraced(function* (payloadPath) {
    const text =
      payloadPath === "-"
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
            return yield* fs.readFileString(payloadPath);
          }).pipe(
            Effect.mapError((cause) =>
              toFailure({
                code: "ReadPayloadFailed",
                message: `Failed to read capture payload file: ${payloadPath}`,
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
