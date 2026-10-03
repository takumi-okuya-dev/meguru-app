// 下書きの編集のダイアログ（specs/003 US3、contracts/ui-routes.md「下書きの編集」、FR-019）。
// 002の追加・編集のダイアログの枠を使い、保存の 409・404 の扱いも002と同じにする。
import { DRAFT_BODY_MAX, countChars, isBlank, type PostDraft } from "@threads-grower/shared";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { DeletedElsewhereNotice, FormDialogFrame } from "@/components/items/FormDialogFrame";
import { useItemForm, type FormErrors } from "@/components/items/use-item-form";
import { api } from "@/lib/api-client";
import { ThreadsLengthBar } from "./ThreadsLengthBar";

type Form = { body: string };

/**
 * 下書きの編集のダイアログ。本文の下に、一覧と同じ長さの表示を出す。
 * @param props - accountId、item：編集する下書き、onSaved：保存できた、onClose：閉じる、onDeletedElsewhere：削除済みの案内を閉じた
 * @returns ダイアログ
 */
export function DraftEditDialog({
  accountId,
  item,
  onSaved,
  onClose,
  onDeletedElsewhere,
}: {
  accountId: string;
  item: PostDraft;
  onSaved: (d: PostDraft) => void;
  onClose: () => void;
  onDeletedElsewhere: () => void;
}) {
  const f = useItemForm<Form, PostDraft>({
    item,
    emptyForm: { body: "" },
    toForm: (d) => ({ body: d.body }),
    validate: (form): FormErrors<Form> => ({ body: isBlank(form.body) ? "入力してください" : undefined }),
    overLimit: (form) => countChars(form.body) > DRAFT_BODY_MAX,
    onSaved,
    onClose,
    // 下書きの操作は全プランで使える（research.md R10）ので、403 は起きない
    onGrowerLost: () => {},
    onDeletedElsewhere,
    save: (form, expectedVersion) =>
      api.updatePostDraft(accountId, item.id, { body: form.body, expectedVersion: expectedVersion ?? item.version }),
  });
  const { form, setField, errors } = f;

  return (
    <>
      <FormDialogFrame
        title="下書きを編集"
        description="投稿ストックの下書きの本文を直します。"
        submitLabel="保存"
        submitting={f.submitting}
        onSubmit={f.submit}
        onRequestClose={f.requestClose}
      >
        {f.deleted && <DeletedElsewhereNotice what="下書き" onClose={f.closeDeleted} />}
        <FieldWithCounter
          readOnly={f.readOnly}
          id="draft-body"
          label="本文"
          requiredNote="必須"
          rows={8}
          max={DRAFT_BODY_MAX}
          value={form.body}
          error={errors.body}
          onChange={(v) => setField("body", v)}
        />
        <ThreadsLengthBar text={form.body} />
      </FormDialogFrame>
      {f.overlays}
    </>
  );
}
