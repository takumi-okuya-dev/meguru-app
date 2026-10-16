// 貼り付け欄（specs/003 US2、contracts/ui-routes.md「貼り付け欄」「登録直後の案内」、research.md R5）。
// 外部LLMの回答を貼り付けて送ると、「@@@」の行で分けて要確認に一括登録する。
// 014で投稿ストックの画面の下から「投稿をつくる」の画面に移し、見出しと登録の後の案内を足した（specs/014 FR-161・FR-162）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DRAFT_BODY_MAX,
  errorMessage,
  findPasteProblem,
  splitDrafts,
  type DraftBatchResult,
} from "@threads-grower/shared";
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

type Notice = { message: string; retry: boolean };
// self：自分で1件書いて登録した（区切りがないのは当たり前なので、その注意は出さない）
type Registered = { result: DraftBatchResult; text: string; self: boolean };

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
 *   focusKey：欄にフォーカスを当てる移動のキー（画面を開くたびに変わる）、
 *   showSelfWrite：「自分で1件書く」とリサーチへの案内を出すか（直せる人だけ。specs/014 FR-132）
 * @returns 貼り付け欄
 */
export function PasteComposer({
  accountId,
  atLimit,
  focusKey,
  showSelfWrite = false,
}: {
  accountId: string;
  atLimit: boolean;
  focusKey?: string;
  showSelfWrite?: boolean;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [registered, setRegistered] = useState<Registered | null>(null);
  // 「自分で1件書く」を押した（欄の案内を変え、区切りがない注意を出さない）
  const [selfWrite, setSelfWrite] = useState(false);
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
    mutationFn: (req: { clientRequestId: string; text: string; self: boolean }) =>
      api.createDraftBatch(accountId, { clientRequestId: req.clientRequestId, text: req.text }),
    onSuccess: (result, req) => {
      pending.current = null;
      setText((current) => (current === req.text ? "" : current));
      setNotice(null);
      setRegistered({ result, text: req.text, self: req.self });
      setSelfWrite(false);
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

  const submit = () => {
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
    send.mutate({ clientRequestId: id, text, self: selfWrite });
  };

  const busy = send.isPending;
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
      <p className="text-[13px] text-muted-foreground">
        AIの答えは、答えの下にあるコピーボタンで全体をコピーしてから貼り付けてください（マウスで選ぶと、区切りの行が抜けることがあります）
      </p>
      {registered && (
        <RegisteredNotice
          accountId={accountId}
          result={registered.result}
          self={registered.self}
          undoing={undo.isPending}
          onUndo={() => undo.mutate(registered)}
          onClose={() => setRegistered(null)}
        />
      )}
      {notice && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">{notice.message}</span>
          {notice.retry && (
            <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={submit}>
              もう一度送る
            </Button>
          )}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-3xl border bg-card py-2 pr-2 pl-4 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <textarea
          ref={areaRef}
          aria-label="AIの返信を貼り付ける欄"
          placeholder={selfWrite ? "投稿の本文を1件書く…" : "AIの返信をここに貼り付け…"}
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
          onClick={submit}
        >
          <ArrowUpIcon className="size-5" />
        </Button>
      </div>
      <p className="px-2 text-xs text-muted-foreground">
        「@@@」で区切られた投稿が、まとめて「要確認」に登録されます
      </p>
      {showSelfWrite && (
        <div className="space-y-1.5 rounded-xl bg-muted/50 px-3.5 py-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1">自分で1件書く：AIを使わずに、1件の本文を書いて登録することもできます</p>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={busy}
              onClick={() => {
                setSelfWrite(true);
                areaRef.current?.focus();
              }}
            >
              自分で1件書く
            </Button>
          </div>
          <p className="text-muted-foreground">
            リサーチした投稿を、自分なりに真似して書いてみよう →{" "}
            <Link to={`/accounts/${accountId}/research`} className="text-ring underline">
              リサーチを見る
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

function RegisteredNotice({
  accountId,
  result,
  self,
  undoing,
  onUndo,
  onClose,
}: {
  accountId: string;
  result: DraftBatchResult;
  self: boolean;
  undoing: boolean;
  onUndo: () => void;
  onClose: () => void;
}) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl border bg-muted/60 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1 space-y-0.5 py-1">
        <p className="font-medium">{result.draftCount}件を投稿ストックに登録しました</p>
        {!result.delimiterFound && !self && (
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
