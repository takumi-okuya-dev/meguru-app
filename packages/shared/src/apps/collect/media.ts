// 集金管理の媒体（どこから申し込んだか。specs/collect/001-event-day-collection data-model.md 2-3、contracts/events.md 2）。
import type { Media } from "../../media/types";

/** 名簿の人の媒体の値（並びは画面のボタンの順）。 */
export const COLLECT_MEDIA = ["minato", "kokuchpro", "tunagate", "jimoty", "peatix", "youtrust", "walk_in", "other"] as const;
/** 名簿の人の媒体。 */
export type CollectMedia = (typeof COLLECT_MEDIA)[number];

/** 媒体の表示名。 */
export const COLLECT_MEDIA_LABELS: Record<CollectMedia, string> = {
  minato: "港",
  kokuchpro: "こくちーずプロ",
  tunagate: "つなげーと",
  jimoty: "ジモティー",
  peatix: "Peatix",
  youtrust: "YOUTRUST",
  walk_in: "当日",
  other: "その他",
};

/** Threadsの外部媒体展開（021）の媒体 → 集金管理の媒体（Threadsのイベントの掲載済みの媒体を直すため。User Story 6）。 */
const FROM_THREADS_MEDIA: Record<Media, CollectMedia> = {
  kokuchpro: "kokuchpro",
  peatix: "peatix",
  tsunagate: "tunagate",
  jmty: "jimoty",
  youtrust: "youtrust",
};

/**
 * Threadsの外部媒体展開の媒体を、集金管理の媒体の値に直す。
 * @param media - 021の媒体の値
 * @returns 集金管理の媒体（知らない値なら undefined）
 */
export function collectMediaFromThreads(media: string): CollectMedia | undefined {
  return Object.hasOwn(FROM_THREADS_MEDIA, media) ? FROM_THREADS_MEDIA[media as Media] : undefined;
}

/**
 * 集金管理の媒体の値か。
 * @param value - 調べる値
 * @returns 媒体の値なら true
 */
export function isCollectMedia(value: unknown): value is CollectMedia {
  return typeof value === "string" && (COLLECT_MEDIA as readonly string[]).includes(value);
}
