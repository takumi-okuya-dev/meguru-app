// 設定の誤りや接続の失敗を、読み込み中のまま止めずに案内する画面
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function ErrorScreen({
  title,
  message,
  hints,
  onRetry,
}: {
  title: string;
  message: ReactNode;
  hints?: ReactNode[];
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-10" role="alert">
      <div className="w-full max-w-lg space-y-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm">{message}</p>
        {hints && hints.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        )}
        <Button onClick={onRetry ?? (() => window.location.reload())}>再読み込み</Button>
      </div>
    </div>
  );
}

/** Clerk の Publishable key が未設定・見本の値のとき */
export function ClerkKeyMissingScreen() {
  return (
    <ErrorScreen
      title="Clerkのキーが設定されていません"
      message={
        <>
          <code>apps/web/.env.local</code> の <code>VITE_CLERK_PUBLISHABLE_KEY</code> に、ClerkのPublishable
          key（<code>pk_test_…</code>）を入れてください。
        </>
      }
      hints={[
        <>キーは、Clerkのダッシュボードの「API keys」にあります（docs/external-services-setup.md の「2. Clerk」）。</>,
        <>書き換えた後は、開発サーバー（<code>pnpm dev</code> など）を止めて起動し直してください。</>,
      ]}
    />
  );
}

/** Clerk の読み込みが一定時間終わらないとき */
export function ClerkLoadFailedScreen() {
  return (
    <ErrorScreen
      title="ログインの仕組みを読み込めませんでした"
      message="Clerk（ログインのサービス）の読み込みが終わりません。次の点を確認してから、再読み込みしてください。"
      hints={[
        <>インターネットに接続できているか</>,
        <>
          <code>apps/web/.env.local</code> の <code>VITE_CLERK_PUBLISHABLE_KEY</code> が、ClerkのダッシュボードのPublishable
          keyと一致しているか
        </>,
        <>エディタに内蔵のブラウザで開いている場合は、ChromeやSafariで開き直す</>,
      ]}
    />
  );
}
