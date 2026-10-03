// 「他の場所で更新されています」（specs/002 contracts/ui-routes.md 規則5、research.md R3）
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";

/**
 * 保存で 409 STALE_UPDATE を受けたときの選択。既定の操作は「最新の内容を読み込み直す」。
 * @param props - open：表示するか、updatedAt：最新の更新日時（ISO 8601）、onReload：読み込み直す、onOverwrite：上書きする、onCancel：閉じる
 * @returns 選択のダイアログ
 */
export function ConflictDialog({
  open,
  updatedAt,
  onReload,
  onOverwrite,
  onCancel,
}: {
  open: boolean;
  updatedAt: string | null;
  onReload: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>他の場所で更新されています</DialogTitle>
          <DialogDescription>
            この内容は、別のタブや端末で先に保存されています{updatedAt ? `（${formatDateTime(updatedAt)}）` : ""}。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onOverwrite}>
            自分の内容で上書きする
          </Button>
          <Button className="rounded-full" onClick={onReload} autoFocus>
            最新の内容を読み込み直す
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
