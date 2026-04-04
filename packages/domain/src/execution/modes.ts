export const executionModes = ["auto_execute", "approval_required"] as const;

export type ExecutionMode = (typeof executionModes)[number];
