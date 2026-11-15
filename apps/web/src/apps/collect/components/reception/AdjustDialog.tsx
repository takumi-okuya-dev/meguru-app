// 受付で区分・金額を変えるダイアログ（specs/collect/001-event-day-collection FR-032、research.md R17）。
// 変えたものは受付の記録にだけ持ち、名簿の区分は変えない。金額を空にすると区分の金額。
import { COLLECT_LIMITS, type CollectTier } from "@meguru/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ChoiceButtons } from "../roster/ChoiceButtons";
import { yen } from "../../lib/reception-model";

/** 受付で変えた区分・金額。 */
export type Adjustment = { priceTierId: string; amount?: number };

/**
 * 区分・金額を変えるダイアログ。
 * @param props - title：見出し、tiers：料金の区分、value：今の区分と金額、onSave：決めた、onClose：閉じる
 * @returns ダイアログ
 */
export function AdjustDialog({
  title,
  tiers,
  value,
  onSave,
  onClose,
}: {
  title: string;
  tiers: readonly CollectTier[];
  value: Adjustment;
  onSave: (value: Adjustment) => void;
  onClose: () => void;
}) {
  const [tierId, setTierId] = useState(value.priceTierId);
  const [amount, setAmount] = useState(value.amount === undefined ? "" : String(value.amount));
  const digits = amount.normalize("NFKC").replace(/[,\s円]/g, "");
  const parsed = digits === "" ? undefined : Number(digits);
  const invalid = parsed !== undefined && (!Number.isInteger(parsed) || parsed < 0 || parsed > COLLECT_LIMITS.tierAmountMax);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby="adjust-desc">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription id="adjust-desc">この受付の記録だけを変えます（名簿の区分は変えません）。</DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (invalid) return;
            onSave({ priceTierId: tierId, ...(parsed === undefined ? {} : { amount: parsed }) });
          }}
        >
          <ChoiceButtons label="料金の区分" options={tiers.map((t) => ({ value: t.id, label: `${t.name} ${yen(t.amount)}` }))} value={tierId} onChange={setTierId} />
          <div className="space-y-1.5">
            <Input aria-label="金額を直接入れる" inputMode="numeric" placeholder="金額を直接入れる（空なら区分の金額）" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {invalid && <p className="text-xs text-destructive">0〜999,999円の整数で入れてください。</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit" disabled={invalid}>
              決める
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
