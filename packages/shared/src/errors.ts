// エラーコードと、画面に出す日本語の文言（contracts/ui-routes.md「エラー文言」）。
// APIは code だけを返し、Webがここから文言を引く。

/** APIとWebで共有するエラーコードの一覧（contracts/api.md・ui-routes.md）。 */
export const ERROR_CODES = [
  "AUTH_REQUIRED",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_LIMIT_REACHED",
  "THREADS_AUTH_CANCELLED",
  "THREADS_AUTH_FAILED",
  "THREADS_PROFILE_FETCH_FAILED",
  "THREADS_ACCOUNT_TAKEN",
  "RECONNECT_ACCOUNT_MISMATCH",
  "ACCOUNT_DELETED_DURING_CONNECT",
  "THREADS_AUTH_REVOKED",
  "THREADS_DATA_DELETION_REQUESTED",
  "OAUTH_STATE_INVALID",
  "CONFIRMATION_MISMATCH",
  "VALIDATION_FAILED",
  "STALE_UPDATE",
  "ITEM_NOT_FOUND",
  "ITEM_LIMIT_REACHED",
  "KEYWORD_DUPLICATE",
  "GROWER_FEATURE_REQUIRED",
  "CONFIG_ERROR",
  "API_UNREACHABLE",
  "INTERNAL_ERROR",
] as const;

/** エラーコード。 */
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * 文字列がエラーコードかを確かめる。
 * @param value - 確かめる文字列（URLのクエリなど）
 * @returns エラーコードなら true
 */
export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

/** エラー文言に埋め込む値。 */
export type ErrorMessageContext = {
  /** RECONNECT_ACCOUNT_MISMATCH で使う、元のAccountのユーザー名（@なし） */
  username?: string;
  /** ACCOUNT_LIMIT_REACHED で使う、ユーザーの登録数上限 */
  max?: number;
  /** CONFIG_ERROR で使う、誤っている設定の項目名（値は含めない） */
  details?: string[];
  /** API_UNREACHABLE で使う、接続しようとしたAPIのURL */
  apiUrl?: string;
};

/** エラーのときに利用者が次に取れる操作。 */
export type NextAction =
  | "sign-in"
  | "back-to-accounts"
  | "plan-guidance"
  | "delete-account"
  | "retry-connect"
  | "retry-later"
  | "retype"
  | "reload"
  | "none";

/** 画面に出すエラー文言と、次に取れる操作。 */
export type ErrorMessage = { message: string; action: NextAction };

/**
 * エラーコードから、画面に出す日本語の文言を作る（contracts/ui-routes.md「エラー文言」）。
 * ACCOUNT_LIMIT_REACHED は上限（max）で文言を切り替える（FR-017）。
 * @param code - エラーコード
 * @param ctx - 文言に埋め込む値
 * @returns 文言と次に取れる操作
 */
export function errorMessage(code: ErrorCode, ctx: ErrorMessageContext = {}): ErrorMessage {
  switch (code) {
    case "AUTH_REQUIRED":
      return { message: "セッションの有効期限が切れました。もう一度ログインしてください。", action: "sign-in" };
    case "ACCOUNT_NOT_FOUND":
      return {
        message: "このAccountは見つかりません。削除されたか、アクセスする権限がありません。",
        action: "back-to-accounts",
      };
    case "ACCOUNT_LIMIT_REACHED":
      // 上限1件ならアップグレード、最上位の上限（5件）なら不要なAccountの削除を案内する（FR-017）
      if ((ctx.max ?? 1) <= 1) {
        return {
          message:
            "現在のプランで登録できるAccount数（1件）に達しています。プラン3にすると最大5件まで登録できます。",
          action: "plan-guidance",
        };
      }
      return {
        message: `登録できるAccount数の上限（${ctx.max}件）に達しています。新しく追加するには、使っていないAccountを削除してください。`,
        action: "delete-account",
      };
    case "THREADS_AUTH_CANCELLED":
      return { message: "Threadsとの接続がキャンセルされました。", action: "retry-connect" };
    case "THREADS_AUTH_FAILED":
      return { message: "Threadsとの接続に失敗しました。時間をおいてもう一度お試しください。", action: "retry-connect" };
    case "THREADS_PROFILE_FETCH_FAILED":
      return {
        message: "Threadsアカウントの情報を取得できませんでした。もう一度お試しください。",
        action: "retry-connect",
      };
    case "THREADS_ACCOUNT_TAKEN":
      return { message: "このThreadsアカウントは別のユーザーが登録済みです。", action: "retry-connect" };
    case "RECONNECT_ACCOUNT_MISMATCH":
      return {
        message: `再接続には、元の@${ctx.username ?? ""}で認可してください。別のアカウントで認可されました。`,
        action: "retry-connect",
      };
    case "ACCOUNT_DELETED_DURING_CONNECT":
      return {
        message: "接続の途中でAccountが削除されたため、接続を中止しました。接続する場合は、もう一度お試しください。",
        action: "retry-connect",
      };
    case "THREADS_AUTH_REVOKED":
      return {
        message: "Threadsとの連携が解除されたため、接続を中止しました。接続する場合は、もう一度お試しください。",
        action: "retry-connect",
      };
    case "THREADS_DATA_DELETION_REQUESTED":
      return {
        message:
          "このThreadsアカウントのデータ削除の要求を処理しているため、接続を中止しました。削除が完了してから、もう一度お試しください（通常は1日以内に完了します）。",
        action: "retry-later",
      };
    case "OAUTH_STATE_INVALID":
      return { message: "接続の有効期限が切れました。最初からやり直してください。", action: "retry-connect" };
    case "CONFIRMATION_MISMATCH":
      return { message: "入力したユーザー名が一致しません。", action: "retype" };
    case "VALIDATION_FAILED":
      return { message: "入力内容を確認してください。", action: "none" };
    case "STALE_UPDATE":
      return { message: "別のタブや端末で先に保存されています。", action: "none" };
    case "ITEM_NOT_FOUND":
      return { message: "この項目は、別のタブや端末で削除されています。", action: "reload" };
    case "ITEM_LIMIT_REACHED":
      return { message: "登録できる上限に達しています。不要なものを削除してから追加してください。", action: "none" };
    case "KEYWORD_DUPLICATE":
      return { message: "同じキーワードがすでに登録されています。", action: "retype" };
    case "GROWER_FEATURE_REQUIRED":
      return {
        message: "この機能はプラン2以上で使えます。保存済みの内容はそのまま残っています。",
        action: "plan-guidance",
      };
    case "CONFIG_ERROR":
      return {
        message: `サーバーの設定に誤りがあります${ctx.details?.length ? `（${ctx.details.join("、")}）` : ""}。開発環境では apps/api/.dev.vars を確認し、APIを起動し直してください。`,
        action: "reload",
      };
    case "API_UNREACHABLE":
      return {
        message: `APIに接続できませんでした${ctx.apiUrl ? `（${ctx.apiUrl}）` : ""}。APIが起動しているか、apps/web/.env.local の VITE_API_BASE_URL と apps/api/.dev.vars の WEB_ORIGIN が正しいかを確認してください。`,
        action: "reload",
      };
    case "INTERNAL_ERROR":
      return { message: "エラーが発生しました。時間をおいてもう一度お試しください。", action: "none" };
  }
}

/** Googleでのログインに失敗したときの文言。 */
export const GOOGLE_SIGN_IN_FAILED_MESSAGE = "Googleでのログインに失敗しました。もう一度お試しください。";

/** アカウント追加画面に常に出す、テスター制限の案内（research.md R3）。 */
export const TESTER_NOTICE =
  "現在は検証期間中のため、招待されたThreadsアカウントのみ接続できます。接続できない場合は運営者にお問い合わせください。";

/** 要再接続のAccountの画面の上部に出すバナーの文言（FR-019）。 */
export const NEEDS_RECONNECT_BANNER =
  "Threadsとの接続が切れています。再接続するまで、このAccountの自動処理は止まります。";

/** 上限到達時に添える、既存Accountを認可し直す方法の案内。 */
export const RECONNECT_FROM_SETTINGS_HINT =
  "登録済みのAccountの接続を更新したい場合は、そのAccountの設定画面から認可し直せます。";

/**
 * Threadsの接続に成功したときの文言（contracts/ui-routes.md「callbackの結果表示」）。
 * @param kind - new（新規）、updated（既存を更新）、reconnect（再接続）
 * @param username - Threadsのユーザー名（@なし）
 * @returns 画面に出す文言
 */
export function connectedMessage(kind: "new" | "updated" | "reconnect", username: string): string {
  switch (kind) {
    case "new":
      return `@${username} を追加しました`;
    case "updated":
      return `@${username} はすでに登録済みのため、接続情報を更新しました`;
    case "reconnect":
      return `@${username} を再接続しました`;
  }
}
