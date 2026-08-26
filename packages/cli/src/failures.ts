import { Runtime, Schema } from "effect";

export class CliCommandFailure extends Schema.TaggedError<CliCommandFailure>()(
  "CliCommandFailure",
  {
    code: Schema.String,
    message: Schema.String,
    exitCode: Schema.Literals([1, 2]),
    warnings: Schema.optional(Schema.Array(Schema.String)),
  },
) {
  override readonly [Runtime.errorExitCode] = this.exitCode;
  override readonly [Runtime.errorReported] = false;
}

export class CliCommandExit extends Schema.TaggedError<CliCommandExit>()("CliCommandExit", {
  exitCode: Schema.Literals([1, 2]),
}) {
  override readonly [Runtime.errorExitCode] = this.exitCode;
  override readonly [Runtime.errorReported] = false;
}

export const toFailure = (input: {
  readonly code: string;
  readonly message: string;
  readonly exitCode?: 1 | 2;
  readonly warnings?: ReadonlyArray<string>;
}): CliCommandFailure =>
  input.warnings === undefined
    ? CliCommandFailure.make({
        code: input.code,
        message: input.message,
        exitCode: input.exitCode ?? 1,
      })
    : CliCommandFailure.make({
        code: input.code,
        message: input.message,
        exitCode: input.exitCode ?? 1,
        warnings: [...input.warnings],
      });

export const exitWith = (exitCode: 1 | 2): CliCommandExit => CliCommandExit.make({ exitCode });
