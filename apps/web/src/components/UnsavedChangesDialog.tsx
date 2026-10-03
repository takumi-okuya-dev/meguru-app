// 「保存していない変更があります」の確認（specs/002 contracts/ui-routes.md 規則3）
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
 * 未保存の変更があるまま移動・閉じようとしたときの確認。既定の操作は「編集に戻る」。
 * @param props - open：表示するか、onStay：編集に戻る、onDiscard：変更を破棄して移動する（閉じる）
 * @returns 確認のダイアログ
 */
export function UnsavedChangesDialog({
  open,
  onStay,
  onDiscard,
}: {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onStay()}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>保存していない変更があります</DialogTitle>
          <DialogDescription>このまま移動すると、変更は失われます。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onDiscard}>
            変更を破棄して移動
          </Button>
          <Button className="rounded-full" onClick={onStay} autoFocus>
            編集に戻る
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
