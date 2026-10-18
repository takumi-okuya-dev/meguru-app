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
 * @param props - open：表示するか、onStay：編集に戻る、onDiscard：変更を破棄して移動する（閉じる）、
 *   title・description・discardLabel：文言を変えるとき（参考投稿のためた投稿など。specs/014）
 * @returns 確認のダイアログ
 */
export function UnsavedChangesDialog({
  open,
  onStay,
  onDiscard,
  title = "保存していない変更があります",
  description = "このまま移動すると、変更は失われます。",
  discardLabel = "変更を破棄して移動",
}: {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
  title?: string;
  description?: string;
  discardLabel?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onStay()}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onDiscard}>
            {discardLabel}
          </Button>
          <Button className="rounded-full" onClick={onStay} autoFocus>
            編集に戻る
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
