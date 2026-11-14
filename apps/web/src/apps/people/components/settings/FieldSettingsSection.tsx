// 設定の自由な項目の段：足す・名前を直す・並べ替える（上へ・下へ）・消す（specs/people/002-sales-list spec US6 AS1、FR-109）。
// 消すと、全員のその項目の値も消える。同じ名前（nameKey）は 409 PEOPLE_NAME_TAKEN（「同じ名前がもうあります。」）。
import { countChars } from "@meguru/shared";
import { FIELD_LABEL_MAX, FIELDS_MAX, type CustomField } from "@meguru/shared/people";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { fieldClass } from "../EventForm";
import { peopleApi } from "../../lib/api";
import { peopleQueryKeys } from "../../lib/query-keys";
import { refreshFields } from "../../lib/refresh";

/**
 * 項目の名前の確かめ。
 * @param text - 前後の空白を外した名前
 * @returns 文言（よければ null）
 */
function labelProblem(text: string): string | null {
  return countChars(text) > FIELD_LABEL_MAX ? `項目の名前は${FIELD_LABEL_MAX}文字までです。` : null;
}

/**
 * 項目の1行（名前を直す・上へ・下へ・消す）。
 * @param props - field：項目、index：何番目か、count：項目の数、moving：並べ替えの途中、onMove：上（-1）・下（+1）へ動かす
 * @returns 行
 */
function FieldRow({ field, index, count, moving, onMove }: { field: CustomField; index: number; count: number; moving: boolean; onMove: (delta: -1 | 1) => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [label, setLabel] = useState(field.label);
  const rename = useMutation({
    mutationFn: (next: string) => peopleApi.renameField(field.id, next),
    onSuccess: async () => {
      setEditing(false);
      toast.success("項目の名前を直しました");
      await refreshFields(queryClient);
    },
  });
  const remove = useMutation({
    mutationFn: () => peopleApi.deleteField(field.id),
    onSuccess: async () => {
      toast.success("項目を消しました");
      await refreshFields(queryClient);
    },
  });
  const text = label.trim();
  const problem = labelProblem(text);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text === "" || problem) return;
    if (text === field.label) setEditing(false);
    else rename.mutate(text);
  };
  const error = rename.error ?? remove.error;
  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      {editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
          <label htmlFor={`${id}-label`} className="sr-only">
            「{field.label}」の新しい名前
          </label>
          <input id={`${id}-label`} className={cn(fieldClass, "min-w-0 flex-1 basis-40")} value={label} aria-invalid={problem !== null} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" className="h-11 rounded-full md:h-9" disabled={rename.isPending || text === "" || problem !== null}>
            保存
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-full md:h-9"
            onClick={() => {
              setLabel(field.label);
              setEditing(false);
              rename.reset();
            }}
          >
            やめる
          </Button>
          {problem && <p className="w-full text-[13px] text-destructive">{problem}</p>}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className="min-w-0 flex-1 break-words font-medium">{field.label}</span>
          <Button type="button" variant="ghost" size="icon" className="size-11 rounded-full md:size-8" aria-label={`「${field.label}」を上へ`} disabled={moving || index === 0} onClick={() => onMove(-1)}>
            <ArrowUpIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 rounded-full md:size-8"
            aria-label={`「${field.label}」を下へ`}
            disabled={moving || index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon className="size-4" />
          </Button>
          <Button type="button" variant="ghost" className="h-11 rounded-full px-3 md:h-8" aria-label={`「${field.label}」の名前を直す`} onClick={() => setEditing(true)}>
            名前を直す
          </Button>
          {!confirming && (
            <Button type="button" variant="ghost" className="h-11 rounded-full px-3 text-destructive md:h-8" aria-label={`「${field.label}」を消す`} onClick={() => setConfirming(true)}>
              消す
            </Button>
          )}
        </div>
      )}
      {confirming && !editing && (
        <div role="group" aria-label={`「${field.label}」を消す確かめ`} className="space-y-2 rounded-xl bg-muted p-3">
          <p>全員の「{field.label}」の値も消えます。元に戻せません。</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" className="h-11 rounded-full md:h-9" disabled={remove.isPending} onClick={() => remove.mutate()}>
              項目を消す
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
 * 自由な項目の段。
 * @returns 段
 */
export function FieldSettingsSection() {
  const id = useId();
  const queryClient = useQueryClient();
  const fields = useQuery({ queryKey: peopleQueryKeys.fields, queryFn: peopleApi.fields });
  const [label, setLabel] = useState("");
  const create = useMutation({
    mutationFn: (next: string) => peopleApi.createField(next),
    onSuccess: async () => {
      setLabel("");
      toast.success("項目を足しました");
      await refreshFields(queryClient);
    },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => peopleApi.reorderFields(ids),
    onSuccess: async (saved) => {
      // 項目の一覧は返りの順をそのまま入れる（読み直さない）。人のページの項目の順だけ読み直す
      queryClient.setQueryData(peopleQueryKeys.fields, saved);
      await queryClient.invalidateQueries({ queryKey: peopleQueryKeys.persons });
    },
  });
  const list = fields.data ?? [];
  const text = label.trim();
  const problem = labelProblem(text);
  const full = list.length >= FIELDS_MAX;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text === "" || problem || full) return;
    create.mutate(text);
  };
  /**
   * 項目を1つ上か下へ動かして、すべての順を送る。
   * @param index - 動かす項目の番目
   * @param delta - 上は -1、下は +1
   */
  const move = (index: number, delta: -1 | 1) => {
    const ids = list.map((f) => f.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to]!, ids[index]!];
    reorder.mutate(ids);
  };
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-base font-semibold">
        自由な項目
      </h2>
      <p className="text-sm text-muted-foreground">「好きなもの」「紹介された本」のような項目を足すと、全員の人のページに、この順で出ます。</p>
      {fields.isPending ? (
        <p className="text-sm text-muted-foreground">読み込んでいます…</p>
      ) : fields.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {describeError(fields.error)}
        </p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ項目はありません。</p>
      ) : (
        <ul aria-label="自由な項目の一覧" className="divide-y rounded-2xl border bg-card">
          {list.map((f, i) => (
            <FieldRow key={`${f.id}:${f.label}`} field={f} index={i} count={list.length} moving={reorder.isPending} onMove={(d) => move(i, d)} />
          ))}
        </ul>
      )}
      {reorder.isError && (
        <p role="alert" className="text-[13px] text-destructive">
          {describeError(reorder.error)}
        </p>
      )}
      <form className="space-y-1" onSubmit={submit}>
        <label htmlFor={`${id}-new`} className="text-sm font-medium">
          項目を足す
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={`${id}-new`}
            className={cn(fieldClass, "min-w-0 flex-1 basis-40")}
            value={label}
            autoComplete="off"
            placeholder="例：好きなもの"
            aria-invalid={problem !== null}
            disabled={full}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button type="submit" className="h-11 rounded-full md:h-9" disabled={create.isPending || text === "" || problem !== null || full}>
            <PlusIcon /> 足す
          </Button>
        </div>
        {problem && <p className="text-[13px] text-destructive">{problem}</p>}
        {full && <p className="text-[13px] text-muted-foreground">項目は{FIELDS_MAX}までです。</p>}
        {create.isError && (
          <p role="alert" className="text-[13px] text-destructive">
            {describeError(create.error)}
          </p>
        )}
      </form>
    </section>
  );
}
