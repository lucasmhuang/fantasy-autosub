import { formatRecentMoment, requestAmountTenths, teamName } from "@injurysub/domain";
import {
  AdjustmentPanel,
  Button,
  FacePair,
  LineupChanges,
  Notice,
  RecordList,
  SelectField,
  StatusPanel,
  TextAreaField,
  TextField,
} from "@injurysub/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { renderCommissionerStatus } from "../../app/(commish)/commish/status-messages";
import type { RequestDetailView } from "../../lib/server/commish";
import { faceImageProps } from "../../lib/server/images";
import type { Queue } from "../../lib/server/queue";
import { commissionerWord, signedPoints } from "../board/board-copy";
import { adjustmentKind } from "../board/confirm-copy";
import { surname } from "../board/option-copy";
import { AddressStatusNotice } from "../board/status-notice";
import { dayLabel } from "./by-hand-copy";
import { AutomationStrip } from "./commish-title";
import { ByHand, ComparePanel, ReversePanel, StaleChanges } from "./detail-panels";
import { QueueColumn } from "./queue-view";
import {
  detailActions,
  detailHeader,
  detailRecord,
  detailStatus,
  emailMark,
} from "./request-detail-copy";

type Found = Extract<RequestDetailView, { status: "found" }>;
type Reading = { zone: string; now: Date; ownTeam: boolean };
type Props = {
  detail: Found | { status: "unavailable" };
  queue: Queue;
  // The form `?form=` opened on this page.
  form: string | undefined;
  status: string | undefined;
  ownTeam: boolean;
  zone: string;
  now: Date;
};

const FAIL = "Couldn't load this request: InjurySub's database didn't answer.";

// One request for the commissioner, with the queue beside it at 1280 (FS-LAYOUT-5).
export function CommissionerRequestView(props: Props) {
  const { detail, queue, zone, now } = props;
  const current = detail.status === "found" ? detail.request.requestId : undefined;
  return (
    <div className="page">
      <nav className="backbar phone-only">
        <Button asChild variant="ghost" back>
          <Link href="/commish/requests">Queue</Link>
        </Button>
      </nav>
      <div className="cols">
        <div className="col desk-only">
          <QueueColumn
            queue={queue}
            status={undefined}
            zone={zone}
            now={now}
            current={current}
            strip={false}
          />
        </div>
        <div className="col flow">
          <AutomationStrip
            automation={queue.status === "found" ? queue.automation : { status: "unavailable" }}
            from={current === undefined ? "/commish/requests" : `/commish/requests/${current}`}
            zone={zone}
            now={now}
          />
          {detail.status === "found" ? (
            <DetailColumn {...props} detail={detail} />
          ) : (
            <Notice tone="fail" action={{ label: "Try again", href: "?" }}>
              {FAIL}
            </Notice>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailColumn(props: Props & { detail: Found }) {
  const { detail, status, form } = props;
  const reading = { zone: props.zone, now: props.now, ownTeam: props.ownTeam };
  const header = detailHeader(detail, reading);
  const mark = emailMark(detail.alertEmail, reading);
  return (
    <>
      <header className="titleblock">
        <h1 className="t-title">{header.team}</h1>
        <div className="swapline mt-(--space-6)">
          <FacePair
            incoming={{ face: faceImageProps(String(detail.request.replacementPlayerId), 54) }}
            outgoing={{
              face: faceImageProps(String(detail.request.injuredPlayerId), 54),
              out: true,
            }}
          />
          <div className="min-w-0">
            <div className="titleblock-subtitle mt-0">{header.swap}</div>
            <div className="titleblock-subtitle">{header.asked}</div>
          </div>
        </div>
      </header>
      {form === undefined && (
        <AddressStatusNotice status={status} render={renderCommissionerStatus} />
      )}
      {mark && <Notice tone="fail">{mark}</Notice>}
      <StatusPanel {...detailStatus(detail, reading)} live={false} />
      <Sends detail={detail} />
      <StaleChanges detail={detail} reading={reading} />
      <ComparePanel detail={detail} reading={reading} />
      <ByHand detail={detail} reading={reading} />
      <Actions detail={detail} reading={reading} form={form} status={status} />
      <FiledFor detail={detail} reading={reading} />
      <Adjustment detail={detail} />
      <RecordList title="Record" events={detailRecord(detail, reading)} />
    </>
  );
}

// What approving sends (FS-DETAIL-4): each move with its face, then the adjustment.
function Sends({ detail }: { detail: Found }) {
  const { sends, request } = detail;
  if (sends === null) return null;
  const team = teamName(request.teamId, detail.names.team);
  return (
    <LineupChanges
      title="Approving sends"
      id="approving-sends"
      changes={sends.moves.map((move) => ({
        slot: move.toSlot === "BE" ? "BN" : move.toSlot,
        bench: move.toSlot === "BE",
        out: move.playerId === request.injuredPlayerId,
        name: move.name,
        text: `${slotName(move.fromSlot)} → ${slotName(move.toSlot)}`,
        face: faceImageProps(String(move.playerId), 54),
      }))}
      adjustment={{
        amount: `${signedPoints(sends.amountTenths)} for ${team}, week ${request.matchupPeriodId}`,
        text: `Their side goes from ${points(sends.sideBeforeTenths)} to ${points(sends.sideAfterTenths)}. Posts publicly on ESPN's activity feed.`,
      }}
    />
  );
}

const slotName = (slot: string) => (slot === "BE" ? "BN" : slot);
const points = (tenths: number) => (tenths / 10).toFixed(1).replace("-", "−");

function Actions({
  detail,
  reading,
  form,
  status,
}: {
  detail: Found;
  reading: Reading;
  form: string | undefined;
  status: string | undefined;
}) {
  if (isOpenForm(form)) return <OpenForm detail={detail} form={form} status={status} />;
  const { primary, links } = detailActions(detail, reading);
  if (detail.actions.includes("reverse")) return <ReverseForm detail={detail} />;
  if (primary === null && links.length === 0) return null;
  return (
    <section className="actions" aria-label="Actions">
      {primary?.kind === "form" && (
        <Button asChild variant="primary">
          <Link href={`?form=${primary.form}`}>{primary.label}</Link>
        </Button>
      )}
      {(primary?.kind === "approve" || primary?.kind === "reapprove") && (
        <ActionForm detail={detail} action={primary.kind}>
          <input type="hidden" name="shownTenths" value={primary.shownTenths} />
          <Button variant="confirm" type="submit">
            {primary.label}
          </Button>
        </ActionForm>
      )}
      {links.length > 0 && (
        <div className="text-actions">
          {links.map((link) => (
            <Button key={link.form} asChild variant="ghost">
              <Link href={`?form=${link.form}`}>{link.label}</Link>
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

// Each form posts at the version shown, so a change from another tab refuses it (IF-DETAIL-12).
function ActionForm({
  detail,
  action,
  children,
}: {
  detail: Found;
  action: string;
  children: ReactNode;
}) {
  return (
    <form method="post" action={`/commish/requests/${detail.request.requestId}/${action}`}>
      <input type="hidden" name="version" value={detail.request.version} />
      {children}
    </form>
  );
}

const OPEN_FORMS = ["override", "complete", "complete-adjustment", "reject"] as const;
type OpenFormName = (typeof OPEN_FORMS)[number];
const isOpenForm = (form: string | undefined): form is OpenFormName =>
  OPEN_FORMS.some((each) => each === form);

function OpenForm({
  detail,
  form,
  status,
}: {
  detail: Found;
  form: OpenFormName;
  status: string | undefined;
}) {
  const failed = status === "invalid_form";
  if (form === "override") return <OverrideForm detail={detail} failed={failed} />;
  if (form === "reject") return <RejectForm detail={detail} failed={failed} />;
  return (
    <CompleteForm detail={detail} failed={failed} adjustmentOnly={form === "complete-adjustment"} />
  );
}

function FormPanel({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className="panel stack-12" aria-labelledby={id}>
      <h2 id={id} className="t-label">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Cancel() {
  return (
    <Button asChild variant="quiet">
      <Link href="?">Cancel</Link>
    </Button>
  );
}

function OverrideForm({ detail, failed }: { detail: Found; failed: boolean }) {
  const computed = detail.adjustment.computedTenths;
  return (
    <FormPanel title="Override the amount" id="override">
      <ActionForm detail={detail} action="override">
        <TextField
          id="override-amount"
          name="amount"
          label="Amount to apply instead"
          inputMode="decimal"
          required
          hint={`Computed: ${computed === null ? "none" : signedPoints(computed)}. Both stay on the record.`}
          error={failed ? "Enter an amount like −18.0." : undefined}
        />
        <Button variant="primary" type="submit">
          Save override
        </Button>
      </ActionForm>
      <Cancel />
    </FormPanel>
  );
}

function CompleteForm({
  detail,
  failed,
  adjustmentOnly,
}: {
  detail: Found;
  failed: boolean;
  adjustmentOnly: boolean;
}) {
  const { request, adjustment } = detail;
  const records = adjustment.overrideTenths ?? adjustment.computedTenths;
  const days = Array.from({ length: 7 }, (_, index) => request.requestDay + index);
  return (
    <FormPanel title="Mark done by hand" id="complete">
      <ActionForm detail={detail} action="complete">
        <SelectField
          id="complete-day"
          name="effectiveDay"
          label={`First day ESPN showed ${surname(request.replacementName)} active`}
          hint={`Days before it take ${surname(request.injuredName)}'s points off.`}
          error={failed ? "That day can't be used for this request." : undefined}
          options={days.map((day) => ({
            value: String(day),
            label: `${dayLabel(request, day)}${day === request.requestDay ? " (the request's day)" : ""}`,
          }))}
        />
        <label className="check">
          <input type="checkbox" name="adjustmentOnly" value="1" defaultChecked={adjustmentOnly} />
          <span>{"Adjustment only: the lineup wasn't changed on ESPN"}</span>
        </label>
        {/* FS-DETAIL-12: the amount it records, an override over the computed one. */}
        <div className="kv">
          <span className="k">Adjustment</span>
          <span className="v">{records === null ? "—" : signedPoints(records)}</span>
        </div>
        <Button variant="primary" type="submit">
          Mark done by hand
        </Button>
      </ActionForm>
      <Cancel />
    </FormPanel>
  );
}

function RejectForm({ detail, failed }: { detail: Found; failed: boolean }) {
  const manager = commissionerWord(detail.names.manager);
  return (
    <FormPanel title="Reject" id="reject">
      <ActionForm detail={detail} action="reject">
        <TextAreaField
          id="reject-reason"
          name="reason"
          label={`Reason ${manager} will see`}
          maxLength={500}
          error={failed ? `Add a reason; ${manager} sees it on the request.` : undefined}
        />
        <Button variant="primary" type="submit">
          Reject request
        </Button>
      </ActionForm>
      <Cancel />
    </FormPanel>
  );
}

// A done request's reversal (IF-DETAIL-9): the amount to take back on ESPN, then mark it.
function ReverseForm({ detail }: { detail: Found }) {
  const { request } = detail;
  const applied = requestAmountTenths(request) ?? 0;
  const team = teamName(request.teamId, detail.names.team);
  const takeBack =
    applied === 0
      ? "It posted no adjustment, so there's nothing to take back on ESPN."
      : `On ESPN's Scoreboard, take ${signedPoints(applied)} back off ${team}'s side in week ${request.matchupPeriodId} (enter ${signedPoints(-applied)} on top of their adjustment), then mark it reversed.`;
  return (
    <ReversePanel
      detail={detail}
      fallback={`${takeBack} The lineup stays unless you change it on ESPN. ${surname(request.injuredName)} can't be requested again this week.`}
    >
      <ActionForm detail={detail} action="reverse">
        <Button variant="secondary" type="submit">
          Mark reversed
        </Button>
      </ActionForm>
    </ReversePanel>
  );
}

const GAME_WORDS = {
  not_started: "Not started",
  ended: "Ended",
  in_progress: "In progress",
} as const;

// FS-DETAIL-16: a request filed on a manager's behalf, with what was attested.
function FiledFor({ detail, reading }: { detail: Found; reading: Reading }) {
  const { filing, request } = detail;
  if (filing === null) return null;
  const manager = commissionerWord(detail.names.manager, true);
  const attested = (field: string) => (filing.attestedFields.includes(field) ? " · attested" : "");
  const time = (at: Date) => formatTime(at, reading);
  const rows: [string, string][] = [
    [`${manager} asked`, `${time(filing.statedMoment)}${attested("requestMoment")}`],
    ["You filed it", time(filing.filedAt)],
    [`${surname(request.injuredName)} then`, `${filing.designation}${attested("designation")}`],
    ["ESPN at filing", filing.designationAtFiling ?? "Not read"],
  ];
  if (filing.replacementGame !== null) {
    rows.push([
      `${surname(request.replacementName)}'s game then`,
      `${GAME_WORDS[filing.replacementGame]}${attested("replacementGame")}`,
    ]);
  }
  if (filing.enteredTenths !== null) {
    rows.push([
      `${surname(request.replacementName)}'s points before`,
      `${(filing.enteredTenths / 10).toFixed(1)} · entered by hand`,
    ]);
  }
  return (
    <section className="panel px-(--space-16) py-(--space-12)" aria-labelledby="filed-for">
      <h2 id="filed-for" className="t-label">
        {`Filed for ${manager}`}
      </h2>
      {rows.map(([k, v]) => (
        <div key={k} className="kv">
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
      {filing.note && (
        <div className="kv">
          <span className="v wrap">{`Note: "${filing.note}"`}</span>
        </div>
      )}
    </section>
  );
}

function formatTime(at: Date, reading: Reading): string {
  return formatRecentMoment(at, reading.zone, reading.now);
}

// The amount (FS-DETAIL-6): computed, any override beside it, and what's on ESPN once applied.
function Adjustment({ detail }: { detail: Found }) {
  const { adjustment, request, breakdown } = detail;
  const { computedTenths, overrideTenths, appliedTenths } = adjustment;
  const shown = appliedTenths ?? overrideTenths ?? computedTenths;
  const rows: [string, string][] = [];
  if (overrideTenths !== null || appliedTenths !== null) {
    rows.push(["Computed", computedTenths === null ? "—" : signedPoints(computedTenths)]);
  }
  if (overrideTenths !== null) rows.push(["Your override", signedPoints(overrideTenths)]);
  if (appliedTenths !== null) rows.push(["On ESPN", signedPoints(appliedTenths)]);
  return (
    <AdjustmentPanel
      total={shown === null || shown === 0 ? null : signedPoints(shown)}
      state={appliedTenths === null ? "Projected" : "Final"}
      notice={
        rows.length === 0 ? undefined : (
          <div>
            {rows.map(([k, v]) => (
              <div key={k} className="kv">
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
          </div>
        )
      }
      lines={breakdown.map((line) => ({
        who: `${surname(line.name)} · ${dayLabel(request, line.day)}`,
        amount: signedPoints(line.tenths),
        kind: adjustmentKind(line.why),
      }))}
    />
  );
}
