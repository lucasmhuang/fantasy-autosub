"use client";

import { UnexpectedFailure } from "../components/shell/full-state";

// FS-APP-3: any failure a page didn't handle. Next requires a client component here.
export default function ErrorPage({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry: () => void;
}) {
  return (
    <UnexpectedFailure
      retry={
        <button type="button" className="btn" onClick={() => unstable_retry()}>
          Try again
        </button>
      }
    />
  );
}
