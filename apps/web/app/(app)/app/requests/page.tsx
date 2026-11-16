import { redirect } from "next/navigation";
import { RequestsListView } from "../../../../components/board/requests-list-view";
import { Shell } from "../../../../components/shell/shell";
import {
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../../lib/server/auth";
import { loadTeamHistory } from "../../../../lib/server/request-view";
import { loadShell } from "../../../../lib/server/shell";

// The shell's Requests destination: the team's own requests, newest first (FS-LIST-1, FS-LIST-2).
export default async function RequestsPage() {
  const session = await getCurrentAuthenticatedSession();
  if (!session) redirect(signInLocation("/app/requests"));
  const { teamId } = session.user;
  if (teamId === null) redirect("/app");

  const history = await loadTeamHistory({ teamId });
  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="requests">
      <RequestsListView
        history={history}
        team={shell.account.team}
        zone={deviceZoneOf(session)}
        now={new Date()}
        commissionerName={shell.commissionerName}
      />
    </Shell>
  );
}
