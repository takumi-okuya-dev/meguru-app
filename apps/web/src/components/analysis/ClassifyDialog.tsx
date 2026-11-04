// 内容を分類する（specs/022 contracts/ui-routes.md「内容を分類する」、research.md R8）。
// 018の「AIと考える」・021の「AIと整える」と同じく、プロンプトをコピーし、外のAIの答えを貼って反映する（原則III）。
// 「分類済み」では、型とテーマを選び直すとその場で保存する（FR-053）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ANALYSIS_THEME_NAME_MAX,
  ANALYSIS_THEMES_MAX,
  OPENING_TYPE_LABELS,
  OPENING_TYPES,
  classifyPrompt,
  parseClassifyAnswer,
  type AnalysisTheme,
  type ClassifyItem,
  type ClassifyProblem,
  type OpeningType,
} from "@threads-grower/shared";
import { PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { CopyPromptStatus, CopyPromptTrigger, useCopyPrompt } from "@/components/CopyPromptButton";
import { FormDialogFrame } from "@/components/items/FormDialogFrame";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";

type Mode = "unclassified" | "classified";
const STEPS = ["プロンプトをコピーして、ChatGPTやClaudeに送る", "返ってきた答えを、下に丸ごと貼り付けて「読み取る」", "候補を確かめて「反映する」"];
const head = (body: string) => [...body.replace(/\s*\n\s*/g, " ")].slice(0, 24).join("");

/**
 * 書き出しの型とテーマを選ぶ組。
 * @param props - index：何件目（読み上げの名前）、openingType・themeId：今の値、themes：テーマ、onChange：変えたとき
 * @returns 選ぶ組
 */
function ClassSelects({
  index,
  openingType,
  themeId,
  themes,
  disabled,
  onChange,
}: {
  index: number;
  openingType: OpeningType | null;
  themeId: string | null;
  themes: readonly AnalysisTheme[];
  disabled?: boolean;
  onChange: (v: { openingType: OpeningType; themeId: string | null }) => void;
}) {
  const cls = "h-9 rounded-lg border bg-background px-2 text-[13px]";
  return (
    <span className="flex flex-wrap gap-1.5">
      <select
        aria-label={`書き出しの型（${index}）`}
        className={cls}
        value={openingType ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ openingType: e.target.value as OpeningType, themeId })}
      >
        {openingType === null && <option value="">選ぶ</option>}
        {OPENING_TYPES.map((t) => (
          <option key={t} value={t}>
            {OPENING_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <select
        aria-label={`テーマ（${index}）`}
        className={cls}
        value={themeId ?? ""}
        disabled={disabled || openingType === null}
        onChange={(e) => openingType && onChange({ openingType, themeId: e.target.value || null })}
      >
        <option value="">テーマなし</option>
        {themes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * テーマの一覧（タグ）と、直す欄。
 * @param props - accountId：Account、themes：今のテーマ、version：設定の版、canSave：保存できるか
 * @returns テーマの一覧
 */
function ThemeEditor({ accountId, themes, version }: { accountId: string; themes: readonly AnalysisTheme[]; version: number | null }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id?: string; name: string }[] | null>(null);
  const save = useMutation({
    mutationFn: (next: { id?: string; name: string }[]) =>
      api.patchAnalysisSettings(accountId, { expectedVersion: version, themes: next.filter((t) => t.name.trim() !== "") }),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.analysisAll(accountId) });
    },
    onError: (err) => toast.error(describeError(err)),
  });
  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {themes.length === 0 && <span className="text-[13px] text-muted-foreground">まだありません</span>}
        {themes.map((t) => (
          <span key={t.id} className="rounded-full border px-2.5 py-0.5 text-[12px]">
            {t.name}
          </span>
        ))}
        <Button variant="outline" size="sm" className="h-8 rounded-full text-[12px]" onClick={() => setEditing(themes.map((t) => ({ ...t })))}>
          テーマを直す
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5" aria-label="テーマを直す">
        {editing.map((t, i) => (
          <li key={t.id ?? `new-${i}`} className="flex items-center gap-1.5">
            <input
              aria-label={`テーマ${i + 1}の名前`}
              value={t.name}
              maxLength={ANALYSIS_THEME_NAME_MAX}
              onChange={(e) => setEditing(editing.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}
              className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-[13px]"
            />
            <button
              type="button"
              aria-label={`テーマ${i + 1}を消す`}
              onClick={() => setEditing(editing.filter((_, k) => k !== i))}
              className="flex size-9 items-center justify-center rounded-lg hover:bg-accent"
            >
              <XIcon className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        {editing.length < ANALYSIS_THEMES_MAX && (
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing([...editing, { name: "" }])}>
            <PlusIcon className="size-4" />
            テーマを足す
          </Button>
        )}
        <Button size="sm" className="rounded-full" disabled={save.isPending} onClick={() => save.mutate(editing)}>
          テーマを保存
        </Button>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setEditing(null)}>
          やめる
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground">10個まで。テーマを消すと、そのテーマの分類は「テーマなし」になります。</p>
    </div>
  );
}

/**
 * 内容を分類するポップアップ。
 * @param props - accountId：Account、settingsVersion：設定の版、onRequestClose：閉じる
 * @returns ポップアップ
 */
export function ClassifyDialog({
  accountId,
  settingsVersion,
  onRequestClose,
}: {
  accountId: string;
  settingsVersion: number | null;
  onRequestClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("unclassified");
  const [paste, setPaste] = useState("");
  const [parsed, setParsed] = useState<{ items: ClassifyItem[]; problems: ClassifyProblem[] } | null>(null);
  const pasteId = useId();
  const list = useQuery({
    queryKey: queryKeys.classifications(accountId, mode),
    queryFn: () => api.classifications(accountId, mode),
  });
  const posts = list.data?.posts ?? [];
  const themes = list.data?.themes ?? [];
  const targets = posts.map((p) => ({ draftId: p.draftId, body: p.body }));
  const copy = useCopyPrompt({ getText: () => classifyPrompt(targets, themes) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.analysisAll(accountId) });
  const apply = useMutation({
    mutationFn: (items: ClassifyItem[]) =>
      api.putClassifications(accountId, {
        source: "ai",
        items: items.map((i) => ({ draftId: i.draftId, openingType: i.openingType, themeId: i.themeId })),
      }),
    onSuccess: (res) => {
      toast.success(`${res.saved}件の分類を反映しました`);
      refresh();
      onRequestClose();
    },
    onError: (err) => toast.error(describeError(err)),
  });
  const fix = useMutation({
    mutationFn: (item: { draftId: string; openingType: OpeningType; themeId: string | null }) =>
      api.putClassifications(accountId, { source: "manual", items: [item] }),
    onSuccess: refresh,
    onError: (err) => toast.error(describeError(err)),
  });
  const bodyOf = new Map(posts.map((p) => [p.draftId, p.body]));
  const items = parsed?.items ?? [];

  return (
    <FormDialogFrame
      title="内容を分類する"
      description="ChatGPTやClaudeに、投稿の書き出しの型とテーマを分けてもらいます"
      submitLabel={mode === "unclassified" ? `${items.length}件を反映する` : "閉じる"}
      submitting={apply.isPending}
      submitDisabled={mode === "unclassified" && items.length === 0}
      onSubmit={() => (mode === "unclassified" ? apply.mutate(items) : onRequestClose())}
      onRequestClose={onRequestClose}
    >
      <div className="space-y-4 text-sm leading-relaxed">
        <div role="tablist" aria-label="分類する投稿" className="flex gap-1.5">
          {(
            [
              ["unclassified", "まだの投稿"],
              ["classified", "分類済み"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => {
                setMode(key);
                setParsed(null);
              }}
              className={cn(
                "h-9 rounded-full border px-3.5 text-[13px]",
                mode === key ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-accent",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {list.isPending ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted" aria-busy="true" />
        ) : list.isError ? (
          <p role="alert" className="text-destructive">
            {describeError(list.error)}
          </p>
        ) : mode === "unclassified" ? (
          <>
            <div className="space-y-1.5">
              <h3 className="font-medium">テーマの一覧</h3>
              <ThemeEditor accountId={accountId} themes={themes} version={settingsVersion} />
            </div>
            {posts.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-muted-foreground">分類する投稿はありません</p>
            ) : (
              <>
                <p className="text-[13px] text-muted-foreground">
                  分類が付いていない確定した投稿 {posts.length + (list.data?.remaining ?? 0)}件（1回に50件まで）
                </p>
                <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
                  {STEPS.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <div className="space-y-2">
                  <CopyPromptTrigger disabled={copy.loading} onClick={() => void copy.copy()} />
                  <CopyPromptStatus state={copy.state} copiedMessage="コピーしました。ChatGPTやClaudeに貼り付けて送ってください" />
                </div>
                <div className="space-y-1">
                  <label htmlFor={pasteId} className="font-medium">
                    AIの答えを貼り付ける
                  </label>
                  <textarea
                    id={pasteId}
                    rows={5}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    placeholder="AIが返した答えを、そのまま丸ごと貼り付けてください"
                    className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-[14px]"
                  />
                  <Button variant="outline" size="sm" className="rounded-full" disabled={paste.trim() === ""} onClick={() => setParsed(parseClassifyAnswer(paste, targets, themes))}>
                    読み取る
                  </Button>
                </div>
                {parsed && (
                  <div className="space-y-2" aria-label="分類の候補">
                    <p className="text-[13px] text-muted-foreground">
                      {parsed.items.length}件を読み取りました。
                      {parsed.problems.length > 0 && `${parsed.problems.length}件は読み取れなかったので保存しません。`}
                    </p>
                    <ul className="max-h-72 divide-y overflow-y-auto rounded-xl border">
                      {parsed.items.map((it) => (
                        <li key={it.draftId} className="flex flex-col gap-1.5 px-3 py-2.5 md:flex-row md:items-center md:justify-between">
                          <span className="min-w-0 text-[13px]">
                            【{it.index}】{head(bodyOf.get(it.draftId) ?? "")}…
                          </span>
                          <ClassSelects
                            index={it.index}
                            openingType={it.openingType}
                            themeId={it.themeId}
                            themes={themes}
                            onChange={(v) =>
                              setParsed({ ...parsed, items: parsed.items.map((x) => (x.draftId === it.draftId ? { ...x, ...v } : x)) })
                            }
                          />
                        </li>
                      ))}
                      {parsed.problems.map((p) => (
                        <li key={`p-${p.index}`} className="px-3 py-2.5 text-[13px] text-muted-foreground">
                          【{p.index}】{head(targets[p.index - 1]?.body ?? "")}… — {p.reason}のため保存しません
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </>
        ) : posts.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-muted-foreground">分類済みの投稿はありません</p>
        ) : (
          <ul aria-label="分類済みの投稿" className="max-h-[28rem] divide-y overflow-y-auto rounded-xl border">
            {posts.map((p, i) => (
              <li key={p.draftId} className="flex flex-col gap-1.5 px-3 py-2.5 md:flex-row md:items-center md:justify-between">
                <span className="min-w-0 text-[13px]">{head(p.body)}…</span>
                <ClassSelects
                  index={i + 1}
                  openingType={p.openingType}
                  themeId={p.themeId}
                  themes={themes}
                  disabled={fix.isPending}
                  onChange={(v) => {
                    fix.mutate({ draftId: p.draftId, ...v });
                    queryClient.setQueryData(queryKeys.classifications(accountId, "classified"), {
                      ...list.data!,
                      posts: posts.map((x) => (x.draftId === p.draftId ? { ...x, ...v } : x)),
                    });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormDialogFrame>
  );
}
