export const replacementOptionStatuses = [
  "auto_executable",
  "valid_requires_review",
  "invalid",
] as const;

export type ReplacementOptionStatus = (typeof replacementOptionStatuses)[number];

export const replacementOptionLabelMap: Record<ReplacementOptionStatus, string> = {
  auto_executable: "Ready now",
  valid_requires_review: "Review required",
  invalid: "Not valid",
};
