import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

// The owner's words for the app (FS-APP-7, FS-APP-9, FS-APP-10, FS-SHELL-10), checked over every
// copy module's text: its string literals, never its imports, identifiers or comments. A new
// copy module under these folders is scanned without being listed. Views join the scan as they
// are rebuilt, by their rendered markup.
const webRoot = new URL("../", import.meta.url).pathname;

type Rule = {
  name: string;
  pattern: RegExp;
  managerOnly?: boolean;
  outsideSignIn?: boolean;
  // Views that can't follow the rule, each with its reason.
  exempt?: string[];
};

// The views rebuilt so far, scanned by their own text (JSX text and string literals).
const REBUILT_VIEWS = [
  "components/shell/shell.tsx",
  "components/shell/full-state.tsx",
  "app/(auth)/login/login-view.tsx",
  "components/board/board-view.tsx",
  "components/board/option-groups.tsx",
  "components/board/choose-view.tsx",
  "components/board/confirm-view.tsx",
  "components/board/request-page-view.tsx",
  "components/board/live-request.tsx",
  "components/board/request-rows.tsx",
  "components/board/requests-list-view.tsx",
  "app/(app)/app/loading.tsx",
  "app/(app)/app/requests/(list)/loading.tsx",
  "components/commish/queue-view.tsx",
  "components/commish/request-detail-view.tsx",
  "components/commish/detail-panels.tsx",
  "app/(commish)/commish/requests/loading.tsx",
];

const RULES: Rule[] = [
  { name: '"swap", never "substitution" or "sub"', pattern: /\bsubstitut|\bsubs?\b/i },
  { name: '"Team", never "board" or "dashboard"', pattern: /\b(board|dashboard)\b/i },
  // "Link your account" (to a team) is the canvas's verb, not a link sent (Board · no team).
  { name: "no links: InjurySub sends none", pattern: /\blinks?\b(?! your account)|\bclick/i },
  { name: 'no "Day N"', pattern: /\bday (\d|\$\{)/i },
  { name: '"Week {N}", never "Matchup {N}"', pattern: /\bmatchup (\d|\$\{)/i, managerOnly: true },
  {
    name: 'the commissioner by name, never "your commissioner"',
    pattern: /\byour commissioner\b/i,
    managerOnly: true,
    outsideSignIn: true,
    // The full pages show when nothing could be read, the commissioner's name included.
    exempt: ["components/shell/full-state.tsx"],
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
  return [...components, ...statuses, ...REBUILT_VIEWS.map((path) => join(webRoot, path))];
}

// The text of every string and template literal a reader could see: not a module name in an
// import or export, and not a literal in a type (`Exclude<Status, "board">`).
function textsIn(code: string, path: string): string[] {
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  const texts: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) texts.push(node.text);
    if (ts.isJsxText(node) && node.text.trim() !== "") texts.push(node.text.trim());
    // A template reads whole, with "${…}" where each value goes, so "Matchup ${n}" is seen.
    if (ts.isTemplateExpression(node)) {
      const spans = node.templateSpans.map((span) => `\${…}${span.literal.text}`);
      texts.push(node.head.text + spans.join(""));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return texts;
}

const textsOf = (path: string) => textsIn(readFileSync(path, "utf8"), path);

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
      if (rule.exempt?.includes(relative(webRoot, path))) return [];
      return textsOf(path)
        .filter((text) => rule.pattern.test(text))
        .map((text) => `${relative(webRoot, path)}: ${text}`);
    });

    expect(breaches).toEqual([]);
  });

  it("reads a rebuilt view's own text", () => {
    const view = 'export const V = () => <p title="Week 3">Open the dashboard</p>;';

    expect(textsIn(view, "sample.tsx")).toEqual(["Week 3", "Open the dashboard"]);
  });

  it("scans the rebuilt views", () => {
    const modules = copyModules().map((path) => relative(webRoot, path));

    expect(modules).toEqual(expect.arrayContaining(REBUILT_VIEWS));
  });

  it.each([
    ['"Week {N}", never "Matchup {N}"', "const week = (n: number) => `Open Matchup ${n} on ESPN`;"],
    ['no "Day N"', "const day = (n: number) => `Counts for Day ${n}`;"],
  ])("keeps the rule %s when the number is put into a template", (name, code) => {
    const rule = RULES.find((each) => each.name === name);

    expect(rule).toBeDefined();
    expect(textsIn(code, "sample.ts").filter((text) => rule?.pattern.test(text))).toHaveLength(1);
  });
});
