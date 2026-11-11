// キーワードの追加・編集のダイアログ（specs/002 contracts/ui-routes.md「リサーチの画面」、FR-014）
import { SHORT_TEXT_MAX, countChars, isBlank, normalizeKeyword, type ResearchKeyword } from "@meguru/shared";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { DeletedElsewhereNotice, FormDialogFrame } from "@/components/items/FormDialogFrame";
import { useItemForm, type FormErrors } from "@/components/items/use-item-form";
import { api } from "@/lib/api-client";

type Form = { keyword: string; purpose: string };
const EMPTY: Form = { keyword: "", purpose: "" };
const DUPLICATE = "同じキーワードがすでに登録されています";

/**
 * キーワードの追加・編集のダイアログ。同じキーワードは、保存する前に案内する（正規化して比べる。research.md R5）。
 * @param props - accountId、item：編集するキーワード、existing：登録済みのキーワード、結果の通知
 * @returns ダイアログ
 */
export function KeywordFormDialog({
  accountId,
  item,
  existing,
  onSaved,
  onClose,
  onReadOnly,
  onDeletedElsewhere,
  onLimitReached,
}: {
  accountId: string;
  item?: ResearchKeyword;
  existing: ResearchKeyword[];
  onSaved: (k: ResearchKeyword) => void;
  onClose: () => void;
  onReadOnly: () => void;
  onDeletedElsewhere: () => void;
  onLimitReached: () => void;
}) {
  const taken = new Set(existing.filter((k) => k.id !== item?.id).map((k) => normalizeKeyword(k.keyword)));
  const isDuplicate = (s: string) => !isBlank(s) && taken.has(normalizeKeyword(s));

  const f = useItemForm<Form, ResearchKeyword>({
    item,
    emptyForm: EMPTY,
    toForm: (k) => ({ keyword: k.keyword, purpose: k.purpose }),
    validate: (form): FormErrors<Form> => ({
      keyword: isBlank(form.keyword) ? "入力してください" : isDuplicate(form.keyword) ? DUPLICATE : undefined,
    }),
    overLimit: (form) => countChars(form.keyword) > SHORT_TEXT_MAX || countChars(form.purpose) > SHORT_TEXT_MAX,
    fieldErrorFor: (err) => (err.code === "KEYWORD_DUPLICATE" ? { keyword: DUPLICATE } : null),
    onSaved,
    onClose,
    onReadOnly,
    onDeletedElsewhere,
    onLimitReached,
    save: (form, expectedVersion) =>
      expectedVersion === undefined
        ? api.createResearchKeyword(accountId, form)
        : api.updateResearchKeyword(accountId, item!.id, { ...form, expectedVersion }),
  });
  const { form, setField, errors } = f;
  // 重複は保存を待たずに、入力した時点で案内する
  const keywordError = errors.keyword ?? (isDuplicate(form.keyword) ? DUPLICATE : undefined);

  return (
    <>
      <FormDialogFrame
        title={item ? "キーワードを編集" : "キーワードを追加"}
        description="リサーチで検索する言葉を登録します。"
        submitLabel="保存"
        submitting={f.submitting}
        locked={f.locked}
        onSubmit={f.submit}
        onRequestClose={f.requestClose}
      >
        {f.deleted && <DeletedElsewhereNotice what="キーワード" onClose={f.closeDeleted} />}
        <FieldWithCounter
          readOnly={f.readOnly}
          id="keyword"
          label="キーワード"
          requiredNote="必須"
          placeholder="例: AI 初心者"
          multiline={false}
          max={SHORT_TEXT_MAX}
          value={form.keyword}
          error={keywordError}
          onChange={(v) => setField("keyword", v)}
        />
        <FieldWithCounter
          readOnly={f.readOnly}
          id="keyword-purpose"
          label="狙いのメモ"
          placeholder="例: 初心者向けの共感投稿を探す"
          multiline={false}
          max={SHORT_TEXT_MAX}
          value={form.purpose}
          onChange={(v) => setField("purpose", v)}
        />
      </FormDialogFrame>
      {f.overlays}
    </>
  );
}
