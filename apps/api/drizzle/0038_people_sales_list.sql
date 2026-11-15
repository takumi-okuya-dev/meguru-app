CREATE TABLE "people"."contact_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"contacted_on" date NOT NULL,
	"channel" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_contact_logs_channel" CHECK ("people"."contact_logs"."channel" IN ('line', 'venue', 'other', 'done')),
	CONSTRAINT "people_contact_logs_note_length" CHECK (char_length("people"."contact_logs"."note") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "people"."custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"label_key" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_custom_fields_label_length" CHECK (char_length("people"."custom_fields"."label") BETWEEN 1 AND 30)
);
--> statement-breakpoint
CREATE TABLE "people"."person_field_values" (
	"person_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "person_field_values_person_id_field_id_pk" PRIMARY KEY("person_id","field_id"),
	CONSTRAINT "people_person_field_values_length" CHECK (char_length("people"."person_field_values"."value") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "people"."person_links" (
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "person_links_person_id_kind_pk" PRIMARY KEY("person_id","kind"),
	CONSTRAINT "people_person_links_kind" CHECK ("people"."person_links"."kind" IN ('instagram', 'x', 'facebook')),
	CONSTRAINT "people_person_links_url" CHECK (char_length("people"."person_links"."url") BETWEEN 1 AND 500 AND "people"."person_links"."url" LIKE 'https://%')
);
--> statement-breakpoint
CREATE TABLE "people"."person_tags" (
	"person_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "person_tags_person_id_tag_id_pk" PRIMARY KEY("person_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "people"."tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_tags_name_length" CHECK (char_length("people"."tags"."name") BETWEEN 1 AND 30)
);
--> statement-breakpoint
ALTER TABLE "people"."owner_settings" ADD COLUMN "person_view" jsonb;--> statement-breakpoint
ALTER TABLE "people"."persons" ADD COLUMN "next_action_on" date;--> statement-breakpoint
ALTER TABLE "people"."persons" ADD COLUMN "next_action_note" text;--> statement-breakpoint
ALTER TABLE "people"."persons" ADD COLUMN "birthday_md" text;--> statement-breakpoint
ALTER TABLE "people"."persons" ADD COLUMN "likelihood" smallint;--> statement-breakpoint
ALTER TABLE "people"."contact_logs" ADD CONSTRAINT "contact_logs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."person_field_values" ADD CONSTRAINT "person_field_values_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."person_field_values" ADD CONSTRAINT "person_field_values_field_id_custom_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "people"."custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."person_links" ADD CONSTRAINT "person_links_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."person_tags" ADD CONSTRAINT "person_tags_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."person_tags" ADD CONSTRAINT "person_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "people"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_contact_logs_person_idx" ON "people"."contact_logs" USING btree ("person_id","contacted_on");--> statement-breakpoint
CREATE INDEX "people_contact_logs_user_idx" ON "people"."contact_logs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_custom_fields_user_label_idx" ON "people"."custom_fields" USING btree ("user_id","label_key");--> statement-breakpoint
CREATE INDEX "people_person_field_values_field_idx" ON "people"."person_field_values" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "people_person_tags_tag_idx" ON "people"."person_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_tags_user_name_idx" ON "people"."tags" USING btree ("user_id","name_key");--> statement-breakpoint
CREATE INDEX "people_persons_user_next_action_idx" ON "people"."persons" USING btree ("user_id","next_action_on");--> statement-breakpoint
ALTER TABLE "people"."persons" ADD CONSTRAINT "people_persons_next_action" CHECK (("people"."persons"."next_action_on" IS NULL AND "people"."persons"."next_action_note" IS NULL) OR ("people"."persons"."next_action_on" IS NOT NULL AND char_length("people"."persons"."next_action_note") BETWEEN 1 AND 200));--> statement-breakpoint
ALTER TABLE "people"."persons" ADD CONSTRAINT "people_persons_birthday_md" CHECK ("people"."persons"."birthday_md" IS NULL OR "people"."persons"."birthday_md" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');--> statement-breakpoint
ALTER TABLE "people"."persons" ADD CONSTRAINT "people_persons_likelihood" CHECK ("people"."persons"."likelihood" IS NULL OR "people"."persons"."likelihood" BETWEEN 1 AND 3);