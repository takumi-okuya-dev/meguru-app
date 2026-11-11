// 参考投稿の入力欄（specs/014-strategy-guidance FR-080・FR-095〜FR-097、contracts/ui-routes.md「リサーチ」）。
// 本文・媒体・元の投稿の投稿日（と鮮度）・投稿のURL・検索したキーワード・投稿の数字と投稿者（開閉）・なぜ良いか。
import {
  FRESHNESS_LEVELS,
  POSTED_DATE_MODES,
  REFERENCE_AUTHOR_MAX,
  REFERENCE_BODY_MAX,
  REFERENCE_MEMO_MAX,
  REFERENCE_PLATFORMS,
  REFERENCE_WHY_GOOD_MAX,
  SHORT_TEXT_MAX,
  URL_MAX,
  jstToday,
  type PostedDateMode,
  type ReferenceMetricKey,
  type ReferencePlatform,
} from "@meguru/shared";
import { ChevronDownIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import type { FormErrors } from "@/components/items/use-item-form";
import { cn } from "@/lib/utils";
import { freshnessOfForm, type RefForm } from "./reference-post-form";

const METRIC_LABELS: [ReferenceMetricKey, string][] = [
  ["likes", "いいね"],
  ["replies", "コメント"],
  ["views", "閲覧数"],
  ["saves", "保存数"],
  ["reposts", "リポスト"],
  ["followers", "投稿者のフォロワー数"],
];

const selectClass = "h-11 w-full rounded-xl border border-input bg-card px-3 text-base md:h-10 md:text-[15px]";

/**
 * 参考投稿の入力欄。
 * @param props - form：値、setField：1項目を変える、errors：項目ごとの誤り、readOnly：読むだけ、
 *   whyGoodNote：なぜ良いかの説明、whyGoodExtra：なぜ良いかの下に足す中身（1件の解説など）
 * @returns 入力欄
 */
export function ReferencePostFields({
  form,
  setField,
  errors,
  readOnly = false,
  whyGoodNote,
  whyGoodExtra,
}: {
  form: RefForm;
  setField: <K extends keyof RefForm>(key: K, value: RefForm[K]) => void;
  errors: FormErrors<RefForm>;
  readOnly?: boolean;
  whyGoodNote?: string;
  whyGoodExtra?: ReactNode;
}) {
  const hasMetrics = METRIC_LABELS.some(([k]) => form[k] !== "") || form.author !== "" || form.memo !== "";
  const [metricsOpen, setMetricsOpen] = useState(hasMetrics);
  const freshness = FRESHNESS_LEVELS.find((f) => f.value === freshnessOfForm(form))?.label;
  return (
    <>
      <FieldWithCounter
        readOnly={readOnly}
        id="reference-body"
        label="本文"
        requiredNote="必須"
        placeholder="伸びていた投稿の本文を、そのまま貼り付けてください"
        rows={6}
        max={REFERENCE_BODY_MAX}
        value={form.body}
        error={errors.body}
        onChange={(v) => setField("body", v)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="reference-platform" className="font-medium">
            媒体
          </label>
          <select
            id="reference-platform"
            disabled={readOnly}
            value={form.platform}
            onChange={(e) => setField("platform", e.target.value as ReferencePlatform)}
            className={selectClass}
          >
            {REFERENCE_PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="reference-posted-mode" className="font-medium">
            元の投稿の投稿日
          </label>
          <select
            id="reference-posted-mode"
            disabled={readOnly}
            value={form.postedDateMode}
            onChange={(e) => setField("postedDateMode", e.target.value as PostedDateMode)}
            className={selectClass}
          >
            {POSTED_DATE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {form.postedDateMode === "exact" && (
          <div className="space-y-1">
            <label htmlFor="reference-posted-date" className="font-medium">
              投稿日
            </label>
            <input
              id="reference-posted-date"
              type="date"
              readOnly={readOnly}
              max={jstToday(new Date())}
              value={form.postedDate}
              onChange={(e) => setField("postedDate", e.target.value)}
              aria-invalid={!!errors.postedDate}
              className={cn(selectClass, errors.postedDate && "border-warning")}
            />
            {errors.postedDate && <p className="text-[13px] text-warning">{errors.postedDate}</p>}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        投稿日から鮮度（30日まで：最新、90日まで：現役、それより前：アーカイブ）を判定し、新しい参考投稿ほど投稿づくりで優先します。
        今の入力：<span className="font-medium text-foreground">{freshness}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldWithCounter
          readOnly={readOnly}
          id="reference-url"
          label="投稿のURL"
          placeholder="https://www.threads.com/…"
          type="url"
          multiline={false}
          max={URL_MAX}
          value={form.postUrl}
          error={errors.postUrl}
          onChange={(v) => setField("postUrl", v)}
        />
        <FieldWithCounter
          readOnly={readOnly}
          id="reference-keyword"
          label="検索したキーワード"
          placeholder="例: 20代後半 友達"
          multiline={false}
          max={SHORT_TEXT_MAX}
          value={form.keyword}
          onChange={(v) => setField("keyword", v)}
        />
      </div>
      <div className="rounded-2xl border">
        <button
          type="button"
          aria-expanded={metricsOpen}
          onClick={() => setMetricsOpen((v) => !v)}
          className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm"
        >
          <span className="flex-1 font-medium">投稿の数字・投稿者（分かる場合だけ）</span>
          <ChevronDownIcon className={cn("size-4 transition-transform", metricsOpen && "rotate-180")} aria-hidden="true" />
        </button>
        {metricsOpen && (
          <div className="space-y-3 px-4 pb-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {METRIC_LABELS.map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <label htmlFor={`reference-metric-${key}`} className="text-xs">
                    {label}
                  </label>
                  <input
                    id={`reference-metric-${key}`}
                    inputMode="numeric"
                    readOnly={readOnly}
                    value={form[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    aria-invalid={!!errors[key]}
                    className={cn("h-10 w-full rounded-xl border border-input bg-card px-3 text-base md:text-[15px]", errors[key] && "border-warning")}
                  />
                  {errors[key] && <p className="text-xs text-warning">{errors[key]}</p>}
                </div>
              ))}
            </div>
            <FieldWithCounter
              readOnly={readOnly}
              id="reference-author"
              label="投稿者（アカウント名）"
              multiline={false}
              max={REFERENCE_AUTHOR_MAX}
              value={form.author}
              onChange={(v) => setField("author", v)}
            />
            <FieldWithCounter
              readOnly={readOnly}
              id="reference-memo"
              label="メモ（なぜ気になったか、など）"
              rows={2}
              max={REFERENCE_MEMO_MAX}
              value={form.memo}
              onChange={(v) => setField("memo", v)}
            />
          </div>
        )}
      </div>
      <FieldWithCounter
        readOnly={readOnly}
        id="reference-why"
        label="なぜ良いか"
        requiredNote="任意"
        description={whyGoodNote}
        placeholder="例: 冒頭の1文で共感を取り、最後に問いかけでコメントを促している"
        rows={4}
        max={REFERENCE_WHY_GOOD_MAX}
        value={form.whyGood}
        onChange={(v) => setField("whyGood", v)}
      >
        {whyGoodExtra}
      </FieldWithCounter>
    </>
  );
}
