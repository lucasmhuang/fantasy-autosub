import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The HTML a component renders on the server, for markup assertions.
export function renderMarkup(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

// An element of rendered markup: its tag and its attributes (names lowercased, values decoded).
export type MarkupElement = { tag: string; attributes: Record<string, string> };

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

function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, name = "", value = ""] of tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)) {
    attributes[name.toLowerCase()] = decoded(value);
  }
  return attributes;
}

// Every element, in document order. React quotes and escapes every attribute, so this pattern
// holds for what it renders.
function elementsIn(markup: string): MarkupElement[] {
  return [...markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)].map(([, tag = "", attributes = ""]) => ({
    tag,
    attributes: attributesOf(attributes),
  }));
}

export function elementsByTag(markup: string, tag: string): MarkupElement[] {
  return elementsIn(markup).filter((element) => element.tag === tag);
}

// Every element whose class list holds all of `classes`.
export function elementsWithClass(markup: string, ...classes: string[]): MarkupElement[] {
  return elementsIn(markup).filter(({ attributes }) => {
    const list = (attributes.class ?? "").split(/\s+/);
    return classes.every((name) => list.includes(name));
  });
}

// The markup's text, tags removed, as a reader would see it run together.
export function textOf(markup: string): string {
  return decoded(markup.replace(/<[^>]*>/g, "")).trim();
}
