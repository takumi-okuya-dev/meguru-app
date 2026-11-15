CREATE TABLE "feature_disables" (
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"disabled_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"disabled_by_user_id" uuid,
	CONSTRAINT "feature_disables_pkey" PRIMARY KEY("user_id","feature"),
	CONSTRAINT "feature_disables_feature_valid" CHECK ("feature_disables"."feature" IN ('autopost', 'strategy', 'team'))
);
--> statement-breakpoint
CREATE TABLE "feature_setting_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_user_id" uuid,
	"subject_group_id" uuid,
	"feature" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"subject_name" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_setting_events_feature_valid" CHECK ("feature_setting_events"."feature" IN ('autopost', 'strategy', 'team')),
	CONSTRAINT "feature_setting_events_action_valid" CHECK ("feature_setting_events"."action" IN ('disabled', 'enabled')),
	CONSTRAINT "feature_setting_events_one_subject" CHECK (("feature_setting_events"."subject_user_id" IS NULL) <> ("feature_setting_events"."subject_group_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "group_feature_disables" (
	"group_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"disabled_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"disabled_by_user_id" uuid,
	CONSTRAINT "group_feature_disables_pkey" PRIMARY KEY("group_id","feature"),
	CONSTRAINT "group_feature_disables_feature_valid" CHECK ("group_feature_disables"."feature" IN ('autopost', 'strategy', 'team'))
);
--> statement-breakpoint
ALTER TABLE "feature_disables" ADD CONSTRAINT "feature_disables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_disables" ADD CONSTRAINT "feature_disables_disabled_by_user_id_users_id_fk" FOREIGN KEY ("disabled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_setting_events" ADD CONSTRAINT "feature_setting_events_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_setting_events" ADD CONSTRAINT "feature_setting_events_subject_group_id_test_groups_id_fk" FOREIGN KEY ("subject_group_id") REFERENCES "public"."test_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_setting_events" ADD CONSTRAINT "feature_setting_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_feature_disables" ADD CONSTRAINT "group_feature_disables_group_id_test_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."test_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_feature_disables" ADD CONSTRAINT "group_feature_disables_disabled_by_user_id_users_id_fk" FOREIGN KEY ("disabled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_setting_events_created_idx" ON "feature_setting_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feature_setting_events_subject_created_idx" ON "feature_setting_events" USING btree ("subject_user_id","created_at" DESC NULLS LAST);