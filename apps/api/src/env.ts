/** Workers のバインディング（環境変数・Secret）。一覧と意味は contracts/api.md「環境変数・Secret」。 */
export interface Env {
  /** どの環境で動いているか（specs/015-deploy-environments contracts/environments.md 2）。手元は development */
  APP_ENV: "production" | "staging" | "development";
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
  /** 自動投稿の関所（specs/005-auto-post research.md R3） */
  AUTOPOST_KV: KVNamespace;
  /** Threads連携の公開範囲。未設定は testers（specs/002-strategy-profile research.md R15） */
  THREADS_ACCESS_MODE?: "testers" | "public";
  /** 決済のON/OFF（"true" か "false"。必須。specs/013-billing research.md R11） */
  BILLING_ENABLED: string;
  /** Stripeの秘密の鍵（決済ONのとき必須。本番 sk_live_、ステージング・手元 sk_test_） */
  STRIPE_SECRET_KEY?: string;
  /** Webhookの署名の秘密（決済ONのとき必須。whsec_） */
  STRIPE_WEBHOOK_SECRET?: string;
  /** 段階制の料金のID（決済ONのとき必須。price_。specs/013 research.md R3） */
  STRIPE_PRICE_ID?: string;
  /** StripeのAPIの接続先。既定 https://api.stripe.com（テストと手元は偽のStripe） */
  STRIPE_API_BASE_URL?: string;
  /** カスタマーポータルの設定（bpc_。なければStripeの既定の設定） */
  STRIPE_PORTAL_CONFIGURATION_ID?: string;
  /** 適格請求書の登録をしたときの10%（内税）の税率（txr_） */
  STRIPE_TAX_RATE_ID?: string;
}
