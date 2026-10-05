ALTER TABLE "ng_words" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "ng_words_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "last_review_request_id" uuid;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_reject_reasons_valid" CHECK ("post_drafts"."reject_reasons" IS NULL OR (cardinality("post_drafts"."reject_reasons") >= 1
        AND array_position("post_drafts"."reject_reasons", NULL) IS NULL
        AND "post_drafts"."reject_reasons" <@ ARRAY['similar', 'tone', 'thin', 'inaccurate', 'too_promotional', 'policy']::text[]));