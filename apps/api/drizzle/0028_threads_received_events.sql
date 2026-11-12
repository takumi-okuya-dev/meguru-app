-- Threadsが受け取った共通の出来事の番号（specs/meguru/029-threads-pattern1 tasks.md T032）。表を足すだけ（前の版でも壊れない）。

CREATE TABLE "threads_received_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"received_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
