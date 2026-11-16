import { Notice, type NoticeTone } from "@injurysub/ui";
import { redirect } from "next/navigation";
import { commissionerWord } from "../../../components/board/board-copy";
import { BoardView } from "../../../components/board/board-view";
import { DatabaseDown } from "../../../components/shell/full-state";
import { Shell } from "../../../components/shell/shell";
import {
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../lib/server/auth";
import { loadTeamBoard } from "../../../lib/server/board";
import { loadTeamHistory } from "../../../lib/server/request-view";
import { loadShell } from "../../../lib/server/shell";
import { type RequestStatusMessage, renderRequestStatus } from "./status-messages";

type TeamPageSearchParams = { starter?: string; all?: string; status?: string };

const NOTICE_TONES: Record<RequestStatusMessage["tone"], NoticeTone> = {
  success: "info",
  muted: "info",
  warning: "wait",
  danger: "fail",
};

export default async function TeamPage(props: { searchParams: Promise<TeamPageSearchParams> }) {
  const params = await props.searchParams;
  const session = await getCurrentAuthenticatedSession();
  if (!session) redirect(signInLocation("/app", { starter: params.starter, all: params.all }));
  const { user } = session;
  if (user.teamId === null && user.role === "commissioner") redirect("/commish/requests");

  const [board, history] =
    user.teamId === null
      ? [{ status: "no_team" } as const, null]
      : await Promise.all([
          loadTeamBoard({ teamId: user.teamId, revealAll: false }),
          loadTeamHistory({ teamId: user.teamId }),
        ]);
  if (board.status === "database_down") return <DatabaseDown />;
  const shell = await loadShell(session);
  const status = renderRequestStatus(params.status ?? null);
  const name = commissionerWord(user.displayName);
  return (
    <Shell shell={shell} current="team">
      <BoardView
        board={board}
        history={history}
        zone={deviceZoneOf(session)}
        now={new Date()}
        commissionerName={shell.commissionerName}
        title={board.status === "board" ? board.teamName : "Your team"}
        subtitle={
          user.role === "commissioner" ? `${name} · commissioner` : `${name} · team ${user.teamId}`
        }
        notice={status && <Notice tone={NOTICE_TONES[status.tone]}>{status.body}</Notice>}
      />
    </Shell>
  );
}
