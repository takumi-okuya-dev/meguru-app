// テスト用のグループのテストの部品（specs/016-test-groups tasks.md）：ONの環境、運営者の操作、招待の文字列
import type { Env } from "../../src/env";
import { call, db, testEnv, type TestApp } from "./app";
import { neon } from "@neondatabase/serverless";

/** 運営者の Clerk のユーザーID（テストの偽の認証では "test:op"）。 */
export const OPERATOR = "op";

/** テスト用のグループがONの環境。 */
export function groupsEnv(over: Partial<Env> = {}): Env {
  return { ...testEnv, TEST_GROUPS_ENABLED: "true", OPERATOR_CLERK_USER_IDS: OPERATOR, ...over } as Env;
}

/** ONの環境で API を呼ぶ。 */
export function callOn(app: TestApp, method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  return call(app, method, path, { ...opts, env: groupsEnv() });
}

/** 運営者としてグループを作り、IDと招待の文字列を返す。 */
export async function createGroup(app: TestApp, name = "飲食の会", capacity = 10) {
  const res = await callOn(app, "POST", "/api/operator/test-groups", { user: OPERATOR, body: { name, capacity } });
  if (res.status !== 200) throw new Error(`create group failed: ${res.status} ${await res.text()}`);
  const g = (await res.json()) as { id: string; inviteUrl: string };
  return { id: g.id, token: g.inviteUrl.split("/test-invite/")[1]! };
}

/** ONの環境で招待から参加する。 */
export function join(app: TestApp, user: string, token: string) {
  return callOn(app, "POST", `/api/test-invites/${token}/join`, { user });
}

/** users の行（clerk_user_id から）。 */
export async function userRow(clerkUserId: string) {
  db(); // ローカルプロキシの設定
  const [u] = (await neon(testEnv.DATABASE_URL)`
    SELECT id, signed_up_open, billing_exempt FROM users WHERE clerk_user_id = ${clerkUserId}`) as [
    { id: string; signed_up_open: boolean; billing_exempt: boolean } | undefined,
  ];
  return u;
}

/** 利用者を、ONの間に登録した人（グループに入っていなければ入れない人）にする。 */
export async function makeClosedSignup(clerkUserId: string) {
  db();
  await neon(testEnv.DATABASE_URL)`UPDATE users SET signed_up_open = false WHERE clerk_user_id = ${clerkUserId}`;
}
