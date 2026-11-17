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
    // The one catch a friend couldn't guess: an older code typed in reads only as a wrong try.
    body: [`Expires in ${input.ttlMinutes} minutes. If you got more than one, use the newest.`],
  };
}
