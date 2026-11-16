import { SIGN_IN_CODE_MAX_ATTEMPTS } from "@injurysub/domain";

export type SignInStep = "email" | "code";

// Where a message goes: a problem with what was typed under its field, anything else as a notice
// above the form (the canvas's sign-in frames).
export type SignInMessage =
  | { place: "field"; text: string }
  | { place: "notice"; tone: "info" | "fail" | "wait"; text: string };

export type StatusContext = { retryAfterMinutes: number | null; triesLeft: number | null };

const field = (text: string): SignInMessage => ({ place: "field", text });
const failure = (text: string): SignInMessage => ({ place: "notice", tone: "fail", text });
const ON_OUR_SIDE = failure("Something went wrong on our side. Try again in a moment.");

const emailStep: Record<string, SignInMessage> = {
  unknown_email: field(
    "No account uses this address. Ask your commissioner which email they registered for you."
  ),
  invalid_email: field("That doesn't look like an email address."),
  send_failed: failure("We couldn't send your code just now."),
  unavailable: ON_OUR_SIDE,
  signed_out: { place: "notice", tone: "info", text: "You're signed out on this device." },
};

const codeStep: Record<string, SignInMessage> = {
  invalid_code: field("Enter all 6 digits from the email."),
  code_expired: field(
    "This code has expired or was already used. Send a new code; only the newest one works."
  ),
  too_many_tries: failure(
    `That's ${SIGN_IN_CODE_MAX_ATTEMPTS} wrong tries, so this code no longer works. Send a new code to try again.`
  ),
  send_failed: failure("We couldn't send a new code. Your last one still works."),
  unavailable: ON_OUR_SIDE,
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
    return { place: "notice", tone: "wait", text: codeLimit(context.retryAfterMinutes) };
  }
  const messages = step === "email" ? emailStep : codeStep;
  return status !== null && Object.hasOwn(messages, status) ? (messages[status] ?? null) : null;
}

function wrongCode(triesLeft: number | null): string {
  if (triesLeft === null) return "Wrong code.";
  return `Wrong code. ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left.`;
}

// Under an hour in minutes; from an hour up in whole hours, rounded up.
function codeLimit(retryAfterMinutes: number | null): string {
  const wait =
    retryAfterMinutes === null
      ? "later"
      : retryAfterMinutes < 60
        ? `in ${retryAfterMinutes} ${retryAfterMinutes === 1 ? "minute" : "minutes"}`
        : `in about ${hours(retryAfterMinutes)}`;
  return `Code limit reached. Ask again ${wait}; your newest code still works.`;
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
  const where = REQUEST_PAGE.test(redirectPath) ? "your request" : "where you were";
  return {
    place: "notice",
    tone: "info",
    text: `Sign in to continue. You'll go straight back to ${where}.`,
  };
}
