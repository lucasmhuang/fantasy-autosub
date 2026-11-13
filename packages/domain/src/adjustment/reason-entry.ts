import { ENTRY_SEPARATOR } from "./ledger";
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
export function adjustmentReasonEntry(request: NamedRequest, deltaTenths: number): string {
  return `${entryStart(request)}${formatTenths(deltaTenths, { signed: true })}`;
}

type NamedRequest = { requestMoment: Date; injuredName: string; replacementName: string };

// Everything in a request's entry but its amount.
function entryStart(request: NamedRequest): string {
  const moment = `${momentFormat.format(request.requestMoment)} PT`;
  return `Injury sub requested ${moment}: ${request.replacementName} for ${request.injuredName}, `;
}

const AMOUNT = /^[+-]?\d+\.\d$/;

// This request's entry in a side's reason, at whatever amount it was written with; null when the
// reason doesn't name the request. A side that already names it is never added to again.
export function findRequestEntry(reason: string, request: NamedRequest): string | null {
  const start = entryStart(request);
  const named = reason
    .split(ENTRY_SEPARATOR)
    .find((entry) => entry.startsWith(start) && AMOUNT.test(entry.slice(start.length)));
  return named ?? null;
}

const ENTRY_AMOUNT = /^Injury sub requested .*, ([+-]?\d+\.\d)$/;

// The amount, in tenths, of an entry adjustmentReasonEntry wrote; null for any other text. Recovery
// reads it from a write whose answer was lost, to complete the request with the amount written.
export function amountInReasonEntry(entry: string): number | null {
  const amount = ENTRY_AMOUNT.exec(entry)?.[1];
  return amount === undefined ? null : toTenths(Number(amount));
}
