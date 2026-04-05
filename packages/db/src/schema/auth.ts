import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["manager", "commissioner"]);
export const loginLinkStatusEnum = pgEnum("login_link_status", [
  "active",
  "used",
  "expired",
  "revoked",
]);

export const userAccounts = pgTable(
  "user_accounts",
  {
    userId: uuid("user_id").primaryKey(),
    email: text("email").notNull().unique(),
    teamId: integer("team_id"),
    displayName: text("display_name").notNull(),
    role: userRoleEnum("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => ({
    teamIdIdx: index("user_accounts_team_id_idx").on(table.teamId),
    roleIdx: index("user_accounts_role_idx").on(table.role),
  })
);

export const loginLinkTokens = pgTable(
  "login_link_tokens",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userAccounts.userId, { onDelete: "cascade" }),
    redirectPath: text("redirect_path"),
    status: loginLinkStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index("login_link_tokens_user_id_idx").on(table.userId),
    statusIdx: index("login_link_tokens_status_idx").on(table.status),
    expiresAtIdx: index("login_link_tokens_expires_at_idx").on(table.expiresAt),
  })
);

export const sessions = pgTable(
  "sessions",
  {
    sessionId: text("session_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userAccounts.userId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
  },
  (table) => ({
    userIdIdx: index("sessions_user_id_idx").on(table.userId),
    expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt),
    revokedAtIdx: index("sessions_revoked_at_idx").on(table.revokedAt),
  })
);
