// 設定の確認（誤りがあれば項目名だけを返す。値は返さない）
import { describe, expect, it } from "vitest";
import { billingModeOf, connectMethodsOf, operatorIdsOf, testerInvitesEnabledOf, threadsAppIdOf, validateConfig } from "../../src/lib/config";
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

  it("本物のThreadsでも、トークンを貼る方法だけなら、Threadsの3項目は求めない（審査前の運用）", () => {
    const real = {
      ...good,
      THREADS_AUTH_BASE_URL: "https://threads.com",
      THREADS_GRAPH_BASE_URL: "https://graph.threads.com",
      THREADS_APP_ID: "000000000000000",
      THREADS_APP_SECRET: undefined,
      THREADS_REDIRECT_URI: "https://api-dev.example.com/api/threads/callback",
    } as unknown as Env;
    expect(validateConfig({ ...real, THREADS_CONNECT_METHODS: "token" } as Env)).toEqual([]);
    // 「Threadsで許可する」も出すなら（審査後）、また求める
    expect(validateConfig({ ...real, THREADS_CONNECT_METHODS: "app,token" } as Env)).toEqual([
      "THREADS_APP_ID",
      "THREADS_APP_SECRET",
      "THREADS_REDIRECT_URI",
    ]);
  });

  it("TEST_GROUPS_ENABLED は true か false が必須（specs/016 research.md R1）", () => {
    expect(validateConfig({ ...good, TEST_GROUPS_ENABLED: undefined } as unknown as Env)).toEqual(["TEST_GROUPS_ENABLED"]);
    expect(validateConfig({ ...good, TEST_GROUPS_ENABLED: "on" } as Env)).toEqual(["TEST_GROUPS_ENABLED"]);
    expect(validateConfig({ ...good, TEST_GROUPS_ENABLED: "true" } as Env)).toEqual([]);
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

  it("APP_ENV は production・staging・development のどれかが必須（specs/015 FR-026）", () => {
    // production は本番の鍵（live）が要るので、下の「鍵の種類」のテストで確かめる
    for (const v of ["staging", "development"]) {
      expect(validateConfig({ ...good, APP_ENV: v } as Env)).toEqual([]);
    }
    expect(validateConfig({ ...good, APP_ENV: undefined } as unknown as Env)).toEqual(["APP_ENV"]);
    expect(validateConfig({ ...good, APP_ENV: "" } as unknown as Env)).toEqual(["APP_ENV"]);
    expect(validateConfig({ ...good, APP_ENV: "prod" } as unknown as Env)).toEqual(["APP_ENV"]);
  });

  it("本番は live の鍵、ステージングと手元は test の鍵でなければ指摘する（PR #19 のCodexレビュー）", () => {
    const live = {
      ...good,
      APP_ENV: "production",
      BILLING_ENABLED: "true",
      CLERK_SECRET_KEY: "sk_live_TestOnlyDummySecretKey00000",
      CLERK_PUBLISHABLE_KEY: "pk_live_dGVzdC5jbGVyay5hY2NvdW50cy5kZXYk",
      STRIPE_SECRET_KEY: "sk_live_TestOnlyStripeKey000000",
    } as Env;
    expect(validateConfig(live)).toEqual([]);

    // 本番にテスト用の鍵が入っている
    expect(validateConfig({ ...live, CLERK_SECRET_KEY: good.CLERK_SECRET_KEY } as Env)).toEqual(["CLERK_SECRET_KEY"]);
    expect(validateConfig({ ...live, CLERK_PUBLISHABLE_KEY: good.CLERK_PUBLISHABLE_KEY } as Env)).toEqual([
      "CLERK_PUBLISHABLE_KEY",
    ]);
    expect(validateConfig({ ...live, STRIPE_SECRET_KEY: good.STRIPE_SECRET_KEY } as Env)).toEqual(["STRIPE_SECRET_KEY"]);

    // ステージングに本番の鍵が入っている（本当のお客さまに課金してしまう）
    const staging = { ...good, APP_ENV: "staging", BILLING_ENABLED: "true" } as Env;
    expect(validateConfig(staging)).toEqual([]);
    expect(validateConfig({ ...staging, STRIPE_SECRET_KEY: "sk_live_TestOnlyStripeKey000000" } as Env)).toEqual([
      "STRIPE_SECRET_KEY",
    ]);
    expect(
      validateConfig({ ...staging, CLERK_SECRET_KEY: "sk_live_TestOnlyDummySecretKey00000" } as Env),
    ).toEqual(["CLERK_SECRET_KEY"]);

    // 決済OFFなら、Stripeの鍵は見ない（今までどおり）
    expect(
      validateConfig({ ...good, APP_ENV: "staging", STRIPE_SECRET_KEY: "sk_live_x000000000" } as Env),
    ).toEqual([]);
  });

  it("偽のThreadsで動かすときは、Threadsの3項目は見本の値のままでよい", () => {
    const env = { ...good, THREADS_APP_ID: "000000000000000", THREADS_APP_SECRET: "xxxxxxxx" } as Env;
    expect(validateConfig(env)).toEqual([]);
  });
});

// 1つの変数を2つの規則で読まない（セキュリティ監査 run-1）。
// `validateConfig` が "true"／"false" 以外を拒むのに `billingModeOf` が
// `=== "true"` 以外を黙って「課金オフ」に写すと、Cron 側だけが全オーナーを
// 全権として扱う（契約の状態を読まずに）。
describe("billingModeOf", () => {
  it.each([
    ["true", true],
    ["false", false],
  ])("%j は、そのまま読む", (value, expected) => {
    expect(billingModeOf({ BILLING_ENABLED: value, TEST_GROUPS_ENABLED: "false" } as Env).enabled).toBe(expected);
  });

  it.each(["TRUE", "True", "1", "yes", "", undefined])("%j は、黙って課金オフにせず落ちる", (value) => {
    expect(() => billingModeOf({ BILLING_ENABLED: value, TEST_GROUPS_ENABLED: "false" } as Env)).toThrow(/BILLING_ENABLED/);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("TEST_GROUPS_ENABLED の %j は、そのまま testGroups に読む（specs/016）", (value, expected) => {
    expect(billingModeOf({ BILLING_ENABLED: "false", TEST_GROUPS_ENABLED: value } as Env).testGroups).toBe(expected);
  });

  it.each(["TRUE", "1", "", undefined])("TEST_GROUPS_ENABLED の %j は、黙ってOFFにせず落ちる（specs/016）", (value) => {
    expect(() => billingModeOf({ BILLING_ENABLED: "false", TEST_GROUPS_ENABLED: value } as Env)).toThrow(/TEST_GROUPS_ENABLED/);
  });
});

describe("operatorIdsOf（specs/016 research.md R1）", () => {
  it("カンマ区切りを読み、前後の空白と空の項目を捨てる", () => {
    expect(operatorIdsOf({ OPERATOR_CLERK_USER_IDS: " user_a , ,user_b," } as Env)).toEqual(["user_a", "user_b"]);
  });

  it("未設定・空なら運営者はいない", () => {
    expect(operatorIdsOf({} as Env)).toEqual([]);
    expect(operatorIdsOf({ OPERATOR_CLERK_USER_IDS: "" } as Env)).toEqual([]);
  });
});

// つなぐ方法の切り替え（App Review を通すまで／通らなかったときに token だけで運用する）。
// 既定は両方（今までの挙動を変えない）
describe("connectMethodsOf", () => {
  it("未設定なら両方", () => {
    expect(connectMethodsOf({} as Env)).toEqual(["app", "token"]);
    expect(connectMethodsOf({ THREADS_CONNECT_METHODS: "" } as Env)).toEqual(["app", "token"]);
  });

  it.each([
    ["token", ["token"]],
    ["app", ["app"]],
    ["app,token", ["app", "token"]],
    [" TOKEN , app ", ["app", "token"]],
  ])("%j は %j", (raw, expected) => {
    expect(connectMethodsOf({ THREADS_CONNECT_METHODS: raw } as Env)).toEqual(expected);
  });

  it("知らない語だけなら、両方に戻す（打ち間違いで「つなげない製品」にしない）", () => {
    expect(connectMethodsOf({ THREADS_CONNECT_METHODS: "oauth,paste" } as Env)).toEqual(["app", "token"]);
  });
});

// 招待の管理のON/OFF（specs/024-tester-invite-connect research.md R4）。審査の前（testers）で、app を出しているときだけON
describe("testerInvitesEnabledOf", () => {
  it.each([
    [{}, true],
    [{ THREADS_ACCESS_MODE: "testers" }, true],
    [{ THREADS_ACCESS_MODE: "testers", THREADS_CONNECT_METHODS: "app,token" }, true],
    [{ THREADS_ACCESS_MODE: "public" }, false],
    [{ THREADS_ACCESS_MODE: "testers", THREADS_CONNECT_METHODS: "token" }, false],
  ])("%j は %j", (env, expected) => {
    expect(testerInvitesEnabledOf(env as Env)).toBe(expected);
  });
});

// 「Metaでテスターを加える」のリンクに使うアプリID（specs/024 contracts/api.md）。見本の値・未設定なら null
describe("threadsAppIdOf", () => {
  it.each([
    [{ THREADS_APP_ID: "1367107908637398" }, "1367107908637398"],
    [{ THREADS_APP_ID: "000000000000000" }, null],
    [{ THREADS_APP_ID: "" }, null],
    [{}, null],
  ])("%j は %j", (env, expected) => {
    expect(threadsAppIdOf(env as Env)).toBe(expected);
  });
});
