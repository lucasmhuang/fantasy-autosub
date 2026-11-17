import { redirect } from "next/navigation";
import { ProvingView } from "../../../../components/commish/proving-view";
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
import { loadProvingPage } from "../../../../lib/server/proving";
import { loadShell } from "../../../../lib/server/shell";

// The proving run on the commissioner's team (S9, S18-S20): file one, approve it, see its steps,
// and close it, until proving is marked done in Settings.
export default async function ProvingRequestsPage(props: {
  searchParams: Promise<{ starter?: string; status?: string }>;
}) {
  const params = await props.searchParams;
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) {
    redirect(signInLocation("/commish/proving", { starter: params.starter }));
  }
  if (access === "not_commissioner") redirect(COMMISSIONER_ONLY);
  const starterId = /^\d{1,12}$/.test(params.starter ?? "") ? Number(params.starter) : null;
  const page = await loadProvingPage({ starterId });
  if (page.status === "unavailable") return <DatabaseDown />;
  const automation = await loadAutomation();
  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="settings">
      <ProvingView
        page={page}
        automation={automation}
        status={params.status}
        zone={deviceZoneOf(session)}
        now={new Date()}
      />
    </Shell>
  );
}
