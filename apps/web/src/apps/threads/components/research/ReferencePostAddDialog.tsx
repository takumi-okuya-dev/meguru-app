// 参考投稿を追加（ためてまとめて登録。specs/014-strategy-guidance US7、FR-080〜FR-085、contracts/ui-routes.md「リサーチ」）。
// 1件入れるたびに「ためる」で欄の上に並べ、最後に「〇件を登録する」で、ためた分と入力中の分を1回で登録する。
import { useMutation } from "@tanstack/react-query";
import { REFERENCE_BATCH_MAX, isBlank } from "@meguru/shared";
import { useState } from "react";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { BillingRequiredDialog } from "@/components/billing/BillingRequiredDialog";
import { FormDialogFrame } from "@/apps/threads/components/items/FormDialogFrame";
import type { FormErrors } from "@/apps/threads/components/items/use-item-form";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { threadsApi } from "@/apps/threads/lib/api";
import { billingReasonOf, isBillingRequired, saveErrorMessage } from "@/lib/save-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { toast } from "sonner";
import { ReferenceBadges } from "./ReferenceBadges";
import { ReferencePostFields } from "./ReferencePostFields";
import {
  EMPTY_REF_FORM,
  freshnessOfForm,
  overLimitRef,
  toRefInput,
  validateRef,
  type RefForm,
} from "./reference-post-form";

const excerpt = (s: string) => {
  const line = s.trim().split("\n")[0] ?? "";
  return [...line].length > 40 ? `${[...line].slice(0, 40).join("")}…` : line;
};

/**
 * 参考投稿を追加するダイアログ（ためて登録）。
 * @param props - accountId、remaining：あと何件登録できるか、onSaved：登録した件数、onClose、
 *   onReadOnly：読むだけになった、onLimitReached：上限に当たった
 * @returns ダイアログ
 */
export function ReferencePostAddDialog({
  accountId,
  remaining,
  onSaved,
  onClose,
  onReadOnly,
  onLimitReached,
}: {
  accountId: string;
  remaining: number;
  onSaved: (count: number) => void;
  onClose: () => void;
  onReadOnly: () => void;
  onLimitReached: () => void;
}) {
  const [queue, setQueue] = useState<RefForm[]>([]);
  const [form, setForm] = useState<RefForm>(EMPTY_REF_FORM);
  // 入力の「初めの値」。ためた後は、引き継いだ検索したキーワード・媒体が初めの値になる（PR #17 のCodexレビュー）
  const [baseline, setBaseline] = useState<RefForm>(EMPTY_REF_FORM);
  const [errors, setErrors] = useState<FormErrors<RefForm>>({});
  const [confirmClose, setConfirmClose] = useState(false);
  // 欄を空にしたときに、数字の欄の開閉などを初めに戻すためのキー
  const [formKey, setFormKey] = useState(0);
  // 読むだけになった理由（案内を閉じるまで）。閉じた後は入力内容を読むだけで残す（今の追加と同じ。Codexレビュー P1）
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  // 1回に登録できる件数は、残りの件数と20件の小さいほう（FR-084）
  const cap = Math.min(remaining, REFERENCE_BATCH_MAX);
  const hasBody = !isBlank(form.body);
  const total = queue.length + (hasBody ? 1 : 0);
  // 初めの値から変わった項目があれば、未保存として扱う（本文が空でもURLなどを入れていれば。PR #17 のCodexレビュー）
  const edited = (Object.keys(EMPTY_REF_FORM) as (keyof RefForm)[]).some((k) => form[k] !== baseline[k]);
  const dirty = queue.length > 0 || edited;
  useUnsavedChanges(dirty);

  const setField = <K extends keyof RefForm>(key: K, value: RefForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const check = (f: RefForm) => {
    const found = validateRef(f);
    setErrors(found);
    return !Object.values(found).some(Boolean) && !overLimitRef(f);
  };

  const enqueue = () => {
    if (!hasBody || queue.length + 1 > cap || !check(form)) return;
    setQueue((q) => [...q, form]);
    // 検索したキーワードと媒体は、次の投稿のために残す（FR-081）
    const next = { ...EMPTY_REF_FORM, keyword: form.keyword, platform: form.platform };
    setForm(next);
    setBaseline(next);
    setFormKey((k) => k + 1);
  };

  const register = useMutation({
    mutationFn: (items: RefForm[]) => threadsApi.createReferencePostsBatch(accountId, { items: items.map(toRefInput) }),
    onSuccess: (_res, items) => {
      toast.success(`${items.length}件を登録しました`);
      onSaved(items.length);
    },
    onError: (err) => {
      if (isBillingRequired(err)) setReadOnlyReason(billingReasonOf(err));
      else if (err instanceof ApiError && err.code === "ITEM_LIMIT_REACHED") {
        onLimitReached();
        toast.error(saveErrorMessage(err));
      } else toast.error(saveErrorMessage(err));
    },
  });

  // 本文はまだだが、初めの値から変えた入力がある（登録すると黙って捨てることになる。PR #17 のCodexレビュー）
  const partial = !hasBody && edited;

  const submit = () => {
    if (locked || register.isPending || total === 0 || total > cap) return;
    if ((hasBody || partial) && !check(form)) return;
    register.mutate(hasBody ? [...queue, form] : queue);
  };

  const submitLabel = queue.length === 0 ? "登録する" : `${total}件を登録する`;

  return (
    <>
      <FormDialogFrame
        title="参考投稿を追加"
        description="Threadsで見つけた反応の良い投稿を、何件かためてまとめて登録します。"
        submitLabel={submitLabel}
        submitting={register.isPending}
        locked={locked}
        submitDisabled={total === 0 || total > cap}
        onSubmit={submit}
        // 登録の途中は閉じない（送った登録は取り消せないので、破棄したつもりで登録されないように。PR #17 のCodexレビュー）
        onRequestClose={() => {
          if (register.isPending) return;
          if (dirty) setConfirmClose(true);
          else onClose();
        }}
      >
        <p className="text-[13px] text-muted-foreground">
          何件かまとめて登録するときは、1件入れるたびに「この投稿をためて、次の投稿を入力する」を押してください。最後に「〇件を登録する」で、ためた分も一緒に登録します。
        </p>
        {queue.length > 0 && (
          <section aria-label={`ためた投稿（${queue.length}件）`} className="space-y-1.5">
            <h3 className="text-sm font-medium">ためた投稿（{queue.length}件）</h3>
            <ul className="space-y-1.5">
              {queue.map((q, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2">
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <ReferenceBadges platform={q.platform} freshness={freshnessOfForm(q)} explained={!isBlank(q.whyGood)} />
                    <span className="text-[13px] break-words">{excerpt(q.body)}</span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 rounded-full"
                    // 登録の途中は外せない（送った内容と画面が食い違わないように。PR #17 のCodexレビュー）
                    disabled={locked || register.isPending}
                    onClick={() => setQueue((list) => list.filter((_, j) => j !== i))}
                  >
                    外す
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div key={formKey} className="space-y-4">
          <ReferencePostFields
            form={form}
            setField={setField}
            errors={errors}
            // 登録の途中と読むだけの間は、送った内容と食い違わないよう入力を止める
            readOnly={locked || register.isPending}
            whyGoodNote="空のままで大丈夫です。登録した後に、解説がまだの参考投稿をまとめてAIに解説してもらえます。"
          />
        </div>
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 justify-start rounded-full md:h-10"
            disabled={locked || register.isPending || !hasBody || queue.length + 1 > cap}
            onClick={enqueue}
          >
            ＋この投稿をためて、次の投稿を入力する
          </Button>
          <p className="text-xs text-muted-foreground">
            参考投稿はあと{remaining}件まで登録できます
            {cap === REFERENCE_BATCH_MAX && queue.length + 1 > cap ? "。1回に登録できるのは20件までです" : ""}
          </p>
        </div>
      </FormDialogFrame>
      <BillingRequiredDialog
        reason={readOnlyReason}
        onClose={() => {
          setReadOnlyReason(null);
          setLocked(true);
          onReadOnly();
        }}
      />
      <UnsavedChangesDialog
        open={confirmClose}
        title="登録していない投稿があります。破棄しますか？"
        description="ためた投稿と入力中の内容は失われます。"
        discardLabel="破棄して閉じる"
        onStay={() => setConfirmClose(false)}
        onDiscard={() => {
          setConfirmClose(false);
          onClose();
        }}
      />
    </>
  );
}
