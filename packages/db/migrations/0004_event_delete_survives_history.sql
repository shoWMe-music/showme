ALTER TABLE "invitations" DROP CONSTRAINT "invitations_target_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "booking_requests" DROP CONSTRAINT "booking_requests_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "spam_flags" DROP CONSTRAINT "spam_flags_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_target_event_id_events_id_fk" FOREIGN KEY ("target_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spam_flags" ADD CONSTRAINT "spam_flags_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;