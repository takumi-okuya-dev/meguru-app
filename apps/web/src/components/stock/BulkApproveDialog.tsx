// まとめて承認の前の確認（specs/004-review-approval FR-004b、contracts/ui-routes.md「まとめて承認」、Clarifications 2026-10-05）。
// 投稿の内容は運用者の責任のもとで公開されることを伝える。規約に注意の確認（FR-040）も、この1回で済ませる。
import { APPROVED_LIMIT } from "@threads-grower/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** まとめて承認の前に伝える、投稿の責任についての文言。 */
export const BULK_APPROVE_RESPONSIBILITY =
  "承認した投稿は、自動投稿の設定に従ってThreadsに公開されます。投稿の内容は、あなた（アカウントの運用者）の責任のもとで公開されます。内容を確かめたうえで承認してください。";

/**
 * まとめて承認の確認のダイアログ。
 * @param props - selected：選んだ件数、blocked：NGワード・Threadsの上限で承認できない件数、
 *   cautious：規約に注意の件数、approvedSlots：承認済みの上限までの残りの件数、onConfirm：承認する、onCancel：やめる
 * @returns ダイアログ
 */
export function BulkApproveDialog({
  selected,
  blocked,
  cautious,
  approvedSlots,
  onConfirm,
  onCancel,
}: {
  selected: number;
  blocked: number;
  cautious: number;
  approvedSlots: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // 実際に承認される件数。承認済みの上限（500件）の残りの枠も差し引く（PR #5 のCodexレビュー）
  const approvable = Math.max(0, Math.min(selected - blocked, approvedSlots));
  const capped = approvable < selected - blocked;
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>選んだ{selected}件を承認します</DialogTitle>
          <DialogDescription>{BULK_APPROVE_RESPONSIBILITY}</DialogDescription>
        </DialogHeader>
        {(blocked > 0 || cautious > 0 || capped) && (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {blocked > 0 && (
              <li>うち{blocked}件はNGワード・Threadsの上限に当たるため、承認されません</li>
            )}
            {capped && (
              <li>
                承認済みの下書きが上限（{APPROVED_LIMIT}件）に近いため、承認されるのは{approvable}件までです
              </li>
            )}
            {cautious > 0 && (
              <li>うち{cautious}件に、Threadsの規約に触れるおそれのある表現があります</li>
            )}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onCancel}>
            キャンセル
          </Button>
          <Button className="rounded-full" disabled={approvable === 0} onClick={onConfirm}>
            {approvable}件を承認する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
