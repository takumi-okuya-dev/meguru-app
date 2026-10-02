// Web 側の設定の確認（apps/web/.env.local）
const PLACEHOLDER_KEYS = ["pk_test_xxx"];

/** Clerk の Publishable key として使える形か（未設定・見本の値なら false） */
export function isUsablePublishableKey(key: string | undefined): key is string {
  if (!key || PLACEHOLDER_KEYS.includes(key)) return false;
  return /^pk_(test|live)_[A-Za-z0-9+/=$_-]{10,}$/.test(key);
}

/** Clerk の読み込みを待つ上限。これを過ぎたら、読み込み中のまま止めずに案内を出す */
export const CLERK_LOAD_TIMEOUT_MS = 15_000;
