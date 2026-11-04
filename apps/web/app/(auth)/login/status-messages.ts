export type StatusMessage = { body: string; tone: "success" | "danger" | "muted" };

export type StatusContext = {
  email: string | null;
  sender: string;
  retryAfterMinutes: number | null;
  triesLeft: number | null;
};

const fixedMessages: Record<string, StatusMessage> = {
  too_many_tries: {
    body: "That code had too many wrong tries. Send a new code.",
    tone: "danger",
  },
  code_expired: {
    body: "That code has expired or was already used. Send a new code.",
    tone: "danger",
  },
  invalid_code: { body: "Enter the 6-digit code from the email.", tone: "danger" },
  unknown_email: {
    body: "I don't recognize that email address. Ask your commissioner to add you.",
    tone: "danger",
  },
  invalid_email: { body: "Enter a valid email address.", tone: "danger" },
  send_failed: {
    body: "The sign-in email could not be sent. Try again in a moment.",
    tone: "danger",
  },
  unavailable: {
    body: "Something went wrong on our side. Try again in a moment.",
    tone: "danger",
  },
  signed_out: { body: "You have been signed out.", tone: "muted" },
};

// The message for a status the sign-in routes wrote into /login, or null for none.
export function renderStatusMessage(
  status: string | null,
  context: StatusContext
): StatusMessage | null {
  switch (status) {
    case "code_sent":
      return {
        body: `We emailed a 6-digit code to ${context.email ?? "your address"} from ${context.sender}.`,
        tone: "success",
      };
    case "wrong_code":
      return { body: wrongCodeMessage(context.triesLeft), tone: "danger" };
    case "too_many_codes":
      return { body: tooManyCodesMessage(context.retryAfterMinutes), tone: "danger" };
    default:
      return status !== null && Object.hasOwn(fixedMessages, status)
        ? (fixedMessages[status] ?? null)
        : null;
  }
}

function wrongCodeMessage(triesLeft: number | null): string {
  const message = "That code isn't right. Use the code from the newest email.";
  if (triesLeft === null) return message;
  return `${message} ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left.`;
}

// Under an hour in minutes; from an hour up in whole hours, rounded up.
function tooManyCodesMessage(retryAfterMinutes: number | null): string {
  const message = "Too many codes requested.";
  if (retryAfterMinutes === null) return `${message} Try again later.`;
  if (retryAfterMinutes < 60) {
    const unit = retryAfterMinutes === 1 ? "minute" : "minutes";
    return `${message} Try again in ${retryAfterMinutes} ${unit}.`;
  }
  const hours = Math.ceil(retryAfterMinutes / 60);
  return `${message} Try again in about ${hours} ${hours === 1 ? "hour" : "hours"}.`;
}
