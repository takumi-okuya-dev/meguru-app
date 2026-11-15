-- 集金管理の名簿なしで受付する（specs/collect/004-rosterless-check-in data-model.md 2、research.md R1〜R3・R7、tasks.md T005・T006）。
-- イベントの受付のしかた・名簿の人の区分が未定・名簿なしで入った時刻・名簿なしの入口の送り直しの印の列を足す。
-- 前からあるイベントは check_in_mode の既定で roster（名簿あり）になる。今ある行のほかの値は書き換えない。
ALTER TABLE "collect"."events" ADD COLUMN "check_in_mode" text DEFAULT 'roster' NOT NULL;--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD COLUMN "tier_undecided" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD COLUMN "self_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collect"."self_check_in_requests" ADD COLUMN "client_request_id" uuid;--> statement-breakpoint
ALTER TABLE "collect"."self_check_in_requests" ADD CONSTRAINT "self_check_in_requests_client_request_id_unique" UNIQUE("client_request_id");--> statement-breakpoint
ALTER TABLE "collect"."events" ADD CONSTRAINT "events_check_in_mode_valid" CHECK ("collect"."events"."check_in_mode" IN ('roster', 'rosterless'));--> statement-breakpoint
ALTER TABLE "collect"."roster_people" ADD CONSTRAINT "roster_people_tier_undecided_self" CHECK (NOT "collect"."roster_people"."tier_undecided" OR "collect"."roster_people"."self_entered_at" IS NOT NULL);