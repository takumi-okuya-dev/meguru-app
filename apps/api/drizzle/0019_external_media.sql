CREATE TABLE "media_defaults" (
	"account_id" uuid NOT NULL,
	"media" text NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_defaults_pkey" PRIMARY KEY("account_id","media"),
	CONSTRAINT "media_defaults_media_valid" CHECK ("media_defaults"."media" IN ('kokuchpro', 'peatix', 'tsunagate', 'jmty', 'youtrust'))
);
--> statement-breakpoint
CREATE TABLE "promotion_listings" (
	"promotion_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"media" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"posted_url" text,
	"fields" jsonb,
	"fixes" jsonb,
	"image_style" text DEFAULT 'illustration' NOT NULL,
	"source_version" integer,
	"generated_at" timestamp (6) with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_listings_pkey" PRIMARY KEY("promotion_id","media"),
	CONSTRAINT "promotion_listings_media_valid" CHECK ("promotion_listings"."media" IN ('kokuchpro', 'peatix', 'tsunagate', 'jmty', 'youtrust')),
	CONSTRAINT "promotion_listings_status_valid" CHECK ("promotion_listings"."status" IN ('not_started', 'drafting', 'posted', 'stopped')),
	CONSTRAINT "promotion_listings_image_style_valid" CHECK ("promotion_listings"."image_style" IN ('illustration', 'photo')),
	CONSTRAINT "promotion_listings_posted_url_valid" CHECK ("promotion_listings"."posted_url" IS NULL OR ("promotion_listings"."posted_url" ~ '^https?://' AND char_length("promotion_listings"."posted_url") <= 2000))
);
--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "event" jsonb;--> statement-breakpoint
ALTER TABLE "media_defaults" ADD CONSTRAINT "media_defaults_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_defaults" ADD CONSTRAINT "media_defaults_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_listings" ADD CONSTRAINT "promotion_listings_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_listings" ADD CONSTRAINT "promotion_listings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_listings" ADD CONSTRAINT "promotion_listings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promotion_listings_account_idx" ON "promotion_listings" USING btree ("account_id");