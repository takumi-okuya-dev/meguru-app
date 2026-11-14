// 環境の帯と印（specs/015-deploy-environments FR-040・FR-041、contracts/ui-routes.md 1）。
// 本番以外（テスト環境・手元）で、最初の画面（ログインなど）と読みもののページには帯を、
// アプリの画面ではサイドバーのユーザー名の横に短い印を出す（帯がずっと出ていると見にくいため。2026-10-31）。
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

/** 環境ごとの短い印。production は出さない。 */
const BADGE: Record<string, string> = {
  staging: "テスト版",
  development: "開発版",
};

/**
 * 環境の短い印（アプリの画面で、サイドバーのユーザー名の横に出す）。`VITE_APP_ENV`が`production`のときだけ出さない。
 * 知らない値・未設定のときは、帯と同じく黙って本番の見た目にせず、テスト版の印を出す。
 * @returns 印（本番では null）
 */
export function EnvBadge() {
  const appEnv = import.meta.env.VITE_APP_ENV;
  if (appEnv === "production") return null;
  const text = BADGE[appEnv] ?? BADGE.staging;
  return (
    <span className="shrink-0 rounded-md border border-warning/40 bg-warning-bg px-1.5 py-0.5 text-xs leading-none text-foreground">
      {text}
    </span>
  );
}
