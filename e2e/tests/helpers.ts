// E2E の共通部品：DBと偽のThreadsサーバーの初期化、Clerk のテスト用ログイン
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";
import pg from "pg";

export const FAKE_THREADS = process.env.FAKE_THREADS_URL ?? "http://localhost:8790";
const DIRECT_DB = process.env.E2E_DATABASE_URL_DIRECT ?? "postgres://postgres:postgres@localhost:5432/threads_grower";

/** Clerk の開発用インスタンスに用意したテスト用ユーザーのメールアドレス */
export function testUserEmail(): string {
  const email = process.env.E2E_CLERK_USER_EMAIL;
  if (!email) throw new Error("E2E_CLERK_USER_EMAIL を設定してください（README の E2E の項を参照）");
  return email;
}

/**
 * チームのE2Eで使う3人（specs/011-team-revision quickstart.md 2、docs/team-roles.md）。
 * admin＝チームを作る管理者（田中役）、owner＝アカウントを見せるメンバー（鈴木役）、editor＝担当になる編集者（佐藤役）。
 */
export type TeamRole = "admin" | "owner" | "editor";

// 環境変数の名前は008のまま（管理者は、008のパートナーの E2E_PARTNER_EMAIL を使う）
const TEAM_ENV: Record<TeamRole, string> = {
  admin: "E2E_PARTNER_EMAIL",
  owner: "E2E_OWNER_EMAIL",
  editor: "E2E_EDITOR_EMAIL",
};

/**
 * 役割のテスト用ユーザーのメールアドレス。Clerk の開発用インスタンスに、一度Googleでログインしたことのある
 * 3つのアカウントを使う（Googleだけでログインする設定では、APIでユーザーを作ってもチケットでログインできないため）。
 * @param role - 役割
 * @returns メールアドレス
 * @throws Error 環境変数がないとき
 */
export function teamEmail(role: TeamRole): string {
  const email = process.env[TEAM_ENV[role]];
  if (!email) throw new Error(`${TEAM_ENV[role]} を設定してください（README の E2E の項を参照）`);
  return email;
}

/**
 * 役割のテスト用ユーザーとしてログインする（@clerk/testing がメールアドレスからユーザーを探し、ログイン用のチケットで入る）。
 * @param page - ページ（役割ごとに別の BrowserContext のもの）
 * @param role - 役割
 */
export async function signInAs(page: Page, role: TeamRole) {
  await signIn(page, teamEmail(role));
}

export async function resetAll() {
  const client = new pg.Client({ connectionString: DIRECT_DB });
  await client.connect();
  try {
    // 表を足しても漏れないよう、public のすべての表を空にする（マイグレーションの記録は drizzle スキーマにあるので残る）
    const { rows } = await client.query<{ name: string }>(
      "SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'",
    );
    if (rows.length > 0) await client.query(`TRUNCATE ${rows.map((r) => r.name).join(", ")} CASCADE`);
  } finally {
    await client.end();
  }
  await control("reset", {});
  await registerFakeUsers();
}

/**
 * 偽のThreadsにユーザーを登録する（何度呼んでもよい）。最初の1人が「許可する」の既定で、
 * ほかは認可画面の「@… で許可する」で選ぶ（チームの確認で、3人がそれぞれ自分のアカウントを接続する）。
 */
export async function registerFakeUsers() {
  await control("users", { id: "9001", username: "e2e_user", name: "E2E User" });
  await control("users", { id: "9002", username: "partner_co", name: "Partner Co" });
  await control("users", { id: "9003", username: "cafe_b", name: "Cafe B" });
}

export async function control(path: string, body: unknown) {
  const res = await fetch(`${FAKE_THREADS}/__control/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`fake threads control ${path} failed: ${res.status}`);
}

/**
 * Clerk のテスト用ログイン。
 * @param page - ページ
 * @param email - ログインするユーザー（省略すると E2E_CLERK_USER_EMAIL）
 */
export async function signIn(page: Page, email: string = testUserEmail()) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: email });
}

export async function signOut(page: Page) {
  await clerk.signOut({ page });
}
