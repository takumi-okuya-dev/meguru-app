// パートナーを外す確認（specs/008-team-operations contracts/ui-routes.md「このアカウントの設定」、US1-8）。
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
 * パートナーを外すかの確認。
 * @param props - partnerName：パートナーの名前、teamName：チーム名、editorNames：外れる編集者、removing：処理中、onConfirm：外す、onCancel：やめる
 * @returns 確認のダイアログ
 */
export function RemovePartnerDialog({
  partnerName,
  teamName,
  editorNames,
  removing,
  onConfirm,
  onCancel,
}: {
  partnerName: string;
  teamName: string | null;
  editorNames: string[];
  removing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const who = teamName ? `${partnerName}さん（${teamName}）` : `${partnerName}さん`;
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle>{who}を外しますか？</DialogTitle>
          <DialogDescription className="text-foreground/80">
            {editorNames.length > 0
              ? `${partnerName}さんと、このアカウントを担当している編集者${editorNames.length}人（${editorNames.join("・")}）が、このアカウントを開けなくなります。`
              : `${partnerName}さんが、このアカウントを開けなくなります。`}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          作ってもらった投稿の案と、操作の記録は残ります。任せていた承認・設定は、あなただけに戻ります。
        </p>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="destructive" className="rounded-full" disabled={removing} onClick={onConfirm}>
            外す
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
