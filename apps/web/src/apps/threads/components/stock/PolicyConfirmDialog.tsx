// 規約に注意の下書きを承認する前の確認（specs/004-review-approval FR-040、contracts/ui-routes.md「承認」「選択のバー」）。
// 承認は止めない（判断は人の承認に委ねる）。文言は「おそれ」にとどめる（FR-043）。
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
 * 規約に注意の確認のダイアログ。
 * @param props - bulk：まとめての承認か、count：規約に注意の件数（まとめてのとき）、labels：当たった分類の名前（1件のとき）、
 *   onConfirm：承認する、onCancel：やめる
 * @returns ダイアログ
 */
export function PolicyConfirmDialog({
  bulk,
  count,
  labels,
  onConfirm,
  onCancel,
}: {
  bulk: boolean;
  count: number;
  labels: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>Threadsの規約に触れるおそれのある表現があります</DialogTitle>
          <DialogDescription>
            {bulk
              ? `選んだうち${count}件に、Threadsの規約に触れるおそれのある表現があります。内容を確かめたうえで承認しますか？`
              : `内容を確かめたうえで承認しますか？（${labels.join("・")}）`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onCancel}>
            キャンセル
          </Button>
          <Button className="rounded-full" onClick={onConfirm}>
            承認する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
