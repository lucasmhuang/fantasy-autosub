import { redirect } from "next/navigation";
import { LiveRequestPage } from "../../../../../components/board/live-request";
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
  searchParams: Promise<{ status?: string; from?: string }>;
}) {
  const { id } = await props.params;
  const session = await getCurrentAuthenticatedSession();
  if (!session) redirect(signInLocation(`/app/requests/${id}`));
  const { teamId, role } = session.user;
  if (teamId === null) redirect("/app");
  const { status, from } = await props.searchParams;
  const view = await loadRequestView({ teamId, requestId: id });
  if (view.status === "proving" && role === "commissioner") redirect("/commish/proving");
  if (view.status === "unavailable") return <DatabaseDown />;

  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="requests">
      {view.status === "found" ? (
        <LiveRequestPage
          key={view.request.requestId}
          view={view}
          zone={deviceZoneOf(session)}
          now={new Date()}
          commissionerName={shell.commissionerName}
          notice={<AddressStatusNotice status={status} />}
          arrived={from === "confirm"}
        />
      ) : (
        <RequestNotFound />
      )}
    </Shell>
  );
}
