// 人のページの SNS のリンクの段：Instagram・X・Facebook のプロフィールの URL（specs/people/002-sales-list spec US6、FR-110）。
// そのサービスの https の URL だけを残す（isAllowedLinkUrl。最後はAPIが確かめる）。押すと新しいタブで開く（rel="noopener noreferrer"）。
import { isAllowedLinkUrl, LINK_KINDS, LINK_URL_MAX, type LinkKind, type PersonLinks } from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { fieldClass } from "../EventForm";
import { peopleApi } from "../../lib/api";
import { refreshPersons } from "../../lib/refresh";
import { LINK_KIND_LABELS } from "./labels";

/** 入れる欄の見本。 */
const PLACEHOLDERS: Record<LinkKind, string> = {
  instagram: "https://www.instagram.com/…",
  x: "https://x.com/…",
  facebook: "https://www.facebook.com/…",
};

/**
 * 欄の値の確かめ（空は外す・それ以外はそのサービスの https の URL だけ）。
 * @param kind - 種類
 * @param value - 入れた値
 * @returns よければ true
 */
function validLink(kind: LinkKind, value: string): boolean {
  const v = value.trim();
  return v === "" || (v.length <= LINK_URL_MAX && isAllowedLinkUrl(kind, v));
}

/**
 * 今のリンクを欄の値にする。
 * @param links - 今のリンク
 * @returns 種類ごとの欄の値
 */
function linkValues(links: PersonLinks): Record<LinkKind, string> {
  return { instagram: links.instagram ?? "", x: links.x ?? "", facebook: links.facebook ?? "" };
}

/**
 * SNS のリンクの段。リンクが変わったら呼ぶ側が key を変えて作り直す。
 * @param props - personId：人、links：今のリンク
 * @returns 段
 */
export function PersonLinksSection({ personId, links }: { personId: string; links: PersonLinks }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<LinkKind, string>>(() => linkValues(links));
  const save = useMutation({
    mutationFn: () => peopleApi.setPersonLinks(personId, Object.fromEntries(LINK_KINDS.map((k) => [k, values[k].trim() === "" ? null : values[k].trim()]))),
    onSuccess: async () => {
      setEditing(false);
      toast.success("リンクを保存しました");
      await refreshPersons(queryClient);
    },
  });
  const allValid = LINK_KINDS.every((k) => validLink(k, values[k]));
  const present = LINK_KINDS.filter((k) => links[k] && isAllowedLinkUrl(k, links[k]));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (allValid) save.mutate();
  };
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-sm font-medium text-muted-foreground">
        SNS のリンク
      </h2>
      <div className="space-y-3 rounded-2xl border bg-card p-4">
        {present.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {present.map((k) => (
              <Button key={k} asChild variant="outline" className="h-11 rounded-full md:h-9">
                <a href={links[k]} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon /> {LINK_KIND_LABELS[k]}を開く
                </a>
              </Button>
            ))}
          </div>
        ) : (
          !editing && <p className="text-sm text-muted-foreground">まだリンクはありません。</p>
        )}
        {editing ? (
          <form className="space-y-3" onSubmit={submit} noValidate>
            {LINK_KINDS.map((k) => {
              const bad = !validLink(k, values[k]);
              return (
                <div key={k} className="space-y-1">
                  <label htmlFor={`${id}-${k}`} className="text-sm font-medium">
                    {LINK_KIND_LABELS[k]}
                  </label>
                  <input
                    id={`${id}-${k}`}
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    className={fieldClass}
                    value={values[k]}
                    placeholder={PLACEHOLDERS[k]}
                    aria-invalid={bad}
                    onChange={(e) => setValues((old) => ({ ...old, [k]: e.target.value }))}
                  />
                  {bad && <p className="text-[13px] text-destructive">{LINK_KIND_LABELS[k]}の https:// から始まるプロフィールのURLを入れてください。</p>}
                </div>
              );
            })}
            {save.isError && (
              <p role="alert" className="text-[13px] text-destructive">
                {describeError(save.error)}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="h-11 rounded-full md:h-9" disabled={!allValid || save.isPending}>
                リンクを保存
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 rounded-full md:h-9"
                onClick={() => {
                  // 捨てた入力を残さない（今のリンクに戻す）
                  setValues(linkValues(links));
                  save.reset();
                  setEditing(false);
                }}
              >
                やめる
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="ghost" className="h-11 rounded-full px-3 md:h-9" onClick={() => setEditing(true)}>
            リンクを直す
          </Button>
        )}
      </div>
    </section>
  );
}
