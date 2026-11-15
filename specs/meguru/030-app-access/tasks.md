# Tasks：運営者が開いた人だけが使えるアプリ（030）

**Input**: [spec.md](./spec.md)・[plan.md](./plan.md)。1つのPR（マイグレーションがあるので CI を流す）。

## Phase 1：仕組み（API）

- [X] T001 [US1] `platform/registry/registry.ts`に`registerAppAccess`・`appAccessMode`・`grantedApps`を足し、`GET /api/operator/app-registry`の各アプリに`access`を足す。単体テスト。
- [X] T002 [US1] `platform/schema.ts`に`app_access_grants`・`group_app_access_grants`を足し、`pnpm --filter api db:generate`でマイグレーション 0032 を作る（中身が2つの表だけであることを読んで確かめる）。`operator_events`の`action`に CHECK があれば`app_access`を足す。マイグレーションのテスト。
- [X] T003 [US1] `platform/access/app-access.ts`（`accessibleApps`・`canUseApp`・`requireAppAccess`）と、`APP_NOT_AVAILABLE`のエラーのコード（`@meguru/shared`）。結合テスト`test/integration/app-access.test.ts`を先に書く（人ごと・グループ・閉じたグループ・運営者・許可なし）。
- [X] T004 [US1] 入口の関数`loadAppEntitlement(s)`が、`granted`のアプリで使えない人に`access: "none"`を返す。テスト（`open`のアプリ＝Threadsの結果は変わらない）。
- [X] T005 [US1] 運営者のAPI（`PUT /api/operator/app-access/users/:userId`・`/groups/:groupId`）と、`GET /api/operator/users`・`GET /api/operator/test-groups/:groupId`の`appAccess`。運営の記録。`test/repo/routes.snapshot.txt`を更新する。
- [X] T006 [US2] `/api/me`の`available`・`last`・`landing`を、使えるアプリで絞る。`PUT /api/me/last-app`は使えないアプリを400。`resolveMeApps`の単体テストと、今の結合テストが通ること。

## Phase 2：画面（Web）

- [X] T007 [US1] `useOperatorRegistry`の型に`access`を足し、機能のON/OFFの人の画面と、テストのグループの詳しい画面に「アプリの利用」の欄を出す（`granted`のアプリがあるときだけ）。Web のテスト。

## Phase 3：文書

- [X] T008 `docs/module-map.md`（共通の表に2つ足す・入口の関数）と`docs/product-structure.md`（アプリの利用の決まり）を直す。collect 001 の plan.md・research.md R3・tasks.md の PR0 に「030 で入れた（機能のON/OFFではなく、アプリの利用の許可）」と書く。
