import { FacePair, type SmallFaceProps } from "./face-pair";
import { type PillKind, StatusPill } from "./status-pill";

export type RowStatus = { kind: PillKind; word: string };

export type RequestRowProps = {
  // "Kessler in for Adebayo".
  title: string;
  incoming: SmallFaceProps;
  outgoing: SmallFaceProps;
  // Signed, or "—" when none.
  amount: string;
  status: RowStatus;
  // "Wed Nov 4, 8:12 PM PT · week 3".
  when: string;
  href: string;
};

// A manager's request in a list. Every row has the same three lines, and the whole row links to
// the request.
export function RequestRow({
  title,
  incoming,
  outgoing,
  amount,
  status,
  when,
  href,
}: RequestRowProps) {
  return (
    <a className="reqrow has-faces" href={href}>
      <FacePair incoming={incoming} outgoing={outgoing} />
      <div className="title ellipsis">{title}</div>
      <div className="t-amount">{amount}</div>
      <div className="line2">
        <StatusPill kind={status.kind}>{status.word}</StatusPill>
        <span className="when">{when}</span>
      </div>
    </a>
  );
}
