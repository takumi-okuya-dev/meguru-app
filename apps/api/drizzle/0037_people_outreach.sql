CREATE TABLE "people"."outreaches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"event_id" uuid,
	"target_name" text,
	"target_key" text,
	"stage" text NOT NULL,
	"asked_at" timestamp (6) with time zone NOT NULL,
	"link_sent_at" timestamp (6) with time zone,
	"attended_at" timestamp (6) with time zone,
	"approved_at" timestamp (6) with time zone,
	"connected_at" timestamp (6) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_outreaches_purpose" CHECK ("people"."outreaches"."purpose" IN ('invite', 'work')),
	CONSTRAINT "people_outreaches_target" CHECK (("people"."outreaches"."purpose" = 'invite' AND "people"."outreaches"."event_id" IS NOT NULL AND "people"."outreaches"."target_name" IS NULL AND "people"."outreaches"."target_key" IS NULL)
        OR ("people"."outreaches"."purpose" = 'work' AND "people"."outreaches"."event_id" IS NULL AND "people"."outreaches"."target_name" IS NOT NULL AND char_length("people"."outreaches"."target_name") BETWEEN 1 AND 100 AND "people"."outreaches"."target_key" IS NOT NULL)),
	CONSTRAINT "people_outreaches_stage" CHECK (("people"."outreaches"."purpose" = 'invite' AND "people"."outreaches"."stage" IN ('asked', 'link_sent', 'attended')) OR ("people"."outreaches"."purpose" = 'work' AND "people"."outreaches"."stage" IN ('asked', 'approved', 'connected'))),
	CONSTRAINT "people_outreaches_connected_after_approved" CHECK ("people"."outreaches"."stage" <> 'connected' OR "people"."outreaches"."approved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "people"."owner_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"invite_template" text,
	"repeater_goal" integer,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_owner_settings_invite_template" CHECK ("people"."owner_settings"."invite_template" IS NULL OR char_length("people"."owner_settings"."invite_template") BETWEEN 1 AND 500),
	CONSTRAINT "people_owner_settings_repeater_goal" CHECK ("people"."owner_settings"."repeater_goal" IS NULL OR "people"."owner_settings"."repeater_goal" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "people"."outreaches" ADD CONSTRAINT "outreaches_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."outreaches" ADD CONSTRAINT "outreaches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "people"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_outreaches_invite_unique" ON "people"."outreaches" USING btree ("person_id","event_id") WHERE "people"."outreaches"."purpose" = 'invite';--> statement-breakpoint
CREATE UNIQUE INDEX "people_outreaches_work_unique" ON "people"."outreaches" USING btree ("person_id","target_key") WHERE "people"."outreaches"."purpose" = 'work';--> statement-breakpoint
CREATE INDEX "people_outreaches_user_idx" ON "people"."outreaches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "people_outreaches_person_idx" ON "people"."outreaches" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "people_outreaches_event_idx" ON "people"."outreaches" USING btree ("event_id");