import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const registrationRequestsTable = pgTable("registration_requests", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  note: text("note"),
  status: text("status").notNull().default("pending"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RegistrationRequest = typeof registrationRequestsTable.$inferSelect;
export type InsertRegistrationRequest = typeof registrationRequestsTable.$inferInsert;
