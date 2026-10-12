import { describe, expect, it, vi } from "vitest";
import { createEmailClient } from "./index";

// Resend's API reports a rejected send as a plain error object; this mirrors that response shape.
const providerError = {
  name: "validation_error",
  message: "The domain is not verified.",
  statusCode: 403,
};

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => ({ data: null, error: providerError }),
    };
  },
}));

describe("createEmailClient", () => {
  it("keeps the provider's error details when a send is rejected", async () => {
    const client = createEmailClient({
      mode: "resend",
      fromAddress: "noreply@example.com",
      resendApiKey: "re_test",
    });

    const sending = client.send({ to: "manager@example.com", subject: "Sign in", text: "link" });

    await expect(sending).rejects.toThrow("The domain is not verified.");
    await expect(sending).rejects.toHaveProperty("cause", providerError);
  });
});
