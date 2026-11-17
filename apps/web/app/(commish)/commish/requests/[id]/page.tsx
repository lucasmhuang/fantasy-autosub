import { redirect } from "next/navigation";
import { CommissionerRequestView } from "../../../../../components/commish/request-detail-view";
import { Shell } from "../../../../../components/shell/shell";
import {
  COMMISSIONER_ONLY,
  commissionerAccess,
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../../../lib/server/auth";
import { loadRequestDetail } from "../../../../../lib/server/commish";
import { loadQueue } from "../../../../../lib/server/queue";
import { loadShell } from "../../../../../lib/server/shell";

// One request for the commissioner: where it stands, what they can do, and its whole record,
// with the queue beside it at 1280 (FS-DETAIL-1 to -6, -16 to -22, FS-LAYOUT-5).
export default async function CommissionerRequestPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; form?: string }>;
}) {
  const { id } = await props.params;
  const { status, form } = await props.searchParams;
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) {
    redirect(signInLocation(`/commish/requests/${id}`));
  }
  if (access === "not_commissioner") redirect(COMMISSIONER_ONLY);

  const detail = await loadRequestDetail({ requestId: id });
  if (detail.status === "not_found") redirect("/commish/requests");
  // RS-DETAIL-1: a proving run's answers reach the proving page through here.
  if (detail.status === "proving") {
    redirect(status === undefined ? "/commish/proving" : `/commish/proving?status=${status}`);
  }
  const now = new Date();
  const queue = await loadQueue({ now });
  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="queue" arrives>
      <CommissionerRequestView
        detail={detail.status === "found" ? detail : { status: "unavailable" }}
        queue={queue}
        form={form}
        status={status}
        ownTeam={detail.status === "found" && detail.request.teamId === session.user.teamId}
        zone={deviceZoneOf(session)}
        now={now}
      />
    </Shell>
  );
}
