// NGワードのダイアログ（specs/004-review-approval FR-014・FR-016a、contracts/ui-routes.md「NGワードのダイアログ」）。
// 追加・削除はその場で保存する。削除は確認を求めず、トーストの「元に戻す」で足し直せる。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NG_WORD_LIMIT, type NgWord } from "@meguru/shared";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { threadsApi } from "@/apps/threads/lib/api";
import { threadsQueryKeys } from "@/apps/threads/lib/query-keys";
import { saveErrorMessage } from "@/lib/save-error";

/**
 * 入力欄の文字を、改行・「、」・「,」で区切って語の一覧にする。
 * @param text - 入力欄の文字
 * @returns 空でない語
 */
export function splitWords(text: string): string[] {
  return text
    .split(/[\n、,，]/)
    .map((w) => w.trim())
    .filter((w) => w !== "");
}

/**
 * NGワードのダイアログ。
 * @param props - accountId、ngWords：登録済みの語（古い順）、onClose：閉じる
 * @returns ダイアログ
 */
export function NgWordsDialog({
  accountId,
  ngWords,
  onClose,
}: {
  accountId: string;
  ngWords: NgWord[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const atLimit = ngWords.length >= NG_WORD_LIMIT;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: threadsQueryKeys.postingRules(accountId) });
    // NGワードはラベル・承認・プロンプトに効き、追加で承認済みが要確認に戻ることがある
    void queryClient.invalidateQueries({ queryKey: threadsQueryKeys.postDrafts(accountId) });
    void queryClient.invalidateQueries({ queryKey: threadsQueryKeys.promptAll(accountId) });
  };

  const add = useMutation({
    mutationFn: (words: string[]) => threadsApi.addNgWords(accountId, words),
    onSuccess: (res) => {
      setText("");
      setNotice(
        res.duplicates.length > 0
          ? `${res.duplicates.map((w) => `「${w}」`).join("")}はすでにあります`
          : null,
      );
      if (res.reopenedCount > 0) {
        toast.success(`NGワードを含む承認済みの下書き${res.reopenedCount}件を、要確認に戻しました`);
      }
    },
    onError: (err) => {
      setNotice(
        err instanceof ApiError && err.code === "ITEM_LIMIT_REACHED"
          ? `NGワードは${NG_WORD_LIMIT}語まで登録できます。`
          : saveErrorMessage(err),
      );
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (w: NgWord) => threadsApi.deleteNgWord(accountId, w.id),
    onSuccess: (_res, w) => {
      toast.success(`「${w.word}」を削除しました`, {
        duration: 5000,
        action: { label: "元に戻す", onClick: () => add.mutate([w.word]) },
      });
    },
    onError: (err) => toast.error(saveErrorMessage(err)),
    onSettled: refresh,
  });

  const submit = () => {
    const words = splitWords(text);
    if (words.length === 0 || add.isPending) return;
    add.mutate(words);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>NGワード</DialogTitle>
          <DialogDescription>
            全角・半角、大文字・小文字の違いは同じ言葉として扱います
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              aria-label="追加するNGワード"
              placeholder="例：絶対、必ず儲かる"
              value={text}
              disabled={atLimit || add.isPending}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="h-11 rounded-xl text-base md:h-10 md:text-[15px]"
            />
            <Button
              className="h-11 rounded-full md:h-10"
              disabled={atLimit || add.isPending || splitWords(text).length === 0}
              onClick={submit}
            >
              追加
            </Button>
          </div>
          {atLimit && (
            <p className="text-[13px] text-warning">上限（{NG_WORD_LIMIT}語）に達しています</p>
          )}
          {notice && (
            <p role="status" className="text-[13px] text-muted-foreground">
              {notice}
            </p>
          )}
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {ngWords.length}/{NG_WORD_LIMIT}語
          </p>
          {ngWords.length === 0 ? (
            <p className="text-sm text-muted-foreground">まだNGワードはありません。</p>
          ) : (
            <ul aria-label="登録済みのNGワード" className="flex flex-wrap gap-2">
              {ngWords.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-3 text-sm"
                >
                  {w.word}
                  <button
                    type="button"
                    aria-label={`${w.word}を削除`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(w)}
                    className="flex size-8 items-center justify-center rounded-full hover:bg-accent"
                  >
                    <XIcon className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
