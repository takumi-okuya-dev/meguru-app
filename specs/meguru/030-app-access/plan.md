# Implementation Plan：運営者が開いた人だけが使えるアプリ（030）

**Branch**: `feature/meguru-030-app-access` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

## Summary

共通（platform）に「アプリの利用の許可」を足す。アプリは登録のときに`open`（だれでも）か`granted`（運営者が開いた人だけ）を決める。`granted`のアプリは、運営者・人ごとの許可・閉じていないテストのグループの許可のどれかがある人だけが使える。`/api/me`の`available`・入口の関数の`access`・アプリの道筋の関所が、この判定を使う。運営の画面（機能のON/OFF・テストのグループ）に、`granted`のアプリがあるときだけ開く・閉じるを出す。Threadsは`open`のままで、何も変わらない。

## Technical Context

今のめぐるのまま（TypeScript・Hono on Cloudflare Workers・Drizzle・Neon Postgres・React + Vite・TanStack Query・Vitest・Playwright）。新しい依存はない。

## Constitution Check

- 原則IV（モジュールの境界）：許可の表と判定は共通が持つ。アプリは入口の関数（`loadAppEntitlement`の`access`・`requireAppAccess`）だけを使い、許可の表を読まない。共通のコードにアプリの名前を書かない（登録の一覧で扱う）。
- 原則V（権限の判定を1か所に）：許可の判定は`platform/access/app-access.ts`だけに置く。`/api/me`・入口の関数・関所はここを使う。
- マイグレーション（release-runbook.md 3）：表を2つ足すだけ（前の版のアプリは読まないので壊れない）。CI を流す。

## 設計

### 登録（`platform/registry/registry.ts`）

- `registerAppAccess(app: string, mode: "open" | "granted")`。登録しないアプリは`open`。`appAccessMode(app)`・`grantedApps()`（登録の順）。`resetRegistry`系のテスト用の関数があれば、そこでも消す。
- `GET /api/operator/app-registry`の各アプリに`access: "open" | "granted"`を足す（登録していないアプリは出ないので、機能・上限だけを登録したアプリは`open`）。`granted`だけを登録したアプリも一覧に出す。

### 表（`platform/schema.ts`・マイグレーション 0032）

- `app_access_grants`：`app text`・`user_id uuid`（`users`への外部キー、`ON DELETE CASCADE`）・`granted_by uuid`（`users`、`ON DELETE SET NULL`）・`granted_at timestamptz default now()`。主キー`(app, user_id)`。`app`は`^[a-z_]{1,30}$`の CHECK（機能の名前と同じ形）。
- `group_app_access_grants`：`app`・`group_id uuid`（`test_groups`、`ON DELETE CASCADE`）・`granted_by`・`granted_at`。主キー`(app, group_id)`。同じ CHECK。

### 判定（`platform/access/app-access.ts`。新しいフォルダー）

- `accessibleApps(db, userId, operator: boolean): Promise<Set<string>>`：`APP_CATALOG`のアプリのうち、`open`のもの＋`granted`で（運営者、または人ごとの許可、または閉じていないグループの許可）があるもの。
- `canUseApp(db, userId, operator, app): Promise<boolean>`。
- 入口の関数：`loadAppEntitlement(s)`（`platform/entitlement/entitlement.ts`）は、`granted`のアプリで使えない人に`access: "none"`を返す（ほかの値はそのまま）。まとめて読む方は、人の配列に対して1回の問い合わせで許可を読む。
- 関所：`requireAppAccess(app)`（Hono のミドルウェア。`authed`のあとに置く）。使えなければ`AppError("APP_NOT_AVAILABLE", 403)`。エラーのコードは`@meguru/shared`の`errors.ts`に足す。`platform/index.ts`から書き出す。

### `/api/me`（`platform/identity/me-routes.ts`）

- `resolveMeApps(using, lastAppId, accessible)`：`available = releasedApps() ∩ accessible`。`using`・`last`・`landing`は今の決め方のまま`available`で絞る。
- `PUT /api/me/last-app`：`lastAppRequestSchema`を通ったあと、使えないアプリは400 `VALIDATION_FAILED`。

### 運営者のAPI（`platform/access/operator-app-access-routes.ts`）

- `PUT /api/operator/app-access/users/:userId` 本文`{ apps: Record<string, boolean> }` → `{ granted: string[] }`。
- `PUT /api/operator/app-access/groups/:groupId` 同じ形。
- 名前は`granted`で登録したアプリだけ（ほかは400 `VALIDATION_FAILED`、`fields: ["apps"]`）。人・グループがいなければ404。
- 読む方は、今の応答に足す：`GET /api/operator/users?email=`（`OperatorUser`）と`GET /api/operator/test-groups/:groupId`に`appAccess: string[]`（その人・グループに開いているアプリ）。共通の型（`@meguru/shared`）に足す。
- 運営の記録：`operator_events`に`action: "app_access"`・`subjectUserId`（人のとき）・`detail: { app, granted, groupId? }`。`OPERATOR_EVENT_ACTIONS`に足す（DB の CHECK があればマイグレーションで足す）。

### 画面（`apps/web/src/shell/settings/`）

- `useOperatorRegistry()`の結果に`access`が入る。`granted`のアプリが1つもなければ、何も出さない。
- 機能のON/OFF（`features.tsx`）で人を選んだとき、「アプリの利用」の欄に`granted`のアプリごとのスイッチ（名前は`appById(id)?.name ?? id`）。テストのグループ（`test-groups.tsx`）の詳しい画面にも同じ欄。変えたらすぐ保存し、結果を出す（今の機能のスイッチと同じふるまい）。

## テスト

- API の結合テスト `test/integration/app-access.test.ts`：仮のアプリ`demo_granted`を`registerAppAccess`で登録し、`requireAppAccess("demo_granted")`を付けた試しの道筋で、人ごと・グループ・閉じたグループ・運営者・許可なしを確かめる。運営者のAPI（400・404・記録）。入口の関数の`access`。
- `/api/me`：`resolveMeApps`の単体テスト（`accessible`で絞る・`last`が使えないと null）。結合で、Threadsだけの人の応答が変わらない（今のテストが通る）。`PUT /api/me/last-app`の400は、`APP_CATALOG`にない名前が今も400になることと、`resolveMeApps`の単体テストで確かめる（`APP_CATALOG`に`granted`のアプリが入るのは集金管理の PR1）。
- マイグレーションのテスト `test/migration/`の今の形に合わせる。
- Web：`granted`のアプリがあるときだけ欄が出る・スイッチで PUT を呼ぶ（MSW）。

## 集金管理のPR1でやること（このPRではしない）

`APP_CATALOG`に`collect`を足す・`registerAppAccess("collect", "granted")`・集金管理の道筋に`requireAppAccess("collect")`。
