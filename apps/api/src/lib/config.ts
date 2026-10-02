// 設定（環境変数・Secret）の確認。誤っている項目名だけを返し、値は返さない・ログに出さない。
// 見本の値（.dev.vars.example）のまま起動されたときに、理由のわからない INTERNAL_ERROR ではなく、
// どの項目が悪いかを API の応答とログで示すために使う。
import type { Env } from "../env";
import { createTokenCipher } from "./crypto";

const PLACEHOLDERS = ["sk_test_xxx", "pk_test_xxx", "xxxxxxxx", "000000000000000"];

function isPlaceholder(v: string | undefined): boolean {
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
 * ThreadsのアプリID・シークレット・戻り先URLは、接続先が本物のThreadsのときだけ確かめる。
 * @param env - Workers のバインディング
 * @returns 誤っている設定の項目名の一覧（値は含めない）。問題がなければ空
 */
export function validateConfig(env: Env): string[] {
  const problems: string[] = [];

  if (isPlaceholder(env.CLERK_SECRET_KEY) || !/^sk_(test|live)_[A-Za-z0-9]{20,}$/.test(env.CLERK_SECRET_KEY)) {
    problems.push("CLERK_SECRET_KEY");
  }
  if (isPlaceholder(env.CLERK_PUBLISHABLE_KEY) || !/^pk_(test|live)_[A-Za-z0-9+/=$_-]{10,}$/.test(env.CLERK_PUBLISHABLE_KEY)) {
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

  if (usesRealThreads(env)) {
    if (isPlaceholder(env.THREADS_APP_ID) || !/^\d+$/.test(env.THREADS_APP_ID)) problems.push("THREADS_APP_ID");
    if (isPlaceholder(env.THREADS_APP_SECRET)) problems.push("THREADS_APP_SECRET");
    if (!isHttpUrl(env.THREADS_REDIRECT_URI, { httpsOnly: true }) || env.THREADS_REDIRECT_URI.includes("example.com")) {
      problems.push("THREADS_REDIRECT_URI");
    }
  }
  return problems;
}
