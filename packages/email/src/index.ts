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
};

export function buildMagicLinkEmail(input: MagicLinkEmailInput) {
  return {
    to: input.email,
    subject: "Sign in to InjurySub",
    text: `Open this link to continue signing in: ${input.magicLinkUrl}`,
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
    throw new Error("A Resend API key is required when EMAIL_DELIVERY_MODE is resend.");
  }

  const client = createResendClient(options.resendApiKey);

  return {
    mode: "resend",
    async send(message) {
      const response = await client.emails.send({
        from: options.fromAddress,
        ...message,
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      return {
        messageId: response.data?.id,
        mode: "resend",
      };
    },
  };
}
