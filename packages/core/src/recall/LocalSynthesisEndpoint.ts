import { Effect, Schema } from "effect";

export const LOCAL_SYNTHESIS_MODEL_ALIAS = "agentic-memory-qwen3-4b";
export const LOCAL_SYNTHESIS_TIMEOUT = "60 seconds";

export class SynthesisEndpointError extends Schema.TaggedErrorClass<SynthesisEndpointError>()(
  "SynthesisEndpointError",
  {
    reason: Schema.Literals([
      "InvalidUrl",
      "HttpRequired",
      "CredentialsNotAllowed",
      "QueryNotAllowed",
      "FragmentNotAllowed",
      "NonLoopbackHost",
    ]),
    message: Schema.String,
  },
) {}

const decodeUrl = Schema.decodeUnknownEffect(Schema.URLFromString);

const isLoopbackHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "[::1]" || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);

const normalizeEndpoint = (url: URL): string => {
  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "");
  return `${url.origin}${pathname}`;
};

export const validateLocalSynthesisEndpoint = Effect.fnUntraced(function* (
  input: unknown,
): Effect.fn.Return<string, SynthesisEndpointError> {
  const url = yield* decodeUrl(input).pipe(
    Effect.mapError(
      () =>
        new SynthesisEndpointError({
          reason: "InvalidUrl",
          message: "AGENTIC_MEMORY_SYNTHESIS_URL must be a valid absolute URL",
        }),
    ),
  );
  if (url.protocol !== "http:") {
    return yield* new SynthesisEndpointError({
      reason: "HttpRequired",
      message: "The local synthesis endpoint must use HTTP",
    });
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return yield* new SynthesisEndpointError({
      reason: "CredentialsNotAllowed",
      message: "The local synthesis endpoint must not contain credentials",
    });
  }
  if (url.search.length > 0) {
    return yield* new SynthesisEndpointError({
      reason: "QueryNotAllowed",
      message: "The local synthesis endpoint must not contain a query string",
    });
  }
  if (url.hash.length > 0) {
    return yield* new SynthesisEndpointError({
      reason: "FragmentNotAllowed",
      message: "The local synthesis endpoint must not contain a fragment",
    });
  }
  if (!isLoopbackHost(url.hostname)) {
    return yield* new SynthesisEndpointError({
      reason: "NonLoopbackHost",
      message: "The local synthesis endpoint must use localhost, 127.0.0.0/8, or ::1",
    });
  }
  return normalizeEndpoint(url);
});
