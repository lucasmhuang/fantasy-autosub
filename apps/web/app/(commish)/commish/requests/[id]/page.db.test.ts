import { randomUUID } from "node:crypto";
import { writeLeagueSettings } from "@injurysub/db";
import { describe, expect } from "vitest";
import { renderedMarkup } from "../../../../../components/test-support";
import {
  callPage,
  insertInventedRequest,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  webDbTest,
} from "../../../../../lib/server/test-support";
import CommissionerRequestPage from "./page";

const id = randomUUID();
const open = (
  token: string | null,
  requestId: string = id,
  searchParams: { status?: string; form?: string } = {}
) =>
  callPage(token, () =>
    CommissionerRequestPage({
      params: Promise.resolve({ id: requestId }),
      searchParams: Promise.resolve(searchParams),
    })
  );

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the request detail's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({
      redirect: `/login?redirect=${encodeURIComponent(`/commish/requests/${id}`)}`,
    });
  });

  webDbTest("sends a manager to the team page", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { teamId: 2 });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({
      redirect: "/app?status=commissioner_page",
    });
  });
});

// RS-DETAIL-1: a proving run's Approve and "put back" answer here, so the forward carries them.
describe("the request detail's redirects", () => {
  webDbTest("sends an unknown request to the queue", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });

    expect(await open(await insertSession(db, userId, new Date()), randomUUID())).toEqual({
      redirect: "/commish/requests",
    });
  });

  webDbTest.for([
    [undefined, "/commish/proving"],
    ["approved", "/commish/proving?status=approved"],
  ] as const)(
    "sends a proving request, with ?status=%s, to %s",
    async ([status, destination], { database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
      const proving = await insertInventedRequest(db, { kind: "proving", teamId: 1 });
      const token = await insertSession(db, userId, new Date());

      expect(await open(token, proving, status === undefined ? {} : { status })).toEqual({
        redirect: destination,
      });
    }
  );
});

describe("the request detail", () => {
  webDbTest(
    "shows the request's status and record beside the queue, with its row marked",
    async ({ database }) => {
      const { db } = database.connection;
      setRefusingWebEspn("espn_unavailable");
      const requestId = await insertInventedRequest(db, { teamId: 2 });
      const commissioner = await insertInventedUser(db, { role: "commissioner", teamId: 1 });

      const markup = (
        await renderedMarkup(
          await open(await insertSession(db, commissioner, new Date()), requestId)
        )
      ).replaceAll("<!-- -->", "");

      expect(markup).toContain("Needs you: automation off");
      expect(markup).toContain("Record");
      expect(markup).toContain('aria-current="true"');
    }
  );
});

// FS-SHELL-7, Revision 4 A and C: one automation line, the detail's own (the queue beside it at
// 1280 drops its), its switch answering on this request.
describe("the request detail's automation line", () => {
  webDbTest("draws one line, its switch posting this request", async ({ database }) => {
    const { db } = database.connection;
    setRefusingWebEspn("not_connected");
    const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
    await writeLeagueSettings(db, {
      executionMode: "approval_required",
      writeAllowlist: [1, 4],
      updatedBy: userId,
      now: new Date(),
      shownUpdatedAt: null,
    });
    const requestId = await insertInventedRequest(db, { teamId: 3 });
    const token = await insertSession(db, userId, new Date());

    const markup = await renderedMarkup(await open(token, requestId));

    expect(markup.match(/class="autostrip/g)).toHaveLength(1);
    expect(markup).toContain(
      `<input type="hidden" name="from" value="/commish/requests/${requestId}"/>`
    );
  });
});
