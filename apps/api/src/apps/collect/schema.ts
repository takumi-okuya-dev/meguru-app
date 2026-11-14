// 集金管理（apps/collect）の表の定義（specs/collect/001-event-day-collection data-model.md 2、research.md R1・R2）。
// 表はスキーマ collect に置き、共通の表（users など）への外部キーは張らない。主催者は owner_user_id に値として持ち、
// 退会の片づけは出来事（user.withdrawn）で集金管理が行う（docs/app-separation.md 4）。外部キーは集金管理の表の中だけに張る。
// PR1 の分（イベント・料金の区分・名簿・主催者の既定値・受け取った出来事）、PR2 の分（受付の記録・受付用リンク・手伝う人・端末）、
// PR3 の分（精算・イベントのまとめ）、PR4 の分（Threadsのイベントの候補）。
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgSchema, primaryKey, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import {
  type ByMethod,
  type CountAmount,
  type MediaStats,
  COLLECT_LIMITS,
  COLLECT_MEDIA,
  COLLECT_METHODS,
  PAYMENT_STATUSES,
  PAYPAY_QR_TYPES,
  RECEIVER_KINDS,
  RECEPTION_LIMITS,
  RECEPTION_METHODS,
} from "@meguru/shared";
import { bytea, inList, timestamps } from "../../kernel/db/columns";

/** 集金管理のスキーマ。 */
export const collectSchema = pgSchema("collect");

/** イベント（data-model.md 2-1）。 */
export const collectEvents = collectSchema.table(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 主催者（共通の利用者の番号。外部キーなし）
    ownerUserId: uuid("owner_user_id").notNull(),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    venue: text("venue"),
    capacity: integer("capacity"),
    methods: text("methods").array().notNull().default(sql`ARRAY['cash','paypay','transfer']::text[]`),
    // 次に振る受付番号（R8。名簿に足すトランザクションの中で UPDATE … RETURNING して取る）
    nextNumber: integer("next_number").notNull().default(1),
    // 受付の画面に関わる変更のたびに1上げる（R4。会場の共有は PR2）
    version: bigint("version", { mode: "number" }).notNull().default(0),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedVersion: bigint("closed_version", { mode: "number" }),
    paypayCheckedAt: timestamp("paypay_checked_at", { withTimezone: true }),
    // Threadsから作ったときの元の宣伝内容の番号（値だけ。User Story 6・PR4）
    sourceThreadsPromotionId: text("source_threads_promotion_id"),
    sourceChangedAt: timestamp("source_changed_at", { withTimezone: true }),
    sourceDeletedAt: timestamp("source_deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("events_owner_idx").on(t.ownerUserId, t.startsAt),
    check("events_name_length", sql`char_length(${t.name}) BETWEEN 1 AND ${sql.raw(String(COLLECT_LIMITS.eventName))}`),
    check("events_venue_length", sql`char_length(${t.venue}) <= ${sql.raw(String(COLLECT_LIMITS.venue))}`),
    check("events_capacity_range", sql`${t.capacity} BETWEEN 1 AND ${sql.raw(String(COLLECT_LIMITS.capacityMax))}`),
    check("events_ends_after_starts", sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
    check(
      "events_methods_valid",
      sql`cardinality(${t.methods}) >= 1 AND ${t.methods} <@ ARRAY[${inList(COLLECT_METHODS)}]::text[]`,
    ),
    check("events_next_number_positive", sql`${t.nextNumber} >= 1`),
  ],
);

/** 料金の区分（data-model.md 2-2）。イベントを消すと一緒に消える。 */
export const collectPriceTiers = collectSchema.table(
  "price_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => collectEvents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amount: integer("amount").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    index("price_tiers_event_idx").on(t.eventId, t.position),
    check("price_tiers_name_length", sql`char_length(${t.name}) BETWEEN 1 AND ${sql.raw(String(COLLECT_LIMITS.tierName))}`),
    check("price_tiers_amount_range", sql`${t.amount} BETWEEN 0 AND ${sql.raw(String(COLLECT_LIMITS.tierAmountMax))}`),
  ],
);

/** 名簿の人（data-model.md 2-3）。 */
export const collectRosterPeople = collectSchema.table(
  "roster_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => collectEvents.id, { onDelete: "cascade" }),
    // 受付番号（使い回さない。R8）
    number: integer("number").notNull(),
    name: text("name").notNull(),
    // nameKey(name)（R9。検索・同じ名前の知らせ・前回の参加者）
    nameKey: text("name_key").notNull(),
    kana: text("kana"),
    kanaKey: text("kana_key"),
    media: text("media").notNull(),
    // 申込のときの予定の区分。イベントを消すときの CASCADE で止まらないよう NO ACTION（文の終わりで確かめる。data-model.md 2-2）
    priceTierId: uuid("price_tier_id")
      .notNull()
      .references(() => collectPriceTiers.id, { onDelete: "no action" }),
    memo: text("memo"),
    // 飛び入りを手伝う人が足したとき（手伝う人を消したら空にする）
    addedByHelperId: uuid("added_by_helper_id").references((): AnyPgColumn => collectHelpers.id, { onDelete: "set null" }),
    // 飛び入りの送り直しで二重にしない（R6。飛び入りのときだけ入る）
    clientRequestId: uuid("client_request_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roster_people_event_number_key").on(t.eventId, t.number),
    index("roster_people_event_name_key_idx").on(t.eventId, t.nameKey),
    index("roster_people_price_tier_idx").on(t.priceTierId),
    check("roster_people_name_length", sql`char_length(${t.name}) BETWEEN 1 AND ${sql.raw(String(COLLECT_LIMITS.personName))}`),
    check("roster_people_kana_length", sql`char_length(${t.kana}) <= ${sql.raw(String(COLLECT_LIMITS.kana))}`),
    check("roster_people_memo_length", sql`char_length(${t.memo}) <= ${sql.raw(String(COLLECT_LIMITS.memo))}`),
    check("roster_people_media_valid", sql`${t.media} IN (${inList(COLLECT_MEDIA)})`),
    check("roster_people_number_positive", sql`${t.number} >= 1`),
  ],
);

/** 主催者の既定値（data-model.md 2-8）。PayPayのQRの画像と振込先の案内。 */
export const collectOwnerSettings = collectSchema.table(
  "owner_settings",
  {
    ownerUserId: uuid("owner_user_id").primaryKey(),
    paypayQr: bytea("paypay_qr"),
    paypayQrType: text("paypay_qr_type"),
    bankText: text("bank_text"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("owner_settings_paypay_qr_size", sql`octet_length(${t.paypayQr}) <= ${sql.raw(String(COLLECT_LIMITS.paypayQrBytes))}`),
    check("owner_settings_paypay_qr_type_valid", sql`${t.paypayQrType} IN (${inList(PAYPAY_QR_TYPES)})`),
    check("owner_settings_paypay_qr_pair", sql`(${t.paypayQr} IS NULL) = (${t.paypayQrType} IS NULL)`),
    check("owner_settings_bank_text_length", sql`char_length(${t.bankText}) <= ${sql.raw(String(COLLECT_LIMITS.bankText))}`),
  ],
);

/** 受け取った共通の出来事（2回届いても結果を変えない。docs/module-map.md 6、data-model.md 2-11 の processed_events）。 */
export const collectReceivedEvents = collectSchema.table("received_events", {
  eventId: uuid("event_id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true, precision: 6 }).notNull().defaultNow(),
});

/** 受付の記録（data-model.md 2-4）。名簿の人1人に1行（主キー）で、二重の記録を止める（R6）。 */
export const collectReceptionRecords = collectSchema.table(
  "reception_records",
  {
    rosterPersonId: uuid("roster_person_id")
      .primaryKey()
      .references(() => collectRosterPeople.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => collectEvents.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    // 記録したときの区分（受付で変えたら変えたもの。名簿の区分は変えない。R17）。イベントを消すときの CASCADE で止まらないよう NO ACTION
    priceTierId: uuid("price_tier_id")
      .notNull()
      .references(() => collectPriceTiers.id, { onDelete: "no action" }),
    amount: integer("amount").notNull(),
    amountOverridden: boolean("amount_overridden").notNull().default(false),
    receiverKind: text("receiver_kind").notNull(),
    // 手伝う人が受け取ったとき。イベントを消すときの CASCADE で止まらないよう NO ACTION（RESTRICT にしない）
    receiverHelperId: uuid("receiver_helper_id").references((): AnyPgColumn => collectHelpers.id, { onDelete: "no action" }),
    paymentStatus: text("payment_status").notNull(),
    transferConfirmedAt: timestamp("transfer_confirmed_at", { withTimezone: true }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    clientRequestId: uuid("client_request_id").notNull().unique(),
  },
  (t) => [
    index("reception_records_event_idx").on(t.eventId),
    index("reception_records_price_tier_idx").on(t.priceTierId),
    index("reception_records_receiver_helper_idx").on(t.receiverHelperId),
    check("reception_records_method_valid", sql`${t.method} IN (${inList(RECEPTION_METHODS)})`),
    check("reception_records_amount_range", sql`${t.amount} BETWEEN 0 AND ${sql.raw(String(COLLECT_LIMITS.tierAmountMax))}`),
    check("reception_records_none_is_free", sql`${t.method} <> 'none' OR ${t.amount} = 0`),
    check("reception_records_receiver_kind_valid", sql`${t.receiverKind} IN (${inList(RECEIVER_KINDS)})`),
    check("reception_records_receiver_pair", sql`(${t.receiverKind} = 'helper') = (${t.receiverHelperId} IS NOT NULL)`),
    check("reception_records_payment_status_valid", sql`${t.paymentStatus} IN (${inList(PAYMENT_STATUSES)})`),
    check(
      "reception_records_awaiting_only_transfer",
      sql`${t.paymentStatus} = 'paid' OR ${t.method} IN ('transfer_today', 'transfer_later')`,
    ),
  ],
);

/** 受付用リンク（data-model.md 2-5）。照合はハッシュ、主催者がQRを出し直すのは暗号化した写し（AADはイベントの番号。R7）。 */
export const collectReceptionLinks = collectSchema.table(
  "reception_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => collectEvents.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    tokenCiphertext: bytea("token_ciphertext").notNull(),
    tokenIv: bytea("token_iv").notNull(),
    tokenKeyVersion: smallint("token_key_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // 使えるリンク（止めていないもの）は、イベントに1つだけ
  (t) => [uniqueIndex("reception_links_one_active_key").on(t.eventId).where(sql`${t.stoppedAt} IS NULL`)],
);

/** 手伝う人（data-model.md 2-6）。同じ name_key は、名前を入れた人が「別の人」と答えたときだけ2行になる（R7）。 */
export const collectHelpers = collectSchema.table(
  "helpers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => collectEvents.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => collectReceptionLinks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("helpers_event_idx").on(t.eventId),
    index("helpers_link_name_key_idx").on(t.linkId, t.nameKey),
    check("helpers_name_length", sql`char_length(${t.name}) BETWEEN 1 AND ${sql.raw(String(RECEPTION_LIMITS.helperName))}`),
  ],
);

/** 手伝う人の端末（data-model.md 2-6）。端末の印はハッシュだけを持つ。 */
export const collectHelperDevices = collectSchema.table(
  "helper_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    helperId: uuid("helper_id")
      .notNull()
      .references(() => collectHelpers.id, { onDelete: "cascade" }),
    secretHash: text("secret_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("helper_devices_helper_idx").on(t.helperId)],
);

/**
 * 精算（data-model.md 2-7）。受け取った人ごとの現金の合計（あるはずの額）は、受付の記録から毎回数える。
 * 精算したときの合計を expected_at_settle に残し、そのあとで記録が変わったら「精算したあとで変わった」と出す。
 */
export const collectSettlements = collectSchema.table(
  "settlements",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => collectEvents.id, { onDelete: "cascade" }),
    // "owner" か、手伝う人の番号
    receiverKey: text("receiver_key").notNull(),
    countedAmount: integer("counted_amount"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    expectedAtSettle: integer("expected_at_settle"),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.receiverKey] }),
    check("settlements_counted_amount_range", sql`${t.countedAmount} >= 0`),
    check("settlements_settled_pair", sql`(${t.settledAt} IS NULL) = (${t.expectedAtSettle} IS NULL)`),
  ],
);

/** イベントのまとめ（data-model.md 2-9、R11）。イベントを消すときに数字だけを残す。参加者・手伝う人の名前は入れない（FR-014）。 */
export const collectEventSummaries = collectSchema.table(
  "event_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull(),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    rosterCount: integer("roster_count").notNull(),
    attendedCount: integer("attended_count").notNull(),
    byMethod: jsonb("by_method").$type<ByMethod>().notNull(),
    byMedia: jsonb("by_media").$type<MediaStats[]>().notNull(),
    awaitingTransfer: jsonb("awaiting_transfer").$type<CountAmount>().notNull(),
    eventDeletedAt: timestamp("event_deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_summaries_owner_idx").on(t.ownerUserId, t.startsAt)],
);

/**
 * Threads のイベントの候補（data-model.md 2-10、research.md R15）。Threads の出来事を受け取って写す。元の宣伝内容の番号が主キー。
 * 見せるのは、そのThreadsのアカウントの持ち主（owner_user_id）だけ。順番が入れ替わって届くので、イベントの情報と掲載の状況の
 * それぞれに「起きた時刻」を持ち、それより古い出来事は捨てる（data-model.md の last_occurred_at を2つに分けた）。
 */
export const collectThreadsEventCandidates = collectSchema.table(
  "threads_event_candidates",
  {
    promotionId: text("promotion_id").primaryKey(),
    threadsAccountId: text("threads_account_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    venue: text("venue"),
    capacity: integer("capacity"),
    feeAmount: integer("fee_amount"),
    feeNote: text("fee_note"),
    // 掲載済みの媒体（roster_people.media と同じ値）
    postedMedia: text("posted_media").array().notNull().default(sql`ARRAY[]::text[]`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    detailsOccurredAt: timestamp("details_occurred_at", { withTimezone: true, precision: 6 }).notNull(),
    mediaOccurredAt: timestamp("media_occurred_at", { withTimezone: true, precision: 6 }),
  },
  (t) => [index("threads_event_candidates_owner_idx").on(t.ownerUserId, t.startsAt)],
);
