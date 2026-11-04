// 設定（環境変数・Secret）の確認。誤っている項目名だけを返し、値は返さない・ログに出さない。
// 見本の値（.dev.vars.example）のまま起動されたときに、理由のわからない INTERNAL_ERROR ではなく、
// どの項目が悪いかを API の応答とログで示すために使う。
import type { Env } from "../env";
import { createTokenCipher } from "./crypto";

/** APP_ENV に入れてよい値（specs/015-deploy-environments contracts/environments.md 2）。 */
const APP_ENVS: readonly string[] = ["production", "staging", "development"];

/**
 * その環境で使うべき鍵の種類を返す（specs/015。PR #19 のCodexレビュー）。
 * 本番は本番の鍵（live）、ステージングと手元はテスト用の鍵（test）。取り違えると、
 * 本番がテストの利用者名簿で動く・ステージングが本当のお客さまに課金する、といった事故になる。
 * @param appEnv - APP_ENV の値
 * @returns "live" か "test"。APP_ENV が不正なら null（その場合は APP_ENV の指摘だけを出す）
 */
function keyModeOf(appEnv: string): "live" | "test" | null {
  if (appEnv === "production") return "live";
  if (appEnv === "staging" || appEnv === "development") return "test";
  return null;
}

/**
 * 鍵が、その環境の種類（live／test）と合っているかを見る。
 * @param value - 鍵の値
 * @param mode - その環境で使うべき種類
 * @returns 合っていれば true
 */
function matchesKeyMode(value: string | undefined, mode: "live" | "test" | null): boolean {
  if (mode === null || !value) return true;
  return value.startsWith(`sk_${mode}_`) || value.startsWith(`pk_${mode}_`);
}

const PLACEHOLDERS = ["sk_test_xxx", "pk_test_xxx", "xxxxxxxx", "000000000000000", "whsec_xxx", "price_xxx"];

/**
 * 未設定か、見本の値のままかを判定する。
 * @param v - 設定の値
 * @returns 空・見本の値なら true
 */
export function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  return PLACEHOLDERS.includes(v) || v.includes("REPLACE_WITH");
}

function base64Bytes(v: string): number | null {
  try {
    return atob(v).length;
  } catch {
    return null;
  }
}

function isHttpUrl(v: string | undefined, { httpsOnly = false } = {}): boolean {
  if (!v) return false;
  try {
    const u = new URL(v);
    return httpsOnly ? u.protocol === "https:" : u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 接続先が本物のThreads（偽のサーバーではない）かを判定する。
 * @param env - Workers のバインディング
 * @returns 本物のThreadsにつなぐなら true
 */
function usesRealThreads(env: Env): boolean {
  try {
    const host = new URL(env.THREADS_AUTH_BASE_URL).hostname;
    return host.endsWith("threads.com") || host.endsWith("threads.net");
  } catch {
    return true;
  }
}

/**
 * 設定（環境変数・Secret）を確かめる。未設定・見本の値・形の誤りを見つける。
 * ThreadsのアプリID・シークレット・戻り先URLは、接続先が本物のThreadsで、
 * 「Threadsで許可する」（`THREADS_CONNECT_METHODS` の `app`）を出すときだけ確かめる。
 * @param env - Workers のバインディング
 * @returns 誤っている設定の項目名の一覧（値は含めない）。問題がなければ空
 */
export function validateConfig(env: Env): string[] {
  const problems: string[] = [];

  // どの環境かは必ず明示する（未設定のまま本番の値で動かさない。specs/015 FR-026）
  if (!APP_ENVS.includes(env.APP_ENV)) problems.push("APP_ENV");
  const keyMode = keyModeOf(env.APP_ENV);

  if (
    isPlaceholder(env.CLERK_SECRET_KEY) ||
    !/^sk_(test|live)_[A-Za-z0-9]{20,}$/.test(env.CLERK_SECRET_KEY) ||
    !matchesKeyMode(env.CLERK_SECRET_KEY, keyMode)
  ) {
    problems.push("CLERK_SECRET_KEY");
  }
  if (
    isPlaceholder(env.CLERK_PUBLISHABLE_KEY) ||
    !/^pk_(test|live)_[A-Za-z0-9+/=$_-]{10,}$/.test(env.CLERK_PUBLISHABLE_KEY) ||
    !matchesKeyMode(env.CLERK_PUBLISHABLE_KEY, keyMode)
  ) {
    problems.push("CLERK_PUBLISHABLE_KEY");
  }
  try {
    createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  } catch {
    problems.push("TOKEN_ENCRYPTION_KEYS");
  }
  if (isPlaceholder(env.IDENTIFIER_HASH_KEY) || base64Bytes(env.IDENTIFIER_HASH_KEY) !== 32) {
    problems.push("IDENTIFIER_HASH_KEY");
  }
  if (!env.DATABASE_URL || !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) problems.push("DATABASE_URL");
  if (!isHttpUrl(env.WEB_ORIGIN)) problems.push("WEB_ORIGIN");
  if (!env.AUTOPOST_KV) problems.push("AUTOPOST_KV");
  if (env.THREADS_ACCESS_MODE !== undefined && !["testers", "public"].includes(env.THREADS_ACCESS_MODE)) {
    problems.push("THREADS_ACCESS_MODE");
  }

  // 決済のON/OFFは必須。未設定で黙ってOFFにしない（specs/013 FR-063）
  if (env.BILLING_ENABLED !== "true" && env.BILLING_ENABLED !== "false") problems.push("BILLING_ENABLED");
  if (env.BILLING_ENABLED === "true") {
    if (
      isPlaceholder(env.STRIPE_SECRET_KEY) ||
      !/^sk_(test|live)_[A-Za-z0-9]{10,}$/.test(env.STRIPE_SECRET_KEY ?? "") ||
      !matchesKeyMode(env.STRIPE_SECRET_KEY, keyMode)
    ) {
      problems.push("STRIPE_SECRET_KEY");
    }
    if (isPlaceholder(env.STRIPE_WEBHOOK_SECRET) || !/^whsec_[A-Za-z0-9]{10,}$/.test(env.STRIPE_WEBHOOK_SECRET ?? "")) {
      problems.push("STRIPE_WEBHOOK_SECRET");
    }
    if (isPlaceholder(env.STRIPE_PRICE_ID) || !/^price_[A-Za-z0-9]{6,}$/.test(env.STRIPE_PRICE_ID ?? "")) {
      problems.push("STRIPE_PRICE_ID");
    }
    if (env.STRIPE_API_BASE_URL !== undefined && !isHttpUrl(env.STRIPE_API_BASE_URL)) problems.push("STRIPE_API_BASE_URL");
  }

  // テスト用のグループのON/OFFも必須。未設定で黙ってOFFにしない（specs/016 research.md R1）
  if (env.TEST_GROUPS_ENABLED !== "true" && env.TEST_GROUPS_ENABLED !== "false") problems.push("TEST_GROUPS_ENABLED");

  // このアプリのMetaアプリを使うのは「Threadsで許可する」だけ。審査前はトークンを貼る方法だけで
  // 運用するので、使わない値は求めない。外したときの通知の窓口は verifySignedRequest が断る
  if (usesRealThreads(env) && connectMethodsOf(env).includes("app")) {
    if (isPlaceholder(env.THREADS_APP_ID) || !/^\d+$/.test(env.THREADS_APP_ID)) problems.push("THREADS_APP_ID");
    if (isPlaceholder(env.THREADS_APP_SECRET)) problems.push("THREADS_APP_SECRET");
    if (!isHttpUrl(env.THREADS_REDIRECT_URI, { httpsOnly: true }) || env.THREADS_REDIRECT_URI.includes("example.com")) {
      problems.push("THREADS_REDIRECT_URI");
    }
  }
  return problems;
}

/**
 * 決済のモード（specs/013 research.md R2・R11）。環境ごとに1つで、判定する人の値に持たせる。
 * testGroups はテスト用のグループの仕組みがONか（specs/016 research.md R4）。ONなら、テスト環境に入れない
 * オーナーは読むだけになる（定期処理・権限の判定に同じモードで届けるため、ここに載せる）。
 * operators は運営者のClerkのユーザーID（ONのときだけ。運営者はいつもテスト版に入れる）。機能の設定の画面の運営者は、
 * ここではなく認証のミドルウェアが `operatorIdsOf` で決める（招待制に関わらない。specs/019 research.md R5）。
 */
export type BillingMode = { enabled: boolean; testGroups?: boolean; operators?: readonly string[] };

/** つなぐ方法（`accounts.connection_method` と同じ語）。 */
export const CONNECT_METHODS = ["app", "token"] as const;

/**
 * 画面に出すつなぐ方法を決める。
 *
 * 未設定なら両方（今までの挙動）。`THREADS_CONNECT_METHODS` はカンマ区切りで、
 * 知らない語は無視する。1つも残らなければ両方に戻す（設定の打ち間違いで
 * 「つなげない製品」にしないため）。
 * @param env - Workers のバインディング
 * @returns 出す方法の並び（`app` が先）
 */
export function connectMethodsOf(env: Pick<Env, "THREADS_CONNECT_METHODS">): ("app" | "token")[] {
  const raw = env.THREADS_CONNECT_METHODS;
  if (!raw) return [...CONNECT_METHODS];
  const asked = new Set(raw.split(",").map((m) => m.trim().toLowerCase()));
  const picked = CONNECT_METHODS.filter((m) => asked.has(m));
  return picked.length > 0 ? picked : [...CONNECT_METHODS];
}

/**
 * 環境の設定から決済のモードを作る。
 *
 * `validateConfig` は `"true"`／`"false"` 以外を拒む（FR-063：未設定で黙ってOFFにしない）。
 * ここで `=== "true"` だけを見て残りを「課金オフ」に写すと、同じ変数を2つの規則で読むことになり、
 * `"TRUE"` のような値で **APIは全リクエストを拒むのに Cron は全オーナーを全権として扱う**
 * （`entitlementOf` が契約の状態を読まずに全権を返す）。だから列挙外の値では落とす。
 * 両方の入口が先に `validateConfig` を通るので、正しい設定では到達しない
 * （セキュリティ監査 run-1）。
 * @param env - Workers のバインディング
 * @returns 決済のモード
 * @throws Error 列挙外の値のとき
 */
export function billingModeOf(env: Pick<Env, "BILLING_ENABLED" | "TEST_GROUPS_ENABLED" | "OPERATOR_CLERK_USER_IDS">): BillingMode {
  let enabled: boolean;
  if (env.BILLING_ENABLED === "true") enabled = true;
  else if (env.BILLING_ENABLED === "false") enabled = false;
  else throw new Error(`BILLING_ENABLED must be "true" or "false"`);
  // テスト用のグループも同じ理由で、列挙外の値では落とす（specs/016 research.md R1）
  if (env.TEST_GROUPS_ENABLED === "true") return { enabled, testGroups: true, operators: operatorIdsOf(env) };
  if (env.TEST_GROUPS_ENABLED === "false") return { enabled, testGroups: false };
  throw new Error(`TEST_GROUPS_ENABLED must be "true" or "false"`);
}

/**
 * 運営者のClerkのユーザーIDの一覧（specs/016 research.md R1）。カンマ区切りで、前後の空白と空の項目は捨てる。
 * @param env - Workers のバインディング
 * @returns ClerkのユーザーIDの一覧（いなければ空）
 */
export function operatorIdsOf(env: Pick<Env, "OPERATOR_CLERK_USER_IDS">): string[] {
  return (env.OPERATOR_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
