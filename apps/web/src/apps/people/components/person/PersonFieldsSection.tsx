// 人のページの自由な項目の段（specs/people/002-sales-list spec US6、FR-109）。項目は設定で足し、値は人ごとに入れる（空にすると消える）。
import { countChars } from "@meguru/shared";
import { FIELD_VALUE_MAX, type PersonFieldValue } from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { peopleApi } from "../../lib/api";
import { settingsPath } from "../../lib/paths";
import { refreshPersons } from "../../lib/refresh";

/**
 * 自由な項目の段。値が変わったら呼ぶ側が key を変えて作り直す。
 * @param props - personId：人、fields：項目と値（項目の順）
 * @returns 段
 */
export function PersonFieldsSection({ personId, fields }: { personId: string; fields: PersonFieldValue[] }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.fieldId, f.value ?? ""])));
  const save = useMutation({
    mutationFn: () =>
      peopleApi.setPersonFields(
        personId,
        fields.map((f) => ({ fieldId: f.fieldId, value: (values[f.fieldId] ?? "").trim() === "" ? null : (values[f.fieldId] ?? "") })),
      ),
    onSuccess: async () => {
      toast.success("項目を保存しました");
      await refreshPersons(queryClient);
    },
  });
  const dirty = fields.some((f) => (values[f.fieldId] ?? "").trim() !== (f.value ?? ""));
  const over = fields.some((f) => countChars(values[f.fieldId] ?? "") > FIELD_VALUE_MAX);
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-sm font-medium text-muted-foreground">
        自由な項目
      </h2>
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          「好きなもの」「紹介された本」のような項目は、
          <Link to={settingsPath()} className="underline">
            設定
          </Link>
          で足せます。
        </p>
      ) : (
        <div className="space-y-4 rounded-2xl border bg-card p-4">
          {fields.map((f) => (
            <FieldWithCounter
              key={f.fieldId}
              id={`${id}-${f.fieldId}`}
              label={f.label}
              value={values[f.fieldId] ?? ""}
              onChange={(v) => setValues((old) => ({ ...old, [f.fieldId]: v }))}
              max={FIELD_VALUE_MAX}
              rows={2}
            />
          ))}
          {save.isError && (
            <p role="alert" className="text-[13px] text-destructive">
              {describeError(save.error)}
            </p>
          )}
          <div className="flex justify-end">
            <Button className="h-11 rounded-full md:h-9" disabled={!dirty || over || save.isPending} onClick={() => save.mutate()}>
              項目を保存
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
