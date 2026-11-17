import type { CommissionerAlertInput } from "../src/commissioner-alert";

// Step 6's invented league for the alert previews (the preview's Spam tab sends what it renders
// to react.email, so these entries carry invented names only).
export const ALERT_SAMPLE: CommissionerAlertInput = {
  to: "commissioner@example.test",
  requestId: "00000000-0000-4000-8000-000000000000",
  version: 1,
  teamId: 4,
  teamName: "Stretch Fours",
  injuredName: "Domantas Sabonis",
  replacementName: "Jonas Valančiūnas",
  slot: "C",
  askedAt: new Date("2026-11-12T00:02:00.000Z"),
  askedBy: "Marcus",
  amount: { tenths: -310, kind: "projected" },
  situation: { kind: "approval", expiresAt: new Date("2026-11-12T12:02:00.000Z") },
};
