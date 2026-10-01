// エラーコードと、画面に出す日本語の文言（contracts/ui-routes.md「エラー文言」）。
// APIは code だけを返し、Webがここから文言を引く。

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
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

export type ErrorMessageContext = {
  /** RECONNECT_ACCOUNT_MISMATCH で使う、元のAccountのユーザー名（@なし） */
  username?: string;
  /** ACCOUNT_LIMIT_REACHED で使う、ユーザーの登録数上限 */
  max?: number;
};

export type NextAction =
  | "sign-in"
  | "back-to-accounts"
  | "plan-guidance"
  | "delete-account"
  | "retry-connect"
  | "retry-later"
  | "retype"
  | "none";

export type ErrorMessage = { message: string; action: NextAction };

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
    case "INTERNAL_ERROR":
      return { message: "エラーが発生しました。時間をおいてもう一度お試しください。", action: "none" };
  }
}

export const GOOGLE_SIGN_IN_FAILED_MESSAGE = "Googleでのログインに失敗しました。もう一度お試しください。";

export const TESTER_NOTICE =
  "現在は検証期間中のため、招待されたThreadsアカウントのみ接続できます。接続できない場合は運営者にお問い合わせください。";

export const NEEDS_RECONNECT_BANNER =
  "Threadsとの接続が切れています。再接続するまで、このAccountの自動処理は止まります。";

export const RECONNECT_FROM_SETTINGS_HINT =
  "登録済みのAccountの接続を更新したい場合は、そのAccountの設定画面から認可し直せます。";

/** callback 成功時の表示（contracts/ui-routes.md「callbackの結果表示」） */
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
