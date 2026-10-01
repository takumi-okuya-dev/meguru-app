// Workers のバインディング（contracts/api.md「環境変数・Secret」）
export interface Env {
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  THREADS_APP_ID: string;
  THREADS_APP_SECRET: string;
  THREADS_REDIRECT_URI: string;
  THREADS_AUTH_BASE_URL: string;
  THREADS_GRAPH_BASE_URL: string;
  TOKEN_ENCRYPTION_KEYS: string;
  TOKEN_ENCRYPTION_KEY_VERSION: string;
  IDENTIFIER_HASH_KEY: string;
  DATABASE_URL: string;
  WEB_ORIGIN: string;
}
