"use client";

import { UnexpectedFailure } from "../components/shell/full-state";
import "./globals.css";

// A failure in the root layout itself: Next renders this in place of the whole document.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <UnexpectedFailure
          retry={
            <button type="button" className="btn" onClick={() => reset()}>
              Try again
            </button>
          }
        />
      </body>
    </html>
  );
}
