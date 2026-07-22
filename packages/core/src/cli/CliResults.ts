import { Schema } from "effect";
import { LinkConfig } from "../link/LinkConfig.ts";
import { EMBEDDING_MODEL_ID } from "../semantic/EmbeddingModel.ts";
import { SemanticIndexReadiness, SemanticIndexResult } from "../semantic/SemanticIndex.ts";
import { VaultHealth } from "../vault/VaultStatus.ts";

export const CliError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
}).annotate({ identifier: "CliError" });
export type CliError = typeof CliError.Type;

export const CliFailureResult = Schema.Struct({
  status: Schema.Literal("failed"),
  error: CliError,
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "CliFailureResult" });
export type CliFailureResult = typeof CliFailureResult.Type;

export const InitCommandResult = Schema.Struct({
  status: Schema.Literals(["initialized", "already_initialized"]),
  vaultPath: Schema.String,
  changes: Schema.Struct({
    createdDirectory: Schema.Boolean,
    copiedTemplate: Schema.Boolean,
    initializedGit: Schema.Boolean,
    updatedGitIgnore: Schema.Boolean,
  }),
  model: Schema.Struct({
    id: Schema.Literal(EMBEDDING_MODEL_ID),
    status: Schema.Literal("available"),
    installation: Schema.Literals(["downloaded", "already_available"]),
  }),
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "InitCommandResult" });
export type InitCommandResult = typeof InitCommandResult.Type;

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

export const StatusLinkInfo = Schema.Union([
  Schema.Struct({
    exists: Schema.Literal(false),
    path: Schema.String,
  }),
  Schema.Struct({
    exists: Schema.Literal(true),
    path: Schema.String,
    config: Schema.optional(LinkConfig),
    message: Schema.optional(Schema.String),
  }),
]).annotate({ identifier: "StatusLinkInfo" });
export type StatusLinkInfo = typeof StatusLinkInfo.Type;

export const StatusVaultInfo = Schema.Struct({
  path: Schema.String,
  healthy: Schema.Boolean,
  projectFileExists: Schema.Boolean,
  memoryRouteExists: Schema.Boolean,
  details: VaultHealth,
}).annotate({ identifier: "StatusVaultInfo" });
export type StatusVaultInfo = typeof StatusVaultInfo.Type;

export const StatusCommandResult = Schema.Struct({
  status: Schema.Literals(["unlinked", "healthy", "unhealthy"]),
  projectRoot: Schema.String,
  link: StatusLinkInfo,
  vault: Schema.optional(StatusVaultInfo),
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "StatusCommandResult" });
export type StatusCommandResult = typeof StatusCommandResult.Type;

export const CliFailureResultJson = Schema.fromJsonString(CliFailureResult).annotate({
  identifier: "CliFailureResultJson",
});
export const InitCommandResultJson = Schema.fromJsonString(InitCommandResult).annotate({
  identifier: "InitCommandResultJson",
});
export const LinkCommandResultJson = Schema.fromJsonString(LinkCommandResult).annotate({
  identifier: "LinkCommandResultJson",
});
export const StatusCommandResultJson = Schema.fromJsonString(StatusCommandResult).annotate({
  identifier: "StatusCommandResultJson",
});
export const SemanticIndexResultJson = Schema.fromJsonString(SemanticIndexResult).annotate({
  identifier: "SemanticIndexResultJson",
});
export const SemanticIndexReadinessJson = Schema.fromJsonString(SemanticIndexReadiness).annotate({
  identifier: "SemanticIndexReadinessJson",
});

export const encodeCliFailureResultJson = Schema.encodeUnknownEffect(CliFailureResultJson);
export const encodeInitCommandResultJson = Schema.encodeUnknownEffect(InitCommandResultJson);
export const decodeInitCommandResultJson = Schema.decodeUnknownEffect(InitCommandResultJson);
export const encodeLinkCommandResultJson = Schema.encodeUnknownEffect(LinkCommandResultJson);
export const encodeStatusCommandResultJson = Schema.encodeUnknownEffect(StatusCommandResultJson);
export const encodeSemanticIndexResultJson = Schema.encodeUnknownEffect(SemanticIndexResultJson);
export const decodeSemanticIndexResultJson = Schema.decodeUnknownEffect(SemanticIndexResultJson);
export const encodeSemanticIndexReadinessJson = Schema.encodeUnknownEffect(
  SemanticIndexReadinessJson,
);
export const decodeSemanticIndexReadinessJson = Schema.decodeUnknownEffect(
  SemanticIndexReadinessJson,
);
