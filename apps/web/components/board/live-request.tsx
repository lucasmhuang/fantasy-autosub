"use client";

import { Notice } from "@injurysub/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  afterPoll,
  type ChangeMotion,
  changeMotions,
  FIRST_POLL_MS,
  type FoundRequestView,
  liveStatusOf,
  POLL_GAVE_UP,
  type PollOutcome,
  reviveRequestView,
  SWAP_ENDS_MS,
  sameStatus,
  stillMoving,
} from "./live-request-state";
import { RequestPageView } from "./request-page-view";

// Long enough for the longest motion: the sheen, 400 ms in, for 1.6 s.
const MOTION_CLEARS_MS = 2100;

export type LiveRequestPageProps = {
  view: FoundRequestView;
  zone: string;
  now: Date;
  commissionerName: string | null;
  notice?: ReactNode;
  arrived: boolean;
};

// A request's page that keeps itself current without reloading: while the request can still
// change it asks for the request's view every 3 s, and shows a changed one in place with the
// motion the change calls for (IF-MOTION-4 to -9). It stops once the request settles, when the
// page is left, and pauses while the tab is hidden. After 10 failed checks in a row it says to
// reload (FM-REQUEST-7).
export function LiveRequestPage({ view: first, arrived, ...props }: LiveRequestPageProps) {
  const [view, setView] = useState(first);
  const [motion, setMotion] = useState<ChangeMotion[]>([]);
  const [arriving, setArriving] = useState(arrived);
  const [gaveUp, setGaveUp] = useState(false);
  const shown = useRef(first);
  const { requestId } = first.request;
  const path = `/requests/${requestId}/status`;

  // The swap played once on arrival from Confirm; a reload or a later visit shows it at rest.
  useEffect(() => {
    if (!arrived) return;
    const address = new URL(window.location.href);
    address.searchParams.delete("from");
    window.history.replaceState(null, "", address);
    const settle = setTimeout(() => setArriving(false), SWAP_ENDS_MS);
    return () => clearTimeout(settle);
  }, [arrived]);

  useEffect(() => {
    if (motion.length === 0) return;
    const clear = setTimeout(() => setMotion([]), MOTION_CLEARS_MS);
    return () => clearTimeout(clear);
  }, [motion]);

  useEffect(() => {
    if (!stillMoving(shown.current.request.status)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;
    const aborts = new AbortController();

    const schedule = (delayMs: number) => {
      if (stopped || document.hidden) return;
      timer = setTimeout(check, delayMs);
    };
    const check = async () => {
      timer = undefined;
      const answer = await pollView(path, requestId, aborts.signal);
      if (answer === null) return;
      if (answer.kind === "answered") {
        const before = liveStatusOf(shown.current);
        const after = liveStatusOf(answer.view);
        if (!sameStatus(before, after)) {
          shown.current = answer.view;
          setMotion(changeMotions(before, after));
          setView(answer.view);
        }
      }
      const outcome: PollOutcome =
        answer.kind === "answered"
          ? { kind: "answered", status: liveStatusOf(answer.view) }
          : answer;
      const next = afterPoll(failures, outcome);
      if (next.next === "stop") {
        stopped = true;
        if (next.reason === "gave_up") setGaveUp(true);
        return;
      }
      failures = next.failures;
      schedule(next.delayMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined) {
        schedule(0);
      }
    };

    schedule(FIRST_POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      aborts.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [path, requestId]);

  return (
    <RequestPageView
      {...props}
      view={view}
      arrived={arriving}
      motion={motion.join(" ") || undefined}
      live={
        <div data-live-request={stillMoving(view.request.status) ? path : undefined}>
          {gaveUp && (
            <Notice tone="fail" announce>
              {POLL_GAVE_UP}
            </Notice>
          )}
        </div>
      }
    />
  );
}

type PollAnswer =
  | { kind: "answered"; view: FoundRequestView }
  | Exclude<PollOutcome, { kind: "answered" }>;

// One check. Null when the page was left mid-check.
async function pollView(
  path: string,
  requestId: string,
  signal: AbortSignal
): Promise<PollAnswer | null> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(path, { cache: "no-store", signal });
    text = await response.text();
  } catch (error) {
    if (signal.aborted) return null;
    // The network didn't answer: a failed check, tried again later.
    if (error instanceof TypeError) return { kind: "failed" };
    throw error;
  }
  if (response.status === 401 || response.status === 404) return { kind: "refused" };
  if (!response.ok) return { kind: "failed" };
  try {
    const view = reviveRequestView(text, requestId);
    return view === null ? { kind: "failed" } : { kind: "answered", view };
  } catch (error) {
    // Not JSON (a proxy's error page): a failed check.
    if (error instanceof SyntaxError) return { kind: "failed" };
    throw error;
  }
}
