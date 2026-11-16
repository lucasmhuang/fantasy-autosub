"use client";

import { Notice } from "@injurysub/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  type ChangeMotion,
  changeMotions,
  type FoundRequestView,
  liveStatusOf,
  POLL_GAVE_UP,
  SWAP_ENDS_MS,
  stillMoving,
} from "./live-request-state";
import { RequestPageView } from "./request-page-view";
import { createRequestPoller } from "./request-poller";

// Long enough for the longest motion: the sheen, 400 ms in, for 1.6 s.
const MOTION_CLEARS_MS = 2100;

export type LiveRequestPageProps = {
  view: FoundRequestView;
  zone: string;
  now: Date;
  commissionerName: string | null;
  notice?: ReactNode;
  arrived: boolean;
  fromConfirm?: boolean;
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
    const poller = createRequestPoller({
      requestId,
      fetchText: async (address, signal) => {
        const response = await fetch(address, { cache: "no-store", signal });
        return { status: response.status, text: await response.text() };
      },
      shown: () => shown.current,
      apply: (next) => {
        setMotion(changeMotions(liveStatusOf(shown.current), liveStatusOf(next)));
        shown.current = next;
        setView(next);
      },
      giveUp: () => setGaveUp(true),
      isHidden: () => document.hidden,
    });
    poller.start();
    document.addEventListener("visibilitychange", poller.visibilityChanged);
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", poller.visibilityChanged);
    };
  }, [requestId]);

  return (
    <RequestPageView
      {...props}
      view={view}
      arrived={arriving}
      motion={motion.join(" ") || undefined}
      announce={stillMoving(first.request.status)}
      live={
        <div
          data-live-request={
            stillMoving(view.request.status) ? `/requests/${requestId}/status` : undefined
          }
        >
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
