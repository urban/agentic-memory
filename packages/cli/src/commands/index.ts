import { encodeSemanticIndexResultJson } from "@urban/agentic-memory-core/cli/CliResults";
import {
  deleteSemanticIndex,
  synchronizeSemanticIndex,
} from "@urban/agentic-memory-core/semantic/SemanticIndex";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { resolvePathInput } from "./path-input.ts";
import { commandRoot } from "./root.ts";

export const commandIndex = Command.make(
  "index",
  {
    vaultPath: Flag.string("vault").pipe(
      Flag.withDescription("Path to an initialized Agentic Memory vault"),
    ),
    deleteIndex: Flag.boolean("delete").pipe(
      Flag.withDescription(
        "Delete only local derivative index state; preserve Markdown and the shared model",
      ),
    ),
  },
  Effect.fnUntraced(function* ({ deleteIndex, vaultPath }) {
    const root = yield* commandRoot;
    const resolvedVaultPath = yield* resolvePathInput(root.directory, vaultPath, "Vault path");
    const result = yield* (
      deleteIndex
        ? deleteSemanticIndex(resolvedVaultPath)
        : synchronizeSemanticIndex(resolvedVaultPath)
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
  Command.withDescription(
    "Explicitly synchronize or delete a vault's local derivative semantic index",
  ),
  Command.withExamples([
    {
      command: "agentic-memory -C /absolute/path/to index --vault vault --json",
      description: "Resolve a relative vault path and incrementally index managed Markdown",
    },
    {
      command: "agentic-memory index --vault /absolute/path/to/vault --delete",
      description: "Safely delete only per-vault derivative semantic state",
    },
  ]),
);
