// 集金管理の受付・会場の共有・受付の手伝いの入力と出力の形（specs/collect/001-event-day-collection contracts/api.md 4・5・8、
// contracts/realtime.md、data-model.md 2-4〜2-6・4）。PR2 の分。
import { z } from "zod";
import { countChars } from "../../text";
import { COLLECT_MEDIA } from "./media";
import { COLLECT_LIMITS, COLLECT_METHODS, collectTierSchema } from "./schemas";

/** 受付の払い方（data-model.md 2-4。`none`は「来場のみ」で0円）。 */
export const RECEPTION_METHODS = ["cash", "paypay", "transfer_today", "transfer_later", "none"] as const;
/** 受付の払い方。 */
export type ReceptionMethod = (typeof RECEPTION_METHODS)[number];
/** 受付の払い方の表示名。 */
export const RECEPTION_METHOD_LABELS: Record<ReceptionMethod, string> = {
  cash: "現金",
  paypay: "PayPay",
  transfer_today: "振込（当日）",
  transfer_later: "振込（後日）",
  none: "来場のみ",
};

/**
 * 受付の払い方が、イベントで使う払い方に入っているか（`none`はいつも使える。振込は当日・後日のどちらも`transfer`）。
 * @param method - 受付の払い方
 * @param methods - イベントで使う払い方
 * @returns 使えるなら true
 */
export function isReceptionMethodAllowed(method: ReceptionMethod, methods: readonly string[]): boolean {
  if (method === "none") return true;
  return methods.includes(method === "transfer_today" || method === "transfer_later" ? "transfer" : method);
}

/** 受付の決まりの数。 */
export const RECEPTION_LIMITS = {
  /** 手伝う人の名前（data-model.md 2-6） */
  helperName: 20,
  /** 会場の共有の入場券の期限（秒。R5） */
  liveTicketSeconds: 60,
} as const;

/** 受け取った人の種類。 */
/** 受け取った人の種類（`self` は参加者の本人の申告で、まだ受付をする人が確かめていない。specs/collect/002 research.md R3）。 */
export const RECEIVER_KINDS = ["owner", "helper", "self"] as const;
/** 支払いの状態（`awaiting_confirmation` は本人の申告の現金・PayPayの確かめ待ち。specs/collect/002）。 */
export const PAYMENT_STATUSES = ["paid", "awaiting_transfer", "awaiting_confirmation"] as const;

/** PUT …/reception/:personId の入力（FR-031・FR-032・FR-035）。区分と金額は記録にだけ持つ（R17）。 */
export const recordReceptionRequestSchema = z.object({
  method: z.enum(RECEPTION_METHODS),
  priceTierId: z.uuid().optional(),
  amount: z.number().int().min(0).max(COLLECT_LIMITS.tierAmountMax).optional(),
  clientRequestId: z.uuid(),
});
/** PUT …/reception/:personId の入力。 */
export type RecordReceptionRequest = z.infer<typeof recordReceptionRequestSchema>;

/** 受付の記録。 */
export const receptionRecordSchema = z.object({
  personId: z.string(),
  method: z.enum(RECEPTION_METHODS),
  priceTierId: z.string(),
  amount: z.number().int(),
  amountOverridden: z.boolean(),
  receiverKind: z.enum(RECEIVER_KINDS),
  receiverHelperId: z.string().nullable(),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  transferConfirmedAt: z.string().nullable(),
  recordedAt: z.string(),
  /** 参加者の本人の申告で作った記録（確かめたあとも true。specs/collect/002） */
  selfReported: z.boolean().default(false),
  /** 受付をする人が確かめた時刻（本人の申告のとき） */
  confirmedAt: z.string().nullable().default(null),
});
/** 受付の記録。 */
export type ReceptionRecord = z.infer<typeof receptionRecordSchema>;

/** PUT …/reception/:personId の応答。 */
export const recordReceptionResponseSchema = z.object({ record: receptionRecordSchema, version: z.number().int() });
/** PUT …/reception/:personId の応答。 */
export type RecordReceptionResponse = z.infer<typeof recordReceptionResponseSchema>;

/** DELETE …/reception/:personId の応答。 */
export const versionResponseSchema = z.object({ version: z.number().int() });

/** POST …/walk-ins の入力（FR-034）。 */
export const walkInRequestSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s !== "", { message: "required" })
    .refine((s) => countChars(s) <= COLLECT_LIMITS.personName, { message: `max ${COLLECT_LIMITS.personName}` }),
  clientRequestId: z.uuid(),
});
/** POST …/walk-ins の入力。 */
export type WalkInRequest = z.infer<typeof walkInRequestSchema>;

/** 受付の画面の名簿の人（手伝う人の画面と会場の共有の知らせには、メモを入れない。FR-002）。 */
export const receptionPersonSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  name: z.string(),
  kana: z.string().nullable(),
  media: z.enum(COLLECT_MEDIA),
  priceTierId: z.string(),
  memo: z.string().nullable().optional(),
});
/** 受付の画面の名簿の人。 */
export type ReceptionPerson = z.infer<typeof receptionPersonSchema>;

/** POST …/walk-ins の応答。 */
export const walkInResponseSchema = z.object({ person: receptionPersonSchema, version: z.number().int() });
/** POST …/walk-ins の応答。 */
export type WalkInResponse = z.infer<typeof walkInResponseSchema>;

/** 受付の画面の数字（data-model.md 4）。`mine`は呼んだ人が受け取った現金。 */
export const receptionStatsSchema = z.object({
  arrived: z.number().int(),
  rosterCount: z.number().int(),
  cash: z.number().int(),
  paypay: z.number().int(),
  awaitingTransferCount: z.number().int(),
  awaitingTransferAmount: z.number().int(),
  mine: z.number().int(),
  /** 本人の申告の確かめ待ち（現金・PayPayの合計には入れない。specs/collect/002） */
  awaitingConfirmationCount: z.number().int().default(0),
  awaitingConfirmationAmount: z.number().int().default(0),
});
/** 受付の画面の数字。 */
export type ReceptionStats = z.infer<typeof receptionStatsSchema>;

/** 受付の画面のイベント（手伝う人にも出してよい項目だけ）。 */
export const receptionEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  venue: z.string().nullable(),
  methods: z.array(z.enum(COLLECT_METHODS)),
  tiers: z.array(collectTierSchema),
  closedAt: z.string().nullable(),
});
/** 受付の画面のイベント。 */
export type ReceptionEvent = z.infer<typeof receptionEventSchema>;

/** 受付の画面に出す手伝う人（受け取った人の名前を出すため）。 */
export const receptionHelperSchema = z.object({ id: z.string(), name: z.string(), joinedAt: z.string() });
/** 受付の画面に出す手伝う人。 */
export type ReceptionHelper = z.infer<typeof receptionHelperSchema>;

/** GET …/reception の応答（スナップショット。contracts/api.md 4・8）。 */
export const receptionSnapshotSchema = z.object({
  version: z.number().int(),
  event: receptionEventSchema,
  people: z.array(z.object({ person: receptionPersonSchema, record: receptionRecordSchema.nullable() })),
  stats: receptionStatsSchema,
  helpers: z.array(receptionHelperSchema),
  /** PayPayのシートと振込のシートに出すもの */
  settings: z.object({ hasPaypayQr: z.boolean(), bankText: z.string().nullable() }),
  /** セルフ受付の飛び入りの申し出（待ちだけ。specs/collect/002） */
  selfRequests: z.array(z.lazy(() => selfRequestSchema)).default([]),
});
/** GET …/reception の応答。 */
export type ReceptionSnapshot = z.infer<typeof receptionSnapshotSchema>;

/** POST …/live-ticket の応答（R5）。 */
export const liveTicketResponseSchema = z.object({ ticket: z.string(), expiresAt: z.string() });
/** POST …/live-ticket の応答。 */
export type LiveTicketResponse = z.infer<typeof liveTicketResponseSchema>;

/** 会場の共有の知らせ（contracts/realtime.md 2）。 */
export type LiveMessage = { eventId: string; version: number; at: string } & (
  | { type: "reception.recorded"; personId: string; record: ReceptionRecord }
  | { type: "reception.undone"; personId: string }
  // selfRequests はセルフ受付の申し出を名簿に入れたとき（同じ版で申し出の一覧も変わる。specs/collect/002）
  | { type: "roster.changed"; personId?: string; person?: ReceptionPerson; selfRequests?: SelfRequest[] }
  | { type: "helpers.changed"; helpers: ReceptionHelper[] }
  | { type: "link.stopped" }
  | { type: "resync" }
  | { type: "self_requests.changed"; selfRequests: SelfRequest[] }
  | { type: "self_link.stopped" }
);

/** セルフ受付の飛び入りの申し出（受付の画面に出す。specs/collect/002 data-model.md 2-2）。 */
export const selfRequestSchema = z.object({ id: z.string(), name: z.string(), kana: z.string().nullable(), createdAt: z.string() });
/** セルフ受付の飛び入りの申し出。 */
export type SelfRequest = z.infer<typeof selfRequestSchema>;

/** POST …/reception/:personId/confirm の入力（確かめ待ちを支払い済みにする。払い方・区分・金額を直せる。specs/collect/002 FR-031）。 */
export const confirmReceptionRequestSchema = z.object({
  method: z.enum(["cash", "paypay"]).optional(),
  priceTierId: z.uuid().optional(),
  amount: z.number().int().min(0).max(COLLECT_LIMITS.tierAmountMax).optional(),
});
/** POST …/reception/:personId/confirm の入力。 */
export type ConfirmReceptionRequest = z.infer<typeof confirmReceptionRequestSchema>;

/** POST …/self-requests/:requestId/match の入力（名簿の人に当てる）。 */
export const matchSelfRequestSchema = z.object({ personId: z.uuid() });

/** POST …/self-requests/:requestId/accept|match|reject の応答（名簿に入れたときは person）。 */
export const resolveSelfRequestResponseSchema = z.object({ version: z.number().int(), person: receptionPersonSchema.optional() });
/** 申し出の片付け方。 */
export type SelfRequestAction = "accept" | "match" | "reject";

/** 受付用リンク（GET・POST・PATCH …/link の応答。ない・止めたあとは null）。 */
export const receptionLinkSchema = z.object({ url: z.string(), expiresAt: z.string(), stoppedAt: z.string().nullable() });
/** 受付用リンク。 */
export type ReceptionLink = z.infer<typeof receptionLinkSchema>;

/** GET・POST・PATCH …/link の応答。 */
export const receptionLinkResponseSchema = z.object({ link: receptionLinkSchema.nullable() });
/** GET・POST・PATCH …/link の応答。 */
export type ReceptionLinkResponse = z.infer<typeof receptionLinkResponseSchema>;

/** POST …/link の入力（期限を省いたら既定。R7）。 */
export const createReceptionLinkRequestSchema = z.object({ expiresAt: z.iso.datetime({ offset: true }).optional() });
/** PATCH …/link の入力。 */
export const updateReceptionLinkRequestSchema = z.object({ expiresAt: z.iso.datetime({ offset: true }) });

/** 受付をしている人の1行（FR-072）。 */
export const receptionWorkerSchema = z.object({
  id: z.string(),
  name: z.string(),
  joinedAt: z.string(),
  lastRecordedAt: z.string().nullable(),
  recordCount: z.number().int(),
  cashAmount: z.number().int(),
  deviceCount: z.number().int(),
});
/** 受付をしている人の1行。 */
export type ReceptionWorker = z.infer<typeof receptionWorkerSchema>;

/** GET …/helpers の応答（主催者自身の行つき）。 */
export const receptionWorkersResponseSchema = z.object({
  owner: z.object({ lastRecordedAt: z.string().nullable(), recordCount: z.number().int(), cashAmount: z.number().int() }),
  helpers: z.array(receptionWorkerSchema),
});
/** GET …/helpers の応答。 */
export type ReceptionWorkersResponse = z.infer<typeof receptionWorkersResponseSchema>;

/** 受付用リンクの状態。 */
export const RECEPTION_LINK_STATUSES = ["active", "stopped", "expired"] as const;

/** GET /api/collect/r/:token の応答。 */
export const helperLinkInfoSchema = z.object({
  status: z.enum(RECEPTION_LINK_STATUSES),
  event: z.object({ name: z.string(), startsAt: z.string(), venue: z.string().nullable() }),
  expiresAt: z.string(),
});
/** GET /api/collect/r/:token の応答。 */
export type HelperLinkInfo = z.infer<typeof helperLinkInfoSchema>;

/** POST /api/collect/r/:token/join の入力（FR-071・FR-075。同じ名前なら「同じ人」か「別の人」を選んで送り直す）。 */
export const helperJoinRequestSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s !== "", { message: "required" })
    .refine((s) => countChars(s) <= RECEPTION_LIMITS.helperName, { message: `max ${RECEPTION_LIMITS.helperName}` }),
  sameAsHelperId: z.uuid().optional(),
  asNew: z.boolean().optional(),
});
/** POST /api/collect/r/:token/join の入力。 */
export type HelperJoinRequest = z.infer<typeof helperJoinRequestSchema>;

/** POST /api/collect/r/:token/join の応答。 */
export const helperJoinResponseSchema = z.object({ helperId: z.string(), deviceSecret: z.string() });
/** POST /api/collect/r/:token/join の応答。 */
export type HelperJoinResponse = z.infer<typeof helperJoinResponseSchema>;

/** 手伝う人の端末の印を送る見出し（R7）。 */
export const COLLECT_DEVICE_HEADER = "X-Collect-Device";
