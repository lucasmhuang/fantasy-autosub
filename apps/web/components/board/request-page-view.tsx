import { countsForEspnDay, espnDayLabel, formatRecentMoment } from "@injurysub/domain";
import {
  AdjustmentPanel,
  Button,
  CardStage,
  LineupChanges,
  Notice,
  ReadBack,
  type ReadBackLine,
  RecordList,
  StatusPanel,
  Tracker,
} from "@injurysub/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { faceImageProps } from "../../lib/server/images";
import { pacificCalendarDate } from "../../lib/server/pacific-time";
import type { RequestView } from "../../lib/server/request-view";
import { commissionerWord, signedPoints } from "./board-copy";
import { adjustmentKind } from "./confirm-copy";
import { arrivalMotion } from "./live-request-state";
import { surname } from "./option-copy";
import { recordText, requestStatusPanel, trackerSteps } from "./request-copy";

type Found = Extract<RequestView, { status: "found" }>;

export type RequestPageViewProps = {
  view: Found;
  zone: string;
  now: Date;
  commissionerName: string | null;
  notice?: ReactNode;
  // The open page's own check for changes, under the status (IF-REQUEST-1).
  live?: ReactNode;
  // Arrived from Confirm: the swap plays once.
  arrived?: boolean;
  // Came straight from Confirm (this load only): a refusal offers the way back to the options.
  fromConfirm?: boolean;
  // What a change seen while the page is open plays, for the stylesheet.
  motion?: string;
  // The page is watching it change, so the status stays a live region once it settles and the
  // change is read out (IF-REQUEST-8).
  announce?: boolean;
};

type Reading = { zone: string; now: Date; commissioner: string };

const MOVING = ["queued", "executing"];
const STOPPED = ["rejected", "withdrawn", "refused"];

// One of the manager's requests: the swap, where it stands, what ESPN shows, the adjustment, the
// record, and withdraw while it can still be.
export function RequestPageView({
  view,
  zone,
  now,
  commissionerName,
  notice,
  live,
  arrived = false,
  fromConfirm = false,
  motion,
  announce = false,
}: RequestPageViewProps) {
  const reading: Reading = { zone, now, commissioner: commissionerWord(commissionerName) };
  const { request } = view;
  const panel = requestStatusPanel(view, reading);
  const title = `${surname(request.replacementName)} in for ${surname(request.injuredName)}`;
  const tracked =
    MOVING.includes(request.status) || (request.status === "completed" && !view.delayed);
  return (
    <div
      className="page flow"
      data-arrival={(arrived && arrivalMotion(request.status)) || undefined}
      data-motion={motion}
    >
      <nav className="backbar">
        <Button asChild variant="ghost" back>
          {fromConfirm && request.status === "refused" ? (
            <Link href={`/app/requests/new?injured=${request.injuredPlayerId}`}>Replacements</Link>
          ) : (
            <Link href="/app/requests">Requests</Link>
          )}
        </Button>
      </nav>
      {notice}
      <SwapTop view={view} />
      <header className="reqhead">
        <h1 className="t-title">{title}</h1>
        <div className="reqhead-subtitle">{headerLine(view, reading)}</div>
      </header>
      {view.sentEdit?.differsFromConfirmed && (
        <Notice tone="info">
          Your ESPN lineup changed while this waited, so the lineup change sent differs from the one
          you confirmed. Your score is the same.
        </Notice>
      )}
      <StatusPanel
        tone={panel.tone}
        word={panel.word}
        who={panel.who}
        sentence={panel.sentence}
        live={announce || MOVING.includes(request.status)}
      >
        {tracked && (
          <Tracker
            steps={trackerSteps(request.status, view.tracker, {
              owed: view.breakdown.length > 0,
              zone,
            })}
          />
        )}
      </StatusPanel>
      <RefusedActions view={view} fromConfirm={fromConfirm} />
      {live}
      <WhatEspnShows view={view} reading={reading} />
      <Withdraw view={view} reading={reading} />
      <Adjustment view={view} />
      <RecordList
        collapsed
        events={view.events.map((event) => ({
          time: formatRecentMoment(event.at, zone, now),
          text: recordText(event.type, title, reading.commissioner),
        }))}
      />
    </div>
  );
}

// "Asked Wed 6:41 PM PT · G slot · week 4", and the ESPN day it counts for where the device's
// date isn't ESPN's (IF-TIME-2).
function headerLine(view: Found, reading: Reading): string {
  const { request } = view;
  const asked = `Asked ${formatRecentMoment(request.requestMoment, reading.zone, reading.now)}`;
  const counts = countsForEspnDay(
    request.requestMoment,
    reading.zone,
    pacificCalendarDate(request.requestMoment)
  );
  const day = counts === null ? "" : ` · counts for ${counts}`;
  return `${asked} · ${request.injuredSlot} slot · week ${request.matchupPeriodId}${day}`;
}

// The card stage while it's in line, running or done; two lines once it waits or stopped (E6).
function SwapTop({ view }: { view: Found }) {
  const { request } = view;
  const waiting = !MOVING.includes(request.status) && request.status !== "completed";
  if (waiting) {
    const verb = STOPPED.includes(request.status)
      ? "Would"
      : request.status === "reversed"
        ? "Came"
        : "Will";
    return (
      <LineupChanges
        title="The swap asked for"
        changes={[
          {
            slot: request.injuredSlot,
            name: request.replacementName,
            text: `${verb} come off the bench.`,
            face: faceImageProps(String(request.replacementPlayerId), 54),
          },
          {
            slot: "BN",
            bench: true,
            out: true,
            name: request.injuredName,
            text: `${verb} go to the bench.`,
            face: faceImageProps(String(request.injuredPlayerId), 54),
          },
        ]}
      />
    );
  }
  return (
    <CardStage
      done={request.status === "completed" && !request.rehearsal}
      sheen="cued"
      incoming={{
        name: request.replacementName,
        surname: surname(request.replacementName),
        slot: request.injuredSlot,
        average: "",
        face: faceImageProps(String(request.replacementPlayerId), 170, { eager: true }),
      }}
      outgoing={{
        name: request.injuredName,
        surname: surname(request.injuredName),
        face: faceImageProps(String(request.injuredPlayerId), 150, { eager: true }),
      }}
    />
  );
}

// Refused at Confirm: the starter's standing request, and the way back to Team (IF-CONFIRM-7).
function RefusedActions({ view, fromConfirm }: { view: Found; fromConfirm: boolean }) {
  if (view.request.status !== "refused") return null;
  const standing = view.refusal?.activeRequest ?? null;
  return (
    <>
      {standing !== null && (
        <Button asChild variant="ghost" className="w-full">
          <Link href={`/app/requests/${standing.requestId}`}>See that request</Link>
        </Button>
      )}
      {fromConfirm && (
        <Button asChild variant="primary" className="w-full">
          <Link href="/app">Back to Team</Link>
        </Button>
      )}
    </>
  );
}

// Done: what ESPN shows now. A rehearsal: what it would have sent.
function WhatEspnShows({ view, reading }: { view: Found; reading: Reading }) {
  const { request, tracker } = view;
  if (request.status !== "completed") return null;
  const coming = surname(request.replacementName);
  const going = surname(request.injuredName);
  const amount = signedPoints(request.adjustmentTenths);
  if (request.rehearsal) {
    const lines: ReadBackLine[] = [
      {
        kind: "pending",
        text: `Lineup: ${coming} BN → ${request.injuredSlot}, ${going} ${request.injuredSlot} → BN`,
        when: "Not sent",
      },
    ];
    if (view.breakdown.length > 0)
      lines.push({ kind: "pending", text: `Adjustment ${amount}`, when: "Not sent" });
    return <ReadBack title="Would have sent" lines={lines} />;
  }
  const on = (at: Date | null) =>
    at === null ? "" : `On ESPN ${formatRecentMoment(at, reading.zone, reading.now)}`;
  const lines: ReadBackLine[] = [
    {
      kind: "ok",
      text: `${coming} at ${request.injuredSlot}, ${going} on the bench`,
      when: on(tracker.lineupVerifiedAt),
    },
  ];
  if (view.breakdown.length > 0) {
    lines.push({
      kind: "ok",
      text: `${amount} adjustment, week ${request.matchupPeriodId}`,
      when: on(tracker.adjustmentVerifiedAt),
    });
  }
  return <ReadBack title="What ESPN shows now" lines={lines} />;
}

// Withdraw behind a disclosure that asks to be sure; "Too late" once the lineup went to ESPN.
function Withdraw({ view, reading }: { view: Found; reading: Reading }) {
  const { request } = view;
  const going = surname(request.injuredName);
  if (!view.canWithdraw) {
    return request.status === "executing" ? (
      <p className="text-[12px] text-text-meta">Too late to withdraw.</p>
    ) : null;
  }
  return (
    <details className="withdraw">
      <summary className="btn-sec">Withdraw request</summary>
      <section className="panel stack-12 mt-(--space-8)" aria-labelledby="h-withdraw">
        <h2 id="h-withdraw" className="t-label">
          Withdraw this request?
        </h2>
        <p className="text-[14px] text-text-2">
          {`${reading.commissioner} won't see it any more, and ${going} is free for a new request, which would count from its own time.`}
        </p>
        <form action={`/requests/${request.requestId}/withdraw`} method="post">
          <Button type="submit" variant="primary" className="w-full">
            Withdraw request
          </Button>
        </form>
      </section>
    </details>
  );
}

function Adjustment({ view }: { view: Found }) {
  const { request } = view;
  if (STOPPED.includes(request.status)) return null;
  const state = request.adjustmentIsFinal ? "Final" : "Projected";
  if (view.breakdown.length === 0) {
    return (
      <AdjustmentPanel
        total={null}
        state={state}
        lines={[]}
        foot={`${surname(request.injuredName)} hadn't played this week, so nothing is owed.`}
      />
    );
  }
  const askedDate = pacificCalendarDate(request.requestMoment);
  const dateOf = (day: number) => {
    const shifted = new Date(
      Date.parse(`${askedDate}T00:00:00Z`) + (day - request.requestDay) * 86_400_000
    );
    return espnDayLabel(shifted.toISOString().slice(0, 10));
  };
  return (
    <AdjustmentPanel
      total={signedPoints(request.adjustmentTenths)}
      state={state}
      lines={view.breakdown.map((line) => ({
        who: `${surname(line.name)} · ${dateOf(line.day)}`,
        amount: signedPoints(line.tenths),
        kind: adjustmentKind(line.why),
      }))}
      foot={request.adjustmentIsFinal ? undefined : "Can change until the swap shows on ESPN."}
    />
  );
}
