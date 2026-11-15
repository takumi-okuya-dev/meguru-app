// 「この人と同じ人」：名前で探して選び、確かめてから、今の人にまとめる（specs/people/001-people-memo research.md R15、US2 AS3）。
// 今開いている人を残し、選んだ人の回答・会ったイベント・同意の記録・メモを移して、選んだ人を消す。
import type { PersonListItem, PersonSummary } from "@meguru/shared/people";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { describeError } from "@/lib/api-client";
import { peopleApi } from "../../lib/api";
import { peopleQueryKeys } from "../../lib/query-keys";
import { refreshAllPeople } from "../../lib/refresh";
import { lastMetLabel } from "./PersonRow";
import { PersonSearchBox } from "./PersonSearchBox";
import { useDebouncedValue } from "./use-debounced-value";

/**
 * 名前で探して、同じ人を選ぶ。
 * @param props - person：今の人、onPick：選んだとき
 * @returns 探す欄と候補
 */
function PickStep({ person, onPick }: { person: PersonSummary; onPick: (other: PersonListItem) => void }) {
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim());
  // 100人を超えて当たっても全員を選べるように、「もっと見る」で続きを読む（PR #119 の Codex レビュー）
  const found = useInfiniteQuery({
    queryKey: [...peopleQueryKeys.personList({ q }), "pages"],
    queryFn: ({ pageParam }) => peopleApi.persons({ q, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.persons.length, 0);
      return loaded < last.total && last.persons.length > 0 ? loaded : undefined;
    },
    enabled: q !== "",
  });
  const others = (found.data?.pages ?? []).flatMap((page) => page.persons).filter((p) => p.id !== person.id);
  return (
    <div className="space-y-3">
      <PersonSearchBox value={text} onChange={setText} label="同じ人を名前で探す" placeholder="名前・LINE名で探す" autoFocus />
      {q === "" ? (
        <p className="text-sm text-muted-foreground">同じ人の名前かLINE名を入れてください。</p>
      ) : found.isPending ? (
        <p className="text-sm text-muted-foreground">探しています…</p>
      ) : found.isError ? (
        <p className="text-sm text-destructive">{describeError(found.error)}</p>
      ) : others.length === 0 ? (
        <p className="text-sm text-muted-foreground">見つかりません。</p>
      ) : (
        <ul className="max-h-[50svh] divide-y overflow-y-auto rounded-xl border" aria-label="見つかった人">
          {others.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent" onClick={() => onPick(p)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.displayName}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {p.lineName && p.lineName !== p.displayName ? `LINE：${p.lineName}・` : ""}
                    {lastMetLabel(p.lastMetOn)}
                  </div>
                </div>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
          {found.hasNextPage && (
            <li>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-center px-3 text-sm text-muted-foreground hover:bg-accent"
                disabled={found.isFetchingNextPage}
                onClick={() => void found.fetchNextPage()}
              >
                {found.isFetchingNextPage ? "読んでいます…" : "もっと見る"}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * 「この人と同じ人」のダイアログ。
 * @param props - person：今の人（残す人）、onClose：閉じる
 * @returns ダイアログ
 */
export function PersonMergeDialog({ person, onClose }: { person: PersonSummary; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [other, setOther] = useState<PersonListItem | null>(null);
  const merge = useMutation({
    mutationFn: (otherId: string) => peopleApi.mergePerson(person.id, otherId),
    onSuccess: async (_kept, otherId) => {
      toast.success("同じ人としてまとめました");
      onClose();
      await refreshAllPeople(queryClient, [otherId]);
    },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby="merge-desc">
        <DialogTitle>{other ? "同じ人としてまとめますか？" : "この人と同じ人"}</DialogTitle>
        {!other ? (
          <>
            <DialogDescription id="merge-desc">「{person.displayName}」と同じ人を選ぶと、この人にまとめます。</DialogDescription>
            <PickStep person={person} onPick={setOther} />
          </>
        ) : (
          <>
            <DialogDescription id="merge-desc" asChild>
              <div className="space-y-2 text-sm text-foreground/80">
                <p>
                  「{other.displayName}」を「{person.displayName}」にまとめます。
                </p>
                <ul className="list-disc space-y-0.5 pl-5">
                  <li>回答・会ったイベント・同意の記録を、この人に移します</li>
                  <li>本名は、この人の本名を残します（なければ相手の本名）</li>
                  <li>メモは、両方にあればつなぎます</li>
                  <li>「{other.displayName}」は一覧からなくなります</li>
                </ul>
                <p>まちがえたときは、回答ごとの「別の人に分ける」で分け直せます。</p>
              </div>
            </DialogDescription>
            {merge.isError && (
              <p role="alert" className="text-sm text-destructive">
                {describeError(merge.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                className="h-11 rounded-full md:h-10"
                onClick={() => {
                  setOther(null);
                  merge.reset();
                }}
              >
                戻る
              </Button>
              <Button className="h-11 rounded-full md:h-10" disabled={merge.isPending} onClick={() => merge.mutate(other.id)}>
                まとめる
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
