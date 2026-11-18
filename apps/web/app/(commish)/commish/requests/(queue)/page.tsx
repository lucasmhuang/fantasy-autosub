import { redirect } from "next/navigation";
import { QueueView } from "../../../../../components/commish/queue-view";
import { Shell } from "../../../../../components/shell/shell";
import {
  COMMISSIONER_ONLY,
  commissionerAccess,
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../../../lib/server/auth";
import { loadQueue } from "../../../../../lib/server/queue";
import { loadShell } from "../../../../../lib/server/shell";

// The commissioner's queue: health, then what needs them, then every other request (FS-QUEUE-1
// to -3), read from what the database holds.
export default async function CommissionerRequestsPage(props: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) redirect(signInLocation("/commish/requests"));
  if (access === "not_commissioner") redirect(COMMISSIONER_ONLY);

  const { status } = await props.searchParams;
  const now = new Date();
  const queue = await loadQueue({ now });
  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="queue" arrives>
      <QueueView
        queue={queue}
        status={status}
        zone={deviceZoneOf(session)}
        now={now}
        ownTeamId={session.user.teamId}
      />
    </Shell>
  );
}
