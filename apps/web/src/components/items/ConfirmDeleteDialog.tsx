// 削除の確認（specs/002 contracts/ui-routes.md 規則7）
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
 * 「{名前}を削除しますか？ 元に戻せません。」の確認。
 * @param props - name：削除するものの名前（null なら閉じている）、deleting：削除中、onConfirm：削除する、onCancel：やめる
 * @returns 確認のダイアログ
 */
export function ConfirmDeleteDialog({
  name,
  deleting,
  onConfirm,
  onCancel,
}: {
  name: string | null;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={name !== null} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle className="break-all">{name}を削除しますか？</DialogTitle>
          <DialogDescription>元に戻せません。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="destructive" className="rounded-full" disabled={deleting} onClick={onConfirm}>
            削除する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
