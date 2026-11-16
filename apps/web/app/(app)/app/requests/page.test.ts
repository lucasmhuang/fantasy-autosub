import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { describe, expect, it } from "vitest";
import RequestsPage from "./page";

// The shell's Requests destination exists before its list does (R7d-7): until then it opens the
// Team page, which lists the team's requests below its board.
describe("the requests list", () => {
  it("opens the Team page until the list is built", () => {
    let location: string | null = null;
    try {
      RequestsPage();
    } catch (error) {
      if (!isRedirectError(error)) throw error;
      location = getURLFromRedirectError(error);
    }

    expect(location).toBe("/app");
  });
});
