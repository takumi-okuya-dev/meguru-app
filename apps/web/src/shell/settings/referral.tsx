// 設定 > 紹介（specs/017-referral-links contracts/ui-routes.md 2、FR-002・FR-007）。
// 本人の紹介リンクと、紹介で登録した人数だけを出す。紹介された人が誰かは出さない。特典はない。
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/guards";
import { SettingCard } from "@/components/settings/SettingRow";
import { SwapLabel } from "@/components/SwapLabel";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/**
 * 設定 > 紹介。
 * @returns 紹介の設定
 */
export function ReferralSettingsPage() {
  const referral = useQuery({ queryKey: queryKeys.referral, queryFn: api.referral });
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  if (referral.isPending) return <LoadingSkeleton />;
  if (referral.isError) return <ApiErrorScreen error={referral.error} onRetry={() => void referral.refetch()} />;
  const { url, referredCount } = referral.data;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // コピーできない環境では、入力欄を選択して手でコピーしてもらう
      setCopied(false);
      urlRef.current?.select();
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold max-md:hidden">紹介</h1>
      <p className="text-sm text-muted-foreground">
        このリンクから登録した人の数がわかります。紹介した人・された人への特典はありません。
      </p>
      <SettingCard>
        <div className="space-y-2 p-4">
          <h2 className="text-sm font-medium">紹介リンク</h2>
          <div className="flex flex-wrap gap-2">
            <input
              ref={urlRef}
              readOnly
              value={url}
              aria-label="紹介リンク"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
            />
            <Button variant="outline" onClick={() => void copy()}>
              <SwapLabel labels={{ idle: "コピー", done: "コピーしました" }} show={copied ? "done" : "idle"} />
            </Button>
          </div>
        </div>
      </SettingCard>
      <p className="text-sm">あなたの紹介で登録した人：{referredCount}人</p>
    </div>
  );
}
