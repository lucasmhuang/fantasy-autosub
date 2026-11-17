import { formatAge } from "@injurysub/domain";

// A freshness line's words on the reader's clock (FS-TIME-8): the reading's age while that helps,
// else the time the server wrote.
export function freshText(at: string, now: Date, time: string): string {
  return formatAge(new Date(at), now) ?? time;
}
