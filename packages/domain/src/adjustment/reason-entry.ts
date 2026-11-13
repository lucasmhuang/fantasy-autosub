import { formatTenths, toTenths } from "./points";

// The longest adjustment reason the app writes or asks for: ESPN stored a 1,000-character reason
// whole on team 1 (2026-11-13). Its own limit, if any, is higher and unmeasured.
export const ADJUSTMENT_REASON_MAX_LENGTH = 1_000;

const momentFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// A request's entry in its side's adjustment reason, the same whether the worker writes it or
// the commissioner types it in by hand, so neither repeats the other (composeReason skips an
// entry already there): "Injury sub requested Tue, 10/27, 7:10 PM PT: Toumani Camara for Jaren
// Jackson Jr., +5.1".
export function adjustmentReasonEntry(
  request: { requestMoment: Date; injuredName: string; replacementName: string },
  deltaTenths: number
): string {
  const moment = `${momentFormat.format(request.requestMoment)} PT`;
  const amount = formatTenths(deltaTenths, { signed: true });
  return `Injury sub requested ${moment}: ${request.replacementName} for ${request.injuredName}, ${amount}`;
}

const ENTRY_AMOUNT = /^Injury sub requested .*, ([+-]?\d+\.\d)$/;

// The amount, in tenths, of an entry adjustmentReasonEntry wrote; null for any other text. Recovery
// reads it from a write whose answer was lost, to complete the request with the amount written.
export function amountInReasonEntry(entry: string): number | null {
  const amount = ENTRY_AMOUNT.exec(entry)?.[1];
  return amount === undefined ? null : toTenths(Number(amount));
}
