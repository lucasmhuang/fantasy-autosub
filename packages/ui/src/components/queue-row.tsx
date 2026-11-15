import { FacePair, type SmallFaceProps } from "./face-pair";
import type { RowStatus } from "./request-row";
import { StatusPill } from "./status-pill";

export type QueueRowProps = {
  team: string;
  // "Reid in for Embiid": wraps rather than losing a name.
  swap: string;
  incoming: SmallFaceProps;
  outgoing: SmallFaceProps;
  when: string;
  // Signed with "proj." while projected, or "—".
  amount: string;
  href: string;
  // Why it waits on the commissioner: the reason's short name and what to do.
  needs?: { reason: string; sentence: string };
  // Otherwise its status.
  status?: RowStatus;
  // The request open beside the queue.
  current?: boolean;
};

function LastLine({ needs, status }: Pick<QueueRowProps, "needs" | "status">) {
  if (needs) {
    return (
      <div className="why">
        <StatusPill kind="waiting">{needs.reason}</StatusPill>
        <span>{needs.sentence}</span>
      </div>
    );
  }
  return (
    <div className="status-line">
      {status && <StatusPill kind={status.kind}>{status.word}</StatusPill>}
    </div>
  );
}

// One request in the commissioner's queue.
export function QueueRow({
  team,
  swap,
  incoming,
  outgoing,
  when,
  amount,
  href,
  needs,
  status,
  current = false,
}: QueueRowProps) {
  return (
    <a className="qrow has-faces" href={href} aria-current={current ? "true" : undefined}>
      <FacePair incoming={incoming} outgoing={outgoing} />
      <div className="team ellipsis">{team}</div>
      <div className="amt">{amount}</div>
      <div className="line2">
        <span className="swap">{swap}</span>
        <span className="when num">{when}</span>
      </div>
      <LastLine needs={needs} status={status} />
    </a>
  );
}
