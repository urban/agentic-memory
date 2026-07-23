import { LinkConfig } from "@urban/agentic-memory-core/link/LinkConfig";
import { Schema } from "effect";

export const LinkCommandResult = Schema.Struct({
  status: Schema.Literal("linked"),
  projectRoot: Schema.String,
  configPath: Schema.String,
  config: LinkConfig,
  changes: Schema.Struct({
    wroteConfig: Schema.Boolean,
    createdProjectFile: Schema.Boolean,
    updatedMemoryRoute: Schema.Boolean,
    updatedGitExclude: Schema.Boolean,
  }),
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "LinkCommandResult" });
export type LinkCommandResult = typeof LinkCommandResult.Type;

export const LinkCommandResultJson = Schema.fromJsonString(LinkCommandResult).annotate({
  identifier: "LinkCommandResultJson",
});

export const encodeLinkCommandResultJson = Schema.encodeUnknownEffect(LinkCommandResultJson);
export const decodeLinkCommandResultJson = Schema.decodeUnknownEffect(LinkCommandResultJson);
