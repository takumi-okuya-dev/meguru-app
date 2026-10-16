// プロンプトの長さと送り方（specs/014-strategy-guidance US14、FR-150〜FR-153、research.md R12・R15）。
// 長いプロンプトは2つに分けて送れる。選んだ送り方は端末に覚える。
import { CopyIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readPreference, writePreference } from "@/lib/preferences";

/** 送り方（1つにまとめて／2つに分けて）。 */
export type SendMode = "single" | "split";

const MODE_KEY = "threads-grower:prompt-send-mode";

/**
 * 送り方。覚えた送り方があればそれ、なければ長いときは2つに分ける（FR-151）。
 * @param recommended - 2つに分けるのをすすめるか
 * @returns 今の送り方と、選び直す関数
 */
export function useSendMode(recommended: boolean): [SendMode, (mode: SendMode) => void] {
  const [chosen, setChosen] = useState<SendMode | null>(() => {
    const stored = readPreference(MODE_KEY, "");
    return stored === "single" || stored === "split" ? stored : null;
  });
  const choose = (mode: SendMode) => {
    writePreference(MODE_KEY, mode);
    setChosen(mode);
  };
  return [chosen ?? (recommended ? "split" : "single"), choose];
}

/**
 * プロンプトの長さと、送り方の切り替え。
 * @param props - length：全文の文字数、recommended：2つに分けるのをすすめるか、mode：今の送り方、onChange：選び直す
 * @returns 長さと切り替え
 */
export function SendModeSelect({
  length,
  recommended,
  mode,
  onChange,
}: {
  length: number;
  recommended: boolean;
  mode: SendMode;
  onChange: (mode: SendMode) => void;
}) {
  const name = useId();
  const option = (value: SendMode, label: string) => (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm has-checked:border-foreground has-checked:bg-accent md:min-h-9">
      <input type="radio" name={name} className="accent-foreground" checked={mode === value} onChange={() => onChange(value)} />
      {label}
    </label>
  );
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted-foreground">プロンプトの長さ：約{length.toLocaleString()}字</p>
      {recommended && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-[13px]">
          プロンプトが長いです。無料のAIでは途中で切られることがあります。2つに分けて送るのがおすすめです
        </p>
      )}
      <div role="radiogroup" aria-label="送り方" className="flex flex-wrap gap-2">
        {option("single", "1つにまとめて送る")}
        {option("split", recommended ? "2つに分けて送る（おすすめ）" : "2つに分けて送る")}
      </div>
    </div>
  );
}

function PartRow({ index, note, text }: { index: 0 | 1; note: string; text: string }) {
  const [open, setOpen] = useState(false);
  const name = index === 0 ? "1つ目" : "2つ目";
  const title = index === 0 ? "① 1つ目" : "② 2つ目（最後）";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        index === 0
          ? "1つ目をコピーしました。AIに送って「受け取りました」と返ってきたら、2つ目を送ってください"
          : "2つ目をコピーしました。AIに送ると投稿が作られます",
      );
    } catch {
      // コピーできなければ中身を開いて全文を選ぶ（003 research.md R13 と同じ扱い）
      setOpen(true);
    }
  };
  return (
    <div role="group" aria-label={title} className="space-y-2 rounded-xl border bg-background px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{note}</p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">約{[...text].length.toLocaleString()}字</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button data-prompt-copy={index === 0 ? "" : undefined} className="h-11 rounded-full px-5 md:h-9" onClick={() => void copy()}>
          <CopyIcon className="size-4" />
          {name}をコピー
        </Button>
        <Button variant="ghost" className="h-11 rounded-full md:h-9" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          中身を見る
        </Button>
      </div>
      {open && (
        <Textarea
          aria-label={`${name}の全文`}
          readOnly
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          className="h-56 resize-y font-mono text-[13px] leading-relaxed"
        />
      )}
    </div>
  );
}

/**
 * 2つに分けて送るときの、1つ目と2つ目の行（FR-152）。書き換えはできない（FR-153）。
 * @param props - parts：1つ目と2つ目
 * @returns 2つの行
 */
export function PromptParts({ parts }: { parts: [string, string] }) {
  return (
    <div className="space-y-2">
      <PartRow index={0} note="送ったら、AIの「受け取りました」を待つ" text={parts[0]} />
      <PartRow index={1} note="これを送ると、投稿が作られます" text={parts[1]} />
    </div>
  );
}
