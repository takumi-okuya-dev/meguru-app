-- Threadsが受け取った共通の出来事の番号と、退会の出来事を利用者で探す索引（specs/meguru/029-threads-pattern1 tasks.md T032・T028）。
-- 表と索引を足すだけ（前の版でも壊れない）。

CREATE TABLE "threads_received_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"received_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_events_withdrawn_user_idx" ON "platform_events" USING btree (("payload"->>'userId')) WHERE "platform_events"."type" = 'user.withdrawn';