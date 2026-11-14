// API の呼び出しに失敗したとき、読み込み中のまま止めずに案内と再読み込みを出す
import { ErrorScreen } from "@/components/ErrorScreen";
import { FeatureUnavailableNotice } from "@/components/FeatureUnavailableNotice";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { ApiError, describeError } from "@/lib/api-client";

const TITLES: Partial<Record<string, string>> = {
  CONFIG_ERROR: "サーバーの設定に誤りがあります",
  API_UNREACHABLE: "APIに接続できません",
};

/**
 * API の呼び出しに失敗したとき、読み込み中のまま止めずに案内と再読み込みを出す。
 * セッション切れ（AUTH_REQUIRED）は API クライアントがログイン画面へ移すので、骨組みだけを出す。
 * @param props - error：API の呼び出しの失敗、onRetry：再読み込みのときに呼ぶ処理
 * @returns エラーの案内の画面
 */
export function ApiErrorScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // セッション切れは、APIクライアントがログイン画面へ移すので、ここでは何も出さない
  if (error instanceof ApiError && error.code === "AUTH_REQUIRED") return <LoadingSkeleton />;
  // 機能のまとまりがOFF（開いている間にOFFにされた）なら、再読み込みではなく使えない機能の画面（specs/019 FR-006）
  if (error instanceof ApiError && error.code === "FEATURE_DISABLED") return <FeatureUnavailableNotice />;
  const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
  return (
    <ErrorScreen
      title={TITLES[code] ?? "読み込めませんでした"}
      message={describeError(error)}
      onRetry={onRetry}
    />
  );
}
