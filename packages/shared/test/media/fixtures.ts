// 外部媒体展開のテストの材料（港で読んだ「IT交流会」。specs/021-external-media tasks.md「Format」）
import type { ListingSource, PromotionEvent } from "../../src";

/** IT交流会のイベントの情報。 */
export const IT_EVENT: PromotionEvent = {
  startAt: "2026-11-25T20:00",
  endAt: "2026-11-25T22:00",
  format: "venue",
  venueName: "バー「SHITEN（シテン）」",
  prefecture: "東京都",
  address: "台東区上野4-1-8",
  building: "3階",
  station: "御徒町駅 徒歩3分",
  capacity: 25,
  feeYen: 5000,
  feeNote: "紹介した人もされた人も1,000円引き",
  cancelPolicy: "当日キャンセル：100%\n前日キャンセル：50%",
  audience: "IT・コンサル系の方／初参加・一人参加歓迎",
  organizer: "港｜MINATO",
};

/** IT交流会の本文（地図のURL・LINEの案内・紹介割引・完全紹介制・人脈づくりを含む）。 */
export const IT_CONTENT = [
  "IT系・コンサル系の人や、その人たちに繋がりたい人で、ご飯を食べながらゆるく繋がる会です🍻",
  "初参加・一人参加も大歓迎です🙌",
  "人脈づくりや情報交換のきっかけにぜひ✨",
  "https://maps.app.goo.gl/VcGb44KUVcZNY3686",
  "※普段完全紹介・会員制のバーです。",
  "⭐️紹介割引⭐️お友達紹介した人もされた人も1000円オフ！",
  "参加費のお支払い方法は予約後にLINEでご案内します",
].join("\n");

/** IT交流会の材料。 */
export function itSource(over: Partial<ListingSource> = {}): ListingSource {
  return {
    title: "IT交流会 ゆるく繋がる飲み会",
    content: IT_CONTENT,
    targetLocation: "",
    targetPersona: "",
    targetAgeRange: "",
    cta: "",
    linkedUrl: "https://minato-place.com/events/2026-11-25",
    event: IT_EVENT,
    defaults: {},
    ...over,
  };
}
