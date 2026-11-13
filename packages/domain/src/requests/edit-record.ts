import { z } from "zod";
import type { LineupMove } from "../lineup/classify-options";
import type { LineupEdit } from "./lineup-edit";

// How the lineup edit is kept with a request: Confirm records the edit confirmed in the request
// snapshot, and the executor's claim records the edit it sends, with the confirmed one beside it
// when they differ (Dec-D29b). Written by the web and the worker, read by both.

const movesSchema = z.array(
  z.object({ playerId: z.number().int(), fromSlot: z.string(), toSlot: z.string() })
);
const planSchema = z.object({ plan: movesSchema });
const claimedSchema = z.object({ items: movesSchema, confirmedItems: movesSchema.optional() });

// The request snapshot's part: the edit confirmed, or null for a refusal.
export function planRecord(edit: LineupEdit | null): { plan: LineupMove[] | null } {
  return { plan: edit === null ? null : edit.items };
}

// The edit confirmed, from a request snapshot; null when none was recorded (a refusal, or a
// request filed before plans were kept).
export function confirmedPlanOf(requestSnapshotPayload: unknown): LineupMove[] | null {
  const parsed = planSchema.safeParse(requestSnapshotPayload);
  return parsed.success ? parsed.data.plan : null;
}

// The claim's part: the edit sent, and the confirmed one only when it differs.
export function claimedEditRecord(
  sent: LineupEdit,
  confirmed: readonly LineupMove[] | null
): { items: LineupMove[]; movedStarters: number; confirmedItems?: LineupMove[] } {
  const record = { items: sent.items, movedStarters: sent.movedStarters };
  if (confirmed === null || isSameEdit(sent.items, confirmed)) return record;
  return { ...record, confirmedItems: [...confirmed] };
}

// The edit a claim sent, and the confirmed one when it differed; null for a claim that sent none
// (one that resumed at the adjustment).
export function sentEditOf(
  claimedPayload: unknown
): { items: LineupMove[]; confirmedItems: LineupMove[] | null } | null {
  const parsed = claimedSchema.safeParse(claimedPayload);
  if (!parsed.success) return null;
  return { items: parsed.data.items, confirmedItems: parsed.data.confirmedItems ?? null };
}

export function isSameEdit(a: readonly LineupMove[], b: readonly LineupMove[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (move, index) =>
        move.playerId === b[index]?.playerId &&
        move.fromSlot === b[index]?.fromSlot &&
        move.toSlot === b[index]?.toSlot
    )
  );
}
