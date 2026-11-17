import type { MisuseAlertEmailInput } from "../src/notices";

// Step 6's invented misuse alert (the preview's Spam tab sends what it renders to react.email).
export const MISUSE_SAMPLE: MisuseAlertEmailInput = {
  to: "commissioner@example.test",
  alertId: "00000000-0000-4000-8000-000000000001",
  kind: "lm_transaction",
  teamId: 6,
  teamName: "Backdoor Cutters",
  espnAt: new Date("2026-11-11T23:12:00.000Z"),
  foundAt: new Date("2026-11-11T23:13:00.000Z"),
  what: "A league-manager lineup edit InjurySub didn't make on Backdoor Cutters, from ESPN's day 23: Move Pascal Siakam from F to BE. Move Bennedict Mathurin from BE to F.",
  undo: ["Move Bennedict Mathurin from F to BE.", "Move Pascal Siakam from BE to F."],
  moves: [
    { name: "Pascal Siakam", fromSlot: "F", toSlot: "BE" },
    { name: "Bennedict Mathurin", fromSlot: "BE", toSlot: "F" },
  ],
};
