// 人のページのタグの段：付ける・外す・新しい名前で作る（specs/people/002-sales-list spec US1、FR-101）。
// 新しい名前は、同じ名前（nameKey）のタグがあればそれを付ける（APIが決める）。
import { TAG_NAME_MAX, TAGS_PER_PERSON_MAX, type PersonTag } from "@meguru/shared/people";
import { countChars } from "@meguru/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { fieldClass } from "../EventForm";
import { peopleApi } from "../../lib/api";
import { peopleQueryKeys } from "../../lib/query-keys";
import { refreshTags } from "../../lib/refresh";

/** はじめに出す、付けられるタグの数。 */
const SUGGESTIONS = 12;

/**
 * 名前を比べる形（全角・半角と大文字・小文字をそろえる。最後に決めるのはAPIの nameKey）。
 * @param s - 名前
 * @returns 比べる形
 */
function looseName(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase();
}

/**
 * タグの段。
 * @param props - personId：人、tags：付いているタグ
 * @returns 段
 */
export function PersonTagsSection({ personId, tags }: { personId: string; tags: PersonTag[] }) {
  const id = useId();
  const queryClient = useQueryClient();
  const all = useQuery({ queryKey: peopleQueryKeys.tags, queryFn: peopleApi.tags });
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: (input: { tagIds: string[]; newTagNames: string[] }) => peopleApi.setPersonTags(personId, input),
    onSuccess: async () => {
      setText("");
      await refreshTags(queryClient);
    },
  });
  const current = tags.map((t) => t.id);
  const full = tags.length >= TAGS_PER_PERSON_MAX;
  const name = text.trim();
  const tooLong = countChars(name) > TAG_NAME_MAX;
  const unattached = (all.data ?? []).filter((t) => !current.includes(t.id));
  const suggestions = (name === "" ? unattached : unattached.filter((t) => looseName(t.name).includes(looseName(name)))).slice(0, SUGGESTIONS);

  /**
   * 今のタグにもう1つ足す。
   * @param tagId - 付けるタグ
   */
  const attach = (tagId: string) => {
    save.mutate({ tagIds: [...current, tagId], newTagNames: [] });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name === "" || tooLong || full) return;
    const same = (all.data ?? []).find((t) => looseName(t.name) === looseName(name));
    if (same) {
      if (!current.includes(same.id)) attach(same.id);
      else setText("");
      return;
    }
    save.mutate({ tagIds: current, newTagNames: [name] });
  };

  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-sm font-medium text-muted-foreground">
        タグ
      </h2>
      <div className="space-y-3 rounded-2xl border bg-card p-4">
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだタグはありません。「常連」「登壇してくれそう」のように付けると、一覧で絞れます。</p>
        ) : (
          <ul aria-label="付いているタグ" className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <li key={t.id} className="inline-flex max-w-full items-center rounded-full bg-muted pl-3 text-sm">
                <span className="truncate">#{t.name}</span>
                <button
                  type="button"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-accent md:size-8"
                  aria-label={`「${t.name}」を外す`}
                  disabled={save.isPending}
                  onClick={() => save.mutate({ tagIds: current.filter((x) => x !== t.id), newTagNames: [] })}
                >
                  <XIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="space-y-1" onSubmit={submit}>
          <label htmlFor={`${id}-new`} className="text-sm font-medium">
            タグを付ける
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`${id}-new`}
              className={cn(fieldClass, "min-w-0 flex-1 basis-40")}
              value={text}
              autoComplete="off"
              placeholder="名前を入れるか、下から選ぶ"
              aria-invalid={tooLong}
              disabled={full}
              onChange={(e) => setText(e.target.value)}
            />
            <Button type="submit" className="h-11 rounded-full md:h-9" disabled={save.isPending || name === "" || tooLong || full}>
              <PlusIcon /> 付ける
            </Button>
          </div>
          {tooLong && <p className="text-[13px] text-destructive">タグの名前は{TAG_NAME_MAX}文字までです。</p>}
          {full && <p className="text-[13px] text-muted-foreground">1人に付けられるタグは{TAGS_PER_PERSON_MAX}までです。</p>}
        </form>
        {suggestions.length > 0 && !full && (
          <div role="group" aria-label="付けられるタグ" className="flex flex-wrap gap-2">
            {suggestions.map((t) => (
              <button
                key={t.id}
                type="button"
                className="inline-flex min-h-11 max-w-full items-center rounded-full border bg-card px-3 text-sm hover:bg-accent md:min-h-8"
                disabled={save.isPending}
                onClick={() => attach(t.id)}
              >
                <span className="truncate">＋#{t.name}</span>
              </button>
            ))}
          </div>
        )}
        {save.isError && (
          <p role="alert" className="text-[13px] text-destructive">
            {describeError(save.error)}
          </p>
        )}
      </div>
    </section>
  );
}
