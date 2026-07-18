import {
  CapturePayload as CoreCapturePayload,
  CapturePayloadJson as CoreCapturePayloadJson,
  CapturePayloadMessage as CorePayloadMessage,
  encodeCapturePayloadJson,
} from "@urban/agentic-memory-core/capture/CapturePayload";
import {
  decodeLinkConfigJson,
  encodeLinkConfigJson,
  LinkConfig as CoreResolvedProjectConfig,
  LocalLinkPaths as CoreLocalPaths,
} from "@urban/agentic-memory-core/link/LinkConfig";
import {
  RunStewardResult as CoreRunStewardResult,
  RunStewardResultJson as CoreRunStewardResultJson,
} from "@urban/agentic-memory-core/steward/StewardExecution";
import {
  StewardResult as CoreStewardResultEnvelope,
  StewardResultJson as CoreStewardResultEnvelopeJson,
  StewardResultStatus as CoreStewardResultStatus,
  decodeStewardResultJson as decodeStewardResultEnvelopeJson,
} from "@urban/agentic-memory-core/steward/StewardResult";
import { Schema } from "effect";

export const NotificationLevel = Schema.Literals(["info", "warning", "error"]).annotate({
  identifier: "NotificationLevel",
});
export type NotificationLevel = typeof NotificationLevel.Type;

export const CapturePayload = CoreCapturePayload;
export const CapturePayloadJson = CoreCapturePayloadJson;
export const PayloadMessage = CorePayloadMessage;
export const ResolvedProjectConfig = CoreResolvedProjectConfig;
export const LocalPaths = CoreLocalPaths;
export type CapturePayload = typeof CapturePayload.Type;
export type PayloadMessage = typeof PayloadMessage.Type;
export type ResolvedProjectConfig = typeof ResolvedProjectConfig.Type;
export type LocalPaths = typeof LocalPaths.Type;
export const StewardResultEnvelope = CoreStewardResultEnvelope;
export const StewardResultEnvelopeJson = CoreStewardResultEnvelopeJson;
export const StewardResultStatus = CoreStewardResultStatus;
export type StewardResultEnvelope = typeof StewardResultEnvelope.Type;
export type StewardResultStatus = typeof StewardResultStatus.Type;
export const RunStewardResult = CoreRunStewardResult;
export const RunStewardResultJson = CoreRunStewardResultJson;
export type RunStewardResult = typeof RunStewardResult.Type;

export const decodeProjectConfigJson = decodeLinkConfigJson;
export const encodeProjectConfigJson = encodeLinkConfigJson;
export { encodeCapturePayloadJson, decodeStewardResultEnvelopeJson };
export const decodeRunStewardResultJson = Schema.decodeUnknownEffect(RunStewardResultJson);
