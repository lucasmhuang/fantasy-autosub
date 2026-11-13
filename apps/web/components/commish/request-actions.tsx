import { formatTenths } from "@injurysub/domain";
import { Button } from "@injurysub/ui";
import type { ApprovalOffer } from "../../lib/server/commish";
import type { CommissionerAction } from "../../lib/server/commish-actions";

const inputClassName =
  "rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)]";

type ActionProps = { requestId: string; version: number; requestDay: number };

const points = (tenths: number) => `${formatTenths(tenths, { signed: true })} points`;

// The commissioner's actions on one request, each posted at the version shown (Q13).
export function RequestActions(
  props: ActionProps & { actions: CommissionerAction[]; approval: ApprovalOffer | null }
) {
  const { approval } = props;
  if (props.actions.length === 0) return null;
  return (
    <section className="flex flex-col gap-4 text-sm">
      <h3 className="text-base font-medium">Your actions</h3>
      {approval?.action === "approve" ? <ApproveForm {...props} approval={approval} /> : null}
      {approval?.action === "reapprove" ? <ReapproveForm {...props} approval={approval} /> : null}
      {props.actions.includes("complete") ? <CompleteForm {...props} /> : null}
      {props.actions.includes("override") ? <OverrideForm {...props} /> : null}
      {props.actions.includes("reject") ? <RejectForm {...props} /> : null}
      {props.actions.includes("reverse") ? <ReverseForm {...props} /> : null}
    </section>
  );
}

function ActionForm(
  props: ActionProps & { action: CommissionerAction; children: React.ReactNode }
) {
  return (
    <form
      action={`/commish/requests/${props.requestId}/${props.action}`}
      method="post"
      className="flex flex-col gap-2 rounded-[1.5rem] border border-white/8 bg-black/15 p-4"
    >
      <input type="hidden" name="version" value={props.version} />
      {props.children}
    </form>
  );
}

// The amount an approval approves, and the override that would be written in its place (S4).
function ApprovalAmount({ approval }: { approval: ApprovalOffer }) {
  return (
    <span>
      Adjustment: {points(approval.computedTenths)}.
      {approval.overrideTenths === null
        ? null
        : ` Your override of ${points(approval.overrideTenths)} is what gets written.`}
    </span>
  );
}

// Q6, Q18: the form carries the amount shown, so an approval never covers a different one.
function ApproveForm(props: ActionProps & { approval: ApprovalOffer }) {
  return (
    <ActionForm {...props} action="approve">
      <input type="hidden" name="shownTenths" value={props.approval.computedTenths} />
      <span>Approve: InjurySub makes the lineup change on ESPN, then writes the adjustment.</span>
      <ApprovalAmount approval={props.approval} />
      <Button intent="ghost" size="sm" type="submit" className="self-start">
        Approve
      </Button>
    </ActionForm>
  );
}

function ReapproveForm(props: ActionProps & { approval: ApprovalOffer }) {
  return (
    <ActionForm {...props} action="reapprove">
      <span>Re-approve: InjurySub writes the adjustment it held.</span>
      <ApprovalAmount approval={props.approval} />
      <Button intent="ghost" size="sm" type="submit" className="self-start">
        Re-approve the adjustment
      </Button>
    </ActionForm>
  );
}

// Q9, Q11: done by hand on ESPN, from the day ESPN shows the replacement active, or as an
// adjustment only.
function CompleteForm(props: ActionProps) {
  return (
    <ActionForm {...props} action="complete">
      <label className="flex flex-col gap-1">
        <span>Completed by hand: the first ESPN day showing the replacement active</span>
        <input
          className={inputClassName}
          type="number"
          name="effectiveDay"
          min={props.requestDay}
          defaultValue={props.requestDay}
        />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="adjustmentOnly" value="1" />
        <span>Adjustment only: the lineup wasn’t changed</span>
      </label>
      <Button intent="ghost" size="sm" type="submit" className="self-start">
        Record as completed
      </Button>
    </ActionForm>
  );
}

function OverrideForm(props: ActionProps) {
  return (
    <ActionForm {...props} action="override">
      <label className="flex flex-col gap-1">
        <span>Override the adjustment (points, e.g. -3.2)</span>
        <input className={inputClassName} name="amount" inputMode="decimal" required />
      </label>
      <Button intent="ghost" size="sm" type="submit" className="self-start">
        Save override
      </Button>
    </ActionForm>
  );
}

function RejectForm(props: ActionProps) {
  return (
    <ActionForm {...props} action="reject">
      <label className="flex flex-col gap-1">
        <span>Reject, with the reason the manager will see</span>
        <textarea className={inputClassName} name="reason" maxLength={500} required rows={2} />
      </label>
      <Button intent="ghost" size="sm" type="submit" className="self-start">
        Reject
      </Button>
    </ActionForm>
  );
}

function ReverseForm(props: ActionProps) {
  return (
    <ActionForm {...props} action="reverse">
      <span>Reverse this substitution; you then enter the inverse adjustment on ESPN.</span>
      <Button intent="ghost" size="sm" type="submit" className="self-start">
        Record as reversed
      </Button>
    </ActionForm>
  );
}
