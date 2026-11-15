import { Button } from "./button";

export type FreshnessNoteProps = {
  // When ESPN was last read, already formatted for the reader.
  readAt: string;
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
