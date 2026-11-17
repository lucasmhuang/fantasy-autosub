import type { BoardRowProps } from "@injurysub/ui";
import type { BoardRosterPlayer } from "../../lib/server/board";
import { faceImageProps, logoImageProps } from "../../lib/server/images";
import { gameText, points } from "./board-copy";

const PILLS: Partial<Record<BoardRosterPlayer["designation"], BoardRowProps["pill"]>> = {
  OUT: "out",
  SUSPENSION: "suspended",
};

// One rostered player as a board row: the team page's roster and the filing form's pick rows.
// The board pills only its bench; the filing form names every starter's designation too.
export function boardRowProps(
  player: BoardRosterPlayer,
  slot: string,
  options: { bench: boolean; stale: boolean; zone: string; pill: boolean }
): BoardRowProps {
  const game = gameText(player, options.zone);
  return {
    slot: options.bench ? "BN" : slot,
    name: player.name,
    team: player.proTeam,
    logo: logoImageProps(player.proTeam, 42),
    face: faceImageProps(String(player.playerId), 72),
    meta: `${player.proTeam} · ${game.text}`,
    live: game.live && !options.stale,
    dayToDay: player.designation === "DAY_TO_DAY",
    pill: options.pill ? PILLS[player.designation] : undefined,
    bench: options.bench,
    weekPoints: points(player.weekPoints),
    average: player.seasonAveragePoints === null ? "—" : player.seasonAveragePoints.toFixed(1),
  };
}
