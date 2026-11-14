CREATE TABLE "mention_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"username" text NOT NULL,
	"label" text NOT NULL,
	"always" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mention_people_username_valid" CHECK ("mention_people"."username" ~ '^[a-z0-9._]{1,30}$'),
	CONSTRAINT "mention_people_label_length" CHECK (char_length("mention_people"."label") BETWEEN 1 AND 30)
);
--> statement-breakpoint
CREATE TABLE "mention_settings" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"delay_minutes" integer DEFAULT 30 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mention_settings_message_length" CHECK (char_length("mention_settings"."message") <= 100),
	CONSTRAINT "mention_settings_delay_valid" CHECK ("mention_settings"."delay_minutes" IN (10, 30, 60, 180, 360, 720, 1440))
);
--> statement-breakpoint
CREATE TABLE "post_mentions" (
	"draft_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"usernames" text[] NOT NULL,
	"text" text NOT NULL,
	"delay_minutes" integer,
	"send_after" timestamp (6) with time zone,
	"state" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"container_id" text,
	"publish_requested_at" timestamp (6) with time zone,
	"reply_media_id" text,
	"sent_at" timestamp (6) with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (6) with time zone,
	"lease_token" uuid,
	"lease_until" timestamp (6) with time zone,
	"created_by_user_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_mentions_state_valid" CHECK ("post_mentions"."state" IN ('pending', 'sent', 'canceled', 'failed')),
	CONSTRAINT "post_mentions_failure_reason_valid" CHECK ("post_mentions"."failure_reason" IS NULL OR "post_mentions"."failure_reason" IN ('not_found', 'post_failed', 'no_permission', 'expired', 'ng_word', 'limit', 'error')),
	CONSTRAINT "post_mentions_failed_has_reason" CHECK (("post_mentions"."state" = 'failed') = ("post_mentions"."failure_reason" IS NOT NULL)),
	CONSTRAINT "post_mentions_sent_has_time" CHECK (("post_mentions"."state" = 'sent') = ("post_mentions"."sent_at" IS NOT NULL)),
	CONSTRAINT "post_mentions_when" CHECK ("post_mentions"."delay_minutes" IS NOT NULL OR "post_mentions"."send_after" IS NOT NULL),
	CONSTRAINT "post_mentions_usernames_count" CHECK (cardinality("post_mentions"."usernames") BETWEEN 1 AND 5),
	CONSTRAINT "post_mentions_text_length" CHECK (char_length("post_mentions"."text") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "replies_denied_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "mention_people" ADD CONSTRAINT "mention_people_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_settings" ADD CONSTRAINT "mention_settings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_settings" ADD CONSTRAINT "mention_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_mentions" ADD CONSTRAINT "post_mentions_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_mentions" ADD CONSTRAINT "post_mentions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_mentions" ADD CONSTRAINT "post_mentions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mention_people_account_username_unique" ON "mention_people" USING btree ("account_id","username");--> statement-breakpoint
CREATE INDEX "post_mentions_due_idx" ON "post_mentions" USING btree ("account_id","state") WHERE "post_mentions"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "post_mentions_sent_idx" ON "post_mentions" USING btree ("account_id","sent_at");