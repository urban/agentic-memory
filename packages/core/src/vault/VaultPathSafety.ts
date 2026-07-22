import { Path } from "effect";

export const isPathInsideRoot = (
  rootRealPath: string,
  candidateRealPath: string,
  path: Path.Path,
): boolean => {
  const relative = path.relative(rootRealPath, candidateRealPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};
