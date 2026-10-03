// 宣伝内容の追加・編集のダイアログ（specs/002 contracts/ui-routes.md「宣伝内容の画面」、US2）
import {
  PROMOTION_CONTENT_MAX,
  SHORT_TEXT_MAX,
  URL_MAX,
  countChars,
  isBlank,
  isExpired,
  isHttpUrl,
  type Promotion,
  type PromotionStatus,
} from "@threads-grower/shared";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { DeletedElsewhereNotice, FormDialogFrame } from "@/components/items/FormDialogFrame";
import { useItemForm, type FormErrors } from "@/components/items/use-item-form";
import { api } from "@/lib/api-client";

type Form = {
  title: string;
  content: string;
  targetLocation: string;
  targetPersona: string;
  targetAgeRange: string;
  cta: string;
  linkedUrl: string;
  priority: string;
  status: PromotionStatus;
  validUntil: string;
};

const EMPTY: Form = {
  title: "",
  content: "",
  targetLocation: "",
  targetPersona: "",
  targetAgeRange: "",
  cta: "",
  linkedUrl: "",
  priority: "0",
  status: "active",
  validUntil: "",
};

/** 宣伝内容の状態の表示名。 */
export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  active: "有効",
  paused: "一時停止",
  ended: "終了",
};

function toForm(p: Promotion): Form {
  return {
    title: p.title,
    content: p.content,
    targetLocation: p.targetLocation,
    targetPersona: p.targetPersona,
    targetAgeRange: p.targetAgeRange,
    cta: p.cta,
    linkedUrl: p.linkedUrl,
    priority: String(p.priority),
    status: p.status,
    validUntil: p.validUntil ?? "",
  };
}

function validate(f: Form): FormErrors<Form> {
  const priority = Number(f.priority);
  return {
    title: isBlank(f.title) ? "入力してください" : undefined,
    content: isBlank(f.content) ? "入力してください" : undefined,
    linkedUrl: f.linkedUrl !== "" && !isHttpUrl(f.linkedUrl) ? "https:// から始まるURLを入力してください" : undefined,
    priority:
      !/^\d+$/.test(f.priority) || priority < 0 || priority > 100 ? "0〜100の整数で入力してください" : undefined,
  };
}

function overLimit(f: Form) {
  return (
    [f.title, f.targetLocation, f.targetPersona, f.targetAgeRange, f.cta].some((s) => countChars(s) > SHORT_TEXT_MAX) ||
    countChars(f.content) > PROMOTION_CONTENT_MAX ||
    countChars(f.linkedUrl) > URL_MAX
  );
}

/**
 * 宣伝内容の追加・編集のダイアログ。768px以上は中央のダイアログ、767px以下は全画面のシート。
 * @param props - accountId、item：編集する宣伝内容（追加のときは undefined）、onSaved・onClose・onGrowerLost・onDeletedElsewhere：結果の通知
 * @returns ダイアログ
 */
export function PromotionFormDialog({
  accountId,
  item,
  onSaved,
  onClose,
  onGrowerLost,
  onDeletedElsewhere,
}: {
  accountId: string;
  item?: Promotion;
  onSaved: (p: Promotion) => void;
  onClose: () => void;
  onGrowerLost: () => void;
  onDeletedElsewhere: () => void;
}) {
  const f = useItemForm<Form, Promotion>({
    item,
    emptyForm: EMPTY,
    toForm,
    validate,
    overLimit,
    onSaved,
    onClose,
    onGrowerLost,
    onDeletedElsewhere,
    save: (form, expectedVersion) => {
      const body = { ...form, priority: Number(form.priority), validUntil: form.validUntil || null };
      return expectedVersion === undefined
        ? api.createPromotion(accountId, body)
        : api.updatePromotion(accountId, item!.id, { ...body, expectedVersion });
    },
  });
  const { form, setField, errors } = f;
  const pastDate = form.validUntil !== "" && isExpired(form.validUntil, new Date());

  return (
    <>
      <FormDialogFrame
        title={item ? "宣伝内容を編集" : "宣伝内容を追加"}
        description="投稿で案内したいイベントやサービスを登録します。"
        submitLabel={item ? "保存" : "追加"}
        submitting={f.submitting}
        onSubmit={f.submit}
        onRequestClose={f.requestClose}
      >
        {f.deleted && <DeletedElsewhereNotice what="宣伝内容" onClose={f.closeDeleted} />}
        <FieldWithCounter
          id="promotion-title"
          label="管理用タイトル"
          requiredNote="必須・投稿には出ません"
          placeholder="例: 9月度イベント告知"
          multiline={false}
          max={SHORT_TEXT_MAX}
          value={form.title}
          error={errors.title}
          onChange={(v) => setField("title", v)}
        />
        <FieldWithCounter
          id="promotion-content"
          label="宣伝したい内容"
          requiredNote="必須"
          placeholder="例: 9/20(土)開催の交流イベント。参加費無料、LINEから応募できます。"
          rows={5}
          max={PROMOTION_CONTENT_MAX}
          value={form.content}
          error={errors.content}
          onChange={(v) => setField("content", v)}
        />
        <fieldset className="space-y-2">
          <legend className="pb-1 font-medium">届けたい属性</legend>
          <div className="grid gap-2 md:grid-cols-3">
            {(
              [
                ["targetLocation", "場所", "例: 東京在住"],
                ["targetPersona", "どんな人", "例: 転職を考え始めた人"],
                ["targetAgeRange", "年齢", "例: 26〜29歳"],
              ] as const
            ).map(([key, label, placeholder]) => (
              <FieldWithCounter
                key={key}
                id={`promotion-${key}`}
                label={label}
                placeholder={placeholder}
                multiline={false}
                max={SHORT_TEXT_MAX}
                value={form[key]}
                onChange={(v) => setField(key, v)}
                className="[&_label]:text-[13px] [&_label]:font-normal [&_label]:text-muted-foreground"
              />
            ))}
          </div>
        </fieldset>
        <FieldWithCounter
          id="promotion-cta"
          label="読者に取ってほしい行動（CTA）"
          placeholder="例: プロフィールのLINEから応募"
          multiline={false}
          max={SHORT_TEXT_MAX}
          value={form.cta}
          onChange={(v) => setField("cta", v)}
        />
        <FieldWithCounter
          id="promotion-url"
          label="専用URL"
          placeholder="https://"
          type="url"
          multiline={false}
          max={URL_MAX}
          value={form.linkedUrl}
          error={errors.linkedUrl}
          onChange={(v) => setField("linkedUrl", v)}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="promotion-priority" className="font-medium">
              優先度
            </label>
            <input
              id="promotion-priority"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={form.priority}
              onChange={(e) => setField("priority", e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-input bg-card px-3 text-base md:h-10 md:text-[15px]"
            />
            {errors.priority && <p className="text-[13px] text-warning">{errors.priority}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="promotion-status" className="font-medium">
              状態
            </label>
            <select
              id="promotion-status"
              value={form.status}
              onChange={(e) => setField("status", e.target.value as PromotionStatus)}
              className="mt-1 h-11 w-full rounded-xl border border-input bg-card px-3 text-base md:h-10 md:text-[15px]"
            >
              {(Object.keys(PROMOTION_STATUS_LABELS) as PromotionStatus[]).map((s) => (
                <option key={s} value={s}>
                  {PROMOTION_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 space-y-1 md:col-span-1">
            <label htmlFor="promotion-valid-until" className="font-medium">
              掲載期限
            </label>
            <input
              id="promotion-valid-until"
              type="date"
              value={form.validUntil}
              onChange={(e) => setField("validUntil", e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-input bg-card px-3 text-base md:h-10 md:text-[15px]"
            />
          </div>
        </div>
        {pastDate && (
          <p className="text-[13px] text-muted-foreground">
            この日付はすでに過ぎているため、期限切れとして扱われます。
          </p>
        )}
      </FormDialogFrame>
      {f.overlays}
    </>
  );
}
