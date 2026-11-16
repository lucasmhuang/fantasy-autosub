import { redirect } from "next/navigation";
import { RequestPageView } from "../../../../../components/board/request-page-view";
import { AddressStatusNotice } from "../../../../../components/board/status-notice";
import { DatabaseDown, RequestNotFound } from "../../../../../components/shell/full-state";
import { Shell } from "../../../../../components/shell/shell";
import {
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../../../lib/server/auth";
import { loadRequestView } from "../../../../../lib/server/request-view";
import { loadShell } from "../../../../../lib/server/shell";

// One of the team's requests: the swap, where it stands, the adjustment and the record (H1, OQ6).
export default async function RequestPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await props.params;
  const session = await getCurrentAuthenticatedSession();
  if (!session) redirect(signInLocation(`/app/requests/${id}`));
  const { teamId, role } = session.user;
  if (teamId === null) redirect("/app");
  const { status } = await props.searchParams;
  const view = await loadRequestView({ teamId, requestId: id });
  if (view.status === "proving" && role === "commissioner") redirect("/commish/proving");
  if (view.status === "unavailable") return <DatabaseDown />;

  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="requests">
      {view.status === "found" ? (
        <>
          {/* While it's in line or in progress, the page checks again every 10 seconds. */}
          {view.refreshing ? <meta httpEquiv="refresh" content="10" /> : null}
          <RequestPageView
            view={view}
            zone={deviceZoneOf(session)}
            now={new Date()}
            commissionerName={shell.commissionerName}
            notice={<AddressStatusNotice status={status} />}
          />
        </>
      ) : (
        <RequestNotFound />
      )}
    </Shell>
  );
}
