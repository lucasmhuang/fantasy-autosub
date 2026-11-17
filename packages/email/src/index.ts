import { AppError } from "@injurysub/config";
import { formatPacificMoment } from "@injurysub/domain";
import { Resend } from "resend";
import { type CommissionerAlertInput, commissionerAlertRecord } from "./commissioner-alert";
import { renderEmail } from "./render";
import { type SignInCodeRecordInput, signInCodeRecord } from "./sign-in";

export type { AlertAmount, AlertSituation, CommissionerAlertInput } from "./commissioner-alert";

export type EmailDeliveryMode = "console" | "resend";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult = {
  messageId?: string;
  mode: EmailDeliveryMode;
};

// The idempotency key makes a retried send deliver once (Resend's Idempotency-Key).
export type EmailSendOptions = { idempotencyKey?: string };

export interface EmailClient {
  mode: EmailDeliveryMode;
  send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailSendResult>;
}

export type CreateEmailClientOptions = {
  mode: EmailDeliveryMode;
  fromAddress: string;
  resendApiKey?: string;
  sendTimeoutMs?: number;
};

export type EmailErrorCode =
  | "send_rejected"
  | "send_unavailable"
  | "send_timeout"
  | "not_configured";

// A send that failed, or a client that can't send. A failed send's cause keeps only the provider's
// error name and HTTP status, never its message, so no provider text that might echo the email
// reaches a log line. The provider's dashboard keeps the full error.
export class EmailError extends AppError {
  override readonly name = "EmailError";
  readonly code: EmailErrorCode;

  constructor(code: EmailErrorCode, message: string, options: { cause?: Error } = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.code = code;
  }
}

const DEFAULT_SEND_TIMEOUT_MS = 10_000;

export type SignInCodeEmailInput = { to: string } & SignInCodeRecordInput;

// Sent by the web, never queued: both parts, the code's sentence first in each (FS-EMAIL-6).
export async function buildSignInCodeEmail(input: SignInCodeEmailInput): Promise<EmailMessage> {
  const record = signInCodeRecord(input);
  const { html, text } = await renderEmail(record);
  return { to: input.to, subject: record.subject, text, html };
}

export type CommissionerOutboxEmail = {
  dedupeKey: string;
  toAddress: string;
  subject: string;
  body: string;
  html?: string;
};

// An email about one request names it, so the request's page can find whether it went out.
export type RequestOutboxEmail = CommissionerOutboxEmail & { requestId: string; html: string };

// The commissioner's alert as an outbox row, built in one place for the web and the worker, so
// the two can't key the same change differently: request id plus its version after the change.
export async function buildCommissionerOutboxEmail(
  input: CommissionerAlertInput
): Promise<RequestOutboxEmail> {
  const record = commissionerAlertRecord(input);
  const { html, text } = await renderEmail(record);
  return {
    dedupeKey: `${input.requestId}:${input.version}`,
    requestId: input.requestId,
    toAddress: input.to,
    subject: record.subject,
    body: text,
    html,
  };
}

// A send that may go through if tried again: no answer, a timeout, a rate limit or a provider
// failure. Retried under the same idempotency key, it still delivers once.
export function isRetryableEmailFailure(error: EmailError): boolean {
  return error.code === "send_unavailable" || error.code === "send_timeout";
}

export function createResendClient(apiKey: string) {
  return new Resend(apiKey);
}

export function createEmailClient(options: CreateEmailClientOptions): EmailClient {
  if (options.mode === "console") return createConsoleEmailClient(options.fromAddress);
  if (!options.resendApiKey) {
    throw new EmailError(
      "not_configured",
      "A Resend API key is required when EMAIL_DELIVERY_MODE is resend."
    );
  }
  return createResendEmailClient({ ...options, resendApiKey: options.resendApiKey });
}

// Every email comes from InjurySub by name (Dec-D32b); EMAIL_FROM_ADDRESS stays a bare address.
function senderOf(fromAddress: string): string {
  return `InjurySub <${fromAddress}>`;
}

function createConsoleEmailClient(fromAddress: string): EmailClient {
  return {
    mode: "console",
    async send(message) {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          service: "email",
          mode: "console",
          from: senderOf(fromAddress),
          ...message,
        })
      );
      return { mode: "console" };
    },
  };
}

function createResendEmailClient(
  options: CreateEmailClientOptions & { resendApiKey: string }
): EmailClient {
  const client = createResendClient(options.resendApiKey);
  const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  return {
    mode: "resend",
    async send(message, sendOptions = {}) {
      const response = await withSendTimeout(
        client.emails.send({ from: senderOf(options.fromAddress), ...message }, sendOptions),
        sendTimeoutMs
      );
      if (response.error) {
        const { name, statusCode } = response.error;
        throw new EmailError(
          failureCodeFor(statusCode),
          "The email provider didn't take the send.",
          {
            cause: new Error(`${name} (HTTP ${statusCode ?? "none"})`),
          }
        );
      }
      return { messageId: response.data?.id, mode: "resend" };
    },
  };
}

// No HTTP status means the request never got an answer; 429 and 5xx are the provider's own
// trouble. Any other status is a refusal that sending again won't change.
function failureCodeFor(statusCode: number | null | undefined): EmailErrorCode {
  const unavailable = statusCode == null || statusCode === 429 || statusCode >= 500;
  return unavailable ? "send_unavailable" : "send_rejected";
}

// Resend's send takes no abort signal, so a send that answers after the timeout may still deliver.
async function withSendTimeout<T>(sending: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new EmailError("send_timeout", `The email provider didn't answer within ${timeoutMs} ms.`)
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([sending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Tells the commissioner ESPN refused the cookie (O3): one email per refusal, keyed to when ESPN
// began refusing it, so the worker's next checks of the same refusal send nothing more.
export function buildCredentialsRefusedOutboxEmail(input: {
  to: string;
  since: Date;
}): CommissionerOutboxEmail {
  return {
    dedupeKey: `espn-access:credentials_rejected:${input.since.toISOString()}`,
    toAddress: input.to,
    subject: "InjurySub: ESPN refused the cookie",
    body: [
      "ESPN refused InjurySub's ESPN cookie, so InjurySub can't read or change the league until you renew the ESPN cookie on the worker.",
      "Requests waiting to run stay in line, and their managers see them as delayed. They run once ESPN accepts the new cookie, checked again first.",
      "Misuse watch: paused until ESPN accepts a new cookie.",
    ].join("\n\n"),
  };
}

// The reminder every misuse alert carries (M10): the cookie works until it expires, wherever a
// copy of it is.
const COOKIE_REMINDER =
  "Deleting the cookie from Railway doesn't revoke it on ESPN: turn automation off from the commissioner page, then follow the runbook.";

// One email per misuse alert (M1, M4, M10): what it was, the team as ESPN names it, ESPN's time
// for it in PT, and what undoing it takes. Keyed to the alert, so the outbox sends it once.
export function buildMisuseAlertOutboxEmail(input: {
  to: string;
  alertId: string;
  teamName: string | null;
  espnAt: Date | null;
  what: string;
  undo: readonly string[];
}): CommissionerOutboxEmail {
  const subject = `InjurySub: check a league-manager action on ${input.teamName ?? "the league"}`;
  const time = input.espnAt === null ? [] : [`ESPN's time: ${formatPacificMoment(input.espnAt)}`];
  return {
    dedupeKey: `misuse-alert:${input.alertId}`,
    toAddress: input.to,
    subject,
    body: [
      input.what,
      ...time,
      `To undo it:\n${input.undo.join("\n")}`,
      COOKIE_REMINDER,
      "If it was yours, acknowledge it on the commissioner page's alerts.",
    ].join("\n\n"),
  };
}

// Detection couldn't reach ESPN (M6, Dec-D32c): one email per pause, keyed to when it began. A
// refused cookie sends the credentials email instead, which says the watch is paused.
export function buildWatchPausedOutboxEmail(input: {
  to: string;
  since: Date;
}): CommissionerOutboxEmail {
  return {
    dedupeKey: `misuse-watch:paused:${input.since.toISOString()}`,
    toAddress: input.to,
    subject: "InjurySub: the misuse watch is paused",
    body: [
      `InjurySub hasn't been able to read ESPN since ${formatPacificMoment(input.since)}, so it can't check the league for league-manager actions it didn't make.`,
      "It checks again every few minutes, and once ESPN answers it reads back over the time it missed.",
    ].join("\n\n"),
  };
}
