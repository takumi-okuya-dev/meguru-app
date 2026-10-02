// テスト用の環境変数（本番の値は使わない）
const key = (byte: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));

export const TEST_WEB_ORIGIN = "http://localhost:5173";
export const TEST_APP_SECRET = "test-app-secret";

export function testBindings(fakeThreadsUrl: string, databaseUrl: string) {
  return {
    CLERK_SECRET_KEY: "sk_test_TestOnlyDummySecretKey00000",
    CLERK_PUBLISHABLE_KEY: "pk_test_dGVzdC5jbGVyay5hY2NvdW50cy5kZXYk",
    THREADS_APP_ID: "123456",
    THREADS_APP_SECRET: TEST_APP_SECRET,
    THREADS_REDIRECT_URI: "https://api.test/api/threads/callback",
    THREADS_AUTH_BASE_URL: fakeThreadsUrl,
    THREADS_GRAPH_BASE_URL: fakeThreadsUrl,
    TOKEN_ENCRYPTION_KEYS: JSON.stringify({ "1": key(7) }),
    TOKEN_ENCRYPTION_KEY_VERSION: "1",
    IDENTIFIER_HASH_KEY: key(9),
    DATABASE_URL: databaseUrl,
    WEB_ORIGIN: TEST_WEB_ORIGIN,
  };
}
