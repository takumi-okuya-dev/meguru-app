// プロンプトのカード（specs/003 US1、contracts/ui-routes.md「プロンプトのカード」、research.md R11・R13）。
// 戦略プロファイルから組み立てたプロンプトを、件数を選んでコピーする。grower機能を使えないAccountでは案内に変わる。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PROMPT_COUNT_MAX, PROMPT_COUNT_MIN, STRATEGY_TOTAL, type PostDraftList } from "@threads-grower/shared";
import { ChevronDownIcon, CopyIcon, LockIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { PLAN_CHANGE_CONTACT } from "@/components/GrowerRequiredNotice";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { isGrowerRequired, saveErrorMessage } from "@/lib/save-error";
import { cn } from "@/lib/utils";

/** 作る件数を変えてから保存するまでの待ち時間（ミリ秒） */
const SAVE_DELAY_MS = 500;

const isValidCount = (s: string) => /^\d+$/.test(s) && Number(s) >= PROMPT_COUNT_MIN && Number(s) <= PROMPT_COUNT_MAX;

/**
 * プロンプトのカード。
 * @param props - accountId：Account の ID、canGeneratePrompt：grower機能を使えるか、promptPostCount：保存済みの作る件数
 * @returns プロンプトのカード（使えないときは案内）
 */
export function PromptCard({
  accountId,
  canGeneratePrompt,
  promptPostCount,
}: {
  accountId: string;
  canGeneratePrompt: boolean;
  promptPostCount: number;
}) {
  const [growerLost, setGrowerLost] = useState(false);
  if (!canGeneratePrompt || growerLost) return <PromptLockedCard />;
  return <PromptReadyCard accountId={accountId} savedCount={promptPostCount} onGrowerLost={() => setGrowerLost(true)} />;
}

function PromptLockedCard() {
  return (
    <section aria-label="プロンプト" className="flex gap-3 rounded-2xl border bg-muted/60 px-4 py-4">
      <LockIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="font-semibold">AIプロンプトの生成はプラン2以上で使えます</h2>
        <p className="text-sm text-muted-foreground">
          自分で用意した投稿も、「@@@」だけの行で区切って下の欄に貼り付ければ、まとめて登録できます。{PLAN_CHANGE_CONTACT}
        </p>
      </div>
    </section>
  );
}

function PromptReadyCard({
  accountId,
  savedCount,
  onGrowerLost,
}: {
  accountId: string;
  savedCount: number;
  onGrowerLost: () => void;
}) {
  const queryClient = useQueryClient();
  // count：プロンプトの取得に使う件数。countInput：入力欄の文字（保存の前の値も持つ）
  const [count, setCount] = useState(savedCount);
  const [countInput, setCountInput] = useState(String(savedCount));
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
    if (isGrowerRequired(prompt.error)) onGrowerLost();
  }, [prompt.error, onGrowerLost]);

  const saveCount = useMutation({
    mutationFn: (n: number) => api.putPromptSettings(accountId, n),
    onSuccess: ({ postCount }) => {
      queryClient.setQueryData<PostDraftList>(queryKeys.postDrafts(accountId), (old) =>
        old ? { ...old, promptPostCount: postCount } : old,
      );
    },
    onError: (err) => (isGrowerRequired(err) ? onGrowerLost() : toast.error(saveErrorMessage(err))),
  });
  const { mutate: save } = saveCount;

  // 入力が止まってから0.5秒後に、保存して取り直す（contracts/ui-routes.md）
  useEffect(() => {
    if (!isValidCount(countInput) || Number(countInput) === count) return;
    const n = Number(countInput);
    const timer = setTimeout(() => {
      setCount(n);
      setEdited(null);
      save(n);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [countInput, count, save]);

  // コピーに失敗したら、全文の欄を開いた後に全選択する（research.md R13）
  useEffect(() => {
    if (copyFailed && open) {
      areaRef.current?.focus();
      areaRef.current?.select();
    }
  }, [copyFailed, open]);

  const fullText = edited ?? prompt.data?.prompt ?? "";

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
    <section aria-label="プロンプト" className="space-y-3 rounded-2xl border bg-card px-4 py-4 md:px-5">
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
                課題 {summary.strategyFilledCount}/{STRATEGY_TOTAL}・宣伝の対象 {summary.promotionCount}件・参考投稿{" "}
                {summary.referencePostCount}件を反映
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
            onChange={(e) => setCountInput(e.target.value)}
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

      {prompt.error && !isGrowerRequired(prompt.error) ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
          <span className="min-w-0 flex-1">プロンプトを読み込めませんでした。{describeError(prompt.error)}</span>
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => void prompt.refetch()}>
            再読み込み
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button className="h-11 rounded-full px-5 md:h-9" disabled={!prompt.data} onClick={() => void copy()}>
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
            <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      )}

      {copyFailed && (
        <p role="alert" className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm">
          自動でコピーできませんでした。選択された文字を手でコピーしてください
        </p>
      )}

      {open && prompt.data && (
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
            <Button size="sm" variant="ghost" disabled={edited === null} onClick={() => setEdited(null)}>
              元に戻す
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
