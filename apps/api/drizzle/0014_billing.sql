CREATE TABLE "subscriptions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"status" text,
	"current_period_end" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"quantity" integer,
	"quantity_sync_needed" boolean DEFAULT false NOT NULL,
	"pending_checkout_session_id" text,
	"stripe_synced_at" timestamp (6) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "subscriptions_status_valid" CHECK ("subscriptions"."status" IS NULL OR "subscriptions"."status" IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused'))
);
--> statement-breakpoint
CREATE TABLE "withdrawn_users" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"withdrawn_at" timestamp with time zone NOT NULL,
	"clerk_deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "publish_attempts" DROP CONSTRAINT "publish_attempts_skip_reason_valid";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "billing_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "withdrawal_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "plan";--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_skip_reason_valid" CHECK ("publish_attempts"."skip_reason" IS NULL OR "publish_attempts"."skip_reason" IN ('no_drafts', 'needs_reconnect', 'rate_limited', 'daily_limit', 'auto_post_off', 'billing_inactive'));--> statement-breakpoint
DROP TYPE "public"."account_plan";
