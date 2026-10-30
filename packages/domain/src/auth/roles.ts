// Declared twice, as each status, role and mode enum is: here, and as db's user_role pgEnum.
export const userRoles = ["manager", "commissioner"] as const;

export type UserRole = (typeof userRoles)[number];
