// 名簿の人を直すダイアログ（specs/collect/001-event-day-collection FR-025、tasks.md T030）。受付番号は変わらない。
import { COLLECT_LIMITS, type CollectMedia, type CollectTier, type RosterPerson } from "@meguru/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PersonInput } from "../../lib/api";
import { ChoiceButtons } from "./ChoiceButtons";
import { MEDIA_OPTIONS } from "./QuickAdd";

/**
 * 名簿の人を直すダイアログ。
 * @param props - person：直す人、tiers：料金の区分、pending：保存中か、onSave：保存する（成功したら true）、onClose：閉じる
 * @returns ダイアログ
 */
export function PersonDialog({
  person,
  tiers,
  pending,
  onSave,
  onClose,
}: {
  person: RosterPerson;
  tiers: readonly CollectTier[];
  pending: boolean;
  onSave: (input: PersonInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [kana, setKana] = useState(person.kana ?? "");
  const [memo, setMemo] = useState(person.memo ?? "");
  const [media, setMedia] = useState<CollectMedia>(person.media);
  const [tierId, setTierId] = useState(person.priceTierId);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby="person-desc">
        <DialogTitle>No.{person.number}を直す</DialogTitle>
        <DialogDescription id="person-desc" className="sr-only">
          名前・ふりがな・媒体・料金の区分・メモを直します
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (await onSave({ name: name.trim(), kana: kana.trim() || null, media, priceTierId: tierId, memo: memo.trim() || null })) onClose();
          }}
        >
          <Input aria-label="名前" value={name} maxLength={COLLECT_LIMITS.personName} onChange={(e) => setName(e.target.value)} />
          <Input aria-label="ふりがな" placeholder="ふりがな（任意）" value={kana} maxLength={COLLECT_LIMITS.kana} onChange={(e) => setKana(e.target.value)} />
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">媒体</div>
            <ChoiceButtons label="媒体" options={MEDIA_OPTIONS} value={media} onChange={setMedia} />
          </div>
          {tiers.length > 1 && (
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">料金の区分</div>
              <ChoiceButtons label="料金の区分" options={tiers.map((t) => ({ value: t.id, label: t.name }))} value={tierId} onChange={setTierId} />
            </div>
          )}
          <Input aria-label="メモ" placeholder="メモ（紹介割の紹介者など。任意）" value={memo} maxLength={COLLECT_LIMITS.memo} onChange={(e) => setMemo(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              保存する
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
