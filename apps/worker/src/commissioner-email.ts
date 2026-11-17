import { randomUUID } from "node:crypto";
import { loadServerEnv } from "@injurysub/config";
import {
  type DatabaseExecutor,
  enqueueEmail,
  findActiveCommissioner,
  findTeamManagerName,
  getRequestDetail,
  type RequestDetail,
  type SubRequestRecord,
} from "@injurysub/db";
import {
  type AlertAmount,
  type AlertSituation,
  buildCommissionerOutboxEmail,
} from "@injurysub/email";
import { z } from "zod";

// Emails the active commissioner that a request needs them, in the caller's transaction, keyed to
// the request's version after the change. Nothing goes out while no commissioner account is active.
export async function enqueueCommissionerEmail(
  tx: DatabaseExecutor,
  request: SubRequestRecord,
  now: Date
): Promise<void> {
  const commissioner = await findActiveCommissioner(tx);
  if (commissioner === null) return;
  const detail = await getRequestDetail(tx, request.requestId);
  const email = await buildCommissionerOutboxEmail({
    to: commissioner.email,
    requestId: request.requestId,
    version: request.version,
    teamId: request.teamId,
    teamName: filedTeamNameOf(detail),
    injuredName: request.injuredName,
    replacementName: request.replacementName,
    slot: request.injuredSlot,
    askedAt: request.requestMoment,
    // The team's manager, whoever filed it (FS-EMAIL-8).
    askedBy: await findTeamManagerName(tx, request.teamId),
    amount: amountOf(request, detail),
    situation: situationOf(request, detail),
  });
  await enqueueEmail(tx, { emailId: randomUUID(), ...email, createdAt: now });
}

// The team's name as ESPN gave it when the request was filed (Dec-D32a): every filing stores
// ESPN's lineup read in its snapshot. Without one, the email names the team by its number.
const filedLineupSchema = z.object({ lineup: z.object({ teamName: z.string().min(1) }) });

function filedSnapshotOf(detail: RequestDetail | null) {
  return detail?.snapshots.find((snapshot) => snapshot.phase === "request");
}

function filedTeamNameOf(detail: RequestDetail | null): string | null {
  const parsed = filedLineupSchema.safeParse(filedSnapshotOf(detail)?.payload);
  return parsed.success ? parsed.data.lineup.teamName : null;
}

// What the request's events record about its adjustment and why it came to the commissioner: the
// amount a step computed or tried to post, the amount computed at approval, and the rules that
// differed when it was held (`adjustment-step.ts`).
const amountsSchema = z.object({
  computedTenths: z.number().int().optional(),
  finalTenths: z.number().int().optional(),
  approvedComputedTenths: z.number().int().nullable().optional(),
  mismatches: z.array(z.unknown()).optional(),
});

type RecordedAmounts = z.infer<typeof amountsSchema>;

// The newest of the request's events that records an amount the worker worked out.
function recordedAmountsOf(detail: RequestDetail | null): RecordedAmounts {
  const events = [...(detail?.events ?? [])].reverse();
  for (const event of events) {
    const parsed = amountsSchema.safeParse(event.payload);
    if (!parsed.success) continue;
    const { computedTenths, finalTenths } = parsed.data;
    if (computedTenths !== undefined || finalTenths !== undefined) return parsed.data;
  }
  return {};
}

// Which amount the alert shows (Revision 6 K): settled, then computed, then the projection.
function amountOf(request: SubRequestRecord, detail: RequestDetail | null): AlertAmount {
  const settled = request.finalAdjustmentTenths ?? request.overrideAdjustmentTenths;
  if (settled !== null) return { tenths: settled, kind: "settled" };
  const { finalTenths, computedTenths } = recordedAmountsOf(detail);
  const computed = finalTenths ?? computedTenths;
  if (computed !== undefined) return { tenths: computed, kind: "computed" };
  return { tenths: request.projectedAdjustmentTenths, kind: "projected" };
}

const mismatchSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("setting"),
    setting: z.string(),
    espn: z.string(),
    expected: z.string(),
  }),
  z.object({
    kind: z.literal("day-points"),
    name: z.string(),
    espnPoints: z.number(),
    formulaPoints: z.number(),
  }),
]);

// The first rule that differed when the adjustment was held, as the request's page words it.
function heldRulesOf(detail: RequestDetail | null): { first: string; more: number } | null {
  const mismatches = recordedAmountsOf(detail).mismatches ?? [];
  const first = mismatchSchema.safeParse(mismatches[0]);
  if (!first.success) return null;
  const rule = first.data;
  const words =
    rule.kind === "setting"
      ? `${rule.setting} is ${rule.espn} on ESPN; InjurySub expects ${rule.expected}`
      : `${rule.name} scored ${rule.espnPoints} on ESPN; InjurySub’s formula gives ${rule.formulaPoints}`;
  return { first: words, more: mismatches.length - 1 };
}

// The confirmed plan moves the injured starter first and the replacement last; the rest are the
// other starters a rearrangement would move.
const filedPlanSchema = z.object({
  plan: z.array(z.object({ playerId: z.number().int(), toSlot: z.string() })),
  lineup: z.object({
    starters: z.array(
      z.object({ player: z.object({ playerId: z.number(), name: z.string() }).nullable() })
    ),
    bench: z.array(
      z.object({ player: z.object({ playerId: z.number(), name: z.string() }).nullable() })
    ),
  }),
});

function otherMovesOf(detail: RequestDetail | null) {
  const parsed = filedPlanSchema.safeParse(filedSnapshotOf(detail)?.payload);
  if (!parsed.success) return [];
  const { plan, lineup } = parsed.data;
  const names = new Map(
    [...lineup.starters, ...lineup.bench].flatMap(({ player }) =>
      player === null ? [] : [[player.playerId, player.name] as const]
    )
  );
  return plan.slice(1, -1).map(({ playerId, toSlot }) => ({
    name: names.get(playerId) ?? `player ${playerId}`,
    toSlot,
  }));
}

function situationOf(request: SubRequestRecord, detail: RequestDetail | null): AlertSituation {
  const reason = request.reviewReason;
  if (request.status === "awaiting_approval" || reason === null) {
    return { kind: "approval", expiresAt: request.expiresAt ?? request.filedAt };
  }
  switch (reason) {
    case "rearrangement":
      return { kind: "review", reason, moves: otherMovesOf(detail) };
    case "adjustment_held_rules":
      return { kind: "review", reason, rules: heldRulesOf(detail) };
    case "adjustment_changed": {
      const recorded = recordedAmountsOf(detail);
      return {
        kind: "review",
        reason,
        nowTenths: recorded.computedTenths ?? request.projectedAdjustmentTenths ?? 0,
        thenTenths: recorded.approvedComputedTenths ?? request.approvedComputedTenths,
      };
    }
    case "expired":
      return { kind: "review", reason, hours: loadServerEnv().REQUEST_EXPIRY_HOURS };
    case "week_ended":
      return { kind: "review", reason, week: request.matchupPeriodId };
    default:
      return { kind: "review", reason };
  }
}
