// 宣伝内容の追加・編集のダイアログ（specs/002 contracts/ui-routes.md「宣伝内容の画面」、US2）
import {
  PROMOTION_CONTENT_MAX,
  SHORT_TEXT_MAX,
  URL_MAX,
  countChars,
  isBlank,
  isExpired,
  isHttpUrl,
  isEventDateTime,
  PREFECTURES,
  type Promotion,
  type PromotionEvent,
  type PromotionStatus,
} from "@meguru/shared";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { DeletedElsewhereNotice, FormDialogFrame } from "@/apps/threads/components/items/FormDialogFrame";
import { useItemForm, type FormErrors } from "@/apps/threads/components/items/use-item-form";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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
} & EventForm;

/** イベントの情報の入力（specs/021 FR-001）。どれも文字で持ち、保存のときに形を変える。 */
type EventForm = {
  evStart: string;
  evEnd: string;
  evFormat: PromotionEvent["format"];
  evVenueName: string;
  evPrefecture: string;
  evAddress: string;
  evBuilding: string;
  evStation: string;
  evCapacity: string;
  evFee: string;
  evFeeNote: string;
  evCancel: string;
  evAudience: string;
  evOrganizer: string;
};

const EMPTY_EVENT: EventForm = {
  evStart: "",
  evEnd: "",
  evFormat: "venue",
  evVenueName: "",
  evPrefecture: "",
  evAddress: "",
  evBuilding: "",
  evStation: "",
  evCapacity: "",
  evFee: "",
  evFeeNote: "",
  evCancel: "",
  evAudience: "",
  evOrganizer: "",
};

/**
 * イベントの情報を、入力の形にする。
 * @param e - イベントの情報（なければ null）
 * @returns 入力
 */
function toEventForm(e: PromotionEvent | null): EventForm {
  if (!e) return EMPTY_EVENT;
  return {
    evStart: e.startAt,
    evEnd: e.endAt ?? "",
    evFormat: e.format,
    evVenueName: e.venueName ?? "",
    evPrefecture: e.prefecture ?? "",
    evAddress: e.address ?? "",
    evBuilding: e.building ?? "",
    evStation: e.station ?? "",
    evCapacity: e.capacity === null ? "" : String(e.capacity),
    evFee: e.feeYen === null ? "" : String(e.feeYen),
    evFeeNote: e.feeNote ?? "",
    evCancel: e.cancelPolicy ?? "",
    evAudience: e.audience ?? "",
    evOrganizer: e.organizer ?? "",
  };
}

// 入れたイベントの情報があるか（開始がなく、ほかも空なら「なし」）
const hasEventInput = (f: EventForm) =>
  (Object.keys(EMPTY_EVENT) as (keyof EventForm)[]).some((k) => k !== "evFormat" && f[k].trim() !== "");

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

/**
 * 入力から、保存するイベントの情報を作る（入れていなければ null）。
 * @param f - 入力
 * @returns イベントの情報
 */
function eventOf(f: EventForm): PromotionEvent | null {
  if (!hasEventInput(f)) return null;
  return {
    startAt: f.evStart,
    endAt: orNull(f.evEnd),
    format: f.evFormat,
    venueName: orNull(f.evVenueName),
    prefecture: orNull(f.evPrefecture) as PromotionEvent["prefecture"],
    address: orNull(f.evAddress),
    building: orNull(f.evBuilding),
    station: orNull(f.evStation),
    capacity: f.evCapacity.trim() === "" ? null : Number(f.evCapacity),
    feeYen: f.evFee.trim() === "" ? null : Number(f.evFee),
    feeNote: orNull(f.evFeeNote),
    cancelPolicy: orNull(f.evCancel),
    audience: orNull(f.evAudience),
    organizer: orNull(f.evOrganizer),
  };
}

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
  ...EMPTY_EVENT,
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
    ...toEventForm(p.event),
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
    evStart: hasEventInput(f) && !isEventDateTime(f.evStart) ? "開始の日時を入れてください" : undefined,
    evEnd: f.evEnd !== "" && (!isEventDateTime(f.evEnd) || f.evEnd < f.evStart) ? "開始より後の日時を入れてください" : undefined,
    evCapacity: f.evCapacity !== "" && !/^\d+$/.test(f.evCapacity) ? "数字で入れてください" : undefined,
    evFee: f.evFee !== "" && !/^\d+$/.test(f.evFee) ? "数字（円）で入れてください" : undefined,
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
 * @param props - accountId、item：編集する宣伝内容（追加のときは undefined）、onSaved・onClose・onReadOnly・onDeletedElsewhere：結果の通知
 * @returns ダイアログ
 */
export function PromotionFormDialog({
  accountId,
  item,
  onSaved,
  onClose,
  onReadOnly,
  onDeletedElsewhere,
  onLimitReached,
}: {
  accountId: string;
  item?: Promotion;
  onSaved: (p: Promotion) => void;
  onClose: () => void;
  onReadOnly: () => void;
  onDeletedElsewhere: () => void;
  onLimitReached: () => void;
}) {
  const f = useItemForm<Form, Promotion>({
    item,
    emptyForm: EMPTY,
    toForm,
    validate,
    overLimit,
    onSaved,
    onClose,
    onReadOnly,
    onDeletedElsewhere,
    onLimitReached,
    save: (form, expectedVersion) => {
      const { title, content, targetLocation, targetPersona, targetAgeRange, cta, linkedUrl, status } = form;
      const body = {
        title,
        content,
        targetLocation,
        targetPersona,
        targetAgeRange,
        cta,
        linkedUrl,
        status,
        priority: Number(form.priority),
        validUntil: form.validUntil || null,
        event: eventOf(form),
      };
      return expectedVersion === undefined
        ? api.createPromotion(accountId, body)
        : api.updatePromotion(accountId, item!.id, { ...body, expectedVersion });
    },
  });
  const { form, setField, errors } = f;
  const pastDate = form.validUntil !== "" && isExpired(form.validUntil, new Date());
  // 中身があれば最初から開いておく（contracts/ui-routes.md 5）
  const [eventOpen, setEventOpen] = useState(() => item?.event != null);

  return (
    <>
      <FormDialogFrame
        title={item ? "宣伝内容を編集" : "宣伝内容を追加"}
        description="投稿で案内したいイベントやサービスを登録します。"
        submitLabel={item ? "保存" : "追加"}
        submitting={f.submitting}
        locked={f.locked}
        onSubmit={f.submit}
        onRequestClose={f.requestClose}
      >
        {f.deleted && <DeletedElsewhereNotice what="宣伝内容" onClose={f.closeDeleted} />}
        <FieldWithCounter
          readOnly={f.readOnly}
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
          readOnly={f.readOnly}
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
          readOnly={f.readOnly}
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
          readOnly={f.readOnly}
          id="promotion-cta"
          label="読者に取ってほしい行動（CTA）"
          placeholder="例: プロフィールのLINEから応募"
          multiline={false}
          max={SHORT_TEXT_MAX}
          value={form.cta}
          onChange={(v) => setField("cta", v)}
        />
        <FieldWithCounter
          readOnly={f.readOnly}
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
              readOnly={f.readOnly}
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
              disabled={f.readOnly}
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
              readOnly={f.readOnly}
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
        <EventSection open={eventOpen} onToggle={() => setEventOpen((v) => !v)} form={form} errors={errors} readOnly={f.readOnly} setField={setField} />
      </FormDialogFrame>
      {f.overlays}
    </>
  );
}

/** イベントの情報の入力欄（1行）。 */
const INPUT = "mt-1 h-11 w-full rounded-xl border border-input bg-card px-3 text-base md:h-10 md:text-[15px]";

/**
 * 閉じた区分「イベントの情報（任意）」（specs/021 FR-001、contracts/ui-routes.md 5）。
 * @param props - open：開いているか、onToggle：開け閉め、form・errors・readOnly・setField：入力
 * @returns 区分
 */
function EventSection({
  open,
  onToggle,
  form,
  errors,
  readOnly,
  setField,
}: {
  open: boolean;
  onToggle: () => void;
  form: Form;
  errors: FormErrors<Form>;
  readOnly: boolean;
  setField: <K extends keyof Form>(key: K, value: Form[K]) => void;
}) {
  const text = (key: keyof EventForm, label: string, placeholder = "") => (
    <div className="space-y-1">
      <label htmlFor={`promotion-${key}`} className="text-[13px] font-medium">
        {label}
      </label>
      <input
        id={`promotion-${key}`}
        type="text"
        value={form[key]}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => setField(key, e.target.value)}
        className={INPUT}
      />
      {errors[key] && <p className="text-[13px] text-warning">{errors[key]}</p>}
    </div>
  );
  return (
    <section aria-label="イベントの情報" className="space-y-3 border-t pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] hover:bg-accent"
      >
        <ChevronRightIcon className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
        イベントの情報（任意）
      </button>
      <p className="text-[12px] text-muted-foreground">入れると、外部媒体展開と宣伝投稿に使えます</p>
      {open && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="promotion-evStart" className="text-[13px] font-medium">
                開始
              </label>
              <input id="promotion-evStart" type="datetime-local" value={form.evStart} readOnly={readOnly} onChange={(e) => setField("evStart", e.target.value)} className={INPUT} />
              {errors.evStart && <p className="text-[13px] text-warning">{errors.evStart}</p>}
            </div>
            <div className="space-y-1">
              <label htmlFor="promotion-evEnd" className="text-[13px] font-medium">
                終了
              </label>
              <input id="promotion-evEnd" type="datetime-local" value={form.evEnd} readOnly={readOnly} onChange={(e) => setField("evEnd", e.target.value)} className={INPUT} />
              {errors.evEnd && <p className="text-[13px] text-warning">{errors.evEnd}</p>}
            </div>
          </div>
          <div role="radiogroup" aria-label="会場かオンラインか" className="flex gap-1.5">
            {(
              [
                ["venue", "会場"],
                ["online", "オンライン"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={form.evFormat === v}
                disabled={readOnly}
                onClick={() => setField("evFormat", v)}
                className={cn("rounded-full border px-3.5 py-1.5 text-[13px]", form.evFormat === v ? "border-foreground bg-foreground text-background" : "text-muted-foreground")}
              >
                {label}
              </button>
            ))}
          </div>
          {text("evVenueName", "会場名", "例: バー「SHITEN」")}
          <div className="space-y-1">
            <label htmlFor="promotion-evPrefecture" className="text-[13px] font-medium">
              都道府県
            </label>
            <select id="promotion-evPrefecture" value={form.evPrefecture} disabled={readOnly} onChange={(e) => setField("evPrefecture", e.target.value)} className={INPUT}>
              <option value="">（選ばない）</option>
              {PREFECTURES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {text("evAddress", "市区町村・番地", "例: 台東区上野4-1-8")}
          {text("evBuilding", "建物・階", "例: 3階")}
          {text("evStation", "最寄り駅", "例: 御徒町駅 徒歩3分")}
          <div className="grid grid-cols-2 gap-3">
            {text("evCapacity", "定員", "例: 25")}
            {text("evFee", "参加費（円）", "例: 5000（無料は 0）")}
          </div>
          {text("evFeeNote", "参加費の説明（割引など）")}
          <div className="space-y-1">
            <label htmlFor="promotion-evCancel" className="text-[13px] font-medium">
              キャンセルの決まり
            </label>
            <textarea id="promotion-evCancel" rows={3} value={form.evCancel} readOnly={readOnly} onChange={(e) => setField("evCancel", e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-card px-3 py-2 text-base md:text-[15px]" />
          </div>
          {text("evAudience", "対象者", "例: IT・コンサル系の方、初参加歓迎")}
          {text("evOrganizer", "主催者名")}
          <p className="text-[12px] text-muted-foreground">申込先のURLは、上の「専用URL」を使います</p>
        </div>
      )}
    </section>
  );
}
