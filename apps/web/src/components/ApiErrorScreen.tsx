// API の呼び出しに失敗したとき、読み込み中のまま止めずに案内と再読み込みを出す
import { ErrorScreen } from "@/components/ErrorScreen";
import { LoadingSkeleton } from "@/components/guards";
import { ApiError, describeError } from "@/lib/api-client";

const TITLES: Partial<Record<string, string>> = {
  CONFIG_ERROR: "サーバーの設定に誤りがあります",
  API_UNREACHABLE: "APIに接続できません",
};

export function ApiErrorScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // セッション切れは、APIクライアントがログイン画面へ移すので、ここでは何も出さない
  if (error instanceof ApiError && error.code === "AUTH_REQUIRED") return <LoadingSkeleton />;
  const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
  return (
    <ErrorScreen
      title={TITLES[code] ?? "読み込めませんでした"}
      message={describeError(error)}
      onRetry={onRetry}
    />
  );
}
