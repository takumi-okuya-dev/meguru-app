// 保存の途中で 403 BILLING_REQUIRED を受けたときのダイアログ（specs/013 contracts/ui-routes.md「読むだけの帯」、T038）。
// 画面を開いた後に無料体験が終わった・支払いが失敗したなど。入力した内容は画面に残す。
import { errorMessage } from "@threads-grower/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 読むだけの理由から、帯・ダイアログの文言を作る（オーナー以外には支払いの詳細を出さない）。
 * @param reason - 読むだけの理由（trial_ended・payment_failed・canceled・owner_inactive）
 * @returns 文言
 */
export function readOnlyMessage(reason: string | undefined): string {
  // 理由がわからないとき（保存の後の知らせだけで、エラーが手元にない）は、理由を書かない
  if (!reason) return "このアカウントは今、読むだけです。";
  return errorMessage("BILLING_REQUIRED", { details: [reason] }).message;
}

/**
 * 編集できなくなったときのダイアログ。
 * @param props - reason：読むだけの理由（閉じているときは null）、onClose：閉じる
 * @returns ダイアログ
 */
export function BillingRequiredDialog({ reason, onClose }: { reason: string | null; onClose: () => void }) {
  return (
    <Dialog open={reason !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>編集できなくなりました</DialogTitle>
          <DialogDescription>
            {readOnlyMessage(reason ?? undefined)}入力した内容は画面に残っているので、必要ならコピーしてください。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button className="rounded-full" onClick={onClose}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
