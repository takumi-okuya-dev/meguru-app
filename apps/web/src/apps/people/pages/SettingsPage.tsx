// 「/people/settings」：誘いの文と目標（specs/people/001-people-memo contracts/ui-routes.md 1、research.md R17、spec US5）。
// 誘いの文の型（差し込みの説明・見本・初めの型に戻す）と、リピーターの目標（1〜10,000人。空なら目標なし）。
import {
  buildInviteMessage,
  DEFAULT_INVITE_TEMPLATE,
  INVITE_TEMPLATE_MAX,
  REPEATER_GOAL_MAX,
  type PeopleSettings,
} from "@meguru/shared/people";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/shell";
import { fieldClass } from "../components/EventForm";
import { peopleApi, type SettingsUpdateInput } from "../lib/api";
import { peopleQueryKeys } from "../lib/query-keys";
import { refreshSettings } from "../lib/refresh";

/** 見本の値（作った名前と会）。 */
const SAMPLE = { name: "山田はなこ", eventName: "IT交流会", heldOn: "2026-12-13" };

/** 差し込みの説明。 */
const PLACEHOLDERS = [
  { key: "{名前}", text: "相手の本名（なければLINE名）" },
  { key: "{会の名前}", text: "誘う会の名前" },
  { key: "{日にち}", text: "誘う会の日にち（例：12月13日（土））" },
];

/**
 * 文字の数（絵文字も1文字に数える）。
 * @param text - 文字
 * @returns 数
 */
function countChars(text: string): number {
  return [...text].length;
}

/**
 * 設定を保存する処理（保存したら設定と数字を読み直す）。
 * @returns ミューテーション
 */
function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SettingsUpdateInput) => peopleApi.updateSettings(input),
    onSuccess: async () => {
      toast.success("保存しました");
      await refreshSettings(queryClient);
    },
  });
}

/**
 * 誘いの文の型の段。
 * @param props - template：今の型（null は初めの型）
 * @returns 段
 */
function TemplateSection({ template }: { template: string | null }) {
  const id = useId();
  const save = useSaveSettings();
  const [text, setText] = useState(template ?? DEFAULT_INVITE_TEMPLATE);
  const count = countChars(text);
  const tooLong = count > INVITE_TEMPLATE_MAX;
  const isDefault = template === null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tooLong) return;
    // 空にしたとき・初めの型のままのときは、初めの型（null）にする
    save.mutate({ inviteTemplate: text.trim() === "" || text === DEFAULT_INVITE_TEMPLATE ? null : text });
  };
  const reset = () => {
    setText(DEFAULT_INVITE_TEMPLATE);
    save.mutate({ inviteTemplate: null });
  };
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-base font-semibold">
        誘いの文の型
      </h2>
      <p className="text-sm text-muted-foreground">
        誘う候補の「文をコピー」で、この型に相手の名前と誘う会を入れた文をコピーします。参加リンクを入れたいときは、型にそのまま書いてください。
      </p>
      <div className="rounded-2xl border bg-card p-4 text-sm">
        <p className="font-medium">差し込める言葉</p>
        <ul className="mt-1 space-y-0.5">
          {PLACEHOLDERS.map((p) => (
            <li key={p.key}>
              <code className="rounded bg-muted px-1">{p.key}</code>：{p.text}
            </li>
          ))}
        </ul>
      </div>
      <form className="space-y-3" onSubmit={submit}>
        <div className="space-y-1">
          <label htmlFor={`${id}-template`} className="text-sm font-medium">
            型
          </label>
          <Textarea
            id={`${id}-template`}
            rows={4}
            value={text}
            aria-invalid={tooLong}
            aria-describedby={`${id}-count`}
            onChange={(e) => setText(e.target.value)}
          />
          <p id={`${id}-count`} className={cn("text-right text-[13px] tabular-nums", tooLong ? "text-destructive" : "text-muted-foreground")}>
            {count}／{INVITE_TEMPLATE_MAX}文字{tooLong && "（長すぎます）"}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">見本</p>
          <p data-testid="invite-preview" className="rounded-xl bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap">
            {buildInviteMessage(text, SAMPLE)}
          </p>
        </div>
        {save.isError && (
          <p role="alert" className="text-[13px] text-destructive">
            {describeError(save.error)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-11 rounded-full md:h-9" disabled={save.isPending || tooLong}>
            保存
          </Button>
          <Button type="button" variant="outline" className="h-11 rounded-full md:h-9" disabled={save.isPending || (isDefault && text === DEFAULT_INVITE_TEMPLATE)} onClick={reset}>
            初めの型に戻す
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * 目標の欄の値を読む。
 * @param text - 入れた文字
 * @returns 目標（空は null）。読めない・範囲の外は undefined
 */
function parseGoal(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && n <= REPEATER_GOAL_MAX ? n : undefined;
}

/**
 * リピーターの目標の段。
 * @param props - goal：今の目標（null は目標なし）
 * @returns 段
 */
function GoalSection({ goal }: { goal: number | null }) {
  const id = useId();
  const save = useSaveSettings();
  const [text, setText] = useState(goal === null ? "" : String(goal));
  const [touched, setTouched] = useState(false);
  const parsed = parseGoal(text);
  const invalid = parsed === undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (parsed === undefined) return;
    save.mutate({ repeaterGoal: parsed });
  };
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-base font-semibold">
        リピーターの目標
      </h2>
      <p className="text-sm text-muted-foreground">自分の会に2回以上来た人を、リピーターとして数えます。誘う候補の上に、今の数と目標を並べて出します。</p>
      <form className="space-y-3" onSubmit={submit} noValidate>
        <div className="space-y-1">
          <label htmlFor={`${id}-goal`} className="text-sm font-medium">
            目標の人数
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`${id}-goal`}
              type="number"
              inputMode="numeric"
              min={1}
              max={REPEATER_GOAL_MAX}
              step={1}
              className={cn(fieldClass, "max-w-40")}
              value={text}
              aria-invalid={touched && invalid}
              aria-describedby={`${id}-goal-help`}
              onChange={(e) => setText(e.target.value)}
            />
            <span className="text-sm">人</span>
          </div>
          <p id={`${id}-goal-help`} className={cn("text-[13px]", touched && invalid ? "text-destructive" : "text-muted-foreground")}>
            {touched && invalid ? `1〜${REPEATER_GOAL_MAX.toLocaleString("ja-JP")}の数を入れてください。` : "空にすると、目標なしになります。"}
          </p>
        </div>
        {save.isError && (
          <p role="alert" className="text-[13px] text-destructive">
            {describeError(save.error)}
          </p>
        )}
        <Button type="submit" className="h-11 rounded-full md:h-9" disabled={save.isPending}>
          保存
        </Button>
      </form>
    </section>
  );
}

/**
 * 誘いの文と目標の画面。
 * @returns 画面
 */
export function SettingsPage() {
  const settings = useQuery({ queryKey: peopleQueryKeys.settings, queryFn: peopleApi.settings });
  if (settings.isPending) return <LoadingSkeleton />;
  if (settings.isError) return <ApiErrorScreen error={settings.error} onRetry={() => void settings.refetch()} />;
  const data: PeopleSettings = settings.data;
  return (
    <>
      <PageHeader title="誘いの文と目標" />
      <PageBody className="space-y-8">
        <TemplateSection template={data.inviteTemplate} />
        <div className="border-t" />
        <GoalSection goal={data.repeaterGoal} />
      </PageBody>
    </>
  );
}
