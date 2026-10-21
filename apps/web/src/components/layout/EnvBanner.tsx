// 環境の帯（specs/015-deploy-environments FR-040・FR-041、contracts/ui-routes.md 1）。
// 本番以外（テスト環境・手元）で、画面のいちばん上に出す。閉じられない。
// 画面に出す言葉は「テスト環境」。文書では「ステージング」と書くが、利用者はブランチの名前を知らないため。
import { Alert, AlertDescription } from "@/components/ui/alert";

/** 環境ごとの文言。production は帯を出さない。 */
const TEXT: Record<string, string> = {
  staging: "テスト環境です。本番のデータではありません。ここでの投稿は、つないだThreadsアカウントに実際に投稿されます",
  development: "開発環境です（手元）",
};

/**
 * 環境の帯。`VITE_APP_ENV`が`production`のときだけ出さない。
 * 知らない値・未設定のときは、黙って本番の見た目にせず、テスト環境の文言を出す。
 * @returns 帯（本番では null）
 */
export function EnvBanner() {
  const appEnv = import.meta.env.VITE_APP_ENV;
  if (appEnv === "production") return null;
  const text = TEXT[appEnv] ?? TEXT.staging;
  return (
    <Alert
      variant="warning"
      role="status"
      className="flex flex-col gap-3 rounded-none border-x-0 border-t-0 px-4 sm:flex-row sm:items-center sm:justify-between md:px-5"
    >
      <AlertDescription className="text-foreground">{text}</AlertDescription>
    </Alert>
  );
}
