"use client";

import { Notice } from "@injurysub/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  afterPoll,
  catchUp,
  type LiveStatus,
  liveStatusSchema,
  POLL_GAVE_UP,
  type PollOutcome,
  stillMoving,
} from "./live-request-state";

const FIRST_POLL_MS = 3000;

// Keeps an open request page current without reloading it: it asks for the request's status
// every 3 s while the request can still change, and re-renders the page in place when the answer
// differs from what the page shows. It stops once the page shows a settled request, when the page
// is left, and pauses while the tab is hidden. After 10 failed checks in a row it says to reload
// (FM-REQUEST-7).
export function LiveRequest({ status }: { status: LiveStatus }) {
  const path = `/requests/${status.requestId}/status`;
  const router = useRouter();
  // What the page shows: the status it was last rendered with.
  const shown = useRef(status);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    shown.current = status;
  }, [status]);

  useEffect(() => {
    if (!stillMoving(shown.current.status)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let behind = 0;
    let stopped = false;
    const aborts = new AbortController();

    const schedule = (delayMs: number) => {
      if (stopped || document.hidden) return;
      timer = setTimeout(check, delayMs);
    };
    const check = async () => {
      timer = undefined;
      const outcome = await pollStatus(path, aborts.signal);
      if (outcome === null) return;
      const next = afterPoll(failures, outcome, shown.current);
      if (next.next === "stop") {
        stopped = true;
        if (next.reason === "gave_up") setGaveUp(true);
        return;
      }
      failures = next.failures;
      behind = next.refresh ? behind + 1 : 0;
      if (next.refresh && catchUp(behind) === "reload") {
        window.location.reload();
        return;
      }
      if (next.refresh) router.refresh();
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
  }, [path, router]);

  return (
    <div data-live-request={stillMoving(status.status) ? path : undefined}>
      {gaveUp && (
        <Notice tone="fail" announce>
          {POLL_GAVE_UP}
        </Notice>
      )}
    </div>
  );
}

// One check. Null when the page was left mid-check.
async function pollStatus(path: string, signal: AbortSignal): Promise<PollOutcome | null> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", signal });
  } catch (error) {
    if (signal.aborted) return null;
    // The network didn't answer: a failed check, tried again later.
    if (error instanceof TypeError) return { kind: "failed" };
    throw error;
  }
  if (response.status === 401 || response.status === 404) return { kind: "refused" };
  if (!response.ok) return { kind: "failed" };
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal.aborted) return null;
    // Not JSON (a proxy's error page): a failed check.
    if (error instanceof SyntaxError) return { kind: "failed" };
    throw error;
  }
  const parsed = liveStatusSchema.safeParse(body);
  return parsed.success ? { kind: "answered", status: parsed.data } : { kind: "failed" };
}
