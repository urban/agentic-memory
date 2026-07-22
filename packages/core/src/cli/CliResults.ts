import { Schema } from "effect";
import { AbsolutePath, LinkConfig } from "../link/LinkConfig.ts";
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

export const ValidLinkedProjectStatus = Schema.TaggedStruct("valid-link", {
  link: Schema.Struct({
    path: AbsolutePath,
    config: LinkConfig,
  }),
  projectRoute: VaultHealth,
  semanticReadiness: SemanticIndexReadiness,
}).annotate({ identifier: "ValidLinkedProjectStatus" });
export type ValidLinkedProjectStatus = typeof ValidLinkedProjectStatus.Type;

export const InvalidLinkedProjectStatus = Schema.TaggedStruct("invalid-link", {
  link: Schema.Struct({
    path: AbsolutePath,
    message: Schema.String,
  }),
}).annotate({ identifier: "InvalidLinkedProjectStatus" });
export type InvalidLinkedProjectStatus = typeof InvalidLinkedProjectStatus.Type;

export const LinkedProjectStatusResult = Schema.TaggedStruct("linked-project", {
  version: Schema.Literal(1),
  status: Schema.Literals(["healthy", "unhealthy"]),
  directory: AbsolutePath,
  inspection: Schema.Union([ValidLinkedProjectStatus, InvalidLinkedProjectStatus]),
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "LinkedProjectStatusResult" });
export type LinkedProjectStatusResult = typeof LinkedProjectStatusResult.Type;

export const VaultStatusResult = Schema.TaggedStruct("vault", {
  version: Schema.Literal(1),
  directory: AbsolutePath,
  readiness: SemanticIndexReadiness,
}).annotate({ identifier: "VaultStatusResult" });
export type VaultStatusResult = typeof VaultStatusResult.Type;

export const UnconfiguredStatusResult = Schema.TaggedStruct("unconfigured", {
  version: Schema.Literal(1),
  status: Schema.Literal("unconfigured"),
  directory: AbsolutePath,
  expectedLinkPath: AbsolutePath,
  warnings: Schema.Array(Schema.String),
}).annotate({ identifier: "UnconfiguredStatusResult" });
export type UnconfiguredStatusResult = typeof UnconfiguredStatusResult.Type;

export const StatusCommandResult = Schema.Union([
  LinkedProjectStatusResult,
  VaultStatusResult,
  UnconfiguredStatusResult,
]).annotate({ identifier: "StatusCommandResult" });
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
export const VaultStatusResultJson = Schema.fromJsonString(VaultStatusResult).annotate({
  identifier: "VaultStatusResultJson",
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
export const decodeStatusCommandResultJson = Schema.decodeUnknownEffect(StatusCommandResultJson);
export const decodeVaultStatusResultJson = Schema.decodeUnknownEffect(VaultStatusResultJson);
export const encodeSemanticIndexResultJson = Schema.encodeUnknownEffect(SemanticIndexResultJson);
export const decodeSemanticIndexResultJson = Schema.decodeUnknownEffect(SemanticIndexResultJson);
export const encodeSemanticIndexReadinessJson = Schema.encodeUnknownEffect(
  SemanticIndexReadinessJson,
);
export const decodeSemanticIndexReadinessJson = Schema.decodeUnknownEffect(
  SemanticIndexReadinessJson,
);
