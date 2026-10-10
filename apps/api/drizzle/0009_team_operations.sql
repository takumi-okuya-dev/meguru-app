CREATE TYPE "public"."activity_kind" AS ENUM('review', 'draft', 'content', 'settings', 'member');--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'partner';--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'editor';--> statement-breakpoint
CREATE TABLE "account_partner_invites" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" "bytea" NOT NULL,
	"token_iv" "bytea" NOT NULL,
	"key_version" smallint NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_partner_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "account_partners" (
	"account_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"delegate_review" boolean DEFAULT false NOT NULL,
	"delegate_settings" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"joined_notice_dismissed_at" timestamp (6) with time zone,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_partners_account_id_team_id_pk" PRIMARY KEY("account_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"actor_role" "membership_role" NOT NULL,
	"kind" "activity_kind" NOT NULL,
	"action" text NOT NULL,
	"item_count" integer DEFAULT 1 NOT NULL,
	"summary" text,
	"details" jsonb,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_editors" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_editors_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_user_id" uuid NOT NULL,
	"name" text,
	"editor_invite_token_hash" text,
	"editor_invite_token_ciphertext" "bytea",
	"editor_invite_token_iv" "bytea",
	"editor_invite_key_version" smallint,
	"editor_invite_rotated_at" timestamp (6) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_partner_user_id_unique" UNIQUE("partner_user_id"),
	CONSTRAINT "teams_editor_invite_token_hash_unique" UNIQUE("editor_invite_token_hash"),
	CONSTRAINT "teams_name_length" CHECK (char_length("teams"."name") <= 50),
	CONSTRAINT "teams_editor_invite_complete" CHECK (("teams"."editor_invite_token_hash" IS NULL) = ("teams"."editor_invite_token_ciphertext" IS NULL) AND ("teams"."editor_invite_token_hash" IS NULL) = ("teams"."editor_invite_token_iv" IS NULL) AND ("teams"."editor_invite_token_hash" IS NULL) = ("teams"."editor_invite_key_version" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "core_rules_updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "edited_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD COLUMN "feedback_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD COLUMN "feedback_updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "posting_schedules" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "research_keywords" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "strategy_designs" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "account_partner_invites" ADD CONSTRAINT "account_partner_invites_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_partner_invites" ADD CONSTRAINT "account_partner_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_partners" ADD CONSTRAINT "account_partners_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_partners" ADD CONSTRAINT "account_partners_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_editors" ADD CONSTRAINT "team_editors_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_editors" ADD CONSTRAINT "team_editors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_partner_user_id_users_id_fk" FOREIGN KEY ("partner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_partners_one_per_account" ON "account_partners" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_partners_team_idx" ON "account_partners" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "activity_logs_account_created_idx" ON "activity_logs" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_logs_account_actor_idx" ON "activity_logs" USING btree ("account_id","actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_logs_created_idx" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "team_editors_user_idx" ON "team_editors" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_core_rules_updated_by_user_id_users_id_fk" FOREIGN KEY ("core_rules_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_edited_by_user_id_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_feedback_updated_by_user_id_users_id_fk" FOREIGN KEY ("feedback_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_schedules" ADD CONSTRAINT "posting_schedules_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD CONSTRAINT "reference_posts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_keywords" ADD CONSTRAINT "research_keywords_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_designs" ADD CONSTRAINT "strategy_designs_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_team_role_idx" ON "memberships" USING btree ("team_id","role");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_matches_role" CHECK (("memberships"."role" = 'owner') = ("memberships"."team_id" IS NULL));