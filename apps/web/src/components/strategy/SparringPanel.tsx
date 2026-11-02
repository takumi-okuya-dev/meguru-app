// 「AIと壁打ちして埋める」の欄（specs/018-strategy-ai-sparring US1〜US4、contracts/ui-routes.md「壁打ちの欄」、research.md R1・R5〜R7）。
// 範囲を選んでプロンプトをコピーし、AIの答えを貼り付けて、選んだ項目をまとめて入力欄に入れる。保存はしない。
// コピー・貼り付け欄・まだ反映していない答えの扱いは、014の「AIと深掘り」（DeepenPanel）と同じにする。
import {
  SPARRING_SECTION_IDS,
  STRATEGY_SECTIONS,
  buildSparringCandidates,
  buildSparringPrompt,
  parseSparringAnswer,
  selectSparringTargets,
  type SparringKey,
  type SparringSectionId,
  type StrategyValues,
} from "@threads-grower/shared";
import { useEffect, useId, useState } from "react";
import { CopyPromptStatus, CopyPromptTrigger, useCopyPrompt } from "@/components/CopyPromptButton";
import { SparringCandidates } from "@/components/strategy/SparringCandidates";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { cn } from "@/lib/utils";

const STEPS = [
  "範囲を選んで「プロンプトをコピーする」を押す",
  "ChatGPTやClaudeに貼り付けて送り、AIの質問に答える",
  "最後にAIが出した答えを、まるごと下に貼り付ける",
  "反映する項目を選んで「選んだ項目を反映する」を押し、上の「保存」で保存する",
];

/**
 * AIと壁打ちして埋める欄。範囲は欄の中だけで持ち、閉じると初めに戻る（FR-003）。
 * @param props - values：課題の今の値（未保存を含む）、onApply：選んだ項目の新しい案を入力欄に入れる、
 *   onClose：閉じる（まだ反映していない答えがあれば、親が破棄してよいか確かめる）、onDirtyChange：まだ反映していない答えがあるか
 * @returns 欄
 */
export function SparringPanel({
  values,
  onApply,
  onClose,
  onDirtyChange,
}: {
  values: StrategyValues;
  onApply: (patch: Partial<Record<SparringKey, string>>) => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [sections, setSections] = useState<readonly SparringSectionId[]>(SPARRING_SECTION_IDS);
  const [onlyIncomplete, setOnlyIncomplete] = useState(true);
  const [paste, setPaste] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<SparringKey>>(new Set());
  const pasteId = useId();
  const onlyId = useId();

  // まだ反映していない答えは、閉じる・画面の移動の前に確かめる（DeepenPanel と同じ）
  const dirty = paste.trim() !== "";
  useUnsavedChanges(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const targets = selectSparringTargets(values, { sections, onlyIncomplete });
  const copy = useCopyPrompt({ getText: () => buildSparringPrompt(values, targets) });
  const parsed = parseSparringAnswer(paste);
  // 候補の「今」は、画面の今の入力をその都度出す（research.md R6）
  const candidates = buildSparringCandidates(parsed.items, values);
  const picked = candidates.filter((c) => selected.has(c.key));

  // 貼った文が変わったら読み取り直し、選ぶ印をはじめの状態（空の項目だけ）に戻す（FR-016）
  const changePaste = (text: string) => {
    setPaste(text);
    const next = buildSparringCandidates(parseSparringAnswer(text).items, values);
    setSelected(new Set(next.filter((c) => c.selected).map((c) => c.key)));
  };

  const toggleSection = (id: SparringSectionId) =>
    setSections((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : SPARRING_SECTION_IDS.filter((x) => x === id || cur.includes(x))));

  const toggleCandidate = (key: SparringKey) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section aria-label="AIと壁打ち" className="space-y-4 rounded-2xl border px-4 py-3.5 text-sm leading-relaxed">
      <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      <div className="space-y-2.5">
        <div role="group" aria-labelledby={`${onlyId}-sections`} className="space-y-2">
          <p id={`${onlyId}-sections`} className="font-medium">
            相談する区分
          </p>
          <div className="flex flex-wrap gap-2">
            {SPARRING_SECTION_IDS.map((id) => {
              const on = sections.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSection(id)}
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-sm md:min-h-9",
                    on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent",
                  )}
                >
                  {STRATEGY_SECTIONS.find((s) => s.id === id)?.chip}
                </button>
              );
            })}
          </div>
        </div>
        <label htmlFor={onlyId} className="flex min-h-11 items-center gap-3">
          <Switch id={onlyId} checked={onlyIncomplete} onCheckedChange={setOnlyIncomplete} />
          <span>未入力と短めの項目だけにする</span>
        </label>
        <p className={cn("text-[13px]", targets.length === 0 ? "text-warning" : "text-muted-foreground")}>
          {targets.length === 0 ? "この範囲には、相談する項目がありません" : `${targets.length}項目を相談します`}
        </p>
      </div>

      <div className="space-y-2">
        <CopyPromptTrigger disabled={targets.length === 0 || copy.loading} onClick={() => void copy.copy()} />
        <CopyPromptStatus state={copy.state} copiedMessage="コピーしました。ChatGPTやClaudeに貼り付けて送ってください" />
      </div>

      <div className="space-y-1">
        <label htmlFor={pasteId} className="font-medium">
          AIの答えを貼り付ける
        </label>
        <textarea
          id={pasteId}
          rows={6}
          value={paste}
          onChange={(e) => changePaste(e.target.value)}
          placeholder="AIが返した答えを、そのまま丸ごと貼り付けてください"
          className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-[14px]"
        />
      </div>

      {dirty && !parsed.markerFound && (
        <p role="alert" className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm">
          項目ごとの完成版が見つかりませんでした。AIに『決まった形で完成版を出してください』と送り、出た答えを貼ってください
        </p>
      )}
      {parsed.unknown.length > 0 && (
        <p className="text-[13px] text-warning">読み取れなかった項目：{parsed.unknown.join("、")}</p>
      )}
      {candidates.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => setSelected(new Set(candidates.map((c) => c.key)))}
            >
              すべて選ぶ
            </Button>
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setSelected(new Set())}>
              すべて外す
            </Button>
            <span className="text-[13px] text-muted-foreground">
              {candidates.length}件中{picked.length}件を選んでいます
            </span>
          </div>
          <SparringCandidates candidates={candidates} selected={selected} onToggle={toggleCandidate} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-10 rounded-full px-4"
          disabled={picked.length === 0}
          onClick={() => onApply(Object.fromEntries(picked.map((c) => [c.key, c.proposed])))}
        >
          選んだ項目を反映する
        </Button>
        <Button type="button" variant="ghost" className="h-10 rounded-full px-4" onClick={onClose}>
          閉じる
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">反映しても、まだ保存されません。上の「保存」で保存します。</p>
    </section>
  );
}
