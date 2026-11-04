// 「AIと考える」のポップアップ（specs/018-strategy-ai-sparring US1〜US4、contracts/ui-routes.md、research.md R1・R5〜R7）。
// 2026-11-04：全部の項目を一度に相談するのは大変なので、区分ごとに開くポップアップにした（名前も「AIと壁打ちして埋める」から変えた）。
// 区分の項目でプロンプトをコピーし、AIの答えを貼り付けて、選んだ項目をまとめて入力欄に入れる。保存はしない。
// 見た目は追加・編集のダイアログ（FormDialogFrame。docs/ui-design.md 型B）にそろえる。
import {
  STRATEGY_SECTIONS,
  buildSparringCandidates,
  buildSparringPrompt,
  parseSparringAnswer,
  selectSparringTargets,
  type SparringKey,
  type SparringParseResult,
  type SparringSectionId,
  type StrategyCheck,
  type StrategyValues,
} from "@threads-grower/shared";
import { useEffect, useId, useState } from "react";
import { CopyPromptStatus, CopyPromptTrigger, useCopyPrompt } from "@/components/CopyPromptButton";
import { FormDialogFrame } from "@/components/items/FormDialogFrame";
import { SparringCandidates } from "@/components/strategy/SparringCandidates";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { cn } from "@/lib/utils";

const EMPTY_PARSE: SparringParseResult = { items: [], unknown: [], markerFound: false };

const STEPS = [
  "プロンプトをコピーして、ChatGPTやClaudeに送る",
  "AIの質問に答える",
  "最後の答えを、下に貼り付ける",
];

/**
 * ポップアップの見出し（例：AIと考える（営業導線））。入口のボタンの名前にも使う。
 * @param section - 区分
 * @returns 見出し
 */
export function sparringTitle(section: SparringSectionId): string {
  return `AIと考える（${STRATEGY_SECTIONS.find((s) => s.id === section)?.chip ?? ""}）`;
}

/**
 * 区分ごとの「AIと考える」。スイッチは中だけで持ち、閉じると初めに戻る（FR-003）。
 * @param props - section：相談する区分、values：課題の今の値（未保存を含む）、check：画面が求めた自動チェック、
 *   onApply：選んだ項目の新しい案を入力欄に入れる、onRequestClose：閉じる操作（まだ反映していない答えがあれば、親が破棄してよいか確かめる）、
 *   onDirtyChange：まだ反映していない答えがあるか
 * @returns ポップアップ
 */
export function SparringDialog({
  section,
  values,
  check,
  onApply,
  onRequestClose,
  onDirtyChange,
}: {
  section: SparringSectionId;
  values: StrategyValues;
  check: StrategyCheck;
  onApply: (patch: Partial<Record<SparringKey, string>>) => void;
  onRequestClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [onlyIncomplete, setOnlyIncomplete] = useState(true);
  const [paste, setPaste] = useState("");
  // 読み取りは貼った文が変わったときだけ行う（ほかの入力欄を打つたびに読み直さない）
  const [parsed, setParsed] = useState<SparringParseResult>(EMPTY_PARSE);
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

  const targets = selectSparringTargets(values, { sections: [section], onlyIncomplete }, check);
  const copy = useCopyPrompt({ getText: () => buildSparringPrompt(values, targets) });
  // 候補の「今」は、画面の今の入力をその都度出す（research.md R6）
  const candidates = buildSparringCandidates(parsed.items, values);
  const picked = candidates.filter((c) => selected.has(c.key));

  // 貼った文が変わったら読み取り直し、選ぶ印をはじめの状態（空の項目だけ）に戻す（FR-016）
  const changePaste = (text: string) => {
    const next = parseSparringAnswer(text);
    setPaste(text);
    setParsed(next);
    setSelected(
      new Set(
        buildSparringCandidates(next.items, values)
          .filter((c) => c.selected)
          .map((c) => c.key),
      ),
    );
  };

  // 範囲を変えるとプロンプトが変わるので、前のコピーの結果（「コピーしました」・手でコピーする欄）を消す
  const changeOnlyIncomplete = (on: boolean) => {
    copy.reset();
    setOnlyIncomplete(on);
  };

  const toggleCandidate = (key: SparringKey) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <FormDialogFrame
      title={sparringTitle(section)}
      description="区分の項目を、ChatGPTやClaudeと相談して埋めます"
      submitLabel="反映する"
      submitting={false}
      submitDisabled={picked.length === 0}
      onSubmit={() => onApply(Object.fromEntries(picked.map((c) => [c.key, c.proposed])))}
      onRequestClose={onRequestClose}
    >
      <div className="space-y-4 text-sm leading-relaxed">
        <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>

        <div className="space-y-2.5">
          <label htmlFor={onlyId} className="flex min-h-11 items-center gap-3">
            <Switch id={onlyId} checked={onlyIncomplete} onCheckedChange={changeOnlyIncomplete} />
            <span>未入力と短めの項目だけにする</span>
          </label>
          <p
            className={cn(
              "text-[13px]",
              targets.length === 0 ? "text-warning" : "text-muted-foreground",
            )}
          >
            {targets.length === 0
              ? "この区分には、相談する項目がありません"
              : `${targets.length}項目を相談します`}
          </p>
        </div>

        <div className="space-y-2">
          <CopyPromptTrigger
            disabled={targets.length === 0 || copy.loading}
            onClick={() => void copy.copy()}
          />
          <CopyPromptStatus
            state={copy.state}
            copiedMessage="コピーしました。ChatGPTやClaudeに貼り付けて送ってください"
          />
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
          <p
            role="alert"
            className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm"
          >
            項目ごとの完成版が見つかりませんでした。AIに『決まった形で完成版を出してください』と送り、出た答えを貼ってください
          </p>
        )}
        {parsed.unknown.length > 0 && (
          <p className="text-[13px] text-warning">
            読み取れなかった項目：{parsed.unknown.join("、")}
          </p>
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => setSelected(new Set())}
              >
                すべて外す
              </Button>
              <span className="text-[13px] text-muted-foreground">
                {candidates.length}件中{picked.length}件を選んでいます
              </span>
            </div>
            <SparringCandidates
              candidates={candidates}
              selected={selected}
              onToggle={toggleCandidate}
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          反映しても、まだ保存されません。課題の画面の「保存」で保存します。
        </p>
      </div>
    </FormDialogFrame>
  );
}
