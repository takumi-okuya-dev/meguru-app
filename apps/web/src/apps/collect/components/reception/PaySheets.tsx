// PayPay と振込のシート（specs/collect/001-event-day-collection FR-033、quickstart.md 2）。
// PayPay：主催者のQRを大きく出し、受け取ったら「受け取った」。振込：当日・後日を選ぶ。振込先の案内と、名義の前に受付番号を入れてもらう案内を出す。
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { yen } from "../../lib/reception-model";

/**
 * 画像のファイルを、画面で出せるURLにする（閉じたら片づける）。
 * @param blob - 画像
 * @returns URL（まだなければ null）
 */
function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/**
 * PayPay のシート。
 * @param props - name・number・amount：受付する人と金額、hasQr：QRがあるか、qrKey・loadQr：QRの画像の読み方、onReceived：受け取った、onClose：閉じる
 * @returns シート
 */
export function PaypaySheet({
  name,
  number,
  amount,
  hasQr,
  qrKey,
  loadQr,
  onReceived,
  onClose,
}: {
  name: string;
  number: number;
  amount: number;
  hasQr: boolean;
  qrKey: readonly unknown[];
  loadQr: () => Promise<Blob>;
  onReceived: () => void;
  onClose: () => void;
}) {
  const qr = useQuery({ queryKey: qrKey, queryFn: loadQr, enabled: hasQr, staleTime: Infinity });
  const url = useObjectUrl(qr.data);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby="paypay-desc">
        <DialogTitle>
          PayPay・No.{number} {name}
        </DialogTitle>
        <DialogDescription id="paypay-desc">{yen(amount)}を、このQRに送ってもらってください。</DialogDescription>
        <div className="flex justify-center">
          {!hasQr ? (
            <p className="text-sm text-muted-foreground">QRの画像がまだありません（主催者の「PayPay・振込先の設定」で入れられます）。</p>
          ) : url ? (
            <img src={url} alt="PayPayの受け取り用QR" className="aspect-square w-full max-w-80 rounded-lg border object-contain" />
          ) : qr.isError ? (
            <p className="text-sm text-muted-foreground">QRの画像を読めませんでした。</p>
          ) : (
            <div className="aspect-square w-full max-w-80 animate-pulse rounded-lg bg-muted" aria-busy="true" />
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            やめる
          </Button>
          <Button type="button" className="h-11" onClick={onReceived}>
            受け取った
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 振込のシート。
 * @param props - name・number・amount：受付する人と金額、bankText：振込先の案内、onChoose：当日・後日を選んだ、onClose：閉じる
 * @returns シート
 */
export function TransferSheet({
  name,
  number,
  amount,
  bankText,
  onChoose,
  onClose,
}: {
  name: string;
  number: number;
  amount: number;
  bankText: string | null;
  onChoose: (method: "transfer_today" | "transfer_later") => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby="transfer-desc">
        <DialogTitle>
          振込・No.{number} {name}
        </DialogTitle>
        <DialogDescription id="transfer-desc">
          {yen(amount)}。振込の名義の前に、受付番号「{number}」を入れてもらってください（例：{number}ヤマダタロウ）。
        </DialogDescription>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{bankText ?? "振込先の案内がまだありません（主催者の「PayPay・振込先の設定」で入れられます）。"}</div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" className="h-11" onClick={() => onChoose("transfer_today")}>
            今日振り込む
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => onChoose("transfer_later")}>
            後日振り込む
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
