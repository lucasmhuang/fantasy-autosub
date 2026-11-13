import { randomUUID } from "node:crypto";
import {
  type DatabaseExecutor,
  enqueueEmail,
  findActiveCommissioner,
  getRequestDetail,
  type RequestDetail,
  type SubRequestRecord,
} from "@injurysub/db";
import { commissionerReasonFor } from "@injurysub/domain";
import { buildCommissionerOutboxEmail } from "@injurysub/email";
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
  const teamName = filedTeamNameOf(await getRequestDetail(tx, request.requestId));
  await enqueueEmail(tx, commissionerEmailFor(request, { to: commissioner.email, teamName }, now));
}

// The team's name as ESPN gave it when the request was filed (Dec-D32a): every filing stores
// ESPN's lineup read in its snapshot. Without one, the email names the team by its number.
const filedLineupSchema = z.object({ lineup: z.object({ teamName: z.string().min(1) }) });

function filedTeamNameOf(detail: RequestDetail | null): string | null {
  const filed = detail?.snapshots.find((snapshot) => snapshot.phase === "request");
  const parsed = filedLineupSchema.safeParse(filed?.payload);
  return parsed.success ? parsed.data.lineup.teamName : null;
}

function commissionerEmailFor(
  request: SubRequestRecord,
  recipient: { to: string; teamName: string | null },
  now: Date
) {
  const email = buildCommissionerOutboxEmail({
    requestId: request.requestId,
    version: request.version,
    to: recipient.to,
    teamName: recipient.teamName,
    teamId: request.teamId,
    injuredName: request.injuredName,
    replacementName: request.replacementName,
    reason: commissionerReasonFor(request.status, request.reviewReason) ?? "it needs your look",
    adjustmentTenths: request.projectedAdjustmentTenths,
  });
  return { emailId: randomUUID(), ...email, createdAt: now };
}
