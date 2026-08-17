ALTER TABLE "shares" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;