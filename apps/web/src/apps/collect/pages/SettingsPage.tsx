// PayPay・振込先の設定（/collect/settings。specs/collect/001-event-day-collection FR-013、research.md R10、tasks.md T031）。
// QRの画像は画面で縮めてから送る（長い辺1,000px以内・300KB以内）。振込先の案内は300文字まで。どのイベントでも使う。
import { COLLECT_LIMITS } from "@meguru/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUpIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageBody, PageHeader } from "@/shell";
import { collectApi } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { shrinkQrImage } from "../lib/image";
import { collectQueryKeys } from "../lib/query-keys";

/**
 * 保存してあるQRの画像を出す。
 * @returns 画像（読めなければ案内）
 */
function QrPreview() {
  const qr = useQuery({ queryKey: collectQueryKeys.paypayQr, queryFn: collectApi.paypayQr });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!qr.data) return;
    const u = URL.createObjectURL(qr.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [qr.data]);
  if (qr.isError) return <p className="text-sm text-muted-foreground">画像を読めませんでした。</p>;
  if (!url) return <div className="size-48 animate-pulse rounded-lg bg-muted" aria-busy="true" />;
  return <img src={url} alt="PayPayの受け取り用QR" className="size-48 rounded-lg border object-contain" />;
}

/**
 * PayPay・振込先の設定の画面。
 * @returns 画面
 */
export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: collectQueryKeys.settings, queryFn: collectApi.settings });
  const [bankText, setBankText] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const afterSave = (next: Awaited<ReturnType<typeof collectApi.settings>>) => {
    queryClient.setQueryData(collectQueryKeys.settings, next);
    void queryClient.invalidateQueries({ queryKey: collectQueryKeys.me });
  };
  const upload = useMutation({
    mutationFn: async (file: File) => collectApi.uploadPaypayQr(await shrinkQrImage(file)),
    onSuccess: (next) => {
      afterSave(next);
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.paypayQr });
      toast.success("QRの画像を保存しました。");
    },
    onError: (err) => toast.error(err instanceof Error && !("code" in err) ? `${err.message}。別の画像でお試しください。` : collectErrorText(err)),
  });
  const removeQr = useMutation({
    mutationFn: collectApi.deletePaypayQr,
    onSuccess: (next) => {
      afterSave(next);
      queryClient.removeQueries({ queryKey: collectQueryKeys.paypayQr });
      toast.success("QRの画像を消しました。");
    },
    onError: (err) => toast.error(collectErrorText(err)),
  });
  const saveBank = useMutation({
    mutationFn: (text: string) => collectApi.saveBankText(text.trim() || null),
    onSuccess: (next) => {
      afterSave(next);
      setBankText(null);
      toast.success("振込先の案内を保存しました。");
    },
    onError: (err) => toast.error(collectErrorText(err)),
  });
  if (settings.isPending) return <LoadingSkeleton />;
  if (settings.isLoadingError) return <ApiErrorScreen error={settings.error} onRetry={() => void settings.refetch()} />;
  const text = bankText ?? settings.data.bankText ?? "";
  const tooLong = [...text].length > COLLECT_LIMITS.bankText;
  return (
    <>
      <PageHeader title="PayPay・振込先の設定" />
      <PageBody className="space-y-8">
        <section className="space-y-3" aria-labelledby="qr-title">
          <h2 id="qr-title" className="font-medium">
            PayPayの受け取り用QR
          </h2>
          <p className="text-sm text-muted-foreground">受付でPayPayを選んだときに、大きく出します。PayPayアプリの「受け取る」のQRを画面写真に撮って選んでください。</p>
          {settings.data.hasPaypayQr && <QrPreview />}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            aria-label="QRの画像を選ぶ"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
              <ImageUpIcon className="size-4" /> {settings.data.hasPaypayQr ? "画像を変える" : "画像を選ぶ"}
            </Button>
            {settings.data.hasPaypayQr && (
              <Button type="button" variant="ghost" disabled={removeQr.isPending} onClick={() => removeQr.mutate()}>
                <Trash2Icon className="size-4" /> 消す
              </Button>
            )}
          </div>
        </section>
        <section className="space-y-3" aria-labelledby="bank-title">
          <h2 id="bank-title" className="font-medium">
            振込先の案内
          </h2>
          <p className="text-sm text-muted-foreground">振込を選んだ人への案内と、振込待ちの連絡文に入ります（銀行名・支店・口座の種類・番号・名義）。</p>
          <Textarea
            aria-label="振込先の案内"
            rows={4}
            value={text}
            placeholder="例：めぐる銀行 渋谷支店 普通 1234567 ヤマダタロウ"
            onChange={(e) => setBankText(e.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <span className={tooLong ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {[...text].length} / {COLLECT_LIMITS.bankText}
            </span>
            <Button type="button" disabled={tooLong || saveBank.isPending || bankText === null} onClick={() => saveBank.mutate(text)}>
              保存する
            </Button>
          </div>
        </section>
      </PageBody>
    </>
  );
}
