// 人のページのメモの段：見た目の特徴（300文字まで）と話したこと（1,000文字まで）。specs/people/001-people-memo contracts/api.md 4、FR-015。
// メモは画面の中とAPIにだけ置く（ブラウザの保存・ログに書かない。research.md R18）。
import { countChars } from "@meguru/shared";
import { MEMO_APPEARANCE_MAX, MEMO_TALK_MAX, type PersonDetail, type PersonSummary } from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { peopleApi } from "../../lib/api";
import { peopleQueryKeys } from "../../lib/query-keys";
import { refreshPersons } from "../../lib/refresh";

/**
 * 空白だけのメモは null にする。
 * @param s - 入れたメモ
 * @returns 送るメモ
 */
function memoValue(s: string): string | null {
  return s.trim() === "" ? null : s;
}

/**
 * メモの段。人が変わったら（まとめる・分けるのあと）呼ぶ側が key を変えて作り直す。
 * @param props - person：人
 * @returns メモの段
 */
export function PersonMemoSection({ person }: { person: PersonSummary }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [appearance, setAppearance] = useState(person.memoAppearance ?? "");
  const [talk, setTalk] = useState(person.memoTalk ?? "");
  const dirty = appearance !== (person.memoAppearance ?? "") || talk !== (person.memoTalk ?? "");
  const over = countChars(appearance) > MEMO_APPEARANCE_MAX || countChars(talk) > MEMO_TALK_MAX;
  const save = useMutation({
    mutationFn: () => peopleApi.updatePerson(person.id, { memoAppearance: memoValue(appearance), memoTalk: memoValue(talk) }),
    onSuccess: async (saved) => {
      // APIが前後の空白を外すので、保存した形を欄に戻す
      setAppearance(saved.memoAppearance ?? "");
      setTalk(saved.memoTalk ?? "");
      // 読み直しが終わる前に「まだ保存していない」に見えないよう、人のページの中身を先に替える
      queryClient.setQueryData<PersonDetail>(peopleQueryKeys.person(person.id), (old) => (old ? { ...old, person: saved } : old));
      toast.success("メモを保存しました");
      await refreshPersons(queryClient);
    },
  });
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-sm font-medium text-muted-foreground">
        メモ
      </h2>
      <div className="space-y-4 rounded-2xl border bg-card p-4">
        <FieldWithCounter
          id={`${id}-appearance`}
          label="見た目の特徴"
          placeholder="例：背が高い・メガネ・青いバッグ"
          value={appearance}
          onChange={setAppearance}
          max={MEMO_APPEARANCE_MAX}
          rows={2}
        />
        <FieldWithCounter
          id={`${id}-talk`}
          label="話したこと"
          placeholder="例：転職を考えている。デザインの勉強中"
          value={talk}
          onChange={setTalk}
          max={MEMO_TALK_MAX}
          rows={4}
        />
        {save.isError && (
          <p role="alert" className="text-[13px] text-destructive">
            {describeError(save.error)}
          </p>
        )}
        <div className="flex justify-end">
          <Button className="h-11 rounded-full md:h-9" disabled={!dirty || over || save.isPending} onClick={() => save.mutate()}>
            メモを保存
          </Button>
        </div>
      </div>
    </section>
  );
}
