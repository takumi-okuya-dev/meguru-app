// 参考投稿の編集のダイアログ（specs/002 US3、specs/014 FR-088）。追加は ReferencePostAddDialog（ためて登録）で行う。
import { useState, type ReactNode } from "react";
import type { ReferencePost } from "@meguru/shared";
import { DeletedElsewhereNotice, FormDialogFrame } from "@/apps/threads/components/items/FormDialogFrame";
import { useItemForm } from "@/apps/threads/components/items/use-item-form";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { api } from "@/lib/api-client";
import { ReferencePostFields } from "./ReferencePostFields";
import { EMPTY_REF_FORM, overLimitRef, toRefForm, toRefInput, validateRef, type RefForm } from "./reference-post-form";

/**
 * 参考投稿の編集のダイアログ。
 * @param props - accountId、item：編集する参考投稿、whyGoodExtra：なぜ良いかの下に足す中身（1件の解説）、結果の通知
 * @returns ダイアログ
 */
export function ReferencePostFormDialog({
  accountId,
  item,
  onSaved,
  onClose,
  onReadOnly,
  onDeletedElsewhere,
  onLimitReached,
  whyGoodExtra,
}: {
  accountId: string;
  item?: ReferencePost;
  whyGoodExtra?: (setWhyGood: (text: string) => void, onDirtyChange: (dirty: boolean) => void) => ReactNode;
  onSaved: (p: ReferencePost) => void;
  onClose: () => void;
  onReadOnly: () => void;
  onDeletedElsewhere: () => void;
  onLimitReached: () => void;
}) {
  // 1件の解説に貼り付けた内容も、未保存として扱う（PR #17 のCodexレビュー）
  const [explainDirty, setExplainDirty] = useState(false);
  // 貼り付けた解説を「なぜ良いか」に入れずに保存しようとしたとき（保存すると貼り付けた内容は残らない）
  const [confirmSave, setConfirmSave] = useState(false);
  const f = useItemForm<RefForm, ReferencePost>({
    extraDirty: explainDirty,
    item,
    emptyForm: EMPTY_REF_FORM,
    toForm: toRefForm,
    validate: (form) => validateRef(form),
    overLimit: overLimitRef,
    onSaved,
    onClose,
    onReadOnly,
    onDeletedElsewhere,
    onLimitReached,
    save: (form, expectedVersion) =>
      expectedVersion === undefined
        ? api.createReferencePost(accountId, toRefInput(form))
        : api.updateReferencePost(accountId, item!.id, { ...toRefInput(form), expectedVersion }),
  });
  const { form, setField, errors } = f;

  return (
    <>
      <FormDialogFrame
        title={item ? "参考投稿を編集" : "参考投稿を追加"}
        description="Threadsで見つけた反応の良い投稿を直します。"
        submitLabel="保存"
        submitting={f.submitting}
        locked={f.locked}
        onSubmit={() => (explainDirty ? setConfirmSave(true) : f.submit())}
        onRequestClose={f.requestClose}
      >
        {f.deleted && <DeletedElsewhereNotice what="参考投稿" onClose={f.closeDeleted} />}
        <ReferencePostFields
          form={form}
          setField={setField}
          errors={errors}
          readOnly={f.readOnly}
          whyGoodExtra={!f.readOnly && whyGoodExtra?.((text) => setField("whyGood", text), setExplainDirty)}
        />
      </FormDialogFrame>
      {f.overlays}
      <UnsavedChangesDialog
        open={confirmSave}
        title="貼り付けた解説が、まだ「なぜ良いか」に入っていません"
        description="このまま保存すると、貼り付けた解説は失われます。"
        discardLabel="破棄して保存"
        onStay={() => setConfirmSave(false)}
        onDiscard={() => {
          setConfirmSave(false);
          f.submit();
        }}
      />
    </>
  );
}
