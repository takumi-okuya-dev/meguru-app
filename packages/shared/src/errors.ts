// エラーコードと、画面に出す日本語の文言（contracts/ui-routes.md「エラー文言」）。
// APIは code だけを返し、Webがここから文言を引く。
import { TEAM_EDITOR_LIMIT, TEAM_MEMBER_LIMIT, TEAMS_PER_ADMIN } from "./limits";

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
  "PASTE_TOO_LARGE",
  "DRAFT_PUBLISHING",
  "THREADS_NOT_READY",
  // チーム運用（specs/008-team-operations・specs/011-team-revision contracts/api.md「新しいエラーコード」）
  "ROLE_FORBIDDEN",
  "INVITE_INVALID",
  "INVITE_ALREADY_MEMBER",
  "ASSIGNMENT_NOT_ALLOWED",
  "TEAM_NOT_FOUND",
  "TEAM_LIMIT_REACHED",
  "TEAM_FULL",
  "TEAM_NEEDS_ACCOUNT",
  "ACCOUNT_IN_OTHER_TEAM",
  "TEAM_LAST_ACCOUNT",
  "TEAM_ADMIN_MUST_TRANSFER",
  "TEAM_ADMIN_ALONE",
  // 自分のMetaアプリのトークンでの接続（specs/010-token-account-add contracts/api.md）
  "TOKEN_INVALID",
  "TOKEN_SHORT_LIVED",
  "TOKEN_CHECK_LOCKED",
  "ACCOUNT_ALREADY_REGISTERED",
  // アカウントを先に作る（specs/012-accounts-before-connect contracts/api.md）
  "ACCOUNT_NOT_CONNECTED",
  "ACCOUNT_ALREADY_CONNECTED",
  "THREADS_UNAVAILABLE",
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
  /** TOKEN_CHECK_LOCKED で使う、待ちの残り（分） */
  minutes?: number;
  /** RECONNECT_ACCOUNT_MISMATCH で、トークンを貼り付けたときは "token"（文言を変える。specs/010） */
  method?: "app" | "token";
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
      if (ctx.method === "token") {
        return {
          message: `別のThreadsアカウントのトークンです。@${ctx.username ?? ""}のトークンを貼り付けてください。`,
          action: "retype",
        };
      }
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
    case "PASTE_TOO_LARGE":
      return {
        message: "一度に登録できるのは50件・50,000文字まで、1件は2,000文字までです。分けて貼り付けてください。",
        action: "none",
      };
    case "DRAFT_PUBLISHING":
      return { message: "投稿の処理中です。少し待ってからもう一度お試しください。", action: "reload" };
    case "THREADS_NOT_READY":
      if (ctx.details?.[0] === "not_connected") return { message: THREADS_CHECK_MESSAGES.not_connected, action: "none" };
      return ctx.details?.[0] === "needs_reconnect"
        ? { message: THREADS_CHECK_MESSAGES.needs_reconnect, action: "retry-connect" }
        : { message: THREADS_CHECK_MESSAGES.no_publish_permission, action: "retry-connect" };
    case "GROWER_FEATURE_REQUIRED":
      return {
        message: "この機能はプラン2以上で使えます。保存済みの内容はそのまま残っています。",
        action: "plan-guidance",
      };
    case "ROLE_FORBIDDEN":
      return { message: ROLE_FORBIDDEN_MESSAGE, action: "reload" };
    case "INVITE_INVALID":
      return {
        message: "このリンクは使えません。作り直されたか、チームが削除されました。管理者に、新しいリンクを頼んでください。",
        action: "none",
      };
    case "INVITE_ALREADY_MEMBER":
      return { message: "すでにこのチームに入っています。", action: "none" };
    case "ASSIGNMENT_NOT_ALLOWED":
      return { message: "このアカウントは担当にできません。", action: "reload" };
    case "TEAM_NOT_FOUND":
      return { message: "チームが見つかりません。", action: "back-to-accounts" };
    case "TEAM_LIMIT_REACHED":
      return { message: `1人が管理者になれるチームは${TEAMS_PER_ADMIN}までです。`, action: "none" };
    case "TEAM_FULL":
      return ctx.details?.[0] === "editors"
        ? { message: `編集者が上限（${TEAM_EDITOR_LIMIT}人）に達しています。`, action: "none" }
        : { message: `このチームは上限（${TEAM_MEMBER_LIMIT}人）に達しています。管理者に相談してください。`, action: "none" };
    case "TEAM_NEEDS_ACCOUNT":
      return { message: "チームに入れる自分のアカウントを、1つ以上選んでください。", action: "none" };
    case "ACCOUNT_IN_OTHER_TEAM":
      return { message: "選んだアカウントは、ほかのチームに入っています。", action: "reload" };
    case "TEAM_LAST_ACCOUNT":
      return {
        message: "最後のアカウントは、チームから外せません。チームを抜けるときは「チームを抜ける」を使ってください。",
        action: "none",
      };
    case "TEAM_ADMIN_MUST_TRANSFER":
      return { message: "抜ける前に、管理者を引き継ぐ人を選んでください。", action: "none" };
    case "TEAM_ADMIN_ALONE":
      return { message: "チームにはあなたしかいません。抜けるときは、チームを削除してください。", action: "none" };
    case "TOKEN_INVALID":
      return { message: "トークンを確かめられませんでした。トークンを作り直して貼り付けてください。", action: "retype" };
    case "TOKEN_SHORT_LIVED":
      return {
        message: "短期のトークンのようです。ユーザートークン生成ツールで作った長期トークンを貼り付けてください。",
        action: "retype",
      };
    case "TOKEN_CHECK_LOCKED":
      return {
        message: `しばらく待ってから、もう一度お試しください（あと${Math.max(1, ctx.minutes ?? 1)}分）。`,
        action: "retry-later",
      };
    case "ACCOUNT_ALREADY_REGISTERED":
      // 自分の別のアカウントと重なったときは、その名前を出す（details: [id, name, username]。specs/012 contracts/api.md）
      if (ctx.details?.[1] && ctx.details[2]) {
        return { message: `@${ctx.details[2]}は、あなたのアカウント『${ctx.details[1]}』につながっています。`, action: "none" };
      }
      return {
        message:
          "このアカウントはすでに登録されています。接続を更新するときは、そのアカウントの設定の「接続し直す」を使ってください。",
        action: "none",
      };
    case "ACCOUNT_NOT_CONNECTED":
      return {
        message: "このアカウントは、まだThreadsにつながっていません。「このアカウントの設定」からつないでください。",
        action: "none",
      };
    case "ACCOUNT_ALREADY_CONNECTED":
      return { message: "このアカウントは、すでにThreadsにつながっています。", action: "reload" };
    case "THREADS_UNAVAILABLE":
      return { message: "Threadsに接続できませんでした。時間をおいて、もう一度お試しください。", action: "retry-later" };
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

/** ロールが変わったなどで、権限のない操作をしたときの文言（specs/011 FR-060）。 */
export const ROLE_FORBIDDEN_MESSAGE = "この操作はできません。ロールや担当が変わった可能性があります";

/** 開いていたAccountを開けなくなったときの文言（FR-046）。 */
export const ACCOUNT_ACCESS_LOST_MESSAGE = "このアカウントを開けなくなりました";

/**
 * 保存の衝突のときの見出し（FR-007、research.md R8）。先に保存した人の名前があれば添える。
 * @param name - 先に保存した人の名前（不明ならNULL）
 * @returns 見出しの文言
 */
export function staleUpdateTitle(name: string | null | undefined): string {
  return name ? `${name}さんが先に保存しました` : "他の場所で更新されています";
}

/** Googleでのログインに失敗したときの文言。 */
export const GOOGLE_SIGN_IN_FAILED_MESSAGE = "Googleでのログインに失敗しました。もう一度お試しください。";

/** アカウント追加画面に常に出す、テスター制限の案内（research.md R3）。 */
export const TESTER_NOTICE =
  "現在は検証期間中のため、招待されたThreadsアカウントのみ接続できます。接続できない場合は運営者にお問い合わせください。";

/** 要再接続のAccountの画面の上部に出すバナーの文言（FR-019）。 */
export const NEEDS_RECONNECT_BANNER =
  "Threadsとの接続が切れています。再接続するまで、このAccountの自動処理は止まります。";

/** トークンで接続したAccountが要再接続になったときの、オーナー向けのバナーの文言（specs/010 FR-041）。 */
export const NEEDS_RECONNECT_BANNER_TOKEN = "トークンが使えなくなりました。新しいトークンを貼り付けて接続し直してください。";

/** 2時間後の確かめ直しで使えなかったときに添える文（specs/010 FR-012、reconnect_hint = short_lived_token）。 */
export const SHORT_LIVED_TOKEN_HINT =
  "短期トークンだった可能性があります。ユーザートークン生成ツールで作った長期トークンを貼り付けてください。";

/** 要再接続のAccountを、パートナー・編集者が開いたときのバナーの文言（specs/008 FR-044）。再接続はオーナーだけができる。 */
export const NEEDS_RECONNECT_BANNER_HELPER =
  "Threadsとの接続が切れています。オーナーの再接続を待っています。再接続するまで、このAccountの自動処理は止まります。";

/** 上限到達時に添える、既存Accountを認可し直す方法の案内。 */
export const RECONNECT_FROM_SETTINGS_HINT =
  "登録済みのAccountの接続を更新したい場合は、そのAccountの設定画面から認可し直せます。";

/**
 * callback の connected の文言。名前はアカウントの名前（specs/012 research.md R2）。
 * @param kind - connect（はじめてつないだ）・reconnect（接続し直した）
 * @param name - アカウントの名前
 * @returns 文言
 */
export function connectedMessage(kind: "connect" | "reconnect", name: string): string {
  return kind === "connect" ? `${name}をThreadsにつなぎました` : `${name}を再接続しました`;
}

// ---- 自動投稿（specs/005-auto-post contracts/ui-routes.md）----

/** 投稿に失敗した理由の文言（PublishError のコードから）。 */
export const PUBLISH_ERROR_LABELS = {
  network: "Threadsとの通信に失敗しました",
  threads_server: "Threads側でエラーが起きました",
  invalid_request: "Threadsが投稿を受け付けませんでした。本文を確かめてください",
  container_error: "Threadsでの投稿の処理に失敗しました",
  unknown: "投稿に失敗しました",
} as const;

/** 投稿の権限の確認の結果の文言（FR-002a・FR-002b）。ok は件数を埋め込むので threadsCheckOkMessage を使う。 */
export const THREADS_CHECK_MESSAGES = {
  needs_reconnect: "Threadsとの接続が切れています。再接続してください",
  not_connected: "Threadsにつなぐと使えます",
  no_publish_permission: "Threadsへの投稿の権限がありません。再接続して、投稿の許可をオンにしてください",
  unknown: "Threadsとの接続を確認できませんでした。時間をおいてもう一度お試しください",
} as const;

/**
 * 投稿の権限の確認で、投稿できる状態だったときの文言。
 * @param quotaUsage - 直近24時間の投稿数
 * @param quotaTotal - 上限（250）
 * @returns 文言
 */
export function threadsCheckOkMessage(quotaUsage: number, quotaTotal: number): string {
  return `投稿できる状態です（直近24時間の投稿 ${quotaUsage}/${quotaTotal}件）`;
}

/**
 * 投稿の直前のチェックで要確認に戻した理由の文言（FR-007、US2 シナリオ2）。
 * @param reason - ng_word か over_threads_limit
 * @param words - 当たったNGワード
 * @returns 「NGワード（絶対、必ず）」など
 */
export function blockedReasonLabel(reason: "ng_word" | "over_threads_limit", words: string[]): string {
  return reason === "ng_word" ? `NGワード（${words.join("、")}）` : "Threadsの上限を超える本文";
}

/** 深夜の時刻の案内（FR-001b）。設定は止めない。 */
export const LATE_NIGHT_HINT = "深夜の時間帯です。見られにくい可能性があります";

/** パフォーマンスの画面の文言（specs/006-performance-feedback contracts/ui-routes.md）。 */
export const PERFORMANCE_MESSAGES = {
  insightsDenied: "反応数を読む許可がありません。再接続して、インサイトの許可をオンにしてください",
  unmeasurable:
    "Threadsでこの投稿を見つけられないため、反応数を取れません。Threads側で消した投稿などが当たります。判定と基準値には含めません。",
  growerRequiredTitle: "パフォーマンス分析は有料の契約で使えます",
  growerRequiredBody:
    "無料体験が終わりました。契約すると、投稿ごとの反応数・伸びたかどうかの判定・改善メモ・CSVの書き出しを使えます。これまでの記録は残っているので、契約すると続きから見られます。",
  feedbackSaveFailed: "保存できませんでした。もう一度お試しください",
  exportFailed: "書き出せませんでした。もう一度お試しください",
} as const;
