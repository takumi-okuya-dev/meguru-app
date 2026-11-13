CREATE SCHEMA "people";
--> statement-breakpoint
CREATE TABLE "people"."choice_mappings" (
	"user_id" uuid NOT NULL,
	"choice_key" text NOT NULL,
	"choice_text" text NOT NULL,
	"purpose" text NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "choice_mappings_user_id_choice_key_pk" PRIMARY KEY("user_id","choice_key"),
	CONSTRAINT "people_choice_mappings_key_length" CHECK (char_length("people"."choice_mappings"."choice_key") BETWEEN 1 AND 500),
	CONSTRAINT "people_choice_mappings_text_length" CHECK (char_length("people"."choice_mappings"."choice_text") BETWEEN 1 AND 500),
	CONSTRAINT "people_choice_mappings_purpose" CHECK ("people"."choice_mappings"."purpose" IN ('invite', 'work', 'decline', 'ignore'))
);
--> statement-breakpoint
CREATE TABLE "people"."column_mappings" (
	"user_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"question_text" text NOT NULL,
	"field" text NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "column_mappings_user_id_question_key_pk" PRIMARY KEY("user_id","question_key"),
	CONSTRAINT "people_column_mappings_key_length" CHECK (char_length("people"."column_mappings"."question_key") BETWEEN 1 AND 500),
	CONSTRAINT "people_column_mappings_text_length" CHECK (char_length("people"."column_mappings"."question_text") BETWEEN 1 AND 500),
	CONSTRAINT "people_column_mappings_field" CHECK ("people"."column_mappings"."field" IN ('line_name', 'real_name', 'submitted_at', 'next_attendance', 'bring_friends', 'wanted_connections', 'career_interests', 'contact_consent', 'other'))
);
--> statement-breakpoint
CREATE TABLE "people"."consent_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invite" boolean NOT NULL,
	"work" boolean NOT NULL,
	"source" text NOT NULL,
	"response_id" uuid,
	"basis_on" date NOT NULL,
	"changed_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_consent_changes_source" CHECK ("people"."consent_changes"."source" IN ('response', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "people"."erased_attendances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"import_id" uuid,
	"erased_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people"."erased_responses" (
	"event_id" uuid NOT NULL,
	"dedupe_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"erased_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erased_responses_event_id_dedupe_hash_pk" PRIMARY KEY("event_id","dedupe_hash")
);
--> statement-breakpoint
CREATE TABLE "people"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"held_on" date NOT NULL,
	"is_own" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_events_name_length" CHECK (char_length("people"."events"."name") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "people"."imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"row_count" integer NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"created_people_count" integer DEFAULT 0 NOT NULL,
	"linked_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_imports_row_count_range" CHECK ("people"."imports"."row_count" BETWEEN 0 AND 500)
);
--> statement-breakpoint
CREATE TABLE "people"."manual_attendances" (
	"person_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_attendances_person_id_event_id_pk" PRIMARY KEY("person_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "people"."persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"real_name" text,
	"real_name_key" text,
	"line_name" text,
	"line_name_key" text,
	"entered_line_name" text,
	"entered_line_name_key" text,
	"memo_appearance" text,
	"memo_talk" text,
	"consent_invite" boolean DEFAULT false NOT NULL,
	"consent_work" boolean DEFAULT false NOT NULL,
	"consent_source" text DEFAULT 'none' NOT NULL,
	"consent_basis_on" date,
	"consent_updated_at" timestamp (6) with time zone,
	"created_by_import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_persons_real_name_length" CHECK ("people"."persons"."real_name" IS NULL OR char_length("people"."persons"."real_name") BETWEEN 1 AND 100),
	CONSTRAINT "people_persons_line_name_length" CHECK ("people"."persons"."line_name" IS NULL OR char_length("people"."persons"."line_name") BETWEEN 1 AND 100),
	CONSTRAINT "people_persons_entered_line_name_length" CHECK ("people"."persons"."entered_line_name" IS NULL OR char_length("people"."persons"."entered_line_name") BETWEEN 1 AND 100),
	CONSTRAINT "people_persons_memo_appearance_length" CHECK ("people"."persons"."memo_appearance" IS NULL OR char_length("people"."persons"."memo_appearance") <= 300),
	CONSTRAINT "people_persons_memo_talk_length" CHECK ("people"."persons"."memo_talk" IS NULL OR char_length("people"."persons"."memo_talk") <= 1000),
	CONSTRAINT "people_persons_consent_source" CHECK ("people"."persons"."consent_source" IN ('none', 'response', 'manual')),
	CONSTRAINT "people_persons_has_name" CHECK ("people"."persons"."real_name" IS NOT NULL OR "people"."persons"."line_name" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "people"."received_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"received_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people"."responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"dedupe_hash" text NOT NULL,
	"submitted_at" timestamp (6) with time zone,
	"line_name" text NOT NULL,
	"line_name_key" text NOT NULL,
	"real_name" text,
	"real_name_key" text,
	"next_attendance" text,
	"bring_friends" text,
	"wanted_connections" text[] DEFAULT '{}'::text[] NOT NULL,
	"career_interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"consent_choices" text[] DEFAULT '{}'::text[] NOT NULL,
	"consent_invite" boolean DEFAULT false NOT NULL,
	"consent_work" boolean DEFAULT false NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_responses_dedupe_hash" CHECK ("people"."responses"."dedupe_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "people_responses_line_name_length" CHECK (char_length("people"."responses"."line_name") BETWEEN 1 AND 100),
	CONSTRAINT "people_responses_real_name_length" CHECK ("people"."responses"."real_name" IS NULL OR char_length("people"."responses"."real_name") BETWEEN 1 AND 100),
	CONSTRAINT "people_responses_next_attendance_length" CHECK ("people"."responses"."next_attendance" IS NULL OR char_length("people"."responses"."next_attendance") <= 500),
	CONSTRAINT "people_responses_bring_friends_length" CHECK ("people"."responses"."bring_friends" IS NULL OR char_length("people"."responses"."bring_friends") <= 500),
	CONSTRAINT "people_responses_choices_count" CHECK (cardinality("people"."responses"."wanted_connections") <= 30 AND cardinality("people"."responses"."career_interests") <= 30 AND cardinality("people"."responses"."consent_choices") <= 30)
);
--> statement-breakpoint
ALTER TABLE "people"."consent_changes" ADD CONSTRAINT "consent_changes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."consent_changes" ADD CONSTRAINT "consent_changes_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "people"."responses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."erased_attendances" ADD CONSTRAINT "erased_attendances_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "people"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."erased_attendances" ADD CONSTRAINT "erased_attendances_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "people"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."erased_responses" ADD CONSTRAINT "erased_responses_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "people"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."imports" ADD CONSTRAINT "imports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "people"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."manual_attendances" ADD CONSTRAINT "manual_attendances_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."manual_attendances" ADD CONSTRAINT "manual_attendances_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "people"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."persons" ADD CONSTRAINT "persons_created_by_import_id_imports_id_fk" FOREIGN KEY ("created_by_import_id") REFERENCES "people"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."responses" ADD CONSTRAINT "responses_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "people"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."responses" ADD CONSTRAINT "responses_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "people"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."responses" ADD CONSTRAINT "responses_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_consent_changes_person_idx" ON "people"."consent_changes" USING btree ("person_id","changed_at");--> statement-breakpoint
CREATE INDEX "people_consent_changes_user_idx" ON "people"."consent_changes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "people_erased_attendances_event_idx" ON "people"."erased_attendances" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "people_erased_attendances_user_idx" ON "people"."erased_attendances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "people_erased_responses_user_idx" ON "people"."erased_responses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "people_events_user_held_idx" ON "people"."events" USING btree ("user_id","held_on");--> statement-breakpoint
CREATE INDEX "people_imports_user_idx" ON "people"."imports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "people_imports_event_idx" ON "people"."imports" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "people_manual_attendances_event_idx" ON "people"."manual_attendances" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "people_manual_attendances_user_idx" ON "people"."manual_attendances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "people_persons_user_idx" ON "people"."persons" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "people_persons_user_real_name_idx" ON "people"."persons" USING btree ("user_id","real_name_key");--> statement-breakpoint
CREATE INDEX "people_persons_user_line_name_idx" ON "people"."persons" USING btree ("user_id","line_name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "people_responses_event_dedupe_idx" ON "people"."responses" USING btree ("event_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "people_responses_user_line_name_idx" ON "people"."responses" USING btree ("user_id","line_name_key");--> statement-breakpoint
CREATE INDEX "people_responses_person_idx" ON "people"."responses" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "people_responses_import_idx" ON "people"."responses" USING btree ("import_id");