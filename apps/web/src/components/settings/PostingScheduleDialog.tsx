// 投稿のスケジュールのダイアログ（specs/005-auto-post FR-001〜FR-003・FR-001b・FR-002a、contracts/ui-routes.md）。
// 002の追加・編集のダイアログの枠と振る舞い（未保存の警告・他の場所での更新）を使う。
import {
  AUTOPOST_MIN_GAP_MINUTES,
  DEFAULT_DAILY_POST_LIMIT,
  LATE_NIGHT_HINT,
  THREADS_CHECK_MESSAGES,
  isLateNightSlot,
  timeToMinutes,
  validatePostingSchedule,
  type PostingSchedule,
  type ThreadsCheck,
} from "@threads-grower/shared";
import { XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { FormDialogFrame } from "@/components/items/FormDialogFrame";
import { useItemForm } from "@/components/items/use-item-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api-client";
import { formatSlotTime } from "@/lib/format";
import { isStale } from "@/lib/save-error";

type Form = { enabled: boolean; slotTimes: string[]; jitter: boolean };
/** useItemForm で扱う形（版と更新日時を持つ行）。投稿の設定は更新日時を返さないので空にする。 */
type Item = Form & { version: number; updatedAt: string };

const toItem = (s: PostingSchedule): Item => ({
  enabled: s.enabled,
  slotTimes: s.slotTimes,
  jitter: s.jitter,
  version: s.version,
  updatedAt: "",
});

/**
 * 検証の結果を、画面に出す文言にする（contracts/ui-routes.md「投稿のスケジュールのダイアログ」）。
 * @param form - 入力値
 * @param maxSlots - オーナーの1日の投稿数の上限（specs/024 FR-019）
 * @param savedCount - 保存済みの時刻の数（上限が下がって超えている時刻を減らす保存は通す）
 * @returns 文言。問題がなければ null
 */
function validationMessage(form: Form, maxSlots: number, savedCount: number): string | null {
  // 上限が下がって超えている時刻を減らす保存は通す（APIと同じ。specs/024 FR-020）
  const v = validatePostingSchedule(form, { maxSlots: Math.max(maxSlots, savedCount) });
  if (v.ok) return null;
  switch (v.reason) {
    case "duplicate":
      return "同じ時刻がすでにあります";
    case "too_close":
      return `時刻を少しずらすときは、時刻どうしを${AUTOPOST_MIN_GAP_MINUTES}分以上あけてください（${v.times!.map(formatSlotTime).join("と")}）`;
    case "required":
      return "自動投稿をオンにするには、時刻を1つ以上追加してください";
    case "too_many":
      return `1日に投稿できるのは${maxSlots}件までです`;
    case "invalid_time":
      return "時刻の形が正しくありません";
  }
}

/**
 * 投稿のスケジュールのダイアログ。
 * @param props - accountId、schedule：保存済みの設定、onSaved：保存できた（設定と、投稿の権限の確認の結果）、
 *   onReconnect：再接続を始める、onClose：閉じる、notConnected：未接続（オンにできない。時刻は保存できる。specs/012 FR-032）、
 *   maxSlots：オーナーの1日の投稿数の上限（specs/024 FR-019。省けば既定値）
 * @returns ダイアログ
 */
export function PostingScheduleDialog({
  accountId,
  schedule,
  onSaved,
  onReconnect,
  onClose,
  notConnected = false,
  maxSlots = DEFAULT_DAILY_POST_LIMIT,
}: {
  accountId: string;
  schedule: PostingSchedule;
  onSaved: (schedule: PostingSchedule, check: ThreadsCheck | null) => void;
  onReconnect: () => void;
  onClose: () => void;
  notConnected?: boolean;
  maxSlots?: number;
}) {
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState<"needs_reconnect" | "no_publish_permission" | "not_connected" | null>(
    null,
  );
  // 保存の結果の、投稿の権限の確認（保存できた後に渡す。state だと古い値を渡してしまうので ref にする）
  const lastCheck = useRef<ThreadsCheck | null>(null);

  const f = useItemForm<Form, Item>({
    item: toItem(schedule),
    emptyForm: { enabled: false, slotTimes: [], jitter: true },
    toForm: (item) => ({ enabled: item.enabled, slotTimes: item.slotTimes, jitter: item.jitter }),
    validate: () => ({}),
    // 検証に通らない間は保存しない（保存のボタンも無効にする）
    overLimit: (form) => validationMessage(form, maxSlots, schedule.slotTimes.length) !== null,
    onSaved: (item) => onSaved(item, lastCheck.current),
    onClose,
    onReadOnly: () => {},
    onDeletedElsewhere: onClose,
    // 接続が切れている・投稿の権限がない（FR-002a）：ダイアログを閉じず、理由と「再接続」を出す
    fieldErrorFor: (err) => {
      if (err.code !== "THREADS_NOT_READY") return null;
      setNotReady(
        err.details[0] === "needs_reconnect" || err.details[0] === "not_connected" ? err.details[0] : "no_publish_permission",
      );
      return {};
    },
    save: async (form, expectedVersion) => {
      setNotReady(null);
      try {
        const res = await api.putPostingSchedule(accountId, {
          ...form,
          expectedVersion: expectedVersion ?? schedule.version,
        });
        lastCheck.current = res.connectionCheck;
        return toItem(res.schedule);
      } catch (err) {
        // 409 の latest を、useItemForm が扱う形（version を持つ行）にそろえる
        if (isStale(err))
          throw new ApiError(
            err.code,
            err.status,
            err.details,
            toItem(err.latest as PostingSchedule),
            err.updatedBy,
          );
        throw err;
      }
    },
  });

  const message = validationMessage(f.form, maxSlots, schedule.slotTimes.length);
  const full = f.form.slotTimes.length >= maxSlots;
  // 早い時刻から上限の数まで投稿する。それより後の時刻には投稿しない（specs/024 FR-020）
  const sortedTimes = [...f.form.slotTimes].sort((a, b) => (timeToMinutes(a) ?? 0) - (timeToMinutes(b) ?? 0));
  const skipped = new Set(sortedTimes.slice(maxSlots));

  const add = () => {
    if (!adding || timeToMinutes(adding) === null) return;
    if (f.form.slotTimes.includes(adding)) {
      setAddError("同じ時刻がすでにあります");
      return;
    }
    setAddError(null);
    f.setField("slotTimes", [...f.form.slotTimes, adding].sort());
    setAdding("");
  };
  const remove = (t: string) =>
    f.setField(
      "slotTimes",
      f.form.slotTimes.filter((x) => x !== t),
    );

  return (
    <>
      <FormDialogFrame
        title="投稿のスケジュール"
        description="自動投稿のオン・オフと、1日に投稿する時刻を決めます"
        submitLabel={f.submitting && f.form.enabled ? "確かめています…" : "保存"}
        submitting={f.submitting}
        submitDisabled={message !== null}
        onSubmit={f.submit}
        onRequestClose={f.requestClose}
      >
        {notReady && (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
              <span className="flex-1">{THREADS_CHECK_MESSAGES[notReady]}</span>
              {notReady !== "not_connected" && (
                <Button size="sm" className="rounded-full" onClick={onReconnect}>
                  再接続
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {f.submitting && f.form.enabled && (
          <p role="status" className="text-[13px] text-muted-foreground">
            Threadsとの接続を確かめています…
          </p>
        )}

        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">自動投稿</span>
            <span className="block text-xs text-muted-foreground">
              {f.form.enabled
                ? "承認済みの下書きを、下の時刻に1件ずつ投稿します"
                : "オフです。承認済みの下書きは投稿されません"}
            </span>
            {notConnected && (
              <span id="auto-post-not-connected" className="block text-xs text-muted-foreground">
                Threadsにつなぐと使えます。時刻は先に決めておけます
              </span>
            )}
          </span>
          <Switch
            aria-label="自動投稿"
            checked={f.form.enabled}
            disabled={notConnected && !f.form.enabled}
            aria-describedby={notConnected ? "auto-post-not-connected" : undefined}
            onCheckedChange={(v) => f.setField("enabled", v)}
          />
        </label>

        <section aria-labelledby="slot-times-heading" className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 id="slot-times-heading" className="text-sm font-medium">
              投稿する時刻
            </h3>
            <span className="text-xs text-muted-foreground">
              1日 {Math.min(f.form.slotTimes.length, maxSlots)}件 投稿します（{maxSlots}件まで）
            </span>
          </div>
          {skipped.size > 0 && (
            <Alert>
              <AlertDescription>
                上限が{maxSlots}件に下がったため、{maxSlots + 1}つ目からの時刻には投稿しません。
              </AlertDescription>
            </Alert>
          )}
          {f.form.slotTimes.length > 0 && (
            <ul className="divide-y rounded-xl border">
              {f.form.slotTimes.map((t) => {
                const minutes = timeToMinutes(t);
                return (
                  <li key={t} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={skipped.has(t) ? "text-sm tabular-nums text-muted-foreground" : "text-sm tabular-nums"}>
                        {formatSlotTime(t)}
                        {skipped.has(t) && <span className="ml-2.5 text-xs">投稿しません</span>}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground"
                        aria-label={`${formatSlotTime(t)}を削除`}
                        onClick={() => remove(t)}
                      >
                        <XIcon className="size-4" />
                      </Button>
                    </div>
                    {minutes !== null && isLateNightSlot(minutes) && (
                      // 深夜の案内（FR-001b）。検証のエラーではなく、保存は止めない
                      <p className="text-xs text-muted-foreground">{LATE_NIGHT_HINT}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <Input
              type="time"
              aria-label="追加する時刻"
              className="w-36"
              value={adding}
              disabled={full}
              onChange={(e) => {
                setAdding(e.target.value);
                setAddError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button
              variant="outline"
              className="h-10 rounded-full md:h-9"
              disabled={full || !adding}
              onClick={add}
            >
              追加
            </Button>
          </div>
          {full && <p className="text-xs text-muted-foreground">1日に投稿できるのは{maxSlots}件までです。</p>}
          {addError && <p className="text-xs text-destructive">{addError}</p>}
          {message && (
            <p role="alert" className="text-xs text-destructive">
              {message}
            </p>
          )}
        </section>

        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">時刻を少しずらす</span>
            <span className="block text-xs text-muted-foreground">
              機械的に見えないよう、前後10分の中でずらして投稿します
            </span>
          </span>
          <Switch
            aria-label="時刻を少しずらす"
            checked={f.form.jitter}
            onCheckedChange={(v) => f.setField("jitter", v)}
          />
        </label>
      </FormDialogFrame>
      {f.overlays}
    </>
  );
}
