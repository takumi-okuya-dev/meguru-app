// 画面下部の貼り付け欄（specs/003 US2、contracts/ui-routes.md「貼り付け欄」「登録直後の案内」、research.md R5）。
// 外部LLMの回答を貼り付けて送ると、「@@@」の行で分けて要確認に一括登録する。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DRAFT_BODY_MAX,
  errorMessage,
  findPasteProblem,
  splitDrafts,
  type DraftBatchResult,
} from "@threads-grower/shared";
import { ArrowUpIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { saveErrorMessage } from "@/lib/save-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { STOCK_LIMIT_MESSAGE } from "./messages";

type Notice = { message: string; retry: boolean };
/** 下書きを選んでいるときの状態と操作（003 US3、004 FR-004）。actions はタブごとの操作のボタン。 */
export type DraftSelection = { count: number; onClear: () => void; actions: ReactNode };
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
 * 貼り付け欄。登録直後の案内（件数・取り消し）も、この欄のすぐ上に出す。
 * 下書きを1件でも選んでいる間は、欄の代わりに選択のバーを出す（書きかけの内容は残る）。
 * @param props - accountId：Account の ID、atLimit：要確認の下書きが上限に達しているか（送るボタンを無効にする）、
 *   beforeSubmit：送る前に済ませておく処理（待っている削除の確定）、selection：下書きの選択の状態と操作、
 *   focusKey：欄にフォーカスを当てる移動のキー（押すたびに変わる）
 * @returns 貼り付け欄、または選択のバー
 */
export function PasteComposer({
  accountId,
  atLimit,
  beforeSubmit,
  selection,
  focusKey,
}: {
  accountId: string;
  atLimit: boolean;
  beforeSubmit?: () => Promise<void>;
  selection?: DraftSelection;
  focusKey?: string;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [registered, setRegistered] = useState<Registered | null>(null);
  // 送る前の処理（待っている削除の確定）の最中
  const [preparing, setPreparing] = useState(false);
  // 失敗した送信のIDと内容。同じ内容を送り直すときは同じIDを使う（二重登録を防ぐ。research.md R5）
  const pending = useRef<{ id: string; text: string } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // 書きかけの内容は、移動・タブを閉じる前に確認する（FR-022）
  useUnsavedChanges(text.trim() !== "");

  const focusedFor = useRef<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.postDrafts(accountId) });
    // 直近の下書きはプロンプトの材料なので、件数によらずプロンプトも取り直す
    void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(accountId) });
  };

  const send = useMutation({
    mutationFn: (req: { clientRequestId: string; text: string }) => api.createDraftBatch(accountId, req),
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
    setNotice(null);
    // 前回の登録の案内（「取り消す」）は、次の登録が成功するまで残す
    if (beforeSubmit) {
      setPreparing(true);
      try {
        await beforeSubmit();
      } finally {
        setPreparing(false);
      }
    }
    send.mutate({ clientRequestId: id, text });
  };

  const busy = preparing || send.isPending;
  const blank = text.trim() === "";
  const canSend = !blank && !busy && !atLimit;

  // サイドバーの「投稿をつくる」から来て、プロンプトを作れないとき（プラン1）は、欄にフォーカスを当てる
  // （003 FR-021。プロンプトを作れるときはプロンプトのカードに移る。specs/004 Clarifications 2026-10-05）。
  // 選択のバーで欄が隠れている間や、送信中で欄が使えない間は待つ。実際に欄にフォーカスが移ったときだけ
  // 済ませた扱いにする（PR #5 のCodexレビュー）
  const showingSelection = !!selection && selection.count > 0;
  useEffect(() => {
    const area = areaRef.current;
    if (!focusKey || showingSelection || busy || focusedFor.current === focusKey || !area) return;
    area.focus();
    if (document.activeElement === area) focusedFor.current = focusKey;
  }, [focusKey, showingSelection, busy]);

  if (selection && selection.count > 0) return <SelectionBar selection={selection} />;

  return (
    <div className="space-y-2 pt-2">
      {registered && (
        <RegisteredNotice
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
          placeholder="AIの返信をここに貼り付け…"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          className="field-sizing-content max-h-[calc(8lh+1rem)] min-h-10 flex-1 resize-none bg-transparent py-2 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60 md:text-[15px]"
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
      <p className="px-2 text-center text-xs text-muted-foreground">
        「@@@」で区切られた投稿が、まとめて「要確認」に登録されます
      </p>
    </div>
  );
}

function RegisteredNotice({
  result,
  undoing,
  onUndo,
  onClose,
}: {
  result: DraftBatchResult;
  undoing: boolean;
  onUndo: () => void;
  onClose: () => void;
}) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl border bg-muted/60 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1 space-y-0.5 py-1">
        <p className="font-medium">{result.draftCount}件を登録しました</p>
        {!result.delimiterFound && (
          <p className="text-muted-foreground">区切り（@@@）が見つからなかったため、1件として登録しました</p>
        )}
        {result.overLimitCount > 0 && (
          <p className="text-warning">そのうち{result.overLimitCount}件はThreadsの上限を超えています</p>
        )}
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

function SelectionBar({ selection }: { selection: DraftSelection }) {
  return (
    <div className="pt-2 pb-1">
      <div
        role="toolbar"
        aria-label="選んだ下書きの操作"
        className="flex flex-wrap items-center gap-2 rounded-3xl border bg-card py-2 pr-2 pl-4 shadow-sm"
      >
        <span className="min-w-0 flex-1 text-sm font-medium">{selection.count}件を選択中</span>
        <Button variant="ghost" className="h-10 rounded-full md:h-9" onClick={selection.onClear}>
          選択を解除
        </Button>
        {selection.actions}
      </div>
    </div>
  );
}
