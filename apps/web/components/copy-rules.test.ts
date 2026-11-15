import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

// The owner's words for the app (FS-APP-7, FS-APP-9, FS-APP-10, FS-SHELL-10), checked over every
// copy module's text: its string literals, never its imports, identifiers or comments. A new
// copy module under these folders is scanned without being listed. Views join the scan as they
// are rebuilt, by their rendered markup.
const webRoot = new URL("../", import.meta.url).pathname;

type Rule = { name: string; pattern: RegExp; managerOnly?: boolean; outsideSignIn?: boolean };

const RULES: Rule[] = [
  { name: '"swap", never "substitution" or "sub"', pattern: /\bsubstitut|\bsubs?\b/i },
  { name: '"Team", never "board" or "dashboard"', pattern: /\b(board|dashboard)\b/i },
  { name: "no links: InjurySub sends none", pattern: /\blinks?\b|\bclick/i },
  { name: 'no "Day N"', pattern: /\bday \d/i },
  { name: '"Week {N}", never "Matchup {N}"', pattern: /\bmatchup (\d|\$\{)/i, managerOnly: true },
  {
    name: 'the commissioner by name, never "your commissioner"',
    pattern: /\byour commissioner\b/i,
    managerOnly: true,
    outsideSignIn: true,
  },
];

function filesUnder(directory: string, keep: (path: string) => boolean): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesUnder(path, keep);
    return keep(path) ? [path] : [];
  });
}

const isTest = (path: string) => /\.test\.tsx?$|test-support/.test(path);

// Copy modules: the components' plain modules (labels, "-text", formatters) and every
// status-messages file.
function copyModules(): string[] {
  const components = filesUnder(
    join(webRoot, "components"),
    (path) => path.endsWith(".ts") && !isTest(path)
  );
  const statuses = filesUnder(join(webRoot, "app"), (path) => path.endsWith("/status-messages.ts"));
  return [...components, ...statuses];
}

// The text of every string and template literal a reader could see: not a module name in an
// import or export, and not a literal in a type (`Exclude<Status, "board">`).
function textsOf(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const texts: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) texts.push(node.text);
    if (ts.isTemplateExpression(node)) {
      texts.push(node.head.text, ...node.templateSpans.map((span) => `\${…}${span.literal.text}`));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return texts;
}

function audienceOf(path: string): { manager: boolean; signIn: boolean } {
  return { manager: !/\/commish\/|\(commish\)/.test(path), signIn: path.includes("(auth)") };
}

describe("the app's copy", () => {
  it("scans the copy modules", () => {
    const modules = copyModules().map((path) => relative(webRoot, path));

    expect(modules).toContain("app/(app)/app/status-messages.ts");
    expect(modules).toContain("app/(auth)/login/status-messages.ts");
    expect(modules).toContain("components/requests/labels.ts");
    expect(modules).toContain("components/commish/automation-text.ts");
  });

  it.each(RULES)("keeps the rule: $name", (rule) => {
    const breaches = copyModules().flatMap((path) => {
      const { manager, signIn } = audienceOf(path);
      if (rule.managerOnly && !manager) return [];
      if (rule.outsideSignIn && signIn) return [];
      return textsOf(path)
        .filter((text) => rule.pattern.test(text))
        .map((text) => `${relative(webRoot, path)}: ${text}`);
    });

    expect(breaches).toEqual([]);
  });
});
