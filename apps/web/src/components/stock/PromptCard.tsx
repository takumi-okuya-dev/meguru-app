// プロンプトのカード（specs/003 US1、contracts/ui-routes.md「プロンプトのカード」、research.md R11・R13）。
// 戦略プロファイルから組み立てたプロンプトを、件数を選んでコピーする。grower機能を使えないAccountでは案内に変わる。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PROMPT_COUNT_MAX,
  PROMPT_COUNT_MIN,
  STRATEGY_TOTAL,
  staleUpdateTitle,
  type PostDraftList,
  type PostLengthSettings,
  type PromptSummary,
} from "@threads-grower/shared";
import { ChevronDownIcon, CopyIcon, LockIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { LengthSettings } from "@/components/create/LengthSettings";
import { PromptParts, SendModeSelect, useSendMode } from "@/components/create/PromptParts";
import { PromptMaterials } from "@/components/create/PromptMaterials";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { isBillingRequired, isStale, saveErrorMessage } from "@/lib/save-error";
import { cn } from "@/lib/utils";

/**
 * 投稿ルール・NGワード・却下の反映の要約（specs/004 FR-025）。0件の項目は出さない。
 * @param summary - プロンプトの要約
 * @returns 「・ルール 3件・NGワード 2語・却下 5件」のような文字列
 */
function reviewSummary(summary: PromptSummary): string {
  return [
    summary.coreRuleCount > 0 ? `・ルール ${summary.coreRuleCount}件` : "",
    summary.ngWordCount > 0 ? `・NGワード ${summary.ngWordCount}語` : "",
    summary.rejectedCount > 0 ? `・却下 ${summary.rejectedCount}件` : "",
    summary.poorPostCount > 0 ? `・反応が低かった投稿 ${summary.poorPostCount}件` : "",
  ].join("");
}

/** 作る件数を変えてから保存するまでの待ち時間（ミリ秒） */
const SAVE_DELAY_MS = 500;

const isValidCount = (s: string) =>
  /^\d+$/.test(s) && Number(s) >= PROMPT_COUNT_MIN && Number(s) <= PROMPT_COUNT_MAX;

/**
 * プロンプトのカード。
 * @param props - accountId：Account の ID、canGeneratePrompt：grower機能を使えるか、promptPostCount：保存済みの作る件数、
 *   canSaveCount：作る件数を保存できるか（設定の権限。担当の人は、件数を変えてもこの画面の間だけ使い、保存しない。PR #14 のCodexレビュー）、
 *   startKey：「投稿をつくる」の画面を開いたときの移動のキー（開くたびに変わる）。プロンプトのカードまで移り、
 *   「コピー」にフォーカスを当てる（specs/004 Clarifications 2026-10-05、specs/014 T063）、
 *   onLocked：画面を開いた後にプロンプトが使えなくなった（無料体験の終了など）。ページは貼り付け欄にフォーカスを移す
 * @returns プロンプトのカード（使えないときは案内）
 */
export function PromptCard({
  accountId,
  canGeneratePrompt,
  promptPostCount,
  promptPostCountVersion = 1,
  canSaveCount = true,
  startKey,
  onLocked,
}: {
  accountId: string;
  canGeneratePrompt: boolean;
  promptPostCount: number;
  promptPostCountVersion?: number;
  canSaveCount?: boolean;
  startKey?: string;
  onLocked?: () => void;
}) {
  const [readOnlyLost, setReadOnlyLost] = useState(false);
  if (!canGeneratePrompt || readOnlyLost) return <PromptLockedCard />;
  return (
    <PromptReadyCard
      accountId={accountId}
      savedCount={promptPostCount}
      savedVersion={promptPostCountVersion}
      canSaveCount={canSaveCount}
      startKey={startKey}
      onReadOnly={() => {
        setReadOnlyLost(true);
        onLocked?.();
      }}
    />
  );
}

function PromptLockedCard() {
  return (
    <section
      aria-label="プロンプト"
      className="flex gap-3 rounded-2xl border bg-muted/60 px-4 py-4"
    >
      <LockIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="font-semibold">今はAIプロンプトを作れません</h2>
        <p className="text-sm text-muted-foreground">
          このアカウントは今、読むだけです。保存済みの戦略・投稿の案はそのまま残っています。
        </p>
      </div>
    </section>
  );
}

function PromptReadyCard({
  accountId,
  savedCount,
  savedVersion,
  canSaveCount,
  startKey,
  onReadOnly,
}: {
  accountId: string;
  savedCount: number;
  savedVersion: number;
  canSaveCount: boolean;
  startKey?: string;
  onReadOnly: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  // 「投稿をつくる」を開いたときのキー。同じ移動で2回フォーカスを当てない
  const focusedFor = useRef<string | null>(null);
  const queryClient = useQueryClient();
  // count：プロンプトの取得に使う件数。countInput：入力欄の文字（保存の前の値も持つ）。
  // saved：サーバーに保存できた件数。failed：保存に失敗した件数と理由（同じ件数は自動で送り直さない）
  const [count, setCount] = useState(savedCount);
  const [countInput, setCountInput] = useState(String(savedCount));
  const [saved, setSaved] = useState(savedCount);
  // 保存に使う版（先に他の人が保存していたら 409 になる。specs/008 FR-007、PR #9 のCodexレビュー）
  const version = useRef(savedVersion);
  // 入力欄を手で変えた回数。保存を始めたときの回数と比べて、保存中に入力が続いたかを確かめる
  // （値の一致では、20に変えて10に戻した場合を見分けられない。PR #9 のCodexレビュー）
  const editGeneration = useRef(0);
  const [failed, setFailed] = useState<{ count: number; message: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const prompt = useQuery({
    queryKey: queryKeys.prompt(accountId, count),
    queryFn: () => api.getPrompt(accountId, count),
    // 表示のたびに最新の材料から作り直す（FR-007）
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (isBillingRequired(prompt.error)) onReadOnly();
  }, [prompt.error, onReadOnly]);

  // 「投稿をつくる」を開いたら、プロンプトを読み込んだ後に、カードまで移って「コピー」にフォーカスを当てる。
  // 作る流れの最初の一歩（プロンプトのコピー）から始められるようにする（specs/004 Clarifications 2026-10-05）。
  // 読み込みに失敗して「コピー」が出ていない間は待ち、「再読み込み」で出た時点で当てる。
  // 実際に当てられたときだけ済ませた扱いにする（PR #5 のCodexレビュー）
  // 再訪で読み込み直している間は待つ（古い「コピー」で済ませた扱いにしない。PR #5 のCodexレビュー）
  const copyShown = prompt.isSuccess && !prompt.isFetching;
  useEffect(() => {
    if (!startKey || !copyShown || focusedFor.current === startKey) return;
    const copyButton = sectionRef.current?.querySelector<HTMLButtonElement>("[data-prompt-copy]");
    if (!copyButton || copyButton.disabled) return;
    sectionRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    copyButton.focus({ preventScroll: true });
    if (document.activeElement === copyButton) focusedFor.current = startKey;
  }, [startKey, copyShown]);

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (n: number) => api.putPromptSettings(accountId, n, version.current),
    onMutate: () => ({ generation: editGeneration.current }),
    onSuccess: ({ postCount, version: v }) => {
      version.current = v;
      setSaved(postCount);
      setFailed(null);
      queryClient.setQueryData<PostDraftList>(queryKeys.postDrafts(accountId), (old) =>
        old ? { ...old, promptPostCount: postCount, promptPostCountVersion: v } : old,
      );
    },
    onError: (err, n, context) => {
      if (isStale(err)) {
        // 自動で保存する欄なので、黙って上書きせず、最新の件数に合わせて知らせる
        const latest = err.latest as { postCount: number; version: number };
        version.current = latest.version;
        setSaved(latest.postCount);
        setCount(latest.postCount);
        setFailed(null);
        if (context?.generation === editGeneration.current) {
          setCountInput(String(latest.postCount));
          toast.info(
            `${staleUpdateTitle(err.updatedBy?.name)}。作る件数を最新の${latest.postCount}件にしました`,
          );
        } else {
          // 保存中に入力が続いていたら、その入力は捨てない（入力が止まった後に、最新の版で保存し直す。PR #9 のCodexレビュー）
          toast.info(
            `${staleUpdateTitle(err.updatedBy?.name)}（${latest.postCount}件）。入力した件数で保存し直します`,
          );
        }
      } else if (isBillingRequired(err)) onReadOnly();
      else setFailed({ count: n, message: saveErrorMessage(err) });
    },
  });

  // 文字数と割合の保存（specs/014 FR-140）。作る件数と同じ版で衝突を見る
  const { mutate: saveLength, isPending: savingLength } = useMutation({
    mutationFn: (length: PostLengthSettings) =>
      api.putPromptSettings(accountId, saved, version.current, length),
    onSuccess: ({ version: v }) => {
      version.current = v;
      queryClient.setQueryData<PostDraftList>(queryKeys.postDrafts(accountId), (old) =>
        old ? { ...old, promptPostCountVersion: v } : old,
      );
      toast.success("文字数と割合を保存しました");
      // プロンプトの数字が変わるので作り直す
      void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(accountId) });
    },
    onError: (err) => {
      if (isStale(err)) {
        const latest = err.latest as { version: number };
        version.current = latest.version;
        toast.info(`${staleUpdateTitle(err.updatedBy?.name)}。最新の文字数と割合を読み込みました`);
        void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(accountId) });
      } else if (isBillingRequired(err)) onReadOnly();
      else toast.error(saveErrorMessage(err));
    },
  });

  // 入力が止まってから0.5秒後に、その件数でプロンプトを取り直す（contracts/ui-routes.md）
  useEffect(() => {
    if (!isValidCount(countInput) || Number(countInput) === count) return;
    const n = Number(countInput);
    const timer = setTimeout(() => {
      setCount(n);
      setEdited(null);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [countInput, count]);

  // 件数の保存は1つずつ順に行う。保存中に件数が変わったら、終わってから最新の件数を保存する（古い値で上書きしない）
  useEffect(() => {
    if (!canSaveCount || count === saved || saving || failed?.count === count) return;
    save(count);
  }, [canSaveCount, count, saved, saving, failed, save]);

  // コピーに失敗したら、全文の欄を開いた後に全選択する（research.md R13）
  useEffect(() => {
    if (copyFailed && open) {
      areaRef.current?.focus();
      areaRef.current?.select();
    }
  }, [copyFailed, open]);

  const fullText = edited ?? prompt.data?.prompt ?? "";
  // 送り方（1つにまとめて／2つに分けて。specs/014 FR-150〜FR-153）
  const [mode, setMode] = useSendMode(prompt.data?.splitRecommended ?? false);
  const split = mode === "split" && !!prompt.data;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopyFailed(false);
      toast.success("コピーしました。ChatGPTやClaudeに貼り付けて送ってください");
    } catch {
      setOpen(true);
      setCopyFailed(true);
    }
  };

  const summary = prompt.data?.summary;

  return (
    <section
      ref={sectionRef}
      aria-label="プロンプト"
      className="scroll-mt-4 space-y-3 rounded-2xl border bg-card px-4 py-4 md:px-5"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="font-semibold">プロンプトをコピーして、ChatGPTやClaudeに送る</h2>
          {summary &&
            (summary.strategyFilledCount === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                <span>課題を入力すると、投稿の精度が上がります</span>{" "}
                <Link to={`/accounts/${accountId}/strategy`} className="text-ring underline">
                  課題を入力する
                </Link>
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                課題 {summary.strategyFilledCount}/{STRATEGY_TOTAL}・宣伝の対象{" "}
                {summary.promotionCount}件・参考投稿 {summary.referencePostCount}件
                {reviewSummary(summary)}を反映
              </p>
            ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor="prompt-count" className="text-sm">
            作る件数
          </label>
          <input
            id="prompt-count"
            type="number"
            inputMode="numeric"
            min={PROMPT_COUNT_MIN}
            max={PROMPT_COUNT_MAX}
            value={countInput}
            aria-invalid={!isValidCount(countInput)}
            onChange={(e) => {
              editGeneration.current += 1;
              setCountInput(e.target.value);
            }}
            className="h-11 w-20 rounded-xl border border-input bg-card px-3 text-right text-base md:h-9 md:text-[15px]"
          />
          <span className="text-sm">件</span>
        </div>
      </div>
      {!isValidCount(countInput) && (
        <p className="text-[13px] text-warning">
          {PROMPT_COUNT_MIN}〜{PROMPT_COUNT_MAX}の整数で入力してください
        </p>
      )}

      {failed && failed.count === count && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1">
            作る件数（{count}件）：{failed.message}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => setFailed(null)}
          >
            もう一度保存
          </Button>
        </div>
      )}

      {/* プロンプトに入っている情報（specs/014 FR-120）。プロンプトを作れる人だけ */}
      {prompt.data?.materials && (
        <PromptMaterials accountId={accountId} materials={prompt.data.materials} />
      )}
      {/* 文字数と長さの割合（specs/014 FR-140）。保存済みの値が変わったら作り直す */}
      {prompt.data?.settings && (
        <LengthSettings
          key={JSON.stringify(prompt.data.settings.length)}
          settings={prompt.data.settings.length}
          count={count}
          canSave={canSaveCount}
          saving={savingLength}
          onSave={saveLength}
        />
      )}

      {prompt.error && !isBillingRequired(prompt.error) ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5 text-sm"
        >
          <span className="min-w-0 flex-1">
            プロンプトを読み込めませんでした。{describeError(prompt.error)}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => void prompt.refetch()}
          >
            再読み込み
          </Button>
        </div>
      ) : (
        <>
          {prompt.data && (
            <SendModeSelect
              length={prompt.data.length}
              recommended={prompt.data.splitRecommended}
              mode={mode}
              onChange={setMode}
            />
          )}
          {split && prompt.data ? (
            <PromptParts parts={prompt.data.parts} />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                data-prompt-copy
                className="h-11 rounded-full px-5 md:h-9"
                disabled={!prompt.data}
                onClick={() => void copy()}
              >
                <CopyIcon className="size-4" />
                コピー
              </Button>
              <Button
                variant="ghost"
                className="h-11 rounded-full md:h-9"
                aria-expanded={open}
                disabled={!prompt.data}
                onClick={() => setOpen((v) => !v)}
              >
                プロンプトを見る
                <ChevronDownIcon
                  className={cn("size-4 transition-transform", open && "rotate-180")}
                />
              </Button>
            </div>
          )}
        </>
      )}

      {copyFailed && (
        <p
          role="alert"
          className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm"
        >
          自動でコピーできませんでした。選択された文字を手でコピーしてください
        </p>
      )}

      {/* 書き換えてコピーできるのは、1つにまとめたときだけ（FR-153） */}
      {open && !split && prompt.data && (
        <div className="space-y-2">
          <Textarea
            ref={areaRef}
            aria-label="プロンプトの全文"
            value={fullText}
            onChange={(e) => setEdited(e.target.value)}
            className="h-72 resize-y font-mono text-[13px] leading-relaxed"
          />
          <div className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
            <span>書き換えた内容は保存されず、コピーにだけ使われます</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={edited === null}
              onClick={() => setEdited(null)}
            >
              元に戻す
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
