import { cn } from "../lib/cn";
import { Foil, PlayerCard } from "./player-card";
import type { FaceImage } from "./player-face";

export type StagePlayer = {
  name: string;
  surname: string;
  team?: string | null;
  face?: FaceImage | null;
};

export type CardStageProps = {
  incoming: StagePlayer & { slot: string; average: string; logo?: string | null };
  outgoing: StagePlayer;
  // ESPN has confirmed the swap.
  done: boolean;
  // The swap's motion, once, on arrival from Confirm.
  play?: boolean;
  // The sheen, once, when ESPN confirms while the page is open.
  sheen?: boolean;
};

// The swap as two cards: the starter tilted back, the replacement in its foil in front. One
// image to a screen reader; the page's title says the same in words.
export function CardStage({
  incoming,
  outgoing,
  done,
  play = false,
  sheen = false,
}: CardStageProps) {
  return (
    <div
      className={cn("stage", play && "play")}
      role="img"
      aria-label={`${incoming.name}'s card in front, ${outgoing.name}'s card behind`}
    >
      <div className="outgoing">
        <PlayerCard
          size="xs"
          surname={outgoing.surname}
          team={outgoing.team}
          face={outgoing.face}
          finish={done ? "benched" : "out"}
          band={done ? "Bench" : "To bench"}
        />
      </div>
      <div className="incoming">
        <Foil confirmed={done} onStage>
          <PlayerCard
            size="s"
            surname={incoming.surname}
            team={incoming.team}
            logo={incoming.logo}
            face={incoming.face}
            number={incoming.average}
            band={`${incoming.surname} · ${incoming.slot}`}
            sheen={done && sheen}
          />
        </Foil>
      </div>
    </div>
  );
}
