import { encodeSemanticIndexResultJson } from "@urban/agentic-memory-core/cli/CliResults";
import {
  deleteSemanticIndex,
  synchronizeSemanticIndex,
} from "@urban/agentic-memory-core/semantic/SemanticIndex";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { commandRoot } from "./root.ts";

export const commandIndex = Command.make(
  "index",
  {
    vaultPath: Flag.string("vault").pipe(
      Flag.withDescription("Absolute path to an initialized Agentic Memory vault"),
    ),
    deleteIndex: Flag.boolean("delete").pipe(
      Flag.withDescription("Delete the vault's local derivative semantic index"),
    ),
  },
  Effect.fnUntraced(function* ({ deleteIndex, vaultPath }) {
    const root = yield* commandRoot;
    const result = yield* (
      deleteIndex ? deleteSemanticIndex(vaultPath) : synchronizeSemanticIndex(vaultPath)
    ).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: cause.reason,
          message: cause.message,
        }),
      ),
    );
    const jsonText = yield* encodeSemanticIndexResultJson(result).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "EncodeResultFailed",
          message: `Failed to encode semantic index result: ${cause.message}`,
        }),
      ),
    );
    const human =
      result.status === "deleted"
        ? `Deleted semantic index at ${result.vaultPath}`
        : result.status === "already_absent"
          ? `Semantic index is already absent at ${result.vaultPath}`
          : result.status === "already_current"
            ? `Semantic index is already current at ${result.vaultPath}`
            : `Indexed ${result.files.new + result.files.changed} files (${result.chunks.embedded} chunks) at ${result.vaultPath}`;
    return yield* Console.log(root.json ? jsonText : human);
  }, withCliFailureOutput),
).pipe(
  Command.withDescription("Create the local semantic index from managed memory documents"),
  Command.withExamples([
    {
      command: "agentic-memory index --vault /absolute/path/to/vault --json",
      description: "Index all managed memory documents into local derivative state",
    },
    {
      command: "agentic-memory index --vault /absolute/path/to/vault --delete",
      description: "Delete only the vault's local derivative semantic index",
    },
  ]),
);
