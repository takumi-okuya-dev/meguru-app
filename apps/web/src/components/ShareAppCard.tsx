// ホームの「アプリを紹介する」（specs/017-referral-links contracts/ui-routes.md 4）。
// 設定 › 紹介 と同じ本人の紹介リンクを、共有かコピーで渡せるようにする。人数は設定 › 紹介 で見る。
import { useQuery } from "@tanstack/react-query";
import { Share2Icon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/**
 * ホームの「アプリを紹介する」のカード。紹介リンクを読めなければ何も出さない（ホームの本筋ではないため）。
 * @returns カード
 */
export function ShareAppCard() {
  // リンクは変わらないので、開くたびに読み直さない
  const referral = useQuery({ queryKey: queryKeys.referral, queryFn: api.referral, staleTime: Infinity });
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  if (referral.isError) return null;
  const url = referral.data?.url;

  // 共有・コピーは押した直後に呼ぶ（読み込みを待つと、Safari では押した操作と見なされず失敗する）
  const share = async () => {
    if (!url) return;
    try {
      await navigator.share({ title: "ThreadsGrower", text: "Threadsの投稿づくりから自動投稿までを手伝うアプリです。", url });
    } catch {
      // 共有をやめた・使えない場合は何もしない
    }
  };
  const copyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  return (
    <section aria-labelledby="share-app-title" className="w-full rounded-2xl border bg-card px-4 py-3 md:py-4">
      <div className="flex items-start gap-3.5">
        <Share2Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="flex-1 space-y-0.5 leading-snug">
          <h2 id="share-app-title" className="font-semibold">
            アプリを紹介する
          </h2>
          <p className="text-[13px] text-muted-foreground">リンクを送って、ThreadsGrowerを勧められます。</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-[34px]">
        {canShare && (
          <Button size="sm" className="rounded-full" disabled={!url} onClick={() => void share()}>
            共有する
          </Button>
        )}
        <Button size="sm" variant="outline" className="rounded-full" disabled={!url} onClick={() => void copyUrl()}>
          {copy === "copied" ? "コピーしました" : "リンクをコピー"}
        </Button>
        <Link to="/settings/referral" className="text-[13px] text-muted-foreground underline-offset-4 hover:underline">
          紹介した人数を見る
        </Link>
      </div>
      {copy === "failed" && (
        <p role="alert" className="mt-2 pl-[34px] text-[13px] text-destructive">
          コピーできませんでした。「紹介した人数を見る」の画面から、リンクを選んでコピーしてください。
        </p>
      )}
    </section>
  );
}
