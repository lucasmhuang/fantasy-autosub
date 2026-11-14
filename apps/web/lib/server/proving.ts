import { randomUUID } from "node:crypto";
import {
  appendEvent,
  type DatabaseExecutor,
  describeFailure,
  getRequestDetail,
  isDatabaseQueryError,
  markProvingDone,
  transitionRequest,
} from "@injurysub/db";
import { PROVING_TEAM_ID, transition } from "@injurysub/domain";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";
import { REQUEST_ID } from "./request-view";
import { confirmFiling, type Submission, type SubmitResult } from "./requests";

export type ProvingActionResult = {
  status:
    | "cancelled"
    | "proving_marked_done"
    | "not_allowed"
    | "changed"
    | "not_found"
    | "invalid_form"
    | "unavailable";
};

const CANCEL_REASON = "Cancelled by the commissioner.";

// The commissioner files a proving request on team 1, as Confirm files a substitution: checked
// against ESPN now and the edit the page showed. The domain refuses the rest (S9, S19).
export function fileProvingRequest(input: {
  user: Submission["user"];
  form: FormData;
  now: Date;
}): Promise<SubmitResult> {
  return confirmFiling(input, { kind: "proving", teamId: PROVING_TEAM_ID });
}

// Cancel closes a proving request with nothing on ESPN (S19): withdrawn while it waits, is queued
// or is in review untouched, so the worker never runs it; rejected once ESPN refused its swap.
// One whose swap is or may be on ESPN is closed by hand instead.
export async function cancelProvingRequest(input: {
  actorUserId: string;
  form: FormData;
  now: Date;
}): Promise<ProvingActionResult> {
  const requestId = input.form.get("request");
  const shownVersion = input.form.get("version");
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return { status: "not_found" };
  if (typeof shownVersion !== "string" || !/^\d+$/.test(shownVersion)) {
    return { status: "invalid_form" };
  }
  const cancel = { ...input, requestId, version: Number(shownVersion) };
  try {
    return await getWebDatabaseConnection().transaction((tx) => cancelIn(tx, cancel));
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "proving_cancel");
    return { status: "unavailable" };
  }
}

async function cancelIn(
  tx: DatabaseExecutor,
  cancel: { actorUserId: string; requestId: string; version: number; now: Date }
): Promise<ProvingActionResult> {
  const detail = await getRequestDetail(tx, cancel.requestId);
  if (detail === null || detail.request.kind !== "proving") return { status: "not_found" };
  const { request } = detail;
  if (request.version !== cancel.version) return { status: "changed" };
  const type = request.lineupState === "failed" ? "reject" : "withdraw";
  const result = transition(request, { type }, { matchupEnded: false, writeGate: "open" });
  if (!result.ok) return { status: "not_allowed" };
  const moved = await transitionRequest(tx, {
    requestId: request.requestId,
    fromStatus: request.status,
    version: request.version,
    patch: { status: result.status, reviewReason: result.reviewReason },
    now: cancel.now,
  });
  if (moved === null) return { status: "changed" };
  await appendEvent(tx, request.requestId, {
    eventId: randomUUID(),
    actorType: "commissioner",
    actorUserId: cancel.actorUserId,
    eventType: type === "reject" ? "rejected" : "withdrawn",
    payload: { proving: true, from: request.status, reason: CANCEL_REASON },
    createdAt: cancel.now,
  });
  return { status: "cancelled" };
}

// Marks proving done (S9): no new proving request can be filed after it.
export async function markProvingDoneBy(input: {
  actorUserId: string;
  now: Date;
}): Promise<ProvingActionResult> {
  try {
    const db = getWebDatabaseConnection().db;
    await markProvingDone(db, { updatedBy: input.actorUserId, now: input.now });
    getWebLogger().info("web.commish.proving_marked_done", {});
    return { status: "proving_marked_done" };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "proving_done");
    return { status: "unavailable" };
  }
}

function logFailure(error: unknown, flow: string): void {
  getWebLogger().error("web.commish.database_failed", undefined, {
    flow,
    reason: describeFailure(error),
  });
}
