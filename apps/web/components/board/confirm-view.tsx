import { countsForEspnDay, espnDayChangeTime, espnDayLabel, formatMoment } from "@injurysub/domain";
import {
  AdjustmentPanel,
  Button,
  Foil,
  Icon,
  LineupChanges,
  Notice,
  PlayerCard,
  SectionHeader,
  WeekStrip,
} from "@injurysub/ui";
import type { ReactNode } from "react";
import { faceImageProps, logoImageProps } from "../../lib/server/images";
import { pacificCalendarDate } from "../../lib/server/pacific-time";
import type { ConfirmationView } from "../../lib/server/requests";
import { FreshTime } from "../shell/fresh-time";
import { commissionerWord, points, signedPoints } from "./board-copy";
import {
  adjustmentKind,
  afterYouConfirm,
  confirmButtonLabel,
  confirmRoute,
  confirmSubtitle,
  lineupChangeRows,
} from "./confirm-copy";
import { ConfirmSubmit } from "./confirm-submit";
import { surname } from "./option-copy";

export type Confirmable = Extract<ConfirmationView, { status: "confirm" }>;

export type ConfirmViewProps = {
  view: Confirmable;
  zone: string;
  now: Date;
  commissionerName: string | null;
  // The answer to a Confirm that recorded nothing (the edit or week changed, ESPN unreachable).
  notice?: ReactNode;
};

const PUBLIC =
  "Can change until the swap shows on ESPN. It posts publicly on ESPN's activity feed.";

// Confirm: the swap, the adjustment it would post, what happens next, and the one action.
export function ConfirmView({ view, zone, now, commissionerName, notice }: ConfirmViewProps) {
  const commissioner = commissionerWord(commissionerName);
  const route = confirmRoute(view.option.status, view.route);
  const edit = view.option.edit ?? { items: [], movedStarters: 0 };
  const amount = signedPoints(view.projection?.totalTenths ?? 0);
  const owed = (view.projection?.lines.length ?? 0) > 0;
  const chooseHref = `/app/requests/new?injured=${view.starter.playerId}`;
  const changes = lineupChangeRows(edit, route === "review");
  return (
    <div className="page flow">
      {view.changedFrom === null ? (
        notice
      ) : (
        <Notice tone="wait">
          {`Your ESPN lineup changed: ${surname(view.changedFrom.now)} moves now, not ${surname(view.changedFrom.before)}. Nothing was recorded.`}
        </Notice>
      )}
      <nav className="backbar">
        <Button asChild variant="ghost" back>
          <a href={chooseHref}>Replacements</a>
        </Button>
      </nav>
      <header className="titleblock">
        <h1 className="t-title">{`${surname(view.option.name)} in for ${surname(view.starter.name)}`}</h1>
        <div className="titleblock-subtitle">{confirmSubtitle(route, edit, commissioner)}</div>
      </header>
      <SwapPair view={view} />
      <EspnDayNotice view={view} zone={zone} now={now} />
      <BeforeRequestPoints view={view} zone={zone} />
      {changes.length > 0 && (
        <LineupChanges
          aside={edit.items.length === 2 ? "No one else moves" : undefined}
          changes={changes.map((change) => ({
            ...change,
            face: faceImageProps(String(change.playerId), 54),
            out: change.bench,
          }))}
        />
      )}
      <Adjustment view={view} route={route} commissioner={commissioner} />
      <section className="after" aria-labelledby="h-after">
        <SectionHeader id="h-after">After you confirm</SectionHeader>
        <p>
          {afterYouConfirm(
            { route, edit, amount, owed, rulesHeld: view.rulesHeld === true },
            commissioner
          )}
        </p>
      </section>
      <form className="confirm-bar" action="/requests" method="post">
        <input type="hidden" name="injured" value={view.starter.playerId} />
        <input type="hidden" name="replacement" value={view.option.playerId} />
        <input type="hidden" name="idempotencyKey" value={view.idempotencyKey} />
        <input type="hidden" name="edit" value={view.editShown} />
        <input type="hidden" name="period" value={view.matchupPeriodId} />
        <ConfirmSubmit
          label={confirmButtonLabel(
            route,
            owed ? amount : "0.0",
            commissioner,
            view.changedFrom !== null
          )}
        />
        <Button asChild variant="quiet">
          <a href={chooseHref}>Back to replacements</a>
        </Button>
      </form>
    </div>
  );
}

function SwapPair({ view }: { view: Confirmable }) {
  const { starter, option } = view;
  const suspended = starter.designation === "SUSPENSION";
  const into = option.edit?.items.at(-1)?.toSlot ?? starter.slot;
  // The corner shows his team's logo; the band names the team only where there's none.
  const incomingLogo = logoImageProps(option.proTeam, 26);
  return (
    <section className="swap-pair" aria-label="The swap">
      <div>
        <div className="t-eyebrow label">To the bench</div>
        <PlayerCard
          size="m"
          surname={surname(starter.name)}
          team={starter.proTeam}
          face={faceImageProps(String(starter.playerId), 170, { eager: true })}
          number={points(starter.forfeitTenths / 10)}
          numberLabel="Forfeits"
          fact={`${starter.slot} · ${starter.proTeam}`}
          finish={suspended ? "suspended" : "out"}
        />
      </div>
      <div className="arrow" aria-hidden="true">
        <Icon name="move" size={20} />
      </div>
      <div>
        <div className="t-eyebrow label into">Into the lineup</div>
        <Foil confirmed>
          <PlayerCard
            size="m"
            surname={surname(option.name)}
            team={option.proTeam}
            logo={incomingLogo}
            face={faceImageProps(String(option.playerId), 170, { eager: true })}
            number={
              option.seasonAveragePoints === null ? "—" : option.seasonAveragePoints.toFixed(1)
            }
            numberLabel="Season avg"
            fact={`${into}${incomingLogo === null ? ` · ${option.proTeam}` : ""} · ${option.gamesLeft} ${option.gamesLeft === 1 ? "game" : "games"} left`}
          />
        </Foil>
      </div>
    </section>
  );
}

// After midnight east of Pacific, before ESPN's day changes, the swap still counts for ESPN's day
// (IF-CONFIRM-9); the time comes from domain, never written as copy.
function EspnDayNotice({ view, zone, now }: { view: Confirmable; zone: string; now: Date }) {
  const today = view.week.days.find((day) => day.scoringPeriodId === view.week.today)?.date;
  // Only while ESPN's day is the clock's Pacific date: a stale or recorded day says nothing.
  const current = today !== undefined && today === pacificCalendarDate(now);
  const label = current && today ? countsForEspnDay(now, zone, today) : null;
  if (label === null) return null;
  return (
    <Notice tone="info">
      {`This swap counts for ${label}: ESPN's day doesn't change until ${espnDayChangeTime(now, zone)}. ${surname(view.option.name)}'s points from earlier that day won't count.`}
    </Notice>
  );
}

// Points the replacement scored before the request don't count (D12): said before the tap.
function BeforeRequestPoints({ view, zone }: { view: Confirmable; zone: string }) {
  const { option } = view;
  if (!option.warnings.includes("already_scored")) return null;
  const name = surname(option.name);
  const so = points(option.weekPoints);
  const lead =
    option.gameState?.phase === "live"
      ? `${name} is playing now: ${so} pts so far (`
      : `${name} has ${so} pts this week (`;
  return (
    <Notice tone="taken">
      {lead}
      <FreshTime at={view.readAt} time={formatMoment(new Date(view.readAt), zone, "time")} />
      {"). Whatever he has when you confirm won't count; everything after will."}
    </Notice>
  );
}

function Adjustment(props: { view: Confirmable; route: string; commissioner: string }) {
  const { view, commissioner } = props;
  const lines = view.projection?.lines ?? [];
  const dates = new Map(view.week.days.map((day) => [day.scoringPeriodId, day.date]));
  const held = view.rulesHeld === true && (
    <Notice tone="wait">
      {`${commissioner} posts this adjustment by hand: the league's ESPN settings differ from InjurySub's.`}
    </Notice>
  );
  if (lines.length === 0) {
    return (
      <AdjustmentPanel
        total={null}
        state="Projected"
        lines={[]}
        notice={held || undefined}
        foot={`${surname(view.starter.name)} hadn't played this week, so nothing is owed.`}
      />
    );
  }
  const netByDay = new Map<number, number>();
  for (const line of lines) netByDay.set(line.day, (netByDay.get(line.day) ?? 0) + line.tenths);
  return (
    <AdjustmentPanel
      total={signedPoints(view.projection?.totalTenths ?? 0)}
      state="Projected"
      notice={held || undefined}
      lines={lines.map((line) => {
        const date = dates.get(line.day);
        return {
          who: `${surname(line.name)}${date ? ` · ${espnDayLabel(date)}` : ""}`,
          amount: signedPoints(line.tenths),
          kind: adjustmentKind(line.why),
        };
      })}
      strip={
        <WeekStrip
          cells={view.week.days.map((day) => {
            const net = netByDay.get(day.scoringPeriodId);
            const [weekday = "", , date = ""] = day.date ? espnDayLabel(day.date).split(" ") : [];
            return { day: weekday, date, net: net === undefined ? undefined : signedPoints(net) };
          })}
        />
      }
      foot={props.route === "review" ? "Can change until the swap shows on ESPN." : PUBLIC}
    />
  );
}
