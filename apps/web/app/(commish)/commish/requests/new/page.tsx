import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { FilingView } from "../../../../../components/commish/filing-view";
import { DatabaseDown } from "../../../../../components/shell/full-state";
import { Shell } from "../../../../../components/shell/shell";
import {
  COMMISSIONER_ONLY,
  commissionerAccess,
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../../../lib/server/auth";
import { loadAutomation } from "../../../../../lib/server/commish-alerts";
import { loadFilingPage } from "../../../../../lib/server/filing";
import { loadShell } from "../../../../../lib/server/shell";

// The commissioner files a request a manager made outside the app (Q16): pick the team, then the
// players, the moment and what they attest about it.
export default async function FileRequestPage(props: {
  searchParams: Promise<{ team?: string; status?: string }>;
}) {
  const params = await props.searchParams;
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) {
    redirect(signInLocation("/commish/requests/new", { team: params.team }));
  }
  if (access === "not_commissioner") redirect(COMMISSIONER_ONLY);

  const now = new Date();
  const zone = deviceZoneOf(session);
  const page = await loadFilingPage({
    ownTeamId: session.user.teamId,
    team: params.team,
    zone,
    now,
  });
  if (page.status === "database_down") return <DatabaseDown />;
  const automation = await loadAutomation();
  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="file" arrives>
      <FilingView
        page={page}
        status={params.status}
        automation={automation}
        zone={zone}
        now={now}
        idempotencyKey={randomUUID()}
      />
    </Shell>
  );
}
