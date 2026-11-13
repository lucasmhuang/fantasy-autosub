import { formatTenths } from "@injurysub/domain";
import { Button } from "@injurysub/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdjustmentBreakdown } from "../../../../../components/requests/adjustment-breakdown";
import { editLines, formatReadTime } from "../../../../../components/requests/format";
import {
  DELAYED_LABEL,
  DELAYED_TEXT,
  REQUEST_STATUS_LABELS,
  REVIEW_REASON_TEXT,
  SENT_EDIT_DIFFERS_TEXT,
} from "../../../../../components/requests/labels";
import { StatusNotice } from "../../../../../components/requests/status-notice";
import { Surface } from "../../../../../components/shell/site-shell";
import { getCurrentAuthenticatedSession } from "../../../../../lib/server/auth";
import { loadRequestView, type RequestView } from "../../../../../lib/server/request-view";
import { renderRequestStatus } from "../../status-messages";

type Found = Extract<RequestView, { status: "found" }>;

// One of the team's requests: where it stands, its adjustment and why (H1, OQ6).
export default async function RequestPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await props.params;
  const session = await getCurrentAuthenticatedSession();
  if (!session) redirect(`/login?redirect=${encodeURIComponent(`/app/requests/${id}`)}`);
  const { teamId } = session.user;
  if (teamId === null) redirect("/app");
  const { status } = await props.searchParams;
  const view = await loadRequestView({ teamId, requestId: id });
  if (view.status === "not_found") redirect("/app?status=not_found");

  return (
    <main className="page-shell">
      {/* While it's in line or in progress, the page checks again every 10 seconds. */}
      {view.status === "found" && view.refreshing ? (
        <meta httpEquiv="refresh" content="10" />
      ) : null}
      <div className="page-inner flex flex-col gap-6">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <p className="display-kicker">Substitution request</p>
          <StatusNotice status={renderRequestStatus(status ?? null)} />
          {view.status === "found" ? (
            <RequestDetails view={view} />
          ) : (
            <StatusNotice status={renderRequestStatus("unavailable")} />
          )}
          <p className="mt-6 text-sm">
            <Link className="underline" href="/app">
              Back to your team
            </Link>
          </p>
        </Surface>
      </div>
    </main>
  );
}

function RequestDetails({ view }: { view: Found }) {
  const { request } = view;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <h1 className="text-2xl font-medium tracking-[-0.03em]">
        {request.replacementName} in for {request.injuredName}
      </h1>
      <p className="text-sm text-[color:var(--muted)]">
        Asked {formatReadTime(request.filedAt.toISOString())} ·{" "}
        {view.delayed ? DELAYED_LABEL : REQUEST_STATUS_LABELS[request.status]}
      </p>
      <WhyText view={view} />
      <SentEditList view={view} />
      <Adjustment view={view} />
      {request.effectiveDay === null ? null : (
        <p className="text-sm">{`The swap took effect on ESPN's day ${request.effectiveDay}.`}</p>
      )}
      {view.canWithdraw ? <WithdrawForm requestId={request.requestId} /> : null}
    </div>
  );
}

// Why it's waiting, why it was refused, or the commissioner's reason for a rejection.
function WhyText({ view }: { view: Found }) {
  const { request, commissionerReason } = view;
  const reason = request.reviewReason;
  const refusal = renderRequestStatus(request.refusalReason);
  return (
    <>
      {view.delayed ? <p className="text-sm">{DELAYED_TEXT}</p> : null}
      {request.status === "needs_review" && reason !== null ? (
        <p className="text-sm">{REVIEW_REASON_TEXT[reason]}</p>
      ) : null}
      {refusal === null ? null : <p className="text-sm">Refused: {refusal.body}</p>}
      {commissionerReason === null ? null : (
        <p className="text-sm">{`The commissioner's reason: ${commissionerReason}`}</p>
      )}
    </>
  );
}

// X24: the lineup change InjurySub makes on ESPN, once it has taken the request on.
function SentEditList({ view }: { view: Found }) {
  if (view.sentEdit === null) return null;
  const { changes } = editLines(view.sentEdit);
  return (
    <div className="text-sm">
      <p className="font-medium">The lineup change</p>
      <ul className="mt-1 flex flex-col gap-1">
        {changes.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
      {view.sentEdit.differsFromConfirmed ? (
        <p className="mt-2 text-[color:var(--muted)]">{SENT_EDIT_DIFFERS_TEXT}</p>
      ) : null}
    </div>
  );
}

// A refused, rejected or withdrawn request owes nothing, so it shows no adjustment.
const OWES_NOTHING = ["refused", "rejected", "withdrawn"];

function Adjustment({ view }: { view: Found }) {
  const { adjustmentTenths, adjustmentIsFinal, status } = view.request;
  if (adjustmentTenths === null || OWES_NOTHING.includes(status)) return null;
  const label = adjustmentIsFinal ? "Adjustment" : "Projected adjustment";
  return (
    <div className="rounded-[1.5rem] border border-white/8 bg-black/15 p-4 text-sm">
      <p className="font-medium">
        {adjustmentTenths === 0
          ? "No adjustment: just the swap."
          : `${label}: ${formatTenths(adjustmentTenths, { signed: true })} points`}
      </p>
      {adjustmentIsFinal || adjustmentTenths === 0 ? null : (
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Settled once ESPN shows the day the swap took effect.
        </p>
      )}
      {view.breakdown.length === 0 ? null : <AdjustmentBreakdown lines={view.breakdown} />}
    </div>
  );
}

function WithdrawForm({ requestId }: { requestId: string }) {
  return (
    <form action={`/requests/${requestId}/withdraw`} method="post">
      <Button intent="ghost" size="sm" type="submit">
        Withdraw this request
      </Button>
    </form>
  );
}
