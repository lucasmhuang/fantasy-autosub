// Reading an email's HTML for the email tests: what a reader sees, and what it must never carry.

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

function decoded(text: string): string {
  return text.replace(
    /&(?:amp|quot|#x27|#39|lt|gt|nbsp);/g,
    (entity) => ENTITIES[entity] ?? entity
  );
}

// The doctype names the W3C's DTD by URL; no client shows it, so the scan leaves it out.
function withoutDoctype(html: string): string {
  return html.replace(/^<!DOCTYPE[^>]*>/i, "");
}

// The body's text, one entry per block (a paragraph, a cell, a line break), without the head,
// React's comment markers or anything marked `data-skip-in-text` (the large sign-in code).
export function visibleTextOf(html: string): string[] {
  const body = withoutDoctype(html)
    .replace(/<head>[\s\S]*?<\/head>/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<table[^>]*data-skip-in-text="true"[^>]*>[\s\S]*?<\/table>/g, "")
    .replace(/<\/(?:p|div|td|tr|table|h[1-6])>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decoded(body)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
}

const FORBIDDEN_TAGS: ReadonlyArray<[string, RegExp]> = [
  ["link", /<a[\s>]/i],
  ["image", /<img[\s>/]/i],
  ["button", /<button[\s>]/i],
  ["stylesheet", /<link[\s>/]/i],
  ["script", /<script[\s>]/i],
];

// Everything in an email that a client could turn into a link, or that would fetch something:
// FS-EMAIL-2. Returns one entry per problem found, so an empty list means clean.
export function scanEmailHtml(html: string): string[] {
  const problems: string[] = [];
  const content = decoded(withoutDoctype(html));
  for (const [name, pattern] of FORBIDDEN_TAGS) {
    const found = content.match(pattern)?.[0];
    if (found !== undefined) problems.push(`${name}: ${found.replace(/[\s>/]$/, "")}`);
  }
  for (const [, attribute] of content.matchAll(/\s(href|src)=/gi)) {
    problems.push(`attribute: ${attribute}`);
  }
  for (const [url] of content.matchAll(/https?:\/\/|www\./gi)) problems.push(`url: ${url}`);
  for (const [address] of content.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
    problems.push(`address: ${address}`);
  }
  for (const [domain] of content.matchAll(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi)) {
    problems.push(`domain: ${domain}`);
  }
  return problems;
}
