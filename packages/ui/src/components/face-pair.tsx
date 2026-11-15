import { cn } from "../lib/cn";
import { type FaceImage, PlayerFace } from "./player-face";
import { teamStyle } from "./team";

export type SmallFaceProps = { face?: FaceImage | null; team?: string | null; out?: boolean };

// A 40 px face on the team's ground, beside a swap or a lineup move named in text.
export function SmallFace({ face, team, out = false }: SmallFaceProps) {
  return (
    <div className={cn("face-s", out && "is-out")} style={teamStyle(team)}>
      <PlayerFace image={face} />
    </div>
  );
}

// A swap at a glance: the starter dimmed behind, the replacement in front. The row's text
// names them, so the pair is hidden from screen readers.
export function FacePair({
  incoming,
  outgoing,
}: {
  incoming: SmallFaceProps;
  outgoing: SmallFaceProps;
}) {
  return (
    <div className="face-pair" aria-hidden="true">
      <SmallFace {...outgoing} out />
      <SmallFace {...incoming} out={false} />
    </div>
  );
}

// A lineup move named in text ("Reid BN → C"), with the player's face; a player moving out
// is dimmed.
export type Move = SmallFaceProps & { text: string };

export function MoveList({ moves }: { moves: Move[] }) {
  return (
    <div className="moves">
      {moves.map(({ text, ...face }) => (
        <div key={text} className="move">
          <SmallFace {...face} />
          <span>{text}</span>
        </div>
      ))}
    </div>
  );
}
