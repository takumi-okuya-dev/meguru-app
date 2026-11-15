// 区分がまだ決まっていない人の区分を選ぶ（specs/collect/004 User Story 2、FR-021・FR-022）。
// 名簿なしで入った参加者は区分を選ばないので、受付をする人が受け取るとき（振込は入金を確かめるとき）に、参加者に聞いた区分を選ぶ。
import type { CollectTier } from "@meguru/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { yen } from "../../lib/reception-model";

/**
 * 区分を選ぶダイアログ。
 * @param props - title：見出し、tiers：料金の区分、onChoose：選んだ、onClose：閉じる
 * @returns ダイアログ
 */
export function TierChoiceDialog({
  title,
  tiers,
  onChoose,
  onClose,
}: {
  title: string;
  tiers: readonly Pick<CollectTier, "id" | "name" | "amount">[];
  onChoose: (tierId: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby="tier-choice-desc">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription id="tier-choice-desc">参加者に申し込んだときの区分を聞いて、選んでください。</DialogDescription>
        <div className="grid gap-2" role="group" aria-label="料金の区分">
          {tiers.map((t) => (
            <Button key={t.id} type="button" variant="outline" className="h-12 justify-between" onClick={() => onChoose(t.id)}>
              <span>{t.name}</span>
              <span className="tabular-nums">{yen(t.amount)}</span>
            </Button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
