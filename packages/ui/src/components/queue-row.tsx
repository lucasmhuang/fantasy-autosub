import { FacePair, type SmallFaceProps } from "./face-pair";
import { Icon } from "./icon";
import type { RowStatus } from "./request-row";
import { StatusPill } from "./status-pill";

type QueueRowCommon = {
  team: string;
  // "Reid in for Embiid": wraps rather than losing a name. A misuse alert's one-line summary.
  swap: string;
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

// A request leads with its faces; a misuse alert with the alert mark in their place.
export type QueueRowProps = QueueRowCommon &
  ({ incoming: SmallFaceProps; outgoing: SmallFaceProps } | { alert: true });

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

function Lead(props: QueueRowProps) {
  if ("alert" in props) {
    return (
      <div className="face-pair queue-alert-mark" aria-hidden="true">
        <Icon name="warn" size={22} />
      </div>
    );
  }
  return <FacePair incoming={props.incoming} outgoing={props.outgoing} />;
}

// One request, or one misuse alert, in the commissioner's queue.
export function QueueRow(props: QueueRowProps) {
  const { team, swap, when, amount, href, needs, status, current = false } = props;
  return (
    <a className="qrow has-faces" href={href} aria-current={current ? "true" : undefined}>
      <Lead {...props} />
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
