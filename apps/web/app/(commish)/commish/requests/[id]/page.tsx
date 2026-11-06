import { formatTenths } from "@injurysub/domain";
import { redirect } from "next/navigation";
import { CommishHeader } from "../../../../../components/commish/commish-header";
import { ManualStepsPanel } from "../../../../../components/commish/manual-steps-panel";
import { RequestRecord } from "../../../../../components/commish/request-record";
import { AdjustmentBreakdown } from "../../../../../components/requests/adjustment-breakdown";
import { formatReadTime } from "../../../../../components/requests/format";
import { REQUEST_STATUS_LABELS } from "../../../../../components/requests/labels";
import { Surface } from "../../../../../components/shell/site-shell";
import { commissionerAccess, getCurrentAuthenticatedSession } from "../../../../../lib/server/auth";
import { loadRequestDetail, type RequestDetailView } from "../../../../../lib/server/commish";

type Found = Extract<RequestDetailView, { status: "found" }>;

// One request for the commissioner: why it needs them, what to do by hand, and its whole record
// (Q4, Q5, H2).
export default async function CommissionerRequestPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) {
    redirect(`/login?redirect=${encodeURIComponent(`/commish/requests/${id}`)}`);
  }
  if (access === "not_commissioner") redirect("/app");

  const detail = await loadRequestDetail({ requestId: id });
  if (detail.status === "not_found") redirect("/commish/requests");
  return (
    <main className="page-shell">
      <div className="page-inner flex flex-col gap-6">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <CommishHeader title="Request" hasTeam={session.user.teamId !== null} />
          {detail.status === "found" ? (
            <DetailBody detail={detail} />
          ) : (
            <p className="mt-6 text-sm text-[color:var(--muted)]">
              This request can’t be shown right now. Try again in a moment.
            </p>
          )}
        </Surface>
      </div>
    </main>
  );
}

function DetailBody({ detail }: { detail: Found }) {
  const { request } = detail;
  const amount = request.overrideAdjustmentTenths ?? request.projectedAdjustmentTenths;
  return (
    <div className="mt-6 flex flex-col gap-4">
      <h2 className="text-2xl font-medium tracking-[-0.03em]">
        Team {request.teamId}: {request.replacementName} in for {request.injuredName} (
        {request.injuredSlot})
      </h2>
      <p className="text-sm text-[color:var(--muted)]">
        {REQUEST_STATUS_LABELS[request.status]} · requested{" "}
        {formatReadTime(request.requestMoment.toISOString())} on ESPN’s day {request.requestDay}
      </p>
      {detail.why === null ? null : <p className="text-sm">Needs you: {detail.why}.</p>}
      <div className="rounded-[1.5rem] border border-white/8 bg-black/15 p-4 text-sm">
        <p className="font-medium">
          {amount === null || amount === 0
            ? "No adjustment computed."
            : `Computed adjustment: ${formatTenths(amount, { signed: true })} points`}
        </p>
        {detail.breakdown.length === 0 ? null : <AdjustmentBreakdown lines={detail.breakdown} />}
      </div>
      <ManualStepsPanel steps={detail.instructions} matchupId={request.matchupId} />
      <RequestRecord events={detail.events} snapshots={detail.snapshots} />
    </div>
  );
}
