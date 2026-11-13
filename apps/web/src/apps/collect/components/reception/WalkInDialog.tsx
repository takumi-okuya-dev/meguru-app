// 飛び入りを足すダイアログ（specs/collect/001-event-day-collection FR-034）。媒体は「当日」、区分は最初の区分で足し、そのまま受付できる。
import { COLLECT_LIMITS } from "@meguru/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * 飛び入りを足すダイアログ。
 * @param props - initialName：検索に入れていた言葉、onAdd：足す（足せたら true）、onClose：閉じる
 * @returns ダイアログ
 */
export function WalkInDialog({ initialName, onAdd, onClose }: { initialName: string; onAdd: (name: string) => Promise<boolean>; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby="walkin-desc">
        <DialogTitle>飛び入りを足す</DialogTitle>
        <DialogDescription id="walkin-desc">名簿にいない人を、媒体「当日」で足します。足したあと、払い方を選べます。</DialogDescription>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || saving) return;
            setSaving(true);
            const ok = await onAdd(name.trim());
            setSaving(false);
            if (ok) onClose();
          }}
        >
          <Input aria-label="飛び入りの名前" value={name} maxLength={COLLECT_LIMITS.personName} autoFocus onChange={(e) => setName(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              足す
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
