import { z } from "zod";
import type { AdjustmentLine } from "./compute";

// How the lines behind a computed adjustment are kept in a request snapshot: the commissioner's
// completion by hand and the worker's verified adjustment both keep them as `computed.lines`,
// and the request pages read them from either (A1). Written by the web and the worker, read by
// the web.

const linesSchema = z.array(
  z.object({
    day: z.number(),
    playerId: z.number(),
    tenths: z.number(),
    why: z.enum([
      "injured_credited_before_swap",
      "earlier_credit_forfeited",
      "replacement_after_request",
      "replacement_on_bench",
      "replacement_before_request",
    ]),
  })
);
const computedSchema = z.object({ computed: z.object({ lines: linesSchema }) });

export function computedRecord(lines: readonly AdjustmentLine[]): {
  computed: { lines: AdjustmentLine[] };
} {
  return { computed: { lines: [...lines] } };
}

// The lines a snapshot kept; null for a snapshot that kept no computation.
export function computedLinesOf(snapshotPayload: unknown): AdjustmentLine[] | null {
  const parsed = computedSchema.safeParse(snapshotPayload);
  return parsed.success ? parsed.data.computed.lines : null;
}
