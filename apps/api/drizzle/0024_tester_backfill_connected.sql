-- 申し込みのないまま「Threadsで許可する」でつながっているアカウント（024の前からのアカウントなど）を、
-- テスター招待の「接続済み」に足し、Metaのテスターの枠を使っている扱いにする（fix：運営者の一覧と枠の数に出す）。
-- トークンでつながっているアカウントは、Metaのテスターの枠を使わないので足さない。
-- 1. 同じThreadsのユーザー名で、枠を使ったまま取り下げになった記録があれば、それを接続済みに戻す（枠を二重に数えない）
UPDATE "tester_applications" t
SET "status" = 'connected', "removal_reason" = NULL, "decline_reason" = NULL, "user_id" = p."user_id", "account_id" = p."account_id",
    "connected_username" = p."uname", "connected_threads_user_id" = NULL, "mismatch_notice_dismissed_at" = NULL,
    "status_changed_at" = now(), "updated_at" = now()
FROM (
  SELECT DISTINCT ON (a."id") a."id" AS "account_id", m."user_id", lower(a."username") AS "uname", h."id" AS "application_id"
  FROM "accounts" a
  JOIN "memberships" m ON m."account_id" = a."id" AND m."role" = 'owner'
  JOIN "tester_applications" h ON h."holds_slot" AND h."status" = 'withdrawn' AND h."threads_username" = lower(a."username")
  WHERE a."connection_method" = 'app'
    AND a."connection_status" <> 'not_connected'
    AND NOT EXISTS (
      SELECT 1 FROM "tester_applications" l
      WHERE l."account_id" = a."id" AND l."status" IN ('pending', 'invited', 'connected')
    )
  ORDER BY a."id", (h."account_id" = a."id") DESC NULLS LAST, h."status_changed_at" DESC
) p
WHERE t."id" = p."application_id";
--> statement-breakpoint
-- 2. 残りは、接続済みの記録を新しく足す
INSERT INTO "tester_applications" ("user_id", "account_id", "threads_username", "status", "holds_slot", "connected_username")
SELECT m."user_id", a."id", lower(a."username"), 'connected', true, lower(a."username")
FROM "accounts" a
JOIN "memberships" m ON m."account_id" = a."id" AND m."role" = 'owner'
WHERE a."connection_method" = 'app'
  AND a."connection_status" <> 'not_connected'
  AND lower(a."username") ~ '^[a-z0-9._]{1,30}$'
  AND NOT EXISTS (
    SELECT 1 FROM "tester_applications" t
    WHERE t."account_id" = a."id" AND t."status" IN ('pending', 'invited', 'connected')
  );
