CREATE TYPE "public"."account_plan" AS ENUM('auto-only', 'auto-grower', 'multi-account', 'team');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('connected', 'needs_reconnect');--> statement-breakpoint
CREATE TYPE "public"."deletion_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."oauth_mode" AS ENUM('new', 'reconnect');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"threads_user_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"profile_picture_url" text,
	"plan" "account_plan" NOT NULL,
	"connection_status" "connection_status" DEFAULT 'connected' NOT NULL,
	"last_used_at" timestamp (6) with time zone,
	"connection_generation" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_threads_user_id_unique" UNIQUE("threads_user_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" "oauth_mode" NOT NULL,
	"target_account_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_target_required_for_reconnect" CHECK (("oauth_states"."mode" = 'reconnect') = ("oauth_states"."target_account_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "threads_connections" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"access_token_ciphertext" "bytea" NOT NULL,
	"access_token_iv" "bytea" NOT NULL,
	"key_version" smallint NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads_deletion_requests" (
	"confirmation_code" text PRIMARY KEY NOT NULL,
	"request_fingerprint" text NOT NULL,
	"threads_user_id" text,
	"threads_user_hmac" text,
	"status" "deletion_status" NOT NULL,
	"received_at" timestamp (6) with time zone NOT NULL,
	"last_attempted_at" timestamp (6) with time zone NOT NULL,
	"completed_at" timestamp (6) with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "threads_deletion_requests_request_fingerprint_unique" UNIQUE("request_fingerprint"),
	CONSTRAINT "threads_deletion_requests_plaintext_until_completed" CHECK (("threads_deletion_requests"."status" <> 'completed') = ("threads_deletion_requests"."threads_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "threads_revocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"threads_user_hmac" text NOT NULL,
	"issued_at" timestamp (6) with time zone NOT NULL,
	"received_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"last_account_id" uuid,
	"last_account_deleted_at" timestamp with time zone,
	"last_account_client_id" text,
	"last_account_open_seq" bigint,
	"last_account_open_received_at" timestamp (6) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads_connections" ADD CONSTRAINT "threads_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_last_account_id_accounts_id_fk" FOREIGN KEY ("last_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_account_unique" ON "memberships" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_owner_per_account" ON "memberships" USING btree ("account_id") WHERE "memberships"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "threads_deletion_requests_hmac_idx" ON "threads_deletion_requests" USING btree ("threads_user_hmac");--> statement-breakpoint
CREATE INDEX "threads_deletion_requests_retry_idx" ON "threads_deletion_requests" USING btree ("status","last_attempted_at");--> statement-breakpoint
CREATE INDEX "threads_revocations_hmac_issued_idx" ON "threads_revocations" USING btree ("threads_user_hmac","issued_at");