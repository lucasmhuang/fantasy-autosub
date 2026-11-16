import {
  afterPoll,
  FIRST_POLL_MS,
  type FoundRequestView,
  liveStatusOf,
  type PollOutcome,
  reviveRequestView,
  sameStatus,
  stillMoving,
} from "./live-request-state";

// A check longer than this counts as failed, so a dead connection backs off and, in the end,
// says to reload instead of silently stopping (FM-REQUEST-7).
const CHECK_TIMEOUT_MS = 15_000;

export type PollerAnswer = { status: number; text: string };

export type RequestPollerOptions = {
  requestId: string;
  // The status route's answer; rejects when the network doesn't answer or the signal aborts.
  fetchText: (path: string, signal: AbortSignal) => Promise<PollerAnswer>;
  // The view the page shows now.
  shown: () => FoundRequestView;
  apply: (next: FoundRequestView) => void;
  giveUp: () => void;
  isHidden: () => boolean;
};

// The request page's checks for changes, one at a time: the first 3 s after start, then as
// `afterPoll` says. A hidden tab schedules none; coming back checks at once unless a check is in
// flight. Nothing answers into the page once stopped.
export function createRequestPoller(options: RequestPollerOptions) {
  const path = `/requests/${options.requestId}/status`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | null = null;
  let failures = 0;
  let stopped = false;

  const schedule = (delayMs: number) => {
    if (stopped || options.isHidden() || inFlight !== null) return;
    clearTimeout(timer);
    timer = setTimeout(check, delayMs);
  };

  const check = async () => {
    timer = undefined;
    const aborts = new AbortController();
    inFlight = aborts;
    const deadline = setTimeout(() => aborts.abort(), CHECK_TIMEOUT_MS);
    const outcome = await checkOnce(path, options, aborts.signal);
    clearTimeout(deadline);
    inFlight = null;
    if (stopped) return;
    if (outcome.kind === "answered") {
      const next = outcome.view;
      if (!sameStatus(liveStatusOf(options.shown()), liveStatusOf(next))) options.apply(next);
    }
    const asOutcome: PollOutcome =
      outcome.kind === "answered"
        ? { kind: "answered", status: liveStatusOf(outcome.view) }
        : outcome;
    const next = afterPoll(failures, asOutcome);
    if (next.next === "stop") {
      stopped = true;
      if (next.reason === "gave_up") options.giveUp();
      return;
    }
    failures = next.failures;
    schedule(next.delayMs);
  };

  return {
    start() {
      if (stillMoving(options.shown().request.status)) schedule(FIRST_POLL_MS);
    },
    visibilityChanged() {
      if (options.isHidden()) {
        clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined) {
        schedule(0);
      }
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      inFlight?.abort();
    },
  };
}

type CheckOutcome =
  | { kind: "answered"; view: FoundRequestView }
  | Exclude<PollOutcome, { kind: "answered" }>;

async function checkOnce(
  path: string,
  options: RequestPollerOptions,
  signal: AbortSignal
): Promise<CheckOutcome> {
  let answer: PollerAnswer;
  try {
    answer = await options.fetchText(path, signal);
  } catch (error) {
    // The network didn't answer, or the check ran past its deadline (or was stopped, which
    // the caller ignores): a failed check, tried again later.
    if (error instanceof TypeError || signal.aborted) return { kind: "failed" };
    throw error;
  }
  if (answer.status === 401 || answer.status === 404) return { kind: "refused" };
  if (answer.status < 200 || answer.status > 299) return { kind: "failed" };
  try {
    const view = reviveRequestView(answer.text, options.requestId);
    return view === null ? { kind: "failed" } : { kind: "answered", view };
  } catch (error) {
    // Not JSON (a proxy's error page): a failed check.
    if (error instanceof SyntaxError) return { kind: "failed" };
    throw error;
  }
}
