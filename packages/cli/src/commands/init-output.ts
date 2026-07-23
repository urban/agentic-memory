import { InitVaultResult } from "@urban/agentic-memory-core/vault/VaultTemplate";
import { Schema } from "effect";

export const InitVaultResultJson = Schema.fromJsonString(InitVaultResult).annotate({
  identifier: "InitVaultResultJson",
});

export const encodeInitVaultResultJson = Schema.encodeUnknownEffect(InitVaultResultJson);
export const decodeInitVaultResultJson = Schema.decodeUnknownEffect(InitVaultResultJson);
