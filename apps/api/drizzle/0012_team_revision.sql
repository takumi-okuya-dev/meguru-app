CREATE TYPE "public"."team_role" AS ENUM('admin', 'member', 'editor');--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'admin';--> statement-breakpoint
-- specs/011-team-revision research.md R2：008のチームのデータは移さずに消す（Clarifications 2026-10-13）。
-- アカウントのデータと操作の記録（activity_logs）は残す。列挙型の値の追加は別の文にしてある。
DELETE FROM "memberships" WHERE "role" IN ('partner', 'editor');--> statement-breakpoint
DELETE FROM "teams";--> statement-breakpoint
CREATE TABLE "team_accounts" (
	"team_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"added_by_user_id" uuid,
	"shared" boolean DEFAULT false NOT NULL,
	"added_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_accounts_team_id_account_id_pk" PRIMARY KEY("team_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" NOT NULL,
	"joined_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"joined_notice_dismissed_at" timestamp (6) with time zone,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "account_partner_invites" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_partners" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_editors" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "account_partner_invites" CASCADE;--> statement-breakpoint
DROP TABLE "account_partners" CASCADE;--> statement-breakpoint
DROP TABLE "team_editors" CASCADE;--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_partner_user_id_unique";--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_editor_invite_token_hash_unique";--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_editor_invite_complete";--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_name_length";--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_partner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "assigned_notice_dismissed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "admin_user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "invite_token_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "invite_token_ciphertext" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "invite_token_iv" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "invite_key_version" smallint NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "invite_rotated_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "team_accounts" ADD CONSTRAINT "team_accounts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_accounts" ADD CONSTRAINT "team_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_accounts" ADD CONSTRAINT "team_accounts_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_accounts_one_team_per_account" ON "team_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_one_admin" ON "team_members" USING btree ("team_id") WHERE "team_members"."role" = 'admin';--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teams_admin_idx" ON "teams" USING btree ("admin_user_id");--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "partner_user_id";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "editor_invite_token_hash";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "editor_invite_token_ciphertext";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "editor_invite_token_iv";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "editor_invite_key_version";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "editor_invite_rotated_at";--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_invite_token_hash_unique" UNIQUE("invite_token_hash");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_name_length" CHECK (char_length("teams"."name") BETWEEN 1 AND 50);