import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";

// The HTML a view renders on the server, for markup assertions. Its twin in packages/ui stays
// unexported, since a package's only public surface is its src/index.ts.
export function renderMarkup(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

// What a page called with `callPage` rendered, as markup, its async server components awaited
// (a page's header can load its own data). A page that redirected fails the test.
export async function renderedMarkup(
  outcome: { redirect: string } | { element: unknown }
): Promise<string> {
  if ("redirect" in outcome) throw new Error(`the page redirected to ${outcome.redirect}`);
  if (!isValidElement(outcome.element)) throw new Error("the page rendered no element");
  const { prelude } = await prerender(outcome.element);
  return new Response(prelude).text();
}

// The markup's forms and links, read the way a browser submits and follows them. React quotes
// and escapes every attribute, so these patterns hold for what it renders.
export type MarkupForm = {
  action: string | null;
  method: string | null;
  fields: Record<string, string>[];
};
export type MarkupLink = { href: string | null; text: string };

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#x27;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

function decoded(text: string): string {
  return text.replace(/&(?:amp|quot|#x27|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity);
}

// Attribute names lowercased, as HTML reads them; a bare attribute is "".
function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, name = "", value = ""] of tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)) {
    attributes[name.toLowerCase()] = decoded(value);
  }
  return attributes;
}

// The markup's text, tags removed, as a reader would see it run together.
export function textOf(markup: string): string {
  return decoded(markup.replace(/<[^>]*>/g, "")).trim();
}

export type MarkupElement = { tag: string; attributes: Record<string, string> };

// Every element carrying all these classes, with its attributes.
export function elementsWithClass(markup: string, ...classes: string[]): MarkupElement[] {
  return [...markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)]
    .map(([, tag = "", attributes = ""]) => ({ tag, attributes: attributesOf(attributes) }))
    .filter(({ attributes }) => {
      const list = (attributes.class ?? "").split(/\s+/);
      return classes.every((name) => list.includes(name));
    });
}

const FORM = /<form\b([^>]*)>([\s\S]*?)<\/form>/g;
const FIELD = /<(input|textarea)\b([^>]*)>|<select\b([^>]*)>([\s\S]*?)<\/select>/g;
const OPTION = /<option\b([^>]*)>/g;

// Each field carries its tag and attributes; a select also carries its options' values, joined
// with commas.
function fieldsIn(formBody: string): Record<string, string>[] {
  return [...formBody.matchAll(FIELD)].map(
    ([, tag, attributes = "", select = "", options = ""]) => {
      if (tag !== undefined) return { tag, ...attributesOf(attributes) };
      const values = [...options.matchAll(OPTION)].map(
        ([, option = ""]) => attributesOf(option).value
      );
      return { tag: "select", ...attributesOf(select), options: values.join(",") };
    }
  );
}

export function formsIn(markup: string): MarkupForm[] {
  return [...markup.matchAll(FORM)].map(([, tag = "", body = ""]) => {
    const { action = null, method = null } = attributesOf(tag);
    return { action, method, fields: fieldsIn(body) };
  });
}

export function linksIn(markup: string): MarkupLink[] {
  return [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, tag = "", body = ""]) => ({
    href: attributesOf(tag).href ?? null,
    text: textOf(body),
  }));
}
