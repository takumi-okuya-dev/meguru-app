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

export async function resetAll() {
  const client = new pg.Client({ connectionString: DIRECT_DB });
  await client.connect();
  try {
    await client.query(
      "TRUNCATE users, accounts, memberships, threads_connections, oauth_states, threads_deletion_requests, threads_revocations CASCADE",
    );
  } finally {
    await client.end();
  }
  await control("reset", {});
  await control("users", { id: "9001", username: "e2e_user", name: "E2E User" });
}

export async function control(path: string, body: unknown) {
  const res = await fetch(`${FAKE_THREADS}/__control/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`fake threads control ${path} failed: ${res.status}`);
}

export async function signIn(page: Page) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: testUserEmail() });
}

export async function signOut(page: Page) {
  await clerk.signOut({ page });
}
