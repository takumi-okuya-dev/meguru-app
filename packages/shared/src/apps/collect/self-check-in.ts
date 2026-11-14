// セルフ受付（参加者が自分で受付する）の入力と出力の形（specs/collect/002-self-check-in contracts/api.md 3）。
import { z } from "zod";
import { countChars } from "../../text";
import { COLLECT_MEDIA } from "./media";
import { CHECK_IN_MODES, COLLECT_METHODS, COLLECT_LIMITS } from "./schemas";
import { PAYMENT_STATUSES, RECEPTION_LINK_STATUSES } from "./reception";

/**
 * 参加者の端末の印を送る見出し（画面で作る UUID。research.md R2）。CORS ですでに許している手伝う人の見出しと同じ名前を使う
 * （共通の app.ts を変えないため。道筋が違うので取り違えない）。
 */
export const COLLECT_SELF_DEVICE_HEADER = "X-Collect-Device";

/** セルフ受付の回数の上限（research.md R2）。 */
export const SELF_CHECK_IN_LIMITS = {
  /** 端末ごとの、1分に探せる回数 */
  searchesPerDevicePerMinute: 10,
  /** リンク全体の、1分に探せる回数 */
  searchesPerLinkPerMinute: 300,
  /** リンク全体の、待ちの申し出の数 */
  pendingRequestsPerLink: 30,
  /** 参加者の画面が自分の状態を読む間隔（ミリ秒。research.md R5） */
  pollMs: 3000,
  /** 名簿なしで、1つの端末から1つのリンクで名簿に入れられる人数（specs/collect/004 research.md R6。友だちの分も入れられるように） */
  entriesPerDevicePerLink: 10,
  /** 名簿なしで、リンク全体で1分に名簿に入れられる人数 */
  entriesPerLinkPerMinute: 60,
  /** 名簿なしで、リンク全体で名簿に入れられる人数（出し直すと数え直す） */
  entriesPerLink: 1000,
} as const;

/** 参加者が選べる払い方（「来場のみ」は選べない。spec FR-014）。 */
export const SELF_METHODS = ["cash", "paypay", "transfer_today", "transfer_later"] as const;
/** 参加者が選べる払い方。 */
export type SelfMethod = (typeof SELF_METHODS)[number];

/** GET /api/collect/s/:token の応答。 */
export const selfLinkInfoSchema = z.object({
  status: z.enum(RECEPTION_LINK_STATUSES),
  event: z.object({ name: z.string(), startsAt: z.string(), venue: z.string().nullable(), methods: z.array(z.enum(COLLECT_METHODS)) }),
  /** PayPayのQRがあるか・振込先の案内（払い方を選んだあとの案内に出す。spec FR-015） */
  settings: z.object({ hasPaypayQr: z.boolean(), bankText: z.string().nullable() }),
  /** 受付のしかた（specs/collect/004。前の版の API にはないので roster とみなす） */
  checkInMode: z.enum(CHECK_IN_MODES).default("roster"),
  /** 名簿なしで出す媒体の並び（Threads で掲載済みの媒体を先に） */
  media: z.array(z.enum(COLLECT_MEDIA)).default([]),
  /** 名簿なしで区分が2つ以上のときに並べる区分（0円を除く）。ほかは空 */
  tiers: z.array(z.object({ name: z.string(), amount: z.number().int() })).default([]),
});
/** GET /api/collect/s/:token の応答。 */
export type SelfLinkInfo = z.infer<typeof selfLinkInfoSchema>;

/** 参加者に見せてよい本人の情報（名前・受付番号・区分と金額だけ）。 */
export const selfPersonSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  name: z.string(),
  tierName: z.string(),
  amount: z.number().int(),
  /** 区分がまだ決まっていない（名簿なし・区分が2つ以上。tierName・amount は仮。specs/collect/004 research.md R3） */
  tierUndecided: z.boolean().default(false),
});
/** 参加者に見せてよい本人の情報。 */
export type SelfPerson = z.infer<typeof selfPersonSchema>;

/** 参加者に見せる自分の記録。 */
export const selfRecordSchema = z.object({ method: z.string(), paymentStatus: z.enum(PAYMENT_STATUSES), amount: z.number().int() });

/** POST /api/collect/s/:token/search の入力。 */
export const selfSearchRequestSchema = z.object({
  query: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s !== "", { message: "required" })
    .refine((s) => countChars(s) <= COLLECT_LIMITS.personName, { message: "too long" }),
});

/** POST /api/collect/s/:token/search の応答（完全に一致した1人だけ。spec FR-012）。 */
export const selfSearchResponseSchema = z.discriminatedUnion("result", [
  z.object({ result: z.literal("found"), person: selfPersonSchema, record: selfRecordSchema.nullable() }),
  z.object({ result: z.literal("ambiguous") }),
  z.object({ result: z.literal("not_found") }),
]);
/** POST /api/collect/s/:token/search の応答。 */
export type SelfSearchResponse = z.infer<typeof selfSearchResponseSchema>;

/** POST /api/collect/s/:token/declare の入力（0円の区分は method を省く）。 */
export const selfDeclareRequestSchema = z.object({
  personId: z.uuid(),
  method: z.enum(SELF_METHODS).optional(),
  clientRequestId: z.uuid(),
});
/** POST /api/collect/s/:token/declare の入力。 */
export type SelfDeclareRequest = z.infer<typeof selfDeclareRequestSchema>;

/** POST /api/collect/s/:token/declare の応答。 */
export const selfDeclareResponseSchema = z.object({ record: selfRecordSchema });

/** POST /api/collect/s/:token/entries の入力（名簿なしで名簿に入る。specs/collect/004 contracts/api.md 2-2）。 */
export const selfEntryRequestSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s !== "", { message: "required" })
    .refine((s) => countChars(s) <= COLLECT_LIMITS.personName, { message: "too long" }),
  kana: z
    .string()
    .nullish()
    .transform((s) => (s == null || s.trim() === "" ? null : s.trim()))
    .refine((s) => s === null || countChars(s) <= COLLECT_LIMITS.kana, { message: "too long" }),
  media: z.enum(COLLECT_MEDIA),
  referrer: z
    .string()
    .nullish()
    .transform((s) => (s == null || s.trim() === "" ? null : s.trim()))
    .refine((s) => s === null || countChars(s) <= COLLECT_LIMITS.referrer, { message: "too long" }),
  clientRequestId: z.uuid(),
});
/** POST /api/collect/s/:token/entries の入力。 */
export type SelfEntryRequest = z.infer<typeof selfEntryRequestSchema>;

/** POST /api/collect/s/:token/entries の応答。 */
export const selfEntryResponseSchema = z.object({ requestId: z.string(), person: selfPersonSchema });
/** POST /api/collect/s/:token/entries の応答。 */
export type SelfEntryResponse = z.infer<typeof selfEntryResponseSchema>;

/** POST /api/collect/s/:token/requests の入力（飛び入りの申し出）。 */
export const selfRequestCreateSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s !== "", { message: "required" })
    .refine((s) => countChars(s) <= COLLECT_LIMITS.personName, { message: "too long" }),
  kana: z
    .string()
    .nullish()
    .transform((s) => (s == null || s.trim() === "" ? null : s.trim()))
    .refine((s) => s === null || countChars(s) <= COLLECT_LIMITS.kana, { message: "too long" }),
});
/** POST /api/collect/s/:token/requests の入力。 */
export type SelfRequestCreate = z.infer<typeof selfRequestCreateSchema>;

/** POST /api/collect/s/:token/requests の応答。 */
export const selfRequestCreatedSchema = z.object({ requestId: z.string() });

/** 飛び入りの申し出の状態。 */
export const SELF_REQUEST_STATUSES = ["pending", "accepted", "matched", "rejected"] as const;

/** GET /api/collect/s/:token/me の応答（自分の端末の状態）。 */
export const selfMeSchema = z.object({
  status: z.enum(RECEPTION_LINK_STATUSES),
  declaration: z.object({ person: selfPersonSchema, record: selfRecordSchema }).nullable(),
  request: z
    .object({ id: z.string(), status: z.enum(SELF_REQUEST_STATUSES), person: selfPersonSchema.nullable() })
    .nullable(),
});
/** GET /api/collect/s/:token/me の応答。 */
export type SelfMe = z.infer<typeof selfMeSchema>;
