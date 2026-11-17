import { formatRecentMoment, teamName } from "@injurysub/domain";
import { LineupChanges, ManualSteps, Note, Notice } from "@injurysub/ui";
import type { ReactNode } from "react";
import type { RequestDetailView } from "../../lib/server/commish";
import { faceImageProps } from "../../lib/server/images";
import { commissionerWord } from "../board/board-copy";
import { surname } from "../board/option-copy";
import { FreshTime } from "../shell/fresh-time";
import { byHandWords, reverseWords } from "./by-hand-copy";
import { CopyButton } from "./copy-button";
import { comparePanel } from "./request-detail-copy";

type Found = Extract<RequestDetailView, { status: "found" }>;
type Reading = { zone: string; now: Date; ownTeam: boolean };

const teamOf = (detail: Found) => teamName(detail.request.teamId, detail.names.team);
const slotName = (slot: string) => (slot === "BE" ? "BN" : slot);

// What's left to do by hand on ESPN, from ESPN as this page read it (FS-DETAIL-7, -8).
export function ByHand({ detail, reading }: { detail: Found; reading: Reading }) {
  const words = byHandWords(
    { steps: detail.instructions, request: detail.request, team: teamOf(detail) },
    reading
  );
  if (words.kind === "none") return null;
  if (words.kind === "unreadable") {
    return (
      <ManualSteps
        readAt={words.readAt}
        steps={[]}
        notes={
          <Notice tone="info" action={{ label: "Try again", href: "?" }}>
            {"Can't read ESPN right now, so the steps can't be worked out."}
          </Notice>
        }
      />
    );
  }
  return (
    <ManualSteps
      readAt={words.readAt}
      notes={
        words.notes.length === 0
          ? undefined
          : words.notes.map((note) => (
              <Note key={note.text} kind={note.tone}>
                {note.text}
              </Note>
            ))
      }
      steps={words.steps.map((step) => ({
        title: step.title,
        text: step.text,
        done: step.done,
        moves: step.moves?.map((move) => ({
          text: move.text,
          out: move.out,
          face: faceImageProps(String(move.playerId), 54),
        })),
        value: step.value && {
          text: step.value.text,
          long: step.value.long,
          action: <CopyButton text={step.value.text} what={step.value.what} />,
        },
      }))}
    />
  );
}

// A held or changed adjustment's two amounts side by side (FS-DETAIL-10, -11).
export function ComparePanel({ detail, reading }: { detail: Found; reading: Reading }) {
  const panel = comparePanel(detail, reading);
  if (panel === null) return null;
  return (
    <section className="panel stack-12" aria-labelledby="compare-amounts">
      <h2 id="compare-amounts" className="t-label">
        {panel.title}
      </h2>
      <div className="compare">
        {[panel.left, panel.right].map((side) => (
          <div key={side.k}>
            <div className="k">{side.k}</div>
            <div className="v">{side.v}</div>
            {side.s && <div className="s">{side.s}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

// A lineup that changed after the request: the edit that would be sent now beside the one
// the manager confirmed (FS-DETAIL-9).
export function StaleChanges({ detail, reading }: { detail: Found; reading: Reading }) {
  const { instructions, request } = detail;
  if (request.reviewReason !== "stale" || instructions.status !== "ready") return null;
  const manager = commissionerWord(detail.names.manager, true);
  const changes = (moves: typeof instructions.lineupMoves) =>
    moves.map((move) => ({
      slot: slotName(move.toSlot),
      bench: move.toSlot === "BE",
      out: move.playerId === request.injuredPlayerId,
      name: move.name,
      text: `${slotName(move.fromSlot)} → ${slotName(move.toSlot)}`,
      face: faceImageProps(String(move.playerId), 54),
    }));
  const readAt = formatRecentMoment(instructions.readAt, reading.zone, reading.now);
  const asked = formatRecentMoment(request.requestMoment, reading.zone, reading.now);
  return (
    <>
      <LineupChanges
        title="Would be sent now"
        aside={
          <>
            From ESPN <FreshTime at={instructions.readAt.toISOString()} time={readAt} />
          </>
        }
        id="sent-now"
        changes={changes(instructions.lineupMoves)}
      />
      {instructions.confirmedMoves && (
        <LineupChanges
          title={`${manager} saw this ${asked}`}
          aside={`Confirmed by ${manager}`}
          id="confirmed"
          changes={changes(instructions.confirmedMoves)}
        />
      )}
    </>
  );
}

// A done request's reversal (FS-DETAIL-15): the value that takes its amount back off ESPN.
export function ReversePanel({
  detail,
  fallback,
  children,
}: {
  detail: Found;
  fallback: string;
  children: ReactNode;
}) {
  const { reversal, request } = detail;
  // With no adjustment posted there's no value to set: the fallback says so.
  const words =
    reversal === null || reversal.appliedTenths === 0
      ? null
      : reverseWords({ request, team: teamOf(detail), reversal });
  return (
    <section className="panel stack-12" aria-labelledby="reverse">
      <h2 id="reverse" className="t-label">
        Reverse
      </h2>
      <p className="text-[14px] text-text-2">{words?.text ?? fallback}</p>
      {words && (
        <div className="copyval">
          <code>{words.value}</code>
          <CopyButton text={words.value} what={`${surname(request.injuredName)}'s reversal`} />
        </div>
      )}
      {children}
    </section>
  );
}
