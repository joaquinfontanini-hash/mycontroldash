import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";

export const jobLogsTable = pgTable("job_logs", {
  id:             serial("id").primaryKey(),
  jobName:        text("job_name").notNull(),
  status:         text("status").notNull(),   // running | success | failed | skipped
  startedAt:      timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt:     timestamp("finished_at", { withTimezone: true }),
  durationMs:     integer("duration_ms"),
  recordsAffected: integer("records_affected").default(0),
  errorMessage:   text("error_message"),
  metaJson:       text("meta_json"),
}, t => [
  index("jl_job_name_idx").on(t.jobName),
  index("jl_status_idx").on(t.status),
  index("jl_started_at_idx").on(t.startedAt),
]);

export type JobLog = typeof jobLogsTable.$inferSelect;
