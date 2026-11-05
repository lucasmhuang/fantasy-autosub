// Fantasy points as integer tenths. Every league value is a multiple of 0.1 (integer stats times
// 1, 1.2, 1.5, 3, 3 and -1), so tenths add exactly where floats drift (1.2 * 7 is 8.3999…).
export function toTenths(points: number): number {
  if (!Number.isFinite(points)) throw new RangeError("Fantasy points must be a finite number.");
  // + 0 turns Math.round's -0 into 0.
  return Math.round(points * 10) + 0;
}

export function formatTenths(tenths: number, options: { signed?: boolean } = {}): string {
  const magnitude = Math.abs(tenths);
  const digits = `${Math.trunc(magnitude / 10)}.${magnitude % 10}`;
  if (tenths < 0) return `-${digits}`;
  return options.signed && tenths > 0 ? `+${digits}` : digits;
}
