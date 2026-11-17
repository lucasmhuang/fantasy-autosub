// Reading the app's and the design system's CSS in tests: each style rule with its selectors, its
// body and the at-rules around it (keyframes left out).
export type Rule = { selectors: string[]; body: string; within: string[] };

// Every style rule with the at-rules around it, comments removed.
export function rulesOf(source: string): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const within: string[] = [];
  let start = 0;
  for (let at = 0; at < css.length; at += 1) {
    const char = css[at];
    if (char === "{") {
      const prelude = css.slice(start, at).trim();
      if (prelude.startsWith("@")) {
        within.push(prelude);
        start = at + 1;
        continue;
      }
      const end = css.indexOf("}", at);
      rules.push({
        selectors: prelude.split(",").map((part) => part.trim().replace(/\s+/g, " ")),
        body: css.slice(at + 1, end),
        within: [...within],
      });
      at = end;
      start = end + 1;
    } else if (char === "}") {
      within.pop();
      start = at + 1;
    }
  }
  return rules.filter((rule) => !rule.within.some((each) => each.startsWith("@keyframes")));
}
