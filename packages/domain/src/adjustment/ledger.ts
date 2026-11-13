// ESPN keeps one adjustment and one reason per matchup side, and a write sets both (probed
// 2026-11-04). So the app writes the side's new total and a reason naming every entry behind it.
export const ENTRY_SEPARATOR = " | ";

export type ComposedReason = { ok: true; reason: string } | { ok: false; reason: "too_long" };

export function targetSideAdjustment(currentTenths: number, deltaTenths: number): number {
  return currentTenths + deltaTenths;
}

// The side's reason with this entry added last. A reason already holding the entry is kept as is,
// so a retried write can't repeat it. One past ESPN's limit is refused, never shortened by
// dropping an entry, since the reason must account for the whole total.
export function composeReason(existing: string, entry: string, maxLength: number): ComposedReason {
  const entries = existing === "" ? [] : existing.split(ENTRY_SEPARATOR);
  if (entries.includes(entry)) return { ok: true, reason: existing };
  const reason = [...entries, entry].join(ENTRY_SEPARATOR);
  return reason.length <= maxLength ? { ok: true, reason } : { ok: false, reason: "too_long" };
}
