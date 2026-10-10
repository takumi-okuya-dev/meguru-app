// 招待リンクのダイアログ（specs/008-team-operations contracts/ui-routes.md「招待のダイアログ」、research.md R6）。
// パートナーの招待と編集者の招待で共用する。PCは中央のダイアログ、767px以下は全画面のシート。
import { CopyIcon, ShareIcon, XIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { QrCode } from "./QrCode";

/**
 * 招待リンクのダイアログ。
 * @param props - title：見出し、description：本文、url：招待リンク（読み込み中はNULL）、qrNote：QRコードの横の説明、
 *   children：できること等の説明、onRotate：作り直す、rotating：作り直し中、onClose：閉じる、
 *   loadFailed：リンクの読み込みに失敗した、onRetry：読み込み直す（読み込み中と失敗を分ける。PR #9 のCodexレビュー）
 * @returns ダイアログ
 */
export function InviteLinkDialog({
  title,
  description,
  url,
  qrNote,
  children,
  onRotate,
  rotating = false,
  onClose,
  loadFailed = false,
  onRetry,
}: {
  title: string;
  description: string;
  url: string | null;
  qrNote: string;
  children?: ReactNode;
  onRotate: () => void;
  rotating?: boolean;
  onClose: () => void;
  loadFailed?: boolean;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // コピーできない環境では、入力欄を選択して手でコピーしてもらう
      inputRef.current?.select();
    }
  };

  const share = async () => {
    if (!url) return;
    try {
      await navigator.share({ title, text: description, url });
    } catch {
      // 共有をやめた・使えない場合は何もしない
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent mobileFullScreen showClose={false} className="gap-0 p-0 sm:max-w-xl" aria-describedby="invite-desc">
        <div className="flex h-[52px] shrink-0 items-center gap-1 border-b px-1.5 md:h-auto md:border-0 md:px-6 md:pt-5 md:pb-2">
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-lg hover:bg-accent md:order-last md:-mr-2 md:size-9"
          >
            <XIcon className="size-5" />
          </button>
          <DialogTitle className="flex-1 truncate text-base font-semibold md:text-[17px]">{title}</DialogTitle>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 md:max-h-[70vh] md:px-6 md:py-3">
          <DialogDescription id="invite-desc" className="text-sm text-foreground/80">
            {description}
          </DialogDescription>
          <div className="space-y-2">
            <label htmlFor="invite-link" className="text-sm font-medium">
              招待リンク
            </label>
            {!url && loadFailed ? (
              <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-sm">
                <span className="flex-1">招待リンクを読み込めませんでした。</span>
                {onRetry && (
                  <Button variant="outline" size="sm" className="rounded-full" onClick={onRetry}>
                    再読み込み
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input
                  id="invite-link"
                  ref={inputRef}
                  readOnly
                  value={url ?? "作っています…"}
                  className="h-11 min-w-0 flex-1 rounded-xl border bg-muted/40 px-3 text-base md:text-sm"
                  onFocus={(e) => e.currentTarget.select()}
                />
                {canShare && (
                  <Button className="h-11 rounded-full" disabled={!url} onClick={() => void share()}>
                    <ShareIcon className="size-4" />
                    送る
                  </Button>
                )}
                <Button
                  variant={canShare ? "outline" : "default"}
                  className="h-11 rounded-full"
                  disabled={!url}
                  onClick={() => void copy()}
                >
                  <CopyIcon className="size-4" />
                  {copied ? "コピーしました" : "コピー"}
                </Button>
              </div>
            )}
          </div>
          {url && (
            <div className="flex items-center gap-4">
              <QrCode value={url} size={112} />
              <p className="text-xs text-muted-foreground">{qrNote}</p>
            </div>
          )}
          {children}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 md:border-0 md:px-6 md:pb-5">
          <Button
            variant="link"
            className="h-10 px-0 text-foreground underline"
            disabled={!url || rotating}
            onClick={() => {
              setCopied(false);
              onRotate();
            }}
          >
            リンクを作り直す
          </Button>
          <Button variant="outline" className="h-10 rounded-full" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
