import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type ComponentType, createElement } from "react";
import { render } from "react-email";

// Renders every preview entry in the directory given, under whatever runtime runs this script; the
// runtime test runs it as the worker runs (`node --import tsx` from the repo root, production).
// Prints how many rendered; a render that throws, or HTML without the doctype, exits non-zero.

type PreviewEntry = ComponentType<Record<string, unknown>> & {
  PreviewProps?: Record<string, unknown>;
};

// This package compiles as CommonJS, so a dynamic import's `default` can be the module object
// itself, whose own `default` is the entry.
function entryOf(module: { default: unknown }): PreviewEntry {
  const candidate = module.default as { default?: unknown };
  const entry = typeof candidate === "function" ? candidate : candidate.default;
  if (typeof entry !== "function") throw new Error("a preview entry has no default export");
  return entry as PreviewEntry;
}

async function main(): Promise<void> {
  const directory = process.argv[2];
  if (directory === undefined) throw new Error("usage: runtime-check.ts <entries directory>");
  const files = readdirSync(directory).filter((file) => file.endsWith(".tsx"));
  for (const file of files) {
    const entry = entryOf(await import(join(directory, file)));
    const html = await render(createElement(entry, entry.PreviewProps ?? {}));
    if (!html.startsWith("<!DOCTYPE")) throw new Error(`${file} rendered no document`);
  }
  process.stdout.write(JSON.stringify({ rendered: files.length }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
