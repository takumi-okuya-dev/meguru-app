// 設定の確認（誤りがあれば項目名だけを返す。値は返さない）
import { describe, expect, it } from "vitest";
import { validateConfig } from "../../src/lib/config";
import type { Env } from "../../src/env";
import { testBindings } from "../env";

const good = {
  ...testBindings("http://127.0.0.1:8790", "postgres://postgres:postgres@db.localtest.me:5432/threads_grower"),
  AUTOPOST_KV: {} as KVNamespace,
} as Env;

describe("validateConfig", () => {
  it("正しい設定なら問題なし", () => {
    expect(validateConfig(good)).toEqual([]);
  });

  it("見本の値のままの鍵・Clerkのキーを指摘する（値は含めない）", () => {
    const env = {
      ...good,
      CLERK_SECRET_KEY: "sk_test_xxx",
      CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      TOKEN_ENCRYPTION_KEYS: '{"1":"REPLACE_WITH_32_BYTES_BASE64"}',
      IDENTIFIER_HASH_KEY: "REPLACE_WITH_32_BYTES_BASE64",
    } as Env;
    const problems = validateConfig(env);
    expect(problems).toEqual(["CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY", "TOKEN_ENCRYPTION_KEYS", "IDENTIFIER_HASH_KEY"]);
    expect(JSON.stringify(problems)).not.toContain("REPLACE");
  });

  it("鍵リングに現在のバージョンの鍵がなければ指摘する", () => {
    expect(validateConfig({ ...good, TOKEN_ENCRYPTION_KEY_VERSION: "2" } as Env)).toEqual(["TOKEN_ENCRYPTION_KEYS"]);
  });

  it("自動投稿の関所のKV（AUTOPOST_KV）がなければ指摘する", () => {
    expect(validateConfig({ ...good, AUTOPOST_KV: undefined } as unknown as Env)).toEqual(["AUTOPOST_KV"]);
  });

  it("DATABASE_URL と WEB_ORIGIN の形を確かめる", () => {
    expect(validateConfig({ ...good, DATABASE_URL: "", WEB_ORIGIN: "localhost:5173" } as Env)).toEqual([
      "DATABASE_URL",
      "WEB_ORIGIN",
    ]);
  });

  it("接続先が本物のThreadsなら、ThreadsのアプリID・シークレット・戻り先URLも確かめる", () => {
    const env = {
      ...good,
      THREADS_AUTH_BASE_URL: "https://threads.com",
      THREADS_GRAPH_BASE_URL: "https://graph.threads.com",
      THREADS_APP_ID: "000000000000000",
      THREADS_APP_SECRET: "xxxxxxxx",
      THREADS_REDIRECT_URI: "https://api-dev.example.com/api/threads/callback",
    } as Env;
    expect(validateConfig(env)).toEqual(["THREADS_APP_ID", "THREADS_APP_SECRET", "THREADS_REDIRECT_URI"]);
  });

  it("BILLING_ENABLED は true か false が必須（specs/013 FR-063）", () => {
    expect(validateConfig({ ...good, BILLING_ENABLED: undefined } as unknown as Env)).toEqual(["BILLING_ENABLED"]);
    expect(validateConfig({ ...good, BILLING_ENABLED: "yes" } as Env)).toEqual(["BILLING_ENABLED"]);
  });

  it("決済ONなら、Stripeの鍵・Webhookの秘密・料金のIDを確かめる。OFFなら見ない", () => {
    const on = { ...good, BILLING_ENABLED: "true" } as Env;
    expect(validateConfig(on)).toEqual([]);
    const missing = { ...on, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: "", STRIPE_PRICE_ID: undefined } as unknown as Env;
    expect(validateConfig(missing)).toEqual(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"]);
    const sample = { ...on, STRIPE_SECRET_KEY: "sk_test_xxx", STRIPE_WEBHOOK_SECRET: "whsec_xxx", STRIPE_PRICE_ID: "price_xxx" } as Env;
    expect(validateConfig(sample)).toEqual(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"]);
    expect(validateConfig({ ...missing, BILLING_ENABLED: "false" } as Env)).toEqual([]);
  });

  it("偽のThreadsで動かすときは、Threadsの3項目は見本の値のままでよい", () => {
    const env = { ...good, THREADS_APP_ID: "000000000000000", THREADS_APP_SECRET: "xxxxxxxx" } as Env;
    expect(validateConfig(env)).toEqual([]);
  });
});
