// grower機能を使えないAccountの案内（specs/002 FR-024a、contracts/ui-routes.md 規則10）
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** 案内の本文。 */
export const GROWER_REQUIRED_MESSAGE =
  "課題・宣伝内容・リサーチの編集は、プラン2以上で使えます。保存済みの内容はそのまま残っています。";
/** 課金featureができるまでの、プランの変更の案内。 */
export const PLAN_CHANGE_CONTACT = "プランの変更は運営者にお問い合わせください。";

/**
 * 画面の上部に出す案内（読むだけの表示のとき）。
 * @returns 案内
 */
export function GrowerRequiredBanner() {
  return (
    <div role="status" className="flex gap-3 rounded-2xl border bg-muted/60 px-4 py-3 text-sm">
      <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p>
        {GROWER_REQUIRED_MESSAGE}
        <span className="text-muted-foreground">{PLAN_CHANGE_CONTACT}</span>
      </p>
    </div>
  );
}

/**
 * 保存で 403 GROWER_FEATURE_REQUIRED を受けたときのダイアログ（画面を開いた後に無料体験が終わった場合）。
 * @param props - open：表示するか、onClose：閉じる
 * @returns 案内のダイアログ
 */
export function GrowerRequiredDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>編集できなくなりました</DialogTitle>
          <DialogDescription>
            {GROWER_REQUIRED_MESSAGE}
            {PLAN_CHANGE_CONTACT}入力した内容は画面に残っているので、必要ならコピーしてください。
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
