// チームの操作の確認のダイアログ（外す・引き継ぐ・チームの削除。specs/011-team-revision contracts/ui-routes.md「チームの画面」）。
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * 確認のダイアログ。
 * @param props - title：見出し、children：本文、confirmLabel：確かめるボタンの文言、destructive：赤のボタンにする、
 *   pending：処理中、error：失敗の文言、onConfirm：確かめる、onCancel：やめる
 * @returns ダイアログ
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  destructive = false,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md" aria-describedby="confirm-desc">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription id="confirm-desc" asChild>
          <div className="space-y-2 text-sm text-foreground/80">{children}</div>
        </DialogDescription>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-full" onClick={onCancel}>
            キャンセル
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            className="h-10 rounded-full"
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
