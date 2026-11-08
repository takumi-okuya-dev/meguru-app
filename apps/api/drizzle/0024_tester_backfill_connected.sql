-- 申し込みのないまま「Threadsで許可する」でつながっているアカウント（024の前からのアカウントなど）を、
-- テスター招待の「接続済み」に足し、Metaのテスターの枠を使っている扱いにする（fix：運営者の一覧と枠の数に出す）。
-- トークンでつながっているアカウントは、Metaのテスターの枠を使わないので足さない。
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
