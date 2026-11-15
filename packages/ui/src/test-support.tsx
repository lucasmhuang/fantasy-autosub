import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The HTML a component renders on the server, for markup assertions.
export function renderMarkup(element: ReactElement): string {
  return renderToStaticMarkup(element);
}
