// 集金管理の締め・振込待ち・まとめの入力と出力の形（specs/collect/001-event-day-collection contracts/api.md 2・6・7、
// data-model.md 2-7・2-9、FR-011・FR-014・FR-040〜FR-052）。PR3 の分。
import { z } from "zod";
import { COLLECT_MEDIA } from "./media";
import { RECEPTION_METHODS } from "./reception";
import { CHECK_IN_MODES, COLLECT_LIMITS } from "./schemas";

/** 件数と合計。 */
export const countAmountSchema = z.object({ count: z.number().int(), amount: z.number().int() });
/** 件数と合計。 */
export type CountAmount = z.infer<typeof countAmountSchema>;

/** 媒体ごとの数字（FR-044）。売上は支払い済みと振込待ちを分ける。 */
export const mediaStatsSchema = z.object({
  media: z.enum(COLLECT_MEDIA),
  roster: z.number().int(),
  attended: z.number().int(),
  paid: z.number().int(),
  awaiting: z.number().int(),
});
/** 媒体ごとの数字。 */
export type MediaStats = z.infer<typeof mediaStatsSchema>;

/** 払い方ごとの件数と合計。 */
export const byMethodSchema = z.record(z.enum(RECEPTION_METHODS), countAmountSchema);
/** 払い方ごとの件数と合計。 */
export type ByMethod = z.infer<typeof byMethodSchema>;

/** 現金の受け取った人ごとの精算の行（FR-040・FR-041）。receiverKey は "owner" か手伝う人の番号。 */
export const cashReceiverSchema = z.object({
  receiverKey: z.string(),
  name: z.string(),
  count: z.number().int(),
  amount: z.number().int(),
  countedAmount: z.number().int().nullable(),
  settledAt: z.string().nullable(),
  /** 精算したあとで、その人の現金の記録が変わった */
  changedAfterSettle: z.boolean(),
});
/** 現金の受け取った人ごとの精算の行。 */
export type CashReceiver = z.infer<typeof cashReceiverSchema>;

/** GET …/closing の応答（FR-040〜FR-045）。 */
export const closingSnapshotSchema = z.object({
  version: z.number().int(),
  event: z.object({ id: z.string(), name: z.string(), startsAt: z.string() }),
  closedAt: z.string().nullable(),
  changedAfterClose: z.boolean(),
  attendance: z.object({ arrived: z.number().int(), rosterCount: z.number().int() }),
  /** 受付のしかた（名簿なしでは来なかった人を出さない。specs/collect/004 research.md R8） */
  checkInMode: z.enum(CHECK_IN_MODES).default("roster"),
  /** 受付の記録がない名簿の人の数（名簿なしで、来なかった人の代わりに出す） */
  unrecordedCount: z.number().int().default(0),
  /** 本人の申告の確かめ待ち（現金・PayPayの合計に入れない。締める前に知らせる。specs/collect/002 FR-040） */
  awaitingConfirmation: z
    .object({
      count: z.number().int(),
      amount: z.number().int(),
      people: z.array(z.object({ personId: z.string(), number: z.number().int(), name: z.string(), method: z.string(), amount: z.number().int() })),
    })
    .default({ count: 0, amount: 0, people: [] }),
  byMethod: byMethodSchema,
  cashByReceiver: z.array(cashReceiverSchema),
  paypay: z.object({
    count: z.number().int(),
    amount: z.number().int(),
    checkedAt: z.string().nullable(),
    records: z.array(z.object({ personId: z.string(), number: z.number().int(), name: z.string(), amount: z.number().int(), recordedAt: z.string(), receiverName: z.string() })),
  }),
  transfers: z.object({ paid: countAmountSchema, awaiting: countAmountSchema }),
  byMedia: z.array(mediaStatsSchema),
  absent: z.array(z.object({ personId: z.string(), number: z.number().int(), name: z.string(), kana: z.string().nullable(), media: z.enum(COLLECT_MEDIA) })),
});
/** GET …/closing の応答。 */
export type ClosingSnapshot = z.infer<typeof closingSnapshotSchema>;

/** PUT …/settlements/:receiverKey の入力（FR-041。どちらかは要る）。 */
export const putSettlementRequestSchema = z
  .object({
    countedAmount: z.number().int().min(0).max(99_999_999).nullable().optional(),
    settled: z.boolean().optional(),
  })
  .refine((v) => v.countedAmount !== undefined || v.settled !== undefined, { message: "nothing to update", path: ["settled"] });
/** PUT …/settlements/:receiverKey の入力。 */
export type PutSettlementRequest = z.infer<typeof putSettlementRequestSchema>;

/** POST …/close の応答（FR-045。精算していない人がいても締める）。 */
export const closeResponseSchema = z.object({ closedAt: z.string(), unsettled: z.array(z.string()) });
/** POST …/close の応答。 */
export type CloseResponse = z.infer<typeof closeResponseSchema>;

/** 振込待ち・確かめた記録の1行（FR-050）。 */
export const transferItemSchema = z.object({
  personId: z.string(),
  eventId: z.string(),
  eventName: z.string(),
  eventStartsAt: z.string(),
  number: z.number().int(),
  name: z.string(),
  kana: z.string().nullable(),
  amount: z.number().int(),
  method: z.enum(["transfer_today", "transfer_later"]),
  recordedAt: z.string(),
  transferConfirmedAt: z.string().nullable(),
  /** 区分がまだ決まっていない（入金を確かめるときに区分を選ぶ。specs/collect/004 research.md R3） */
  tierUndecided: z.boolean().default(false),
  /** そのイベントの区分（区分を選ぶため。区分が決まっていない人だけ。ほかは空） */
  tiers: z.array(z.object({ id: z.string(), name: z.string(), amount: z.number().int() })).default([]),
});
/** 振込待ち・確かめた記録の1行。 */
export type TransferItem = z.infer<typeof transferItemSchema>;

/** GET /api/collect/transfers の応答（振込待ちのあとに、確かめた記録を新しい順）。 */
export const transferListSchema = z.object({ awaiting: z.array(transferItemSchema), confirmed: z.array(transferItemSchema) });
/** GET /api/collect/transfers の応答。 */
export type TransferList = z.infer<typeof transferListSchema>;

/** POST /api/collect/transfers/:personId/confirm の入力（区分が決まっていない人は区分を選ぶ。specs/collect/004 contracts/api.md 4-1）。 */
export const confirmTransferRequestSchema = z.object({ priceTierId: z.uuid().optional() });
/** POST /api/collect/transfers/:personId/confirm の入力。 */
export type ConfirmTransferRequest = z.infer<typeof confirmTransferRequestSchema>;

/** GET /api/collect/transfers のクエリ。 */
export const transferQuerySchema = z.object({ q: z.string().max(COLLECT_LIMITS.personName).optional() });

/** イベントのまとめ（FR-014。名前は入れない）。 */
export const eventSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  startsAt: z.string(),
  rosterCount: z.number().int(),
  attendedCount: z.number().int(),
  byMethod: byMethodSchema,
  byMedia: z.array(mediaStatsSchema),
  awaitingTransfer: countAmountSchema,
  /** 経費の合計（specs/collect/003 FR-003。前の版の API には無いので既定0） */
  expenseTotal: z.number().int().default(0),
  /** 紹介ありの人数と売上（名前は残さない。specs/collect/003 FR-023） */
  referred: z.object({ count: z.number().int(), paid: z.number().int(), awaiting: z.number().int() }).default({ count: 0, paid: 0, awaiting: 0 }),
  eventDeletedAt: z.string(),
});
/** イベントのまとめ。 */
export type EventSummary = z.infer<typeof eventSummarySchema>;

/** GET /api/collect/summaries の応答。 */
export const eventSummaryListSchema = z.object({ summaries: z.array(eventSummarySchema) });

/** DELETE /api/collect/events/:eventId の応答。 */
export const deleteEventResponseSchema = z.object({ summaryId: z.string() });
