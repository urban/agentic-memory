import { encodeInitCommandResultJson } from "@urban/agentic-memory-core/cli/CliResults";
import { initVaultFromTemplate } from "@urban/agentic-memory-core/vault/VaultTemplate";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { toFailure, withCliFailureOutput } from "../output.ts";
import { commandRoot } from "./root.ts";

export const commandInit = Command.make(
  "init",
  {
    targetPath: Argument.string("vault-path").pipe(
      Argument.withDescription("Absolute path for the Agentic Memory vault"),
    ),
    git: Flag.boolean("git").pipe(Flag.withDescription("Initialize a Git repository if needed")),
    yes: Flag.boolean("yes").pipe(Flag.withDescription("Confirm safe non-interactive actions")),
  },
  Effect.fnUntraced(function* ({ targetPath, git, yes }) {
    const root = yield* commandRoot;
    const result = yield* initVaultFromTemplate({
      targetPath,
      initializeGit: git,
      yes,
    }).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "InitFailed",
          message: cause.message,
        }),
      ),
    );
    const jsonText = yield* encodeInitCommandResultJson(result).pipe(
      Effect.mapError((cause) =>
        toFailure({
          code: "EncodeResultFailed",
          message: `Failed to encode init result: ${cause.message}`,
        }),
      ),
    );

    const vaultMessage =
      result.status === "initialized"
        ? `Initialized Agentic Memory vault at ${result.vaultPath}`
        : `Agentic Memory vault already initialized at ${result.vaultPath}`;
    const modelMessage =
      result.model.installation === "downloaded"
        ? `Downloaded embedding model ${result.model.id}`
        : `Embedding model ${result.model.id} was already available`;
    const ignoreMessage = result.changes.updatedGitIgnore
      ? "Added .agentic-memory/index/ to the vault .gitignore"
      : "The vault .gitignore already ignores .agentic-memory/index/";

    return yield* Console.log(
      root.json ? jsonText : `${vaultMessage}\n${modelMessage}\n${ignoreMessage}`,
    );
  }, withCliFailureOutput),
).pipe(
  Command.withDescription("Initialize an Agentic Memory vault from the bundled template"),
  Command.withExamples([
    {
      command: "agentic-memory init /absolute/path/to/vault --git --yes --json",
      description: "Create a vault and print the result as JSON",
    },
  ]),
);
