import { Resend } from "resend";

export type MagicLinkEmailInput = {
  email: string;
  magicLinkUrl: string;
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
