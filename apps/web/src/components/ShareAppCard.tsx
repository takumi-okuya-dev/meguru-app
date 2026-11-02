// ホームの「アプリを紹介する」（specs/017-referral-links contracts/ui-routes.md 4）。
// 設定 › 紹介 と同じ本人の紹介リンクを、共有かコピーで渡せるようにする。人数は設定 › 紹介 で見る。
import { useQuery } from "@tanstack/react-query";
import { Share2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/**
 * ホームの「アプリを紹介する」のカード。紹介リンクを読めるまで・読めなければ何も出さない（ホームの本筋ではないため）。
 * @returns カード
 */
export function ShareAppCard() {
  // リンクは変わらないので、ホームでは読み直さない（人数は、設定 › 紹介 を開いたときにそちらで読み直す）
  const referral = useQuery({ queryKey: queryKeys.referral, queryFn: api.referral, staleTime: Infinity });
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const urlRef = useRef<HTMLInputElement>(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  // コピーできなかったら、リンクを出して選んだ状態にし、手でコピーしてもらう
  useEffect(() => {
    if (copy !== "failed") return;
    urlRef.current?.focus();
    urlRef.current?.select();
  }, [copy]);
  if (!referral.data) return null;
  const { url } = referral.data;

  // 共有・コピーは押した直後に呼ぶ（読み込みを待つと、Safari では押した操作と見なされず失敗する）
  const share = async () => {
    try {
      await navigator.share({ title: "ThreadsGrower", text: "Threadsの投稿づくりから自動投稿までを手伝うアプリです。", url });
    } catch {
      // 共有をやめた・使えない場合は何もしない
    }
  };
  const copyUrl = async () => {
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
          <Button size="sm" className="rounded-full" onClick={() => void share()}>
            共有する
          </Button>
        )}
        <Button size="sm" variant="outline" className="rounded-full" onClick={() => void copyUrl()}>
          {copy === "copied" ? "コピーしました" : "リンクをコピー"}
        </Button>
        <Link to="/settings/referral" className="text-[13px] text-muted-foreground underline-offset-4 hover:underline">
          紹介した人数を見る
        </Link>
      </div>
      {copy === "failed" && (
        <div className="mt-2 space-y-1.5 pl-[34px]">
          <p role="alert" className="text-[13px] text-destructive">
            コピーできませんでした。下のリンクを選んでコピーしてください。
          </p>
          <input
            ref={urlRef}
            readOnly
            value={url}
            aria-label="紹介リンク"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          />
        </div>
      )}
    </section>
  );
}
