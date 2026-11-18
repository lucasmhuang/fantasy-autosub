import { describe, expect, it } from "vitest";
import { formsIn, linksIn, renderMarkup } from "../../../components/test-support";
import { LoginView } from "./login-view";

const sender = "signin@mail.injurysub.example";
const render = (props: Parameters<typeof LoginView>[0]) =>
  renderMarkup(<LoginView {...props} />)
    .replaceAll("&#x27;", "'")
    .replaceAll("<!-- -->", "");

// FS-SIGNIN-1 to -6, FM-SIGNIN-1 to -12, as the canvas draws the two steps.
describe("LoginView", () => {
  // FS-SHELL-11: sign-in carries the mark before the name.
  it("shows the mark before the name", () => {
    const html = render({
      step: { kind: "email", email: null },
      sender,
      ttlMinutes: 10,
      redirectPath: "/app",
      message: null,
    });

    expect(html).toMatch(
      /<div class="brand"><svg class="brand-mark"[\s\S]*?<\/svg>InjurySub<\/div>/
    );
  });

  it("asks for the email on the first step, without script", () => {
    const markup = render({
      step: { kind: "email", email: null },
      sender,
      ttlMinutes: 10,
      redirectPath: "/app",
      message: null,
    });

    expect(markup).toContain(">Sign in</h1>");
    // Copy table 2, A: the button says what happens; no lede or hint.
    expect(markup).not.toContain("we'll send");
    expect(markup).not.toContain("registered for you");
    expect(markup).not.toContain('class="lede"');
    expect(markup).toContain(">Email me a code</button>");
    expect(markup).not.toContain("<script");
  });

  it("puts a problem with the email under its field, marking the field invalid", () => {
    const markup = render({
      step: { kind: "email", email: "dana@exmaple.com" },
      sender,
      ttlMinutes: 10,
      redirectPath: "/app",
      message: { place: "field", text: "That doesn't look like an email address." },
    });

    expect(markup).toMatch(
      /<input[^>]*aria-invalid="true"[^>]*name="email"|name="email"[^>]*aria-invalid="true"/
    );
    expect(markup).toContain("That doesn't look like an email address.");
    expect(formsIn(markup)[0]?.fields[0]).toMatchObject({
      name: "email",
      value: "dana@exmaple.com",
    });
  });

  it("shows any other message as a notice above the form", () => {
    const markup = render({
      step: { kind: "email", email: null },
      sender,
      ttlMinutes: 10,
      redirectPath: "/app",
      message: { place: "notice", tone: "info", text: "You're signed out on this device." },
    });

    expect(markup.match(/class="notice notice-info"/g)).toHaveLength(1);
    expect(markup.indexOf("signed out on this device")).toBeLessThan(markup.indexOf("<form"));
  });

  it("names the address on the code step and lets a long one wrap", () => {
    const address = "dana.whitfield-okonkwo.fantasy-league-2026@example-mail-provider.com";
    const markup = render({
      step: { kind: "code", email: address },
      sender,
      ttlMinutes: 10,
      redirectPath: "/app",
      message: null,
    });

    expect(markup).toContain(">Check your email</h1>");
    expect(markup).toContain(
      `Code sent to <span class="addr">${address}</span>. It works for 10 minutes.`
    );
    expect(markup).toContain(`From ${sender}. Not there? Check Junk, and mark it Not junk.`);
    expect(markup).toContain("Still nothing? Ask your commissioner.");
  });

  // RS-SIGNIN-10: the time a code works is the setting's, never written into the copy.
  it("says how long the code works from the setting", () => {
    const markup = render({
      step: { kind: "code", email: "dana@example.com" },
      sender,
      ttlMinutes: 15,
      redirectPath: "/app",
      message: null,
    });

    expect(markup).toContain("It works for 15 minutes.");
  });

  it("offers a new code and a different email from the code step", () => {
    const markup = render({
      step: { kind: "code", email: "dana@example.com" },
      sender,
      ttlMinutes: 10,
      redirectPath: "/commish/alerts",
      message: { place: "field", text: "Wrong code. 3 tries left." },
    });

    expect(formsIn(markup).map((form) => form.action)).toEqual([
      "/auth/verify-code",
      "/auth/request-code",
    ]);
    // The resend says it came from the code step, so a failure brings them back to it.
    expect(formsIn(markup)[1]?.fields).toContainEqual(
      expect.objectContaining({ name: "step", type: "hidden", value: "code" })
    );
    expect(markup).toContain("Wrong code. 3 tries left.");
    expect(markup).toContain(">Send a new code</button>");
    expect(linksIn(markup)).toContainEqual({
      href: "/login?redirect=%2Fcommish%2Falerts",
      text: "Use a different email",
    });
  });
});
