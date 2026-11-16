import { Note, OptionCard, SectionHeader } from "@injurysub/ui";
import type { BoardOption } from "../../lib/server/board";
import { faceImageProps } from "../../lib/server/images";
import { gameText, type ReadyRoute, readyGroupLabel } from "./board-copy";
import { gameDays, optionLabel, optionNotes } from "./option-copy";

// Confirm for one starter and one replacement.
export function confirmHref(injuredId: number, replacementId: number): string {
  return `/app/requests/new?injured=${injuredId}&replacement=${replacementId}`;
}

type GroupsProps = {
  injuredId: number;
  options: BoardOption[];
  route: ReadyRoute;
  commissioner: string;
  zone: string;
  // The grid's classes: two up on a phone, three at 1280 ("grid2 is-wide").
  grid: string;
};

// One option as a card: Confirm for a Ready or commissioner's option, nothing for a Not valid one.
export function OptionCardFor(
  props: Omit<GroupsProps, "options" | "grid"> & { option: BoardOption }
) {
  const { option, route, commissioner, zone } = props;
  const game = gameText(option, zone);
  const notValid = option.status === "not_valid";
  return (
    <OptionCard
      name={option.name}
      team={option.proTeam}
      positions={option.position}
      face={faceImageProps(String(option.playerId), 158)}
      average={option.seasonAveragePoints === null ? "—" : option.seasonAveragePoints.toFixed(1)}
      gamesLeft={String(option.gamesLeft)}
      gameDays={gameDays(option.upcomingGames, zone)}
      next={game.text}
      live={game.live}
      notes={optionNotes(option).map((note) => (
        <Note key={note.text} kind={note.kind}>
          {note.text}
        </Note>
      ))}
      href={notValid ? undefined : confirmHref(props.injuredId, option.playerId)}
      label={optionLabel(option, route, commissioner)}
      notValid={notValid}
    />
  );
}

// The Ready options under the league's route, then the commissioner's; Not valid ones are the
// consumer's (Choose shows them behind a disclosure).
export function OptionGroups(props: GroupsProps) {
  const ready = props.options.filter((each) => each.status === "ready_now");
  const review = props.options.filter((each) => each.status === "review_required");
  const group = (key: string, label: string, tone: "ok" | "wait", options: BoardOption[]) =>
    options.length === 0 ? null : (
      <section aria-labelledby={`h-${key}`} className="stack-8">
        <SectionHeader id={`h-${key}`} tone={tone}>
          {`${label} · ${options.length}`}
        </SectionHeader>
        <div className={props.grid}>
          {options.map((option) => (
            <OptionCardFor key={option.playerId} {...props} option={option} />
          ))}
        </div>
      </section>
    );
  return (
    <>
      {group(
        "ready",
        readyGroupLabel(props.route, props.commissioner),
        props.route === "now" ? "ok" : "wait",
        ready
      )}
      {group("review", `${props.commissioner} decides`, "wait", review)}
    </>
  );
}
