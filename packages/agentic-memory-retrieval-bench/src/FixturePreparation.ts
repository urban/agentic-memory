import { Effect } from "effect";

type LoadedFixture = import("./BenchmarkManifest.ts").LoadedFixture;

export type PreparedFixture = {
  readonly id: LoadedFixture["id"];
  readonly vaultPath: string;
};

export const prepareCanonicalFixtures = <E, R>(input: {
  readonly fixtures: ReadonlyArray<LoadedFixture>;
  readonly prepare: (fixture: LoadedFixture) => Effect.Effect<string, E, R>;
}): Effect.Effect<ReadonlyArray<PreparedFixture>, E, R> =>
  Effect.forEach(input.fixtures, (fixture) =>
    input
      .prepare(fixture)
      .pipe(Effect.map((vaultPath) => ({ id: fixture.id, vaultPath }) satisfies PreparedFixture)),
  );

export const fixtureVaultMap = (
  fixtures: ReadonlyArray<PreparedFixture>,
): ReadonlyMap<string, string> =>
  new Map(fixtures.map((fixture) => [fixture.id, fixture.vaultPath]));
