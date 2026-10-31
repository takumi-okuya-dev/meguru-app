CREATE TABLE "test_group_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"subject_name" text,
	"details" jsonb,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_group_events_action_valid" CHECK ("test_group_events"."action" IN ('created', 'renamed', 'capacity_changed', 'invite_rotated', 'closed', 'member_joined', 'member_removed'))
);
--> statement-breakpoint
CREATE TABLE "test_group_members" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"joined_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"granted_billing_exempt" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"invite_token_hash" text NOT NULL,
	"invite_token_ciphertext" "bytea" NOT NULL,
	"invite_token_iv" "bytea" NOT NULL,
	"invite_key_version" smallint NOT NULL,
	"invite_rotated_at" timestamp (6) with time zone,
	"closed_at" timestamp (6) with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_groups_invite_token_hash_unique" UNIQUE("invite_token_hash"),
	CONSTRAINT "test_groups_name_length" CHECK (char_length("test_groups"."name") BETWEEN 1 AND 50),
	CONSTRAINT "test_groups_capacity_range" CHECK ("test_groups"."capacity" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signed_up_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "test_group_events" ADD CONSTRAINT "test_group_events_group_id_test_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."test_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_group_events" ADD CONSTRAINT "test_group_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_group_members" ADD CONSTRAINT "test_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_group_members" ADD CONSTRAINT "test_group_members_group_id_test_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."test_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_groups" ADD CONSTRAINT "test_groups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_group_events_group_created_idx" ON "test_group_events" USING btree ("group_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "test_group_members_group_idx" ON "test_group_members" USING btree ("group_id");--> statement-breakpoint
-- この機能の前からいる利用者は、グループに入っていなくてもテスト版に入れる（specs/016 FR-007、research.md R2）
UPDATE "users" SET "signed_up_open" = true;