// 貼り付け欄（specs/003 US2、contracts/ui-routes.md「貼り付け欄」「登録直後の案内」、research.md R5）。
// 外部LLMの回答を貼り付けて送ると、「@@@」の行で分けて要確認に一括登録する。
// 014で投稿ストックの画面の下から「投稿をつくる」の画面に移し、見出しと登録の後の案内を足した（specs/014 FR-161・FR-162）。
// 文字を減らすため、コピーの注意（FR-131）と「自分で1件書く」（FR-132）を外し、区切りの案内は欄の中に入れた（2026-11-04）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DRAFT_BODY_MAX,
  errorMessage,
  findPasteProblem,
  splitDrafts,
  type DraftBatchResult,
} from "@meguru/shared";
import { ArrowUpIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { saveErrorMessage } from "@/lib/save-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { STOCK_LIMIT_MESSAGE } from "./messages";
import { flushPendingDeletes } from "./use-deferred-delete";

type Notice = { message: string; retry: boolean };
type Registered = { result: DraftBatchResult; text: string };

/**
 * 上限を超えたときの案内。N件目が長いときは、その件も添える。
 * @param details - "text"・"drafts"・"draft:N" のどれか
 * @returns 案内の文言
 */
function pasteTooLargeMessage(details: string[]): string {
  const base = errorMessage("PASTE_TOO_LARGE").message;
  const n = /^draft:(\d+)$/.exec(details[0] ?? "")?.[1];
  return n ? `${n}件目が${DRAFT_BODY_MAX.toLocaleString()}文字を超えています。${base}` : base;
}

/**
 * 貼り付け欄。登録直後の案内（件数・投稿ストックで確かめる・取り消し）も、この欄のすぐ上に出す。
 * @param props - accountId：Account の ID、atLimit：要確認の下書きが上限に達しているか（送るボタンを無効にする）、
 *   focusKey：欄にフォーカスを当てる移動のキー（画面を開くたびに変わる）
 * @returns 貼り付け欄
 */
export function PasteComposer({
  accountId,
  atLimit,
  focusKey,
}: {
  accountId: string;
  atLimit: boolean;
  focusKey?: string;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [registered, setRegistered] = useState<Registered | null>(null);
  // 送る前に、待っている削除（投稿ストックの「元に戻す」の間）を確定している間（PR #17 のCodexレビュー）
  const [preparing, setPreparing] = useState(false);
  // 失敗した送信のIDと内容。同じ内容を送り直すときは同じIDを使う（二重登録を防ぐ。research.md R5）
  const pending = useRef<{ id: string; text: string } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const headingId = useId();

  // 書きかけの内容は、移動・タブを閉じる前に確認する（FR-022）
  useUnsavedChanges(text.trim() !== "");

  const focusedFor = useRef<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(accountId) });
    // 直近の下書きはプロンプトの材料なので、件数によらずプロンプトも取り直す
    void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(accountId) });
  };

  const send = useMutation({
    mutationFn: (req: { clientRequestId: string; text: string }) =>
      api.createDraftBatch(accountId, { clientRequestId: req.clientRequestId, text: req.text }),
    onSuccess: (result, req) => {
      pending.current = null;
      setText((current) => (current === req.text ? "" : current));
      setNotice(null);
      setRegistered({ result, text: req.text });
      refresh();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "PASTE_TOO_LARGE") {
        pending.current = null;
        setNotice({ message: pasteTooLargeMessage(err.details), retry: false });
      } else if (err instanceof ApiError && err.code === "ITEM_LIMIT_REACHED") {
        pending.current = null;
        setNotice({ message: STOCK_LIMIT_MESSAGE, retry: false });
        refresh();
      } else {
        setNotice({ message: saveErrorMessage(err), retry: true });
      }
    },
  });

  const undo = useMutation({
    mutationFn: (r: Registered) => api.deleteDraftBatch(accountId, r.result.batchId),
    onSuccess: ({ deletedCount }, r) => {
      setRegistered(null);
      // 書きかけの内容があれば上書きしない
      setText((current) => (current.trim() === "" ? r.text : current));
      toast.success(`${deletedCount}件の登録を取り消しました`);
      refresh();
    },
    onError: (err) => toast.error(saveErrorMessage(err)),
  });

  const submit = async () => {
    const { parts } = splitDrafts(text);
    const problem = findPasteProblem(text, parts);
    if (problem) {
      setNotice({ message: pasteTooLargeMessage([problem]), retry: false });
      return;
    }
    const id = pending.current?.text === text ? pending.current.id : crypto.randomUUID();
    pending.current = { id, text };
    // 前回の登録の案内（「取り消す」）は、次の登録が成功するまで残す
    setNotice(null);
    // 削除して確定を待っている下書きは、まだサーバーで数えられているので、登録の前に確定する（別の画面で削除した分も待つ）
    setPreparing(true);
    try {
      await flushPendingDeletes();
    } finally {
      setPreparing(false);
    }
    send.mutate({ clientRequestId: id, text });
  };

  const busy = preparing || send.isPending;
  const blank = text.trim() === "";
  const canSend = !blank && !busy && !atLimit;

  // 「投稿をつくる」を開いて、プロンプトを作れないとき（読むだけ）は、欄にフォーカスを当てる
  // （003 FR-021。プロンプトを作れるときはプロンプトのカードの「コピー」に当てる。specs/004 Clarifications 2026-10-05）。
  // 送信中で欄が使えない間は待つ。実際に欄にフォーカスが移ったときだけ済ませた扱いにする（PR #5 のCodexレビュー）
  useEffect(() => {
    const area = areaRef.current;
    if (!focusKey || busy || focusedFor.current === focusKey || !area) return;
    area.focus();
    if (document.activeElement === area) focusedFor.current = focusKey;
  }, [focusKey, busy]);

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="font-semibold">
        AIの答えを貼り付けて、投稿ストックに登録する
      </h2>
      {registered && (
        <RegisteredNotice
          accountId={accountId}
          result={registered.result}
          undoing={undo.isPending}
          onUndo={() => undo.mutate(registered)}
          onClose={() => setRegistered(null)}
        />
      )}
      {notice && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">{notice.message}</span>
          {notice.retry && (
            <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => void submit()}>
              もう一度送る
            </Button>
          )}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-3xl border bg-card py-2 pr-2 pl-4 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <textarea
          ref={areaRef}
          aria-label="AIの返信を貼り付ける欄"
          placeholder={"AIの返信をここに貼り付け…\n「@@@」で区切られた投稿が、まとめて「要確認」に登録されます"}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="field-sizing-content max-h-[calc(12lh+1rem)] min-h-28 flex-1 resize-none bg-transparent py-2 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60 md:text-[15px]"
        />
        <Button
          size="icon"
          className="size-10 shrink-0 rounded-full"
          aria-label="投稿ストックに登録する"
          disabled={!canSend}
          onClick={() => void submit()}
        >
          <ArrowUpIcon className="size-5" />
        </Button>
      </div>
    </section>
  );
}

function RegisteredNotice({
  accountId,
  result,
  undoing,
  onUndo,
  onClose,
}: {
  accountId: string;
  result: DraftBatchResult;
  undoing: boolean;
  onUndo: () => void;
  onClose: () => void;
}) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl border bg-muted/60 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1 space-y-0.5 py-1">
        <p className="font-medium">{result.draftCount}件を投稿ストックに登録しました</p>
        {!result.delimiterFound && (
          <p className="text-muted-foreground">区切り（@@@）が見つからなかったため、1件として登録しました</p>
        )}
        {result.overLimitCount > 0 && (
          <p className="text-warning">そのうち{result.overLimitCount}件はThreadsの上限を超えています</p>
        )}
        <Link to={`/accounts/${accountId}/stock`} className="inline-block pt-0.5 text-ring underline">
          投稿ストックで確かめる
        </Link>
      </div>
      <Button size="sm" variant="ghost" className="rounded-full" disabled={undoing} onClick={onUndo}>
        取り消す
      </Button>
      <Button size="icon" variant="ghost" className="size-8 rounded-full" aria-label="閉じる" onClick={onClose}>
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}
