import { Effect, FileSystem, Path, Schema } from "effect";
import { BenchmarkCase } from "./BenchmarkCase.ts";

export const FixtureId = Schema.Literals(["project-memory", "user-preferences"]);
export type FixtureId = typeof FixtureId.Type;

const SuiteFixtureReference = Schema.Struct({
  id: FixtureId,
  manifest: Schema.String,
});

const CanonicalSuiteManifest = Schema.Struct({
  id: Schema.Literal("recall-canonical"),
  fixtures: Schema.Array(SuiteFixtureReference),
  cases: Schema.String,
});

const FixtureManifest = Schema.Struct({
  id: FixtureId,
  overlay: Schema.String,
});

const Cases = Schema.Array(BenchmarkCase);

export class InvalidBenchmarkManifest extends Schema.TaggedError<InvalidBenchmarkManifest>()(
  "InvalidBenchmarkManifest",
  { message: Schema.String },
) {}

export type LoadedFixture = {
  readonly id: FixtureId;
  readonly manifestPath: string;
  readonly overlayPath: string;
};

export type CanonicalSuite = {
  readonly id: "recall-canonical";
  readonly fixtures: ReadonlyArray<LoadedFixture>;
  readonly cases: ReadonlyArray<BenchmarkCase>;
};

const decodeJson = <S extends Schema.Top>(schema: S, contents: string) =>
  Schema.decodeEffect(Schema.fromJsonString(schema), {
    onExcessProperty: "error",
  })(contents);

const resolveOwnedPath = (
  path: Path.Path,
  packagePath: string,
  relativePath: string,
): Effect.Effect<string, InvalidBenchmarkManifest> => {
  const resolved = path.resolve(packagePath, relativePath);
  const relative = path.relative(packagePath, resolved);
  return path.isAbsolute(relativePath) || relative === ".." || relative.startsWith(`..${path.sep}`)
    ? Effect.fail(
        InvalidBenchmarkManifest.make({
          message: `Benchmark path escapes its package: ${relativePath}`,
        }),
      )
    : Effect.succeed(resolved);
};

export const loadCanonicalSuite = Effect.fn("BenchmarkManifest.loadCanonicalSuite")(function* (
  packagePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const suitePath = path.join(packagePath, "fixtures", "suite.json");
  const suite = yield* decodeJson(CanonicalSuiteManifest, yield* fs.readFileString(suitePath));
  const casesPath = yield* resolveOwnedPath(path, packagePath, suite.cases);
  const cases = yield* decodeJson(Cases, yield* fs.readFileString(casesPath));
  const fixtures = yield* Effect.forEach(suite.fixtures, (fixtureReference) =>
    Effect.gen(function* () {
      const manifestPath = yield* resolveOwnedPath(path, packagePath, fixtureReference.manifest);
      const manifest = yield* decodeJson(FixtureManifest, yield* fs.readFileString(manifestPath));
      if (manifest.id !== fixtureReference.id) {
        return yield* InvalidBenchmarkManifest.make({
          message: `Fixture identity mismatch: ${fixtureReference.id}`,
        });
      }
      const overlayPath = yield* resolveOwnedPath(path, packagePath, manifest.overlay);
      return { id: manifest.id, manifestPath, overlayPath } satisfies LoadedFixture;
    }),
  );
  const fixtureIds = fixtures.map((fixture) => fixture.id);
  const uniqueFixtureIds = new Set(fixtureIds);
  const caseFixtureIds = new Set(cases.map((benchmarkCase) => benchmarkCase.fixtureId));
  if (
    fixtures.length !== 2 ||
    uniqueFixtureIds.size !== fixtures.length ||
    cases.length === 0 ||
    fixtureIds.some((id) => !caseFixtureIds.has(id)) ||
    cases.some((benchmarkCase) => !uniqueFixtureIds.has(benchmarkCase.fixtureId))
  ) {
    return yield* InvalidBenchmarkManifest.make({
      message: "Canonical suite fixture assignments are incomplete or invalid.",
    });
  }
  return { id: suite.id, fixtures, cases } satisfies CanonicalSuite;
});
