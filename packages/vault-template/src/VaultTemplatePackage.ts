import { Effect, Path, PlatformError } from "effect";

export const bundledVaultTemplatePath = Effect.fnUntraced(function* (): Effect.fn.Return<
  string,
  PlatformError.BadArgument,
  Path.Path
> {
  const path = yield* Path.Path;
  return yield* path.fromFileUrl(new URL("../template", import.meta.url));
});
