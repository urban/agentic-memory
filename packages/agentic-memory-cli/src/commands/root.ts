import { Command, Flag } from "effect/unstable/cli";

export const commandRoot = Command.make("agentic-memory").pipe(
  Command.withSharedFlags({
    json: Flag.boolean("json").pipe(Flag.withDescription("Print machine-readable JSON output")),
  }),
  Command.withDescription("Manage Agentic Memory vaults, project links, and Memory Steward runs"),
);
