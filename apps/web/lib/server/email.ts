import { loadServerEnv } from "@injurysub/config";
import { createEmailClient, type EmailClient } from "@injurysub/email";

declare global {
  var __injurysubWebEmailClient: EmailClient | undefined;
}

export function getWebEmailClient(): EmailClient {
  if (globalThis.__injurysubWebEmailClient) {
    return globalThis.__injurysubWebEmailClient;
  }

  const env = loadServerEnv();
  const client = createEmailClient({
    mode: env.EMAIL_DELIVERY_MODE,
    fromAddress: env.EMAIL_FROM_ADDRESS,
    resendApiKey: env.RESEND_API_KEY,
  });

  globalThis.__injurysubWebEmailClient = client;

  return client;
}
