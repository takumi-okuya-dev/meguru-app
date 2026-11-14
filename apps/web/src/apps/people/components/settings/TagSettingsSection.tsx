// 設定のタグの段：タグの一覧（人数つき）・名前を直す・消す（specs/people/002-sales-list spec US1 AS4、FR-101）。
// 消すと、付けていた人すべてから外れる。同じ名前（nameKey）は 409 PEOPLE_NAME_TAKEN（「同じ名前がもうあります。」）。
import { countChars } from "@meguru/shared";
import { TAG_NAME_MAX, type PeopleTag } from "@meguru/shared/people";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { fieldClass } from "../EventForm";
import { peopleApi } from "../../lib/api";
import { refreshTags } from "../../lib/refresh";
import { peopleQueryKeys } from "../../lib/query-keys";

/**
 * タグの1行（名前を直す・消す）。
 * @param props - tag：タグ
 * @returns 行
 */
function TagRow({ tag }: { tag: PeopleTag }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(tag.name);
  const rename = useMutation({
    mutationFn: (next: string) => peopleApi.renameTag(tag.id, next),
    onSuccess: async () => {
      setEditing(false);
      toast.success("タグの名前を直しました");
      await refreshTags(queryClient);
    },
  });
  const remove = useMutation({
    mutationFn: () => peopleApi.deleteTag(tag.id),
    onSuccess: async () => {
      toast.success("タグを消しました");
      await refreshTags(queryClient);
    },
  });
  const text = name.trim();
  const tooLong = countChars(text) > TAG_NAME_MAX;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text === "" || tooLong) return;
    if (text === tag.name) setEditing(false);
    else rename.mutate(text);
  };
  const error = rename.error ?? remove.error;
  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      {editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
          <label htmlFor={`${id}-name`} className="sr-only">
            「{tag.name}」の新しい名前
          </label>
          <input id={`${id}-name`} className={cn(fieldClass, "min-w-0 flex-1 basis-40")} value={name} aria-invalid={tooLong} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" className="h-11 rounded-full md:h-9" disabled={rename.isPending || text === "" || tooLong}>
            保存
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-full md:h-9"
            onClick={() => {
              setName(tag.name);
              setEditing(false);
              rename.reset();
            }}
          >
            やめる
          </Button>
          {tooLong && <p className="w-full text-[13px] text-destructive">タグの名前は{TAG_NAME_MAX}文字までです。</p>}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 flex-1 break-words font-medium">#{tag.name}</span>
          <span className="text-muted-foreground tabular-nums">{tag.personCount}人</span>
          <Button type="button" variant="ghost" className="h-11 rounded-full px-3 md:h-8" aria-label={`「${tag.name}」の名前を直す`} onClick={() => setEditing(true)}>
            名前を直す
          </Button>
          {!confirming && (
            <Button type="button" variant="ghost" className="h-11 rounded-full px-3 text-destructive md:h-8" aria-label={`「${tag.name}」を消す`} onClick={() => setConfirming(true)}>
              消す
            </Button>
          )}
        </div>
      )}
      {confirming && !editing && (
        <div role="group" aria-label={`「${tag.name}」を消す確かめ`} className="space-y-2 rounded-xl bg-muted p-3">
          <p>付けていた{tag.personCount}人から外れます。人は消えません。</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" className="h-11 rounded-full md:h-9" disabled={remove.isPending} onClick={() => remove.mutate()}>
              タグを消す
            </Button>
            <Button type="button" variant="ghost" className="h-11 rounded-full md:h-9" onClick={() => setConfirming(false)}>
              やめる
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {describeError(error)}
        </p>
      )}
    </li>
  );
}

/**
 * タグの段。
 * @returns 段
 */
export function TagSettingsSection() {
  const id = useId();
  const tags = useQuery({ queryKey: peopleQueryKeys.tags, queryFn: peopleApi.tags });
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-base font-semibold">
        タグ
      </h2>
      <p className="text-sm text-muted-foreground">タグは人のページで付けます。ここでは名前を直したり、消したりできます。</p>
      {tags.isPending ? (
        <p className="text-sm text-muted-foreground">読み込んでいます…</p>
      ) : tags.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {describeError(tags.error)}
        </p>
      ) : tags.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだタグはありません。</p>
      ) : (
        <ul aria-label="タグの一覧" className="divide-y rounded-2xl border bg-card">
          {tags.data.map((t) => (
            <TagRow key={`${t.id}:${t.name}`} tag={t} />
          ))}
        </ul>
      )}
    </section>
  );
}
