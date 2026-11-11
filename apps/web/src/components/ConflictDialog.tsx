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
import { staleUpdateTitle } from "@meguru/shared";
import { formatDateTime } from "@/lib/format";

/**
 * 保存で 409 STALE_UPDATE を受けたときの選択。既定の操作は「最新の内容を読み込み直す」。
 * 先に保存した人が分かれば「（名前）さんが先に保存しました」と出す（specs/008 FR-007）。
 * @param props - open：表示するか、updatedAt：最新の更新日時（ISO 8601）、updatedByName：先に保存した人、onReload：読み込み直す、onOverwrite：上書きする、onCancel：閉じる
 * @returns 選択のダイアログ
 */
export function ConflictDialog({
  open,
  updatedAt,
  updatedByName = null,
  onReload,
  onOverwrite,
  onCancel,
}: {
  open: boolean;
  updatedAt: string | null;
  updatedByName?: string | null;
  onReload: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>{staleUpdateTitle(updatedByName)}</DialogTitle>
          <DialogDescription>
            {updatedByName ? "この内容は、開いた後に先に保存されています" : "この内容は、別のタブや端末で先に保存されています"}
            {updatedAt ? `（${formatDateTime(updatedAt)}）` : ""}。
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
