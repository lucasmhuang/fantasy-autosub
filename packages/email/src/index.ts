import { AppError } from "@injurysub/config";
import { Resend } from "resend";

export type MagicLinkEmailInput = {
  email: string;
  magicLinkUrl: string;
};

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

export interface EmailClient {
  mode: EmailDeliveryMode;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export type CreateEmailClientOptions = {
  mode: EmailDeliveryMode;
  fromAddress: string;
  resendApiKey?: string;
  sendTimeoutMs?: number;
};

export function buildMagicLinkEmail(input: MagicLinkEmailInput) {
  return {
    to: input.email,
    subject: "Sign in to InjurySub",
    text: `Open this link to continue signing in: ${input.magicLinkUrl}`,
  };
}

export type EmailErrorCode = "send_rejected" | "send_timeout" | "not_configured";

// A send that failed, or a client that can't send. A rejection's cause keeps only the provider's
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

export type SignInCodeEmailInput = { to: string; code: string; ttlMinutes: number };

// The first sentence is worded so a phone can offer the code for autofill.
export function buildSignInCodeEmail(input: SignInCodeEmailInput): EmailMessage {
  return {
    to: input.to,
    subject: "Sign in to InjurySub",
    text: [
      `Your InjurySub sign-in code is ${input.code}.`,
      `It works for ${input.ttlMinutes} minutes.`,
      "InjurySub never sends sign-in links. If you didn't ask for this code, ignore this email.",
    ].join("\n\n"),
  };
}

export function createResendClient(apiKey: string) {
  return new Resend(apiKey);
}

export function createEmailClient(options: CreateEmailClientOptions): EmailClient {
  if (options.mode === "console") {
    return {
      mode: "console",
      async send(message) {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            service: "email",
            mode: "console",
            from: options.fromAddress,
            ...message,
          })
        );

        return {
          mode: "console",
        };
      },
    };
  }

  if (!options.resendApiKey) {
    throw new EmailError(
      "not_configured",
      "A Resend API key is required when EMAIL_DELIVERY_MODE is resend."
    );
  }

  const client = createResendClient(options.resendApiKey);
  const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;

  return {
    mode: "resend",
    async send(message) {
      const response = await withSendTimeout(
        client.emails.send({
          from: options.fromAddress,
          ...message,
        }),
        sendTimeoutMs
      );

      if (response.error) {
        const { name, statusCode } = response.error;
        throw new EmailError("send_rejected", "The email provider refused the send.", {
          cause: new Error(`${name} (HTTP ${statusCode ?? "none"})`),
        });
      }

      return {
        messageId: response.data?.id,
        mode: "resend",
      };
    },
  };
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
