CREATE TABLE "setlist_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setlist_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setlist_shares_setlist_id_participant_id_unique" UNIQUE("setlist_id","participant_id")
);
--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "on_behalf_of_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "setlist_shares" ADD CONSTRAINT "setlist_shares_setlist_id_setlists_id_fk" FOREIGN KEY ("setlist_id") REFERENCES "public"."setlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setlist_shares" ADD CONSTRAINT "setlist_shares_participant_id_event_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."event_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_on_behalf_of_profile_id_profiles_id_fk" FOREIGN KEY ("on_behalf_of_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Drop `custom` from deal_type (audit A-15; PLAN.md:139 — "free text broke the
-- engine"). Any row still carrying it is re-labelled `performance`: `type` is the
-- at-a-glance grouping, the settlement math lives in `structure`, so the re-label
-- moves no money. Runs BEFORE the type is recreated, or the cast would fail.
UPDATE "deals" SET "type" = 'performance' WHERE "type" = 'custom';--> statement-breakpoint
ALTER TABLE "public"."deals" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."deal_type";--> statement-breakpoint
CREATE TYPE "public"."deal_type" AS ENUM('performance', 'rental', 'fee', 'split');--> statement-breakpoint
ALTER TABLE "public"."deals" ALTER COLUMN "type" SET DATA TYPE "public"."deal_type" USING "type"::"public"."deal_type";