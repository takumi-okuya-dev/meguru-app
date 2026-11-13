// まとめて貼る（specs/collect/001-event-day-collection FR-022・FR-026、research.md R9、tasks.md T030）。
// 複数行の文を貼る → 1行を1人として整えた一覧（人数つき）を見せる → 行ごとに直す・外す → 足す。
// 名前ではなさそうな行（日付・金額・申込など）は、最初から外しておく（戻せる）。画面写真の文字は、スマートフォンの文字の読み取りでコピーしてもらう。
import { cleanPastedLine, COLLECT_LIMITS, COLLECT_MEDIA_LABELS, looksLikeNonName, type CollectMedia, type CollectTier } from "@meguru/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** 確かめの一覧の1行。 */
export type PasteRow = { key: number; original: string; name: string; include: boolean };

/**
 * 貼った文を、確かめの一覧の行にする（空の行は出さない。名前ではなさそうな行は外しておく）。
 * @param text - 貼った文
 * @returns 行
 */
export function rowsFromPaste(text: string): PasteRow[] {
  return text
    .split(/\r?\n/)
    .map((original, key) => ({ key, original, name: cleanPastedLine(original) }))
    .filter((r) => r.original.trim() !== "")
    .map((r) => ({ ...r, include: r.name !== "" && !looksLikeNonName(r.original) }));
}

/**
 * まとめて貼るダイアログ。
 * @param props - media・tier：足す人の媒体と区分（入力欄で選んでいるもの）、pending：足している途中か、
 *   onSubmit：名前の一覧を足す（成功したら true）、onClose：閉じる
 * @returns ダイアログ
 */
export function BulkPasteDialog({
  media,
  tier,
  pending,
  onSubmit,
  onClose,
}: {
  media: CollectMedia;
  tier: CollectTier | undefined;
  pending: boolean;
  onSubmit: (names: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PasteRow[] | null>(null);
  const chosen = (rows ?? []).filter((r) => r.include && r.name.trim() !== "");
  const tooLong = chosen.some((r) => [...r.name.trim()].length > COLLECT_LIMITS.personName);
  const tooMany = chosen.length > COLLECT_LIMITS.bulkMax;
  const setRow = (key: number, patch: Partial<PasteRow>) => setRows((cur) => (cur ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg" aria-describedby="bulk-desc">
        <DialogTitle>まとめて貼る</DialogTitle>
        <DialogDescription id="bulk-desc" className="text-sm text-muted-foreground">
          {COLLECT_MEDIA_LABELS[media]}・{tier ? `${tier.name} ${tier.amount.toLocaleString("ja-JP")}円` : ""}で足します。1行を1人にします。
        </DialogDescription>
        {rows === null ? (
          <div className="space-y-3">
            <Textarea aria-label="貼る文" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1. 松本 れい 様\n2. 井上 そら 様\n3. 木村 ゆうき さん"} />
            <p className="text-xs text-muted-foreground">
              申込の一覧の画面写真は、スマートフォンの文字の読み取り（iPhoneは写真の「テキスト認識表示」、AndroidはGoogleレンズ）で文字をコピーしてから貼ってください。番号・敬称・メールアドレス・電話番号は外します。
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                キャンセル
              </Button>
              <Button type="button" disabled={text.trim() === ""} onClick={() => setRows(rowsFromPaste(text))}>
                確かめる
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium" aria-live="polite">
              {chosen.length}人を足します
            </p>
            <ul className="max-h-[50svh] space-y-1.5 overflow-y-auto" aria-label="足す人の一覧">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0"
                    checked={r.include}
                    aria-label={`${r.name || r.original}を足す`}
                    onChange={(e) => setRow(r.key, { include: e.target.checked })}
                  />
                  <Input aria-label={`${r.key + 1}行目の名前`} value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} className={r.include ? "" : "text-muted-foreground"} />
                </li>
              ))}
            </ul>
            {tooLong && <p className="text-sm text-destructive">名前は{COLLECT_LIMITS.personName}文字までです。長い行を直してください。</p>}
            {tooMany && <p className="text-sm text-destructive">一度に足せるのは{COLLECT_LIMITS.bulkMax}人までです。分けて貼ってください。</p>}
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setRows(null)}>
                戻る
              </Button>
              <Button
                type="button"
                disabled={chosen.length === 0 || tooLong || tooMany || pending}
                onClick={async () => {
                  if (await onSubmit(chosen.map((r) => r.name.trim()))) onClose();
                }}
              >
                {chosen.length}人を足す
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
