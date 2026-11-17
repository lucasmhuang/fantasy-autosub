import type { EmailRecord } from "./record";

export type SignInCodeRecordInput = { code: string; ttlMinutes: number };

// The sign-in email's words (FS-EMAIL-6). The first sentence carries the code, worded so a phone
// can offer it for autofill; the large copy below it is the layout's.
export function signInCodeRecord(input: SignInCodeRecordInput): EmailRecord {
  return {
    kind: "code",
    subject: "Sign in to InjurySub",
    lead: `Your InjurySub sign-in code is ${input.code}.`,
    code: input.code,
    body: [
      `Enter it in InjurySub to finish signing in. It works for ${input.ttlMinutes} minutes, or until a newer code is sent to you.`,
      "InjurySub never sends sign-in links. An email asking you to tap a link to sign in isn’t from InjurySub.",
      "Didn’t ask for this code? You can ignore this email. The code does nothing unless someone enters it.",
    ],
    foot: [
      "Sent by InjurySub to the address your commissioner registered for the league.",
      "Not affiliated with ESPN or the NBA.",
    ],
  };
}
