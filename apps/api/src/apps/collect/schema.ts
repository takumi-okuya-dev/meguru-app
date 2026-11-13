// 集金管理（apps/collect）の表の定義（specs/collect/001-event-day-collection data-model.md 2、research.md R1・R2）。
// 表はスキーマ collect に置き、共通の表（users など）への外部キーは張らない。主催者は owner_user_id に値として持ち、
// 退会の片づけは出来事（user.withdrawn）で集金管理が行う（docs/app-separation.md 4）。外部キーは集金管理の表の中だけに張る。
// PR1 の分（イベント・料金の区分・名簿・主催者の既定値・受け取った出来事）。受付・手伝う人・精算・まとめの表は、それぞれのPRで足す。
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { COLLECT_LIMITS, COLLECT_MEDIA, COLLECT_METHODS, PAYPAY_QR_TYPES } from "@meguru/shared";
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
    // 飛び入りを手伝う人が足したとき（外部キーは手伝う人の表と一緒に PR2 で張る）
    addedByHelperId: uuid("added_by_helper_id"),
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
