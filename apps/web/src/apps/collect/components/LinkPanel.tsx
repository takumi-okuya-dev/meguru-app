// リンクとQR（主催者）。受付の手伝いの受付用リンク（001 FR-070〜FR-073）と、セルフ受付のリンク（002 FR-001〜FR-003）で同じものを使う。
// 出す・QRとコピー・期限を変える・止める・出し直す。
import type { ReceptionLink } from "@meguru/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatJstShort } from "@/lib/format";
import { collectErrorText } from "../lib/errors";
import { QrCode } from "./QrCode";

/** リンクの呼び出し。 */
export type LinkApi = {
  get: () => Promise<{ link: ReceptionLink | null }>;
  create: () => Promise<{ link: ReceptionLink | null }>;
  update: (expiresAt: string) => Promise<{ link: ReceptionLink | null }>;
  stop: () => Promise<{ link: ReceptionLink | null }>;
};

/** 画面ごとの言葉。 */
export type LinkTexts = {
  createLabel: string;
  stopTitle: string;
  stopBody: string;
  stopped: string;
  reissueTitle: string;
  reissueBody: string;
};

/**
 * ISO の時刻を、datetime-local の欄の値（この端末の時刻）にする。
 * @param iso - ISO 8601
 * @returns 「2026-11-20T23:59」
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * リンクとQR。
 * @param props - queryKey：リンクのキー、api：呼び出し、texts：言葉、children：リンクを出す前の説明
 * @returns パネル
 */
export function LinkPanel({ queryKey, api, texts, children }: { queryKey: readonly unknown[]; api: LinkApi; texts: LinkTexts; children?: ReactNode }) {
  const queryClient = useQueryClient();
  const link = useQuery({ queryKey, queryFn: api.get });
  const [expiry, setExpiry] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"stop" | "reissue" | null>(null);

  const setLink = (value: { link: ReceptionLink | null }) => queryClient.setQueryData(queryKey, value);
  const create = useMutation({ mutationFn: api.create, onSuccess: setLink, onError: (e) => toast.error(collectErrorText(e)) });
  const update = useMutation({
    mutationFn: api.update,
    onSuccess: (v) => {
      setLink(v);
      setExpiry(null);
      toast.success("期限を変えました。");
    },
    onError: (e) => toast.error(collectErrorText(e)),
  });
  const stop = useMutation({
    mutationFn: async (reissue: boolean) => {
      await api.stop();
      return reissue ? api.create() : { link: null };
    },
    onSuccess: (v, reissue) => {
      setLink(v);
      setConfirm(null);
      toast.success(reissue ? "新しいリンクを出しました。前のリンクとQRは使えません。" : texts.stopped);
    },
    onError: (e) => toast.error(collectErrorText(e)),
  });

  if (link.isPending) return <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy="true" />;
  if (link.isLoadingError) return <ApiErrorScreen error={link.error} onRetry={() => void link.refetch()} />;
  const current = link.data.link;
  const expired = current !== null && new Date(current.expiresAt).getTime() <= Date.now();

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("リンクをコピーしました。");
    } catch {
      toast.error("コピーできませんでした。リンクを長押しして選んでください。");
    }
  };

  return (
    <>
      {children}
      {current === null ? (
        <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}>
          {texts.createLabel}
        </Button>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <QrCode value={current.url} />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-xs select-all">{current.url}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => void copy(current.url)}>
                <CopyIcon className="size-4" /> コピー
              </Button>
            </div>
            <div className="space-y-1.5">
              <div className="text-sm">
                期限：{formatJstShort(current.expiresAt)}
                {expired && <span className="ml-2 text-destructive">（期限が過ぎました。出し直してください）</span>}
              </div>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (expiry) update.mutate(new Date(expiry).toISOString());
                }}
              >
                <Input
                  type="datetime-local"
                  aria-label="期限"
                  className="w-auto"
                  value={expiry ?? toLocalInput(current.expiresAt)}
                  onChange={(e) => setExpiry(e.target.value)}
                />
                <Button type="submit" variant="outline" size="sm" disabled={!expiry || update.isPending}>
                  期限を変える
                </Button>
              </form>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("reissue")}>
                出し直す
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirm("stop")}>
                止める
              </Button>
            </div>
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm === "stop" ? texts.stopTitle : texts.reissueTitle}
          confirmLabel={confirm === "stop" ? "止める" : "出し直す"}
          destructive={confirm === "stop"}
          pending={stop.isPending}
          onConfirm={() => stop.mutate(confirm === "reissue")}
          onCancel={() => setConfirm(null)}
        >
          <p>{confirm === "stop" ? texts.stopBody : texts.reissueBody}</p>
        </ConfirmDialog>
      )}
    </>
  );
}
