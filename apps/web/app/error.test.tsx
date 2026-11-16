import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import ErrorPage from "./error";
import GlobalError from "./global-error";

// The retry handed to the full page, found in the element tree the boundary returns.
function retryButton(element: unknown): ReactElement<{ onClick: () => void }> {
  const found: ReactElement[] = [];
  const walk = (node: unknown) => {
    if (!isValidElement(node)) return;
    const props = node.props as { retry?: unknown; children?: unknown };
    if (isValidElement(props.retry)) found.push(props.retry);
    for (const child of [props.children].flat()) walk(child);
  };
  walk(element);
  const [button] = found;
  if (button === undefined) throw new Error("no retry button");
  return button as ReactElement<{ onClick: () => void }>;
}

// FS-APP-3: "Try again" fetches the failed page again; reset() alone re-renders the same failure.
describe("the error boundaries", () => {
  it.each([
    ["the page boundary", ErrorPage],
    ["the root boundary", GlobalError],
  ])("%s retries by fetching again", (_, Boundary) => {
    let retried = 0;
    const element = Boundary({
      error: new Error("invented"),
      reset: () => {},
      unstable_retry: () => {
        retried += 1;
      },
    });

    retryButton(element).props.onClick();

    expect(retried).toBe(1);
  });
});
