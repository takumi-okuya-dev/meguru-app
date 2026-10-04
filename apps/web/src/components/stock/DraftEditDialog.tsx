// 下書きの編集のダイアログ（specs/003 US3、contracts/ui-routes.md「下書きの編集」、FR-019）。
// 002の追加・編集のダイアログの枠を使い、保存の 409・404 の扱いも002と同じにする。
// 承認済みの下書きも編集でき、保存すると要確認に戻る（specs/004 FR-007、Clarifications Q1）。
import { DRAFT_BODY_MAX, checkPublishable, countChars, isBlank, type NgWord, type PostDraft } from "@threads-grower/shared";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { DeletedElsewhereNotice, FormDialogFrame } from "@/components/items/FormDialogFrame";
import { useItemForm, type FormErrors } from "@/components/items/use-item-form";
import { useRef } from "react";
import { api } from "@/lib/api-client";
import { LabelRow, NgWordLabel } from "./DraftLabels";
import { ThreadsLengthBar } from "./ThreadsLengthBar";

type Form = { body: string };

/**
 * 下書きの編集のダイアログ。本文の下に、一覧と同じ長さの表示を出す。
 * @param props - accountId、item：編集する下書き、onSaved：保存できた（reopened：承認済みから要確認に戻った）、
 *   onClose：閉じる、onDeletedElsewhere：削除済みの案内を閉じた、ngWords：NGワード
 * @returns ダイアログ
 */
export function DraftEditDialog({
  accountId,
  item,
  onSaved,
  onClose,
  onDeletedElsewhere,
  ngWords = [],
}: {
  accountId: string;
  item: PostDraft;
  /** そのAccountのNGワード（入力に合わせてラベルを出す。FR-016） */
  ngWords?: NgWord[];
  onSaved: (d: PostDraft, reopened: boolean) => void;
  onClose: () => void;
  onDeletedElsewhere: () => void;
}) {
  const reopened = useRef(false);
  const f = useItemForm<Form, PostDraft>({
    item,
    emptyForm: { body: "" },
    toForm: (d) => ({ body: d.body }),
    validate: (form): FormErrors<Form> => ({ body: isBlank(form.body) ? "入力してください" : undefined }),
    overLimit: (form) => countChars(form.body) > DRAFT_BODY_MAX,
    onSaved: (d) => onSaved(d, reopened.current),
    onClose,
    // 下書きの操作は全プランで使える（research.md R10）ので、403 は起きない
    onGrowerLost: () => {},
    onDeletedElsewhere,
    save: async (form, expectedVersion) => {
      const res = await api.updatePostDraft(accountId, item.id, {
        body: form.body,
        expectedVersion: expectedVersion ?? item.version,
      });
      reopened.current = res.reopened;
      return res.draft;
    },
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
        {item.status === "approved" && (
          <p role="note" className="rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm">
            保存すると要確認に戻り、もう一度承認が必要になります
          </p>
        )}
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
        <LiveLabels body={form.body} ngWords={ngWords} />
      </FormDialogFrame>
      {f.overlays}
    </>
  );
}

/**
 * 入力中の本文に合わせて出すラベル（保存の前に気づけるように）。
 * @param props - body：入力中の本文、ngWords：NGワード
 * @returns ラベルの行
 */
function LiveLabels({ body, ngWords }: { body: string; ngWords: NgWord[] }) {
  const check = checkPublishable(body, ngWords);
  return <LabelRow labels={[check.ngWords.length > 0 && <NgWordLabel key="ng" check={check} />].filter(Boolean)} />;
}
