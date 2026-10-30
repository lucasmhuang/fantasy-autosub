export type SeedArguments =
  | { ok: true; filePath: string; apply: boolean }
  | { ok: false; pathGiven: boolean; unknownArgCount: number };

// pnpm seed:accounts <absolute path to the accounts file> [--apply]. Anything else is refused,
// counting what wasn't understood rather than quoting it, since it could be part of a path.
export function parseSeedArguments(args: readonly string[]): SeedArguments {
  const paths = args.filter((arg) => !arg.startsWith("-"));
  const applyFlags = args.filter((arg) => arg === "--apply").length;
  const unknownFlags = args.length - paths.length - applyFlags;
  const unknownArgCount =
    unknownFlags + Math.max(0, paths.length - 1) + Math.max(0, applyFlags - 1);
  const [filePath] = paths;
  if (filePath === undefined || unknownArgCount > 0) {
    return { ok: false, pathGiven: filePath !== undefined, unknownArgCount };
  }
  return { ok: true, filePath, apply: applyFlags === 1 };
}
