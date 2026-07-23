import { AbsolutePath, LinkConfig } from "@urban/agentic-memory-core/link/LinkConfig";
import { SemanticIndexReadiness } from "@urban/agentic-memory-core/semantic/SemanticIndex";
import { VaultHealth } from "@urban/agentic-memory-core/vault/VaultStatus";
import { Schema } from "effect";

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

export const StatusCommandResultJson = Schema.fromJsonString(StatusCommandResult).annotate({
  identifier: "StatusCommandResultJson",
});
export const VaultStatusResultJson = Schema.fromJsonString(VaultStatusResult).annotate({
  identifier: "VaultStatusResultJson",
});

export const encodeStatusCommandResultJson = Schema.encodeUnknownEffect(StatusCommandResultJson);
export const decodeStatusCommandResultJson = Schema.decodeUnknownEffect(StatusCommandResultJson);
export const decodeVaultStatusResultJson = Schema.decodeUnknownEffect(VaultStatusResultJson);
