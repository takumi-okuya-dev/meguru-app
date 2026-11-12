CREATE TABLE "app_access_grants" (
	"app" text NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_access_grants_pkey" PRIMARY KEY("app","user_id"),
	CONSTRAINT "app_access_grants_app_valid" CHECK ("app_access_grants"."app" ~ '^[a-z_]{1,30}$')
);
--> statement-breakpoint
CREATE TABLE "group_app_access_grants" (
	"app" text NOT NULL,
	"group_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_app_access_grants_pkey" PRIMARY KEY("app","group_id"),
	CONSTRAINT "group_app_access_grants_app_valid" CHECK ("group_app_access_grants"."app" ~ '^[a-z_]{1,30}$')
);
--> statement-breakpoint
ALTER TABLE "app_access_grants" ADD CONSTRAINT "app_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_access_grants" ADD CONSTRAINT "app_access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_app_access_grants" ADD CONSTRAINT "group_app_access_grants_group_id_test_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."test_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_app_access_grants" ADD CONSTRAINT "group_app_access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;