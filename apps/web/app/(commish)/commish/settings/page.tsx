import { redirect } from "next/navigation";
import { SettingsView } from "../../../../components/commish/settings-view";
import { DatabaseDown } from "../../../../components/shell/full-state";
import { Shell } from "../../../../components/shell/shell";
import {
  COMMISSIONER_ONLY,
  commissionerAccess,
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../../lib/server/auth";
import { loadAutomation } from "../../../../lib/server/commish-alerts";
import { loadSettingsPage } from "../../../../lib/server/settings-page";
import { loadShell } from "../../../../lib/server/shell";

// The commissioner's settings: the mode and the teams automation may act for (Q1, Q2), and
// proving on their own team.
export default async function CommissionerSettingsPage(props: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) redirect(signInLocation("/commish/settings"));
  if (access === "not_commissioner") redirect(COMMISSIONER_ONLY);

  const { status } = await props.searchParams;
  const page = await loadSettingsPage({ ownTeamId: session.user.teamId });
  if (page.status === "database_down") return <DatabaseDown />;
  const automation = await loadAutomation();
  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="settings">
      <SettingsView
        page={page}
        automation={automation}
        status={status}
        zone={deviceZoneOf(session)}
        now={new Date()}
      />
    </Shell>
  );
}
