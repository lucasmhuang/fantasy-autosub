import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The HTML a view renders on the server, for markup assertions. Its twin in packages/ui stays
// unexported, since a package's only public surface is its src/index.ts.
export function renderMarkup(element: ReactElement): string {
  return renderToStaticMarkup(element);
}
