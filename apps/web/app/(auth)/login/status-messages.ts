import { SIGN_IN_CODE_MAX_ATTEMPTS } from "@injurysub/domain";

export type SignInStep = "email" | "code";

// Where a message goes: a problem with what was typed under its field, anything else as a notice
// above the form (the canvas's sign-in frames).
export type SignInMessage =
  | { place: "field"; text: string }
  | { place: "notice"; tone: "info" | "fail" | "wait"; text: string };

export type StatusContext = {
  retryAfterMinutes: number | null;
  triesLeft: number | null;
  // When the newest code stops working, as the page shows a time; null when none works.
  codeWorksUntil: string | null;
};

const field = (text: string): SignInMessage => ({ place: "field", text });
const failure = (text: string): SignInMessage => ({ place: "notice", tone: "fail", text });
const SOMETHING_WRONG = failure("Something went wrong. Try again in a moment.");

const emailStep: Record<string, SignInMessage> = {
  unknown_email: field(
    "No account uses this address. Ask your commissioner which email they registered for you."
  ),
  invalid_email: field("That doesn't look like an email address."),
  send_failed: failure("The code didn't send."),
  unavailable: SOMETHING_WRONG,
  signed_out: { place: "notice", tone: "info", text: "You're signed out on this device." },
};

const codeStep: Record<string, SignInMessage> = {
  invalid_code: field("Enter all 6 digits from the email."),
  code_expired: field("This code expired or was used. Only the newest code works."),
  too_many_tries: failure(`${SIGN_IN_CODE_MAX_ATTEMPTS} wrong tries; this code no longer works.`),
  unavailable: SOMETHING_WRONG,
};

// The message for a status the sign-in routes wrote into /login, on the step it's shown on, or
// null for none. "code_sent" has none: the code step itself says where the code went.
export function renderStatusMessage(
  status: string | null,
  step: SignInStep,
  context: StatusContext
): SignInMessage | null {
  if (step === "code" && status === "wrong_code") return field(wrongCode(context.triesLeft));
  if (step === "code" && status === "too_many_codes") {
    return { place: "notice", tone: "wait", text: codeLimit(context) };
  }
  if (step === "code" && status === "send_failed") return failure(newCodeFailed(context));
  const messages = step === "email" ? emailStep : codeStep;
  return status !== null && Object.hasOwn(messages, status) ? (messages[status] ?? null) : null;
}

function wrongCode(triesLeft: number | null): string {
  if (triesLeft === null) return "Wrong code.";
  return `Wrong code. ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left.`;
}

function newCodeFailed({ codeWorksUntil }: StatusContext): string {
  return codeWorksUntil === null
    ? "The new code didn't send, and your last one expired. Try again in a moment."
    : `The new code didn't send. Your last one works until ${codeWorksUntil}.`;
}

// Under an hour in minutes; from an hour up in whole hours, rounded up.
function codeLimit({ retryAfterMinutes, codeWorksUntil }: StatusContext): string {
  const wait =
    retryAfterMinutes === null
      ? "later"
      : retryAfterMinutes < 60
        ? `in ${retryAfterMinutes} ${retryAfterMinutes === 1 ? "minute" : "minutes"}`
        : `in about ${hours(retryAfterMinutes)}`;
  return codeWorksUntil === null
    ? `Code limit reached, and your newest code has expired. Ask again ${wait}.`
    : `Code limit reached. Ask again ${wait}; your newest code works until ${codeWorksUntil}.`;
}

function hours(minutes: number): string {
  const count = Math.ceil(minutes / 60);
  return `${count} ${count === 1 ? "hour" : "hours"}`;
}

// A request's own page: /app/requests/<id> or /commish/requests/<id>, not the new-request form.
const REQUEST_PAGE = /^\/(app|commish)\/requests\/(?!new$)[^/?#]+$/;

// IF-SIGNIN-4: a browser sent here from a signed-in page goes straight back to it after the code.
export function backNotice(redirectPath: string): SignInMessage | null {
  if (redirectPath === "/app") return null;
  return {
    place: "notice",
    tone: "info",
    text: REQUEST_PAGE.test(redirectPath)
      ? "Sign in to go back to your request."
      : "Sign in to go back where you were.",
  };
}
