import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["manager", "commissioner"]);
export const loginLinkStatusEnum = pgEnum("login_link_status", [
  "active",
  "used",
  "expired",
  "revoked",
]);

export const userAccounts = pgTable("user_accounts", {
  userId: uuid("user_id").primaryKey(),
  email: text("email").notNull().unique(),
  teamId: integer("team_id"),
  displayName: text("display_name").notNull(),
  role: userRoleEnum("role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const loginLinkTokens = pgTable("login_link_tokens", {
  token: text("token").primaryKey(),
  userId: uuid("user_id").notNull(),
  redirectPath: text("redirect_path"),
  status: loginLinkStatusEnum("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const sessions = pgTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  userId: uuid("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
});
