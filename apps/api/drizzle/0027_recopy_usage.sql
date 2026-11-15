-- 利用の数と上限を、今のデータから写し直す（specs/meguru/029-threads-pattern1 tasks.md T024、/speckit-analyze G1・U4）。
-- 029 の PR1（0026）で写したあと、PR2a のこのデプロイまでの間に作った・消したアカウントや、前の版の API が古い列だけに書いた上限の分の
-- ずれを消してから、料金の数を app_usage に切り替える。何度当てても同じ結果になる。
-- 利用の数：持ち主としてのアカウントの数。
-- 使っているか：持ち主のアカウントがあるか、チームを使える人が、持ち主もチームを使える担当のアカウントか、チームを持つか
-- （apps/threads/accounts/usage.ts の countThreadsUsage・/api/me と同じ決め方。チームのOFFは、人の設定と閉じていないグループの設定）
WITH "team_off" AS (
  SELECT fd."user_id" FROM "feature_disables" fd WHERE fd."app" = 'threads' AND fd."feature" = 'team'
  UNION
  SELECT tgm."user_id" FROM "test_group_members" tgm
    JOIN "test_groups" tg ON tg."id" = tgm."group_id" AND tg."closed_at" IS NULL
    JOIN "group_feature_disables" gfd ON gfd."group_id" = tgm."group_id" AND gfd."app" = 'threads' AND gfd."feature" = 'team'
)
INSERT INTO "app_usage" ("user_id", "app", "quantity", "in_use", "updated_at")
SELECT u."id", 'threads',
  (SELECT count(*)::int FROM "memberships" m WHERE m."user_id" = u."id" AND m."role" = 'owner'),
  EXISTS (SELECT 1 FROM "memberships" m WHERE m."user_id" = u."id" AND m."role" = 'owner')
    OR (
      NOT EXISTS (SELECT 1 FROM "team_off" t WHERE t."user_id" = u."id")
      AND (
        EXISTS (
          SELECT 1 FROM "memberships" m
            JOIN "memberships" o ON o."account_id" = m."account_id" AND o."role" = 'owner'
          WHERE m."user_id" = u."id" AND m."role" = 'editor'
            AND NOT EXISTS (SELECT 1 FROM "team_off" t WHERE t."user_id" = o."user_id")
        )
        OR EXISTS (SELECT 1 FROM "team_members" tm WHERE tm."user_id" = u."id")
      )
    ),
  now()
FROM "users" u
ON CONFLICT ("user_id", "app") DO UPDATE SET "quantity" = EXCLUDED."quantity", "in_use" = EXCLUDED."in_use", "updated_at" = EXCLUDED."updated_at";
--> statement-breakpoint
-- 上限：古い列の値で写し直す（古い列が null の人は、新しい表の行を消して既定の値に戻す）
DELETE FROM "user_app_limits" l
WHERE l."app" = 'threads'
  AND ((l."key" = 'accounts' AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = l."user_id" AND u."account_limit" IS NOT NULL))
    OR (l."key" = 'daily_posts' AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = l."user_id" AND u."daily_post_limit" IS NOT NULL)));
--> statement-breakpoint
INSERT INTO "user_app_limits" ("user_id", "app", "key", "value")
SELECT "id", 'threads', 'accounts', "account_limit" FROM "users" WHERE "account_limit" IS NOT NULL
UNION ALL
SELECT "id", 'threads', 'daily_posts', "daily_post_limit" FROM "users" WHERE "daily_post_limit" IS NOT NULL
ON CONFLICT ("user_id", "app", "key") DO UPDATE SET "value" = EXCLUDED."value";
--> statement-breakpoint
INSERT INTO "app_limit_defaults" ("app", "key", "value")
SELECT 'threads', 'accounts', "default_account_limit" FROM "operator_settings" WHERE "id" = 1
UNION ALL
SELECT 'threads', 'daily_posts', "default_daily_post_limit" FROM "operator_settings" WHERE "id" = 1
ON CONFLICT ("app", "key") DO UPDATE SET "value" = EXCLUDED."value";
