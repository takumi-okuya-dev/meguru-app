// 集金管理の入力と出力の形（specs/collect/001-event-day-collection contracts/api.md 1〜3・7、data-model.md 2）。
// PR1（イベント・料金の区分・名簿・前回の参加者・既定値）の分。受付・手伝う人・締めの形は、それぞれのPRで足す。
import { z } from "zod";
import { countChars } from "../../text";
import { COLLECT_MEDIA } from "./media";

/** 集金管理のアプリの番号（APP_CATALOG・利用の許可・出来事の届け先）。 */
export const COLLECT_APP = "collect";

/** 払い方（イベントで使うもの）。 */
export const COLLECT_METHODS = ["cash", "paypay", "transfer"] as const;
/** 払い方。 */
export type CollectMethod = (typeof COLLECT_METHODS)[number];
/** 払い方の表示名。 */
export const COLLECT_METHOD_LABELS: Record<CollectMethod, string> = { cash: "現金", paypay: "PayPay", transfer: "振込" };

/** 決まりの数（data-model.md 2）。 */
export const COLLECT_LIMITS = {
  eventName: 100,
  venue: 100,
  capacityMax: 10_000,
  tierName: 20,
  tierAmountMax: 999_999,
  tiersMax: 20,
  personName: 50,
  kana: 50,
  memo: 200,
  /** 紹介した人（specs/collect/003 FR-020） */
  referrer: 40,
  bulkMax: 300,
  bankText: 300,
  /** PayPayのQRの画像の上限（バイト。R10） */
  paypayQrBytes: 300 * 1024,
  /** 前回の参加者の候補の数（FR-027） */
  pastAttendees: 5,
} as const;

/** PayPayのQRの画像で受ける形式（R10）。 */
export const PAYPAY_QR_TYPES = ["image/png", "image/jpeg"] as const;

/**
 * 前後の空白を除いた必須の文字列（1〜max文字）。
 * @param max - 文字数の上限
 * @returns zod のスキーマ
 */
const required = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s !== "", { message: "required" })
    .refine((s) => countChars(s) <= max, { message: `max ${max}` });

/**
 * 任意の文字列（空・空白だけ・null は null にする。max文字まで）。
 * @param max - 文字数の上限
 * @returns zod のスキーマ
 */
const optional = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => (s == null || s.trim() === "" ? null : s.trim()))
    .refine((s) => s === null || countChars(s) <= max, { message: `max ${max}` });

/** ISO 8601 の日時（時差つき）。 */
const isoDateTime = z.iso.datetime({ offset: true });

/** 料金の区分の入力（直すときは id を付ける）。 */
export const collectTierInputSchema = z.object({
  id: z.uuid().optional(),
  name: required(COLLECT_LIMITS.tierName),
  amount: z.number().int().min(0).max(COLLECT_LIMITS.tierAmountMax),
});
/** 料金の区分の入力。 */
export type CollectTierInput = z.infer<typeof collectTierInputSchema>;

const methodsSchema = z
  .array(z.enum(COLLECT_METHODS))
  .min(1)
  .transform((ms) => COLLECT_METHODS.filter((m) => ms.includes(m)));

const eventFields = {
  name: required(COLLECT_LIMITS.eventName),
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullish().transform((s) => s ?? null),
  venue: optional(COLLECT_LIMITS.venue),
  capacity: z.number().int().min(1).max(COLLECT_LIMITS.capacityMax).nullish().transform((n) => n ?? null),
  methods: methodsSchema,
  tiers: z.array(collectTierInputSchema).min(1).max(COLLECT_LIMITS.tiersMax),
};

/**
 * 終わりの時刻が始まりより後か（どちらかがなければ確かめない）。
 * @param v - 始まりと終わり
 * @returns 正しければ true
 */
const endsAfterStart = (v: { startsAt?: string; endsAt?: string | null }) =>
  !v.startsAt || !v.endsAt || new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime();

/** POST /api/collect/events の入力（FR-010）。区分の id は無視する。 */
export const createCollectEventRequestSchema = z
  .object({ ...eventFields, sourceThreadsPromotionId: z.string().max(100).nullish().transform((s) => s ?? null) })
  .refine(endsAfterStart, { message: "endsAt must be after startsAt", path: ["endsAt"] });
/** POST /api/collect/events の入力。 */
export type CreateCollectEventRequest = z.infer<typeof createCollectEventRequestSchema>;

/**
 * PATCH /api/collect/events/:eventId の入力。どの項目も省ける。tiers を渡すときは、並びのとおりの全部の区分
 * （id のあるものは直す、ないものは足す、渡さなかった区分は消す。使われている区分は消せない）。
 */
export const updateCollectEventRequestSchema = z
  .object({
    name: eventFields.name.optional(),
    startsAt: isoDateTime.optional(),
    endsAt: eventFields.endsAt.optional(),
    venue: eventFields.venue.optional(),
    capacity: eventFields.capacity.optional(),
    methods: methodsSchema.optional(),
    tiers: eventFields.tiers.optional(),
  })
  .refine((v) => {
    const ids = (v.tiers ?? []).flatMap((t) => (t.id ? [t.id] : []));
    return new Set(ids).size === ids.length;
  }, { message: "duplicate tier id", path: ["tiers"] });
/** PATCH /api/collect/events/:eventId の入力。 */
export type UpdateCollectEventRequest = z.infer<typeof updateCollectEventRequestSchema>;

/** 料金の区分。 */
export const collectTierSchema = z.object({ id: z.string(), name: z.string(), amount: z.number().int(), position: z.number().int() });
/** 料金の区分。 */
export type CollectTier = z.infer<typeof collectTierSchema>;

/** イベント（GET /api/collect/events/:eventId・作った・直したときの応答）。 */
export const collectEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  venue: z.string().nullable(),
  capacity: z.number().int().nullable(),
  methods: z.array(z.enum(COLLECT_METHODS)),
  tiers: z.array(collectTierSchema),
  closedAt: z.string().nullable(),
  sourceThreadsPromotionId: z.string().nullable(),
  sourceChangedAt: z.string().nullable(),
  sourceDeletedAt: z.string().nullable(),
  /** Threads から作ったイベントの、元の宣伝内容で掲載済みの媒体（名簿の媒体のボタンで先に並べる。FR-064）。GET …/:eventId だけ */
  threadsPostedMedia: z.array(z.enum(COLLECT_MEDIA)).optional(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
/** イベント。 */
export type CollectEvent = z.infer<typeof collectEventSchema>;

/** イベントの一覧の1行（FR-012）。 */
export const collectEventListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  venue: z.string().nullable(),
  closedAt: z.string().nullable(),
  rosterCount: z.number().int(),
  attendedCount: z.number().int(),
  awaitingTransferCount: z.number().int(),
  fromThreads: z.boolean(),
});
/** イベントの一覧の1行。 */
export type CollectEventListItem = z.infer<typeof collectEventListItemSchema>;

/** GET /api/collect/events の応答。 */
export const collectEventListSchema = z.object({ events: z.array(collectEventListItemSchema) });
/** GET /api/collect/events の応答。 */
export type CollectEventList = z.infer<typeof collectEventListSchema>;

const personFields = {
  name: required(COLLECT_LIMITS.personName),
  kana: optional(COLLECT_LIMITS.kana),
  media: z.enum(COLLECT_MEDIA),
  priceTierId: z.uuid(),
  memo: optional(COLLECT_LIMITS.memo),
  /** 紹介した人（specs/collect/003 FR-020。40文字まで） */
  referrer: optional(COLLECT_LIMITS.referrer).optional(),
};

/** POST /api/collect/events/:eventId/roster の入力（FR-020）。 */
export const addRosterPersonRequestSchema = z.object(personFields);
/** POST /api/collect/events/:eventId/roster の入力。 */
export type AddRosterPersonRequest = z.infer<typeof addRosterPersonRequestSchema>;

/** POST /api/collect/events/:eventId/roster/bulk の入力（FR-022。APIでも行を整え、空の行を除く）。 */
export const bulkAddRosterRequestSchema = z.object({
  names: z.array(z.string().max(500)).min(1).max(COLLECT_LIMITS.bulkMax),
  media: z.enum(COLLECT_MEDIA),
  priceTierId: z.uuid(),
  /** 貼った人みなに付ける紹介した人（specs/collect/003 FR-020） */
  referrer: optional(COLLECT_LIMITS.referrer).optional(),
});
/** POST /api/collect/events/:eventId/roster/bulk の入力。 */
export type BulkAddRosterRequest = z.infer<typeof bulkAddRosterRequestSchema>;

/** PATCH /api/collect/events/:eventId/roster/:personId の入力（FR-025。どの項目も省けるが、1つは要る）。 */
export const updateRosterPersonRequestSchema = z
  .object({
    name: personFields.name.optional(),
    kana: personFields.kana.optional(),
    media: personFields.media.optional(),
    priceTierId: personFields.priceTierId.optional(),
    memo: personFields.memo.optional(),
    referrer: personFields.referrer,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nothing to update", path: ["name"] });
/** PATCH /api/collect/events/:eventId/roster/:personId の入力。 */
export type UpdateRosterPersonRequest = z.infer<typeof updateRosterPersonRequestSchema>;

/** 名簿の人。 */
export const rosterPersonSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  name: z.string(),
  kana: z.string().nullable(),
  media: z.enum(COLLECT_MEDIA),
  priceTierId: z.string(),
  memo: z.string().nullable(),
  /** 紹介した人（specs/collect/003。前の版の API には無いので既定は null） */
  referrer: z.string().nullable().default(null),
  createdAt: z.string(),
});
/** 名簿の人。 */
export type RosterPerson = z.infer<typeof rosterPersonSchema>;

/** GET /api/collect/events/:eventId/roster の応答（受付番号の順）。 */
export const rosterListSchema = z.object({ people: z.array(rosterPersonSchema), version: z.number().int() });
/** GET /api/collect/events/:eventId/roster の応答。 */
export type RosterList = z.infer<typeof rosterListSchema>;

/** POST /api/collect/events/:eventId/roster の応答（同じ名前の人がいれば sameNameAs。FR-024）。 */
export const addRosterPersonResponseSchema = z.object({
  person: rosterPersonSchema,
  sameNameAs: z.object({ number: z.number().int(), media: z.enum(COLLECT_MEDIA) }).nullable(),
  version: z.number().int(),
});
/** POST /api/collect/events/:eventId/roster の応答。 */
export type AddRosterPersonResponse = z.infer<typeof addRosterPersonResponseSchema>;

/** POST /api/collect/events/:eventId/roster/bulk の応答。 */
export const bulkAddRosterResponseSchema = z.object({ people: z.array(rosterPersonSchema), version: z.number().int() });
/** POST /api/collect/events/:eventId/roster/bulk の応答。 */
export type BulkAddRosterResponse = z.infer<typeof bulkAddRosterResponseSchema>;

/** GET /api/collect/past-attendees のクエリ（FR-027）。 */
export const pastAttendeesQuerySchema = z.object({
  eventId: z.uuid(),
  q: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s !== "", { message: "required" })
    .refine((s) => countChars(s) <= COLLECT_LIMITS.personName, { message: "too long" }),
});

/** 前回の参加者の候補。 */
export const pastAttendeeSchema = z.object({
  name: z.string(),
  kana: z.string().nullable(),
  lastEventName: z.string(),
  lastEventStartsAt: z.string(),
});
/** 前回の参加者の候補。 */
export type PastAttendee = z.infer<typeof pastAttendeeSchema>;

/** GET /api/collect/past-attendees の応答。 */
export const pastAttendeesResponseSchema = z.object({ candidates: z.array(pastAttendeeSchema) });
/** GET /api/collect/past-attendees の応答。 */
export type PastAttendeesResponse = z.infer<typeof pastAttendeesResponseSchema>;

/** PUT /api/collect/settings の入力（FR-013）。 */
export const putCollectSettingsRequestSchema = z.object({ bankText: optional(COLLECT_LIMITS.bankText) });

/** GET・PUT /api/collect/settings の応答。 */
export const collectSettingsSchema = z.object({
  bankText: z.string().nullable(),
  hasPaypayQr: z.boolean(),
});
/** 主催者の既定値。 */
export type CollectSettings = z.infer<typeof collectSettingsSchema>;

/** GET /api/collect/me の応答（029 FR-024 の /api/<アプリ>/me の形）。 */
export const collectMeSchema = z.object({
  hasPaypayQr: z.boolean(),
  hasBankText: z.boolean(),
  awaitingTransferCount: z.number().int(),
});
/** GET /api/collect/me の応答。 */
export type CollectMe = z.infer<typeof collectMeSchema>;
