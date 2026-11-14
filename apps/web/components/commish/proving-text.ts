import { formatTenths } from "@injurysub/domain";

// S15: team 1's side to put back by hand, as it was read before the test adjustment.
export function restoreSideText(side: { tenths: number; reason: string }): string {
  const note = side.reason === "" ? "no note" : `the note “${side.reason}”`;
  return `Check team 1’s adjustment on ESPN. If it isn’t ${formatTenths(side.tenths)} points with ${note}, set it back to that.`;
}
