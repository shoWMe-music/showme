CREATE TYPE "public"."account_kind" AS ENUM('operator', 'performer', 'professional', 'agent');--> statement-breakpoint
CREATE TYPE "public"."admin_alert_kind" AS ENUM('spam_threshold', 'expansion_threshold');--> statement-breakpoint
CREATE TYPE "public"."agreement_status" AS ENUM('draft', 'sent', 'confirmed', 'signed');--> statement-breakpoint
CREATE TYPE "public"."booking_request_source" AS ENUM('public_form', 'performer_offer', 'venue_handoff');--> statement-breakpoint
CREATE TYPE "public"."booking_request_status" AS ENUM('pending', 'accepted', 'declined', 'flagged', 'archived', 'expired');--> statement-breakpoint
CREATE TYPE "public"."booking_sent_via" AS ENUM('in_platform', 'mailto');--> statement-breakpoint
CREATE TYPE "public"."budget_line_kind" AS ENUM('revenue', 'cost');--> statement-breakpoint
CREATE TYPE "public"."budget_scope" AS ENUM('shared', 'private');--> statement-breakpoint
CREATE TYPE "public"."calendar_item_type" AS ENUM('task', 'appointment', 'note');--> statement-breakpoint
CREATE TYPE "public"."deal_party_role" AS ENUM('payer', 'payee', 'split_member', 'commission', 'observer');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('draft', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deal_structure" AS ENUM('guarantee', 'door_split', 'guarantee_vs_door', 'rental');--> statement-breakpoint
CREATE TYPE "public"."deal_type" AS ENUM('performance', 'rental', 'fee', 'split', 'custom');--> statement-breakpoint
CREATE TYPE "public"."event_participant_role" AS ENUM('host', 'co_host', 'performer', 'support', 'crew_lead', 'crew', 'agent');--> statement-breakpoint
CREATE TYPE "public"."event_participant_status" AS ENUM('invited', 'accepted', 'declined', 'confirmed', 'removed');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'suggested', 'pending', 'confirmed', 'on_hold', 'concluded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('photo', 'video', 'document', 'audio', 'other');--> statement-breakpoint
CREATE TYPE "public"."invitation_source" AS ENUM('collaborator', 'admin', 'team', 'venue_handoff', 'performer_offer');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'declined', 'revoked', 'expired', 'used');--> statement-breakpoint
CREATE TYPE "public"."invitation_type" AS ENUM('profile_member', 'event_participant', 'code');--> statement-breakpoint
CREATE TYPE "public"."invoice_direction" AS ENUM('issued', 'received');--> statement-breakpoint
CREATE TYPE "public"."invoice_state" AS ENUM('draft', 'sent', 'paid', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "public"."message_visibility" AS ENUM('all', 'operators', 'party');--> statement-breakpoint
CREATE TYPE "public"."payment_timing" AS ENUM('before_event', 'at_settlement', 'due_date');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('bankgiro', 'iban', 'swish');--> statement-breakpoint
CREATE TYPE "public"."performer_tag" AS ENUM('headliner', 'support', 'dj', 'opener');--> statement-breakpoint
CREATE TYPE "public"."plan_source" AS ENUM('manual', 'stripe');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('free_operator', 'operator_pro', 'free_artist', 'artist_pro');--> statement-breakpoint
CREATE TYPE "public"."pro_code" AS ENUM('stim', 'gema', 'prs', 'none');--> statement-breakpoint
CREATE TYPE "public"."profile_media_kind" AS ENUM('photo', 'video', 'banner', 'avatar', 'document');--> statement-breakpoint
CREATE TYPE "public"."profile_member_role" AS ENUM('owner', 'admin', 'editor', 'viewer', 'crew');--> statement-breakpoint
CREATE TYPE "public"."representation_party" AS ENUM('agent', 'performer');--> statement-breakpoint
CREATE TYPE "public"."representation_status" AS ENUM('proposed', 'active', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."rider_type" AS ENUM('tech', 'hospitality', 'stage_plot', 'input_list');--> statement-breakpoint
CREATE TYPE "public"."schedule_category" AS ENUM('production', 'crew');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('open', 'pending_review', 'comments_received', 'revised', 'finalized', 'partly_paid', 'paid', 'dispute');--> statement-breakpoint
CREATE TYPE "public"."share_access" AS ENUM('public', 'protected');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('budget', 'deal', 'rider', 'terms', 'schedule', 'crew', 'settlement_overview', 'settlement_deal');--> statement-breakpoint
CREATE TYPE "public"."ticketing_source" AS ENUM('manual', 'ticketing_provider');--> statement-breakpoint
CREATE TYPE "public"."transfer_state" AS ENUM('owed', 'paid', 'handled');--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" text,
	"email" text,
	"role_label" text,
	"default_permission_set_id" uuid
);
--> statement-breakpoint
CREATE TABLE "group_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"type" "payout_method" NOT NULL,
	"identifier" text,
	"currency" text,
	"holder_name" text,
	"bank_name" text,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_custom_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"city" text,
	"country" text,
	"lat" double precision,
	"lng" double precision,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "profile_media_kind" NOT NULL,
	"url" text NOT NULL,
	"position" integer
);
--> statement-breakpoint
CREATE TABLE "profile_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"user_id" text,
	"email" text,
	"display_name" text,
	"role" "profile_member_role" NOT NULL,
	"seat_consumed" boolean DEFAULT false NOT NULL,
	"status" text,
	"permission_set_id" uuid,
	"phone" text,
	"notes" text,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_members_profile_id_user_id_unique" UNIQUE("profile_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "profile_social_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "account_kind" NOT NULL,
	"type" text,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"bio" text,
	"avatar_url" text,
	"banner_url" text,
	"details" jsonb,
	"billing" jsonb,
	"claimed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "representations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_profile_id" uuid NOT NULL,
	"performer_profile_id" uuid NOT NULL,
	"region" text[],
	"is_worldwide" boolean DEFAULT false NOT NULL,
	"commission_rate" integer,
	"commissionable_basis" text,
	"agent_collects" boolean DEFAULT false NOT NULL,
	"proposed_by" "representation_party" NOT NULL,
	"status" "representation_status" DEFAULT 'proposed' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"confirmed_by_agent" boolean DEFAULT false NOT NULL,
	"confirmed_by_performer" boolean DEFAULT false NOT NULL,
	"terminated_at" timestamp with time zone,
	"terminated_effective_at" timestamp with time zone,
	"terminated_by" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"initials" text,
	"avatar_url" text,
	"currency" text,
	"date_format" text,
	"time_format" text,
	"timezone" text,
	"company_name" text,
	"country" text,
	"kind" "account_kind" NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"capabilities" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"role" "event_participant_role" NOT NULL,
	"permission_set_id" uuid,
	"performer_tag" "performer_tag",
	"status" "event_participant_status" DEFAULT 'invited' NOT NULL,
	"details" jsonb,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_participants_event_id_profile_id_unique" UNIQUE("event_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_profile_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"event_date" date,
	"door_time" time,
	"start_time" time,
	"end_time" time,
	"curfew" time,
	"timezone" text,
	"venue_profile_id" uuid,
	"stage_id" uuid,
	"venue_name" text,
	"capacity" integer,
	"base_currency" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"notes" text,
	"extras" jsonb,
	"hold_rank" integer,
	"hold_auto_promote" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer
);
--> statement-breakpoint
CREATE TABLE "deal_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"role_in_deal" "deal_party_role" NOT NULL,
	"share" jsonb,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"signature_hash" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"type" "deal_type" NOT NULL,
	"structure" "deal_structure",
	"currency" text,
	"name" text NOT NULL,
	"payer_participant_id" uuid,
	"payment_timing" "payment_timing" DEFAULT 'at_settlement' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"guarantee_amount" bigint,
	"advance_amount" bigint,
	"split_basis_points" integer,
	"terms" jsonb,
	"agreement_body_text" text,
	"agreement_status" "agreement_status" DEFAULT 'draft' NOT NULL,
	"confirmed_snapshot" jsonb,
	"reopen" jsonb,
	"status" "deal_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"kind" "budget_line_kind" NOT NULL,
	"source" "ticketing_source" DEFAULT 'manual' NOT NULL,
	"provider_ref" text,
	"label" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text,
	"collected_by" uuid,
	"paid_by" uuid,
	"payee_participant_id" uuid,
	"cost_split" jsonb,
	"deal_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"scope" "budget_scope" DEFAULT 'shared' NOT NULL,
	"owner_profile_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"party_participant_id" uuid NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settlement_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"party_participant_id" uuid,
	"author_email" text,
	"author_name" text,
	"message" text NOT NULL,
	"attachments" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"from_participant" uuid NOT NULL,
	"to_participant" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text,
	"representation_id" uuid,
	"state" "transfer_state" DEFAULT 'owed' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"participant_id" uuid,
	"representation_id" uuid,
	"status" "settlement_status" DEFAULT 'open' NOT NULL,
	"computed" jsonb,
	"manual_overrides" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_exactly_one_subject" CHECK (num_nonnulls("settlements"."participant_id", "settlements"."representation_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "event_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"sender_user_id" text NOT NULL,
	"sender_participant_id" uuid,
	"body" text NOT NULL,
	"attachments" jsonb,
	"visibility" "message_visibility" DEFAULT 'all' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"kind" "file_kind" NOT NULL,
	"content_type" text,
	"size_bytes" bigint,
	"owner_user_id" text NOT NULL,
	"owner_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"pro_code" "pro_code" DEFAULT 'none' NOT NULL,
	"event_type" text,
	"confidence" text,
	"estimate" bigint
);
--> statement-breakpoint
CREATE TABLE "riders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_profile_id" uuid,
	"event_id" uuid,
	"owner_participant_id" uuid,
	"type" "rider_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"file_id" uuid,
	"source_rider_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"local_date_time" text,
	"duration" integer,
	"label" text NOT NULL,
	"description" text,
	"category" "schedule_category" DEFAULT 'production' NOT NULL,
	"owner_participant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"items" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setlists_event_id_participant_id_unique" UNIQUE("event_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"tier" "plan_tier" NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" "plan_source" DEFAULT 'manual' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" text,
	"renewal_at" timestamp with time zone,
	"seats" integer DEFAULT 1 NOT NULL,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"iban" text,
	"bank_name" text,
	"vat_id" text,
	"address" text,
	"notes" text,
	"persons" jsonb,
	"invitation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "invitation_type" NOT NULL,
	"code" text,
	"token" text,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"created_by_user" text NOT NULL,
	"created_by_profile" uuid,
	"recipient_email" text,
	"recipient_name" text,
	"target_profile_id" uuid,
	"target_event_id" uuid,
	"linked_contact_id" uuid,
	"role" text,
	"permission_set_id" uuid,
	"password_hash" text,
	"source" "invitation_source" NOT NULL,
	"expires_at" timestamp with time zone,
	"used_by_user" text,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_code_unique" UNIQUE("code"),
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "booking_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "booking_request_source" NOT NULL,
	"status" "booking_request_status" DEFAULT 'pending' NOT NULL,
	"target_profile_id" uuid NOT NULL,
	"sender_user_id" text,
	"sender_profile_id" uuid,
	"contact_name" text,
	"email" text,
	"phone" text,
	"artist_name" text,
	"wanted_date" date,
	"additional_dates" jsonb,
	"artist_fee" bigint,
	"offer_fee_min" bigint,
	"offer_fee_max" bigint,
	"pitch" text,
	"note" text,
	"music_url" text,
	"video_url" text,
	"sender_type" text,
	"performer_type" text,
	"genres" jsonb,
	"website_url" text,
	"social_links" jsonb,
	"sent_via" "booking_sent_via" DEFAULT 'in_platform' NOT NULL,
	"event_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_profile_id" uuid NOT NULL,
	"event_id" uuid,
	"direction" "invoice_direction" NOT NULL,
	"issuer_ref" text,
	"recipient_ref" text,
	"transfer_id" uuid,
	"budget_line_id" uuid,
	"number" text,
	"currency" text,
	"line_items" jsonb,
	"vat" jsonb,
	"total" bigint,
	"issued_at" timestamp with time zone,
	"due_date" date,
	"state" "invoice_state" DEFAULT 'draft' NOT NULL,
	"document_snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "share_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"salt" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"rate_window_start" timestamp with time zone,
	CONSTRAINT "share_otps_share_id_email_hash_unique" UNIQUE("share_id","email_hash")
);
--> statement-breakpoint
CREATE TABLE "share_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"linked_participant_id" uuid,
	"claimed_by_user_id" text,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "share_recipients_share_id_email_unique" UNIQUE("share_id","email")
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"event_id" uuid,
	"target_kind" text,
	"target_id" uuid,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"access" "share_access" DEFAULT 'public' NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_profile_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"type" text NOT NULL,
	"actor_user_id" text,
	"actor_profile_id" uuid,
	"actor_display" text,
	"target_kind" text,
	"target_id" uuid,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "admin_alert_kind" NOT NULL,
	"subject_key" text,
	"details" jsonb,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_rsvps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_rsvps_event_id_email_unique" UNIQUE("event_id","email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"acting_profile_id" uuid,
	"capability" text,
	"action" text NOT NULL,
	"target_kind" text,
	"target_id" uuid,
	"event_id" uuid,
	"changes" jsonb,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "calendar_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_profile_id" uuid,
	"owner_user_id" text,
	"type" "calendar_item_type" NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"entity" text,
	"assignee_user_id" text,
	"assignee_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rate_cache" (
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric(18, 10) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rate_cache_base_quote_pk" PRIMARY KEY("base","quote")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"body" text,
	"event_id" uuid,
	"actor_user_id" text,
	"actor_display" text,
	"link" text,
	"metadata" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_unavailability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "spam_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_profile_id" uuid NOT NULL,
	"reporter_profile_id" uuid NOT NULL,
	"reporter_user_id" text,
	"kind" text NOT NULL,
	"context_kind" text,
	"context_id" uuid,
	"event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spam_flags_target_profile_id_reporter_profile_id_kind_unique" UNIQUE("target_profile_id","reporter_profile_id","kind")
);
--> statement-breakpoint
CREATE TABLE "task_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"date" date NOT NULL,
	"time" time,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"owner_profile_id" uuid,
	"owner_user_id" text,
	"title" text NOT NULL,
	"description" text,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"due_date" date,
	"assignee_participant_id" uuid,
	"budget_type" text,
	"budget_amount" bigint,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"category" "template_category" NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_endpoint_key_unique" UNIQUE("user_id","endpoint","key")
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_default_permission_set_id_permission_sets_id_fk" FOREIGN KEY ("default_permission_set_id") REFERENCES "public"."permission_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_profiles" ADD CONSTRAINT "group_profiles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_profiles" ADD CONSTRAINT "group_profiles_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_custom_roles" ADD CONSTRAINT "profile_custom_roles_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_locations" ADD CONSTRAINT "profile_locations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_media" ADD CONSTRAINT "profile_media_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_members" ADD CONSTRAINT "profile_members_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_members" ADD CONSTRAINT "profile_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_members" ADD CONSTRAINT "profile_members_permission_set_id_permission_sets_id_fk" FOREIGN KEY ("permission_set_id") REFERENCES "public"."permission_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_members" ADD CONSTRAINT "profile_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_social_links" ADD CONSTRAINT "profile_social_links_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representations" ADD CONSTRAINT "representations_agent_profile_id_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representations" ADD CONSTRAINT "representations_performer_profile_id_profiles_id_fk" FOREIGN KEY ("performer_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representations" ADD CONSTRAINT "representations_terminated_by_users_id_fk" FOREIGN KEY ("terminated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_sets" ADD CONSTRAINT "permission_sets_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_permission_set_id_permission_sets_id_fk" FOREIGN KEY ("permission_set_id") REFERENCES "public"."permission_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_host_profile_id_profiles_id_fk" FOREIGN KEY ("host_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_profile_id_profiles_id_fk" FOREIGN KEY ("venue_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_venue_profile_id_profiles_id_fk" FOREIGN KEY ("venue_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_participant_id_event_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_payer_participant_id_event_participants_id_fk" FOREIGN KEY ("payer_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_collected_by_event_participants_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_paid_by_event_participants_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_payee_participant_id_event_participants_id_fk" FOREIGN KEY ("payee_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_approvals" ADD CONSTRAINT "settlement_approvals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_approvals" ADD CONSTRAINT "settlement_approvals_party_participant_id_event_participants_id_fk" FOREIGN KEY ("party_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_comments" ADD CONSTRAINT "settlement_comments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_comments" ADD CONSTRAINT "settlement_comments_party_participant_id_event_participants_id_fk" FOREIGN KEY ("party_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_snapshots" ADD CONSTRAINT "settlement_snapshots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_from_participant_event_participants_id_fk" FOREIGN KEY ("from_participant") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_to_participant_event_participants_id_fk" FOREIGN KEY ("to_participant") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_representation_id_representations_id_fk" FOREIGN KEY ("representation_id") REFERENCES "public"."representations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_participant_id_event_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_representation_id_representations_id_fk" FOREIGN KEY ("representation_id") REFERENCES "public"."representations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_sender_participant_id_event_participants_id_fk" FOREIGN KEY ("sender_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reports" ADD CONSTRAINT "performance_reports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_owner_participant_id_event_participants_id_fk" FOREIGN KEY ("owner_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_source_rider_id_riders_id_fk" FOREIGN KEY ("source_rider_id") REFERENCES "public"."riders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_owner_participant_id_event_participants_id_fk" FOREIGN KEY ("owner_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setlists" ADD CONSTRAINT "setlists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setlists" ADD CONSTRAINT "setlists_participant_id_event_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_user_users_id_fk" FOREIGN KEY ("created_by_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_profile_profiles_id_fk" FOREIGN KEY ("created_by_profile") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_target_profile_id_profiles_id_fk" FOREIGN KEY ("target_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_target_event_id_events_id_fk" FOREIGN KEY ("target_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_linked_contact_id_contacts_id_fk" FOREIGN KEY ("linked_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_permission_set_id_permission_sets_id_fk" FOREIGN KEY ("permission_set_id") REFERENCES "public"."permission_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_used_by_user_users_id_fk" FOREIGN KEY ("used_by_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_target_profile_id_profiles_id_fk" FOREIGN KEY ("target_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_sender_profile_id_profiles_id_fk" FOREIGN KEY ("sender_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_transfer_id_settlement_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."settlement_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_otps" ADD CONSTRAINT "share_otps_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_recipients" ADD CONSTRAINT "share_recipients_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_recipients" ADD CONSTRAINT "share_recipients_linked_participant_id_event_participants_id_fk" FOREIGN KEY ("linked_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_recipients" ADD CONSTRAINT "share_recipients_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_profile_id_profiles_id_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_rsvps" ADD CONSTRAINT "audience_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_acting_profile_id_profiles_id_fk" FOREIGN KEY ("acting_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_unavailability" ADD CONSTRAINT "profile_unavailability_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spam_flags" ADD CONSTRAINT "spam_flags_target_profile_id_profiles_id_fk" FOREIGN KEY ("target_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spam_flags" ADD CONSTRAINT "spam_flags_reporter_profile_id_profiles_id_fk" FOREIGN KEY ("reporter_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spam_flags" ADD CONSTRAINT "spam_flags_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spam_flags" ADD CONSTRAINT "spam_flags_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_participant_id_event_participants_id_fk" FOREIGN KEY ("assignee_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_members_user_id_idx" ON "profile_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profile_members_profile_id_idx" ON "profile_members" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "event_participants_event_id_idx" ON "event_participants" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_participants_profile_id_idx" ON "event_participants" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "deal_parties_deal_id_idx" ON "deal_parties" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "deal_parties_participant_id_idx" ON "deal_parties" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "budget_lines_budget_id_idx" ON "budget_lines" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "settlement_transfers_event_id_idx" ON "settlement_transfers" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "settlements_event_id_idx" ON "settlements" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_messages_event_id_idx" ON "event_messages" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "schedule_items_event_id_idx" ON "schedule_items" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_profile_id_idx" ON "credit_ledger" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_requests_pending_dedup" ON "booking_requests" USING btree ("sender_user_id","target_profile_id","wanted_date") WHERE "booking_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");