import type { ReactNode } from "react";
import { Button } from "./button";

export type FreshnessNoteProps = {
  // When ESPN was last read, for the reader: a time, or an age kept current (FS-TIME-8).
  readAt: ReactNode;
  refreshHref: string;
};

export function FreshnessNote({ readAt, refreshHref }: FreshnessNoteProps) {
  return (
    <div className="fresh">
      <p>As of {readAt}</p>
      <Button asChild variant="ghost" icon="refresh">
        <a href={refreshHref}>Refresh</a>
      </Button>
    </div>
  );
}
