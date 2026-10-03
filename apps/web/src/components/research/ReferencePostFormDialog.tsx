// 参考投稿の追加・編集のダイアログ（specs/002 contracts/ui-routes.md「リサーチの画面」、US3）
import {
  REFERENCE_BODY_MAX,
  REFERENCE_WHY_GOOD_MAX,
  SHORT_TEXT_MAX,
  URL_MAX,
  countChars,
  isBlank,
  isHttpUrl,
  type ReferencePost,
} from "@threads-grower/shared";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { DeletedElsewhereNotice, FormDialogFrame } from "@/components/items/FormDialogFrame";
import { useItemForm, type FormErrors } from "@/components/items/use-item-form";
import { api } from "@/lib/api-client";

type Form = { body: string; keyword: string; postUrl: string; whyGood: string };
const EMPTY: Form = { body: "", keyword: "", postUrl: "", whyGood: "" };

const toForm = (p: ReferencePost): Form => ({ body: p.body, keyword: p.keyword, postUrl: p.postUrl, whyGood: p.whyGood });

function validate(f: Form): FormErrors<Form> {
  return {
    body: isBlank(f.body) ? "入力してください" : undefined,
    postUrl: f.postUrl !== "" && !isHttpUrl(f.postUrl) ? "https:// から始まるURLを入力してください" : undefined,
  };
}

function overLimit(f: Form) {
  return (
    countChars(f.body) > REFERENCE_BODY_MAX ||
    countChars(f.keyword) > SHORT_TEXT_MAX ||
    countChars(f.postUrl) > URL_MAX ||
    countChars(f.whyGood) > REFERENCE_WHY_GOOD_MAX
  );
}

/**
 * 参考投稿の追加・編集のダイアログ。
 * @param props - accountId、item：編集する参考投稿（追加のときは undefined）、結果の通知
 * @returns ダイアログ
 */
export function ReferencePostFormDialog({
  accountId,
  item,
  onSaved,
  onClose,
  onGrowerLost,
  onDeletedElsewhere,
}: {
  accountId: string;
  item?: ReferencePost;
  onSaved: (p: ReferencePost) => void;
  onClose: () => void;
  onGrowerLost: () => void;
  onDeletedElsewhere: () => void;
}) {
  const f = useItemForm<Form, ReferencePost>({
    item,
    emptyForm: EMPTY,
    toForm,
    validate,
    overLimit,
    onSaved,
    onClose,
    onGrowerLost,
    onDeletedElsewhere,
    save: (form, expectedVersion) =>
      expectedVersion === undefined
        ? api.createReferencePost(accountId, form)
        : api.updateReferencePost(accountId, item!.id, { ...form, expectedVersion }),
  });
  const { form, setField, errors } = f;

  return (
    <>
      <FormDialogFrame
        title={item ? "参考投稿を編集" : "参考投稿を追加"}
        description="Threadsで見つけた反応の良い投稿を保存します。"
        submitLabel="保存"
        submitting={f.submitting}
        onSubmit={f.submit}
        onRequestClose={f.requestClose}
      >
        {f.deleted && <DeletedElsewhereNotice what="参考投稿" onClose={f.closeDeleted} />}
        <FieldWithCounter
          id="reference-body"
          label="本文"
          requiredNote="必須"
          placeholder="Threadsで見つけた投稿の本文をそのまま貼り付け"
          rows={6}
          max={REFERENCE_BODY_MAX}
          value={form.body}
          error={errors.body}
          onChange={(v) => setField("body", v)}
        />
        <FieldWithCounter
          id="reference-keyword"
          label="検索したキーワード"
          placeholder="例: AI 初心者"
          multiline={false}
          max={SHORT_TEXT_MAX}
          value={form.keyword}
          onChange={(v) => setField("keyword", v)}
        />
        <FieldWithCounter
          id="reference-url"
          label="投稿のURL"
          placeholder="https://www.threads.net/…"
          type="url"
          multiline={false}
          max={URL_MAX}
          value={form.postUrl}
          error={errors.postUrl}
          onChange={(v) => setField("postUrl", v)}
        />
        <FieldWithCounter
          id="reference-why"
          label="なぜ良いか"
          description="自分で書くか、ChatGPTやClaudeに分析してもらった結果を貼り付けます"
          placeholder="例: 冒頭の1文で共感を取り、最後に問いかけでコメントを促している"
          rows={4}
          max={REFERENCE_WHY_GOOD_MAX}
          value={form.whyGood}
          onChange={(v) => setField("whyGood", v)}
        />
      </FormDialogFrame>
      {f.overlays}
    </>
  );
}
