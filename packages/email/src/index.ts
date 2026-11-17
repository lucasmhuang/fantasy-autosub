import { AppError } from "@injurysub/config";
import { Resend } from "resend";
import { type CommissionerAlertInput, commissionerAlertRecord } from "./commissioner-alert";
import {
  type CredentialsRefusedEmailInput,
  credentialsRefusedRecord,
  type MisuseAlertEmailInput,
  misuseAlertRecord,
  type WatchPausedEmailInput,
  watchPausedRecord,
} from "./notices";
import type { EmailRecord } from "./record";
import { renderEmail } from "./render";
import { type SignInCodeRecordInput, signInCodeRecord } from "./sign-in";

export type { AlertAmount, AlertSituation, CommissionerAlertInput } from "./commissioner-alert";
export type {
  CredentialsRefusedEmailInput,
  MisuseAlertEmailInput,
  WatchPausedEmailInput,
} from "./notices";

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
  html: string;
};

// An email about one request names it, so the request's page can find whether it went out.
export type RequestOutboxEmail = CommissionerOutboxEmail & { requestId: string };

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
export async function buildCredentialsRefusedOutboxEmail(
  input: CredentialsRefusedEmailInput
): Promise<CommissionerOutboxEmail> {
  return noticeEmail(
    `espn-access:credentials_rejected:${input.since.toISOString()}`,
    input.to,
    credentialsRefusedRecord(input)
  );
}

// One email per misuse alert (M1, M4, M10), keyed to the alert, so the outbox sends it once.
export async function buildMisuseAlertOutboxEmail(
  input: MisuseAlertEmailInput
): Promise<CommissionerOutboxEmail> {
  return noticeEmail(`misuse-alert:${input.alertId}`, input.to, misuseAlertRecord(input));
}

// The watch couldn't read ESPN (M6, Dec-D32c): one email per pause, keyed to when it began. A
// cookie refused on the league's read sends the credentials email instead, which says the watch
// is paused.
export async function buildWatchPausedOutboxEmail(
  input: WatchPausedEmailInput
): Promise<CommissionerOutboxEmail> {
  return noticeEmail(
    `misuse-watch:paused:${input.since.toISOString()}`,
    input.to,
    watchPausedRecord(input)
  );
}

async function noticeEmail(
  dedupeKey: string,
  to: string,
  record: EmailRecord
): Promise<CommissionerOutboxEmail> {
  const { html, text } = await renderEmail(record);
  return { dedupeKey, toAddress: to, subject: record.subject, body: text, html };
}
