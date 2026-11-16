import { describe, expect } from "vitest";
import { formsIn, linksIn, renderedMarkup } from "../../../components/test-support";
import {
  callPage,
  insertInventedUser,
  insertSession,
  webDbTest,
} from "../../../lib/server/test-support";
import LoginPage from "./page";

const open = (searchParams: Record<string, string>, token: string | null = null) =>
  callPage(token, () => LoginPage({ searchParams: Promise.resolve(searchParams) }));

const field = (attributes: Record<string, string>) => expect.objectContaining(attributes);

describe("the login page", () => {
  // IF-SIGNIN-4: sent here from a request, the page says the code brings them back to it.
  webDbTest.for([["/app/requests/abc"], ["/commish/requests/abc"]] as const)(
    "says a sign-in from %s goes straight back to the request",
    async ([redirect]) => {
      const markup = await renderedMarkup(await open({ redirect }));

      expect(markup.replaceAll("&#x27;", "'")).toContain(
        "Sign in to continue. You'll go straight back to your request."
      );
    }
  );

  webDbTest.for([["/app/requests/new"], ["/commish/requests"]] as const)(
    "says a sign-in from %s goes straight back to where they were",
    async ([redirect]) => {
      const markup = await renderedMarkup(await open({ redirect }));

      expect(markup.replaceAll("&#x27;", "'")).toContain(
        "Sign in to continue. You'll go straight back to where you were."
      );
    }
  );

  webDbTest("says nothing of going back when sent from the starting page", async () => {
    const markup = await renderedMarkup(await open({ redirect: "/app" }));

    expect(markup).not.toContain("go straight back");
  });

  // RS-SIGNIN-2: the names and values the sign-in routes read.
  webDbTest("posts the email and the destination to send a code", async () => {
    const markup = await renderedMarkup(await open({ redirect: "/app/requests/abc" }));

    expect(formsIn(markup)).toEqual([
      {
        action: "/auth/request-code",
        method: "post",
        fields: [
          field({ tag: "input", name: "email", type: "email", value: "" }),
          field({ tag: "input", name: "redirectPath", type: "hidden", value: "/app/requests/abc" }),
        ],
      },
    ]);
  });

  // RS-SIGNIN-2, RS-SIGNIN-6: one text field a phone fills with the emailed code.
  webDbTest(
    "on the code step, posts the code with the address and destination, and can send a new one",
    async () => {
      const markup = await renderedMarkup(
        await open({ step: "code", email: "person@example.test", redirect: "/commish/alerts" })
      );

      const kept = [
        field({ tag: "input", name: "email", type: "hidden", value: "person@example.test" }),
        field({ tag: "input", name: "redirectPath", type: "hidden", value: "/commish/alerts" }),
      ];
      expect(formsIn(markup)).toEqual([
        {
          action: "/auth/verify-code",
          method: "post",
          fields: [
            field({
              tag: "input",
              name: "code",
              type: "text",
              inputmode: "numeric",
              autocomplete: "one-time-code",
            }),
            ...kept,
          ],
        },
        {
          action: "/auth/request-code",
          method: "post",
          fields: [...kept, field({ tag: "input", name: "step", type: "hidden", value: "code" })],
        },
      ]);
      expect(linksIn(markup)).toContainEqual({
        href: "/login?redirect=%2Fcommish%2Falerts",
        text: "Use a different email",
      });
    }
  );

  // RS-SIGNIN-4: a crafted link can't put its own text on the page.
  webDbTest("shows no address that doesn't parse, staying on the email step", async () => {
    const markup = await renderedMarkup(await open({ step: "code", email: "Call 555-0100 now" }));

    expect(markup).not.toContain("555-0100");
    expect(formsIn(markup)).toEqual([
      expect.objectContaining({
        action: "/auth/request-code",
        fields: expect.arrayContaining([field({ name: "email", value: "" })]),
      }),
    ]);
  });

  webDbTest("fills in an address that parses, on the email step without step=code", async () => {
    const markup = await renderedMarkup(await open({ email: "person@example.test" }));

    expect(formsIn(markup)).toEqual([
      expect.objectContaining({
        action: "/auth/request-code",
        fields: expect.arrayContaining([field({ name: "email", value: "person@example.test" })]),
      }),
    ]);
  });

  // RS-SIGNIN-5: someone signed in goes on, as after signing in.
  webDbTest.for([
    ["manager", 2, "/app/requests/abc", "/app/requests/abc"],
    ["manager", 2, "/commish/requests", "/app?status=commissioner_page"],
    ["commissioner", null, "/app", "/commish/requests"],
  ] as const)(
    "sends a signed-in %s (team %s) asking for %s on to %s",
    async ([role, teamId, asked, destination], { database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { role, teamId });
      const token = await insertSession(db, userId, new Date());

      expect(await open({ redirect: asked }, token)).toEqual({ redirect: destination });
    }
  );
});
