import { redirect } from "next/navigation";
import { AlertsView } from "../../../../components/commish/alerts-view";
import { DatabaseDown } from "../../../../components/shell/full-state";
import { Shell } from "../../../../components/shell/shell";
import {
  COMMISSIONER_ONLY,
  commissionerAccess,
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../../lib/server/auth";
import { loadAlertsPage, loadAutomation } from "../../../../lib/server/commish-alerts";
import { loadShell } from "../../../../lib/server/shell";

// The misuse watch (M1-M10): what InjurySub saw changed on ESPN that it didn't make, how to undo
// each, Acknowledge, and the commissioner team's moves of the past day.
export default async function CommissionerAlertsPage(props: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) redirect(signInLocation("/commish/alerts"));
  if (access === "not_commissioner") redirect(COMMISSIONER_ONLY);

  const { status } = await props.searchParams;
  const page = await loadAlertsPage();
  if (page.status === "unavailable") return <DatabaseDown />;
  const automation = await loadAutomation();
  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="queue">
      <AlertsView
        page={page}
        automation={automation}
        status={status}
        zone={deviceZoneOf(session)}
        now={new Date()}
      />
    </Shell>
  );
}
