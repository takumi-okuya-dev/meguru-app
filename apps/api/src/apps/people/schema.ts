// 人物メモ（apps/people）の表の定義（specs/people/001-people-memo data-model.md）。すべて Postgres のスキーマ people に置く（research.md R1）。
// 共通の表への外部キーは張らず、作り手は user_id（共通の利用者の番号）の値で持つ（R2）。外部キーは人物メモの表の中だけ。
// 名前の列に一意の印は付けない（Postgres のエラーの中身に名前が出ないように。R18）。名前の比べ方は *_key の列（nameKey）で行う。
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { IMPORT_FIELDS, CONSENT_PURPOSES } from "@meguru/shared/people";
import { inList, timestamps } from "../../kernel/db/columns";

/** 人物メモのスキーマ。 */
export const peopleSchema = pgSchema("people");

/**
 * 時刻の列（タイムゾーンつき）。
 * @param name - 列の名前
 * @returns 列の定義
 */
const at = (name: string) => timestamp(name, { withTimezone: true, precision: 6 });

/** 回答の1つの答え（CSVの列の順。項目にあたらない答えも入る。FR-005）。 */
export type ResponseAnswer = { q: string; a: string };

// ---- 2-1. イベント ----

/** イベント（data-model.md 2-1）。参加者数は持たず、毎回数える。 */
export const peopleEvents = peopleSchema.table(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    heldOn: date("held_on", { mode: "string" }).notNull(),
    isOwn: boolean("is_own").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check("people_events_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 100`),
    index("people_events_user_held_idx").on(t.userId, t.heldOn),
  ],
);

// ---- 2-2. 取り込み ----

/** 1回の取り込み（取り消しの単位。2-2）。ファイル名は持たない（名前が入ることがあるため。R18）。 */
export const peopleImports = peopleSchema.table(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => peopleEvents.id, { onDelete: "cascade" }),
    rowCount: integer("row_count").notNull(),
    importedCount: integer("imported_count").notNull().default(0),
    createdPeopleCount: integer("created_people_count").notNull().default(0),
    linkedCount: integer("linked_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("people_imports_row_count_range", sql`${t.rowCount} BETWEEN 0 AND 500`),
    index("people_imports_user_idx").on(t.userId),
    index("people_imports_event_idx").on(t.eventId),
  ],
);

// ---- 2-3. 質問文と項目の対応 ----

/** 質問文と項目の対応（覚えたもの。2-3）。 */
export const peopleColumnMappings = peopleSchema.table(
  "column_mappings",
  {
    userId: uuid("user_id").notNull(),
    questionKey: text("question_key").notNull(),
    questionText: text("question_text").notNull(),
    field: text("field").notNull(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.questionKey] }),
    check("people_column_mappings_key_length", sql`char_length(${t.questionKey}) BETWEEN 1 AND 500`),
    check("people_column_mappings_text_length", sql`char_length(${t.questionText}) BETWEEN 1 AND 500`),
    check("people_column_mappings_field", sql`${t.field} IN (${inList(IMPORT_FIELDS)})`),
  ],
);

// ---- 2-4. 同意の選択肢と目的の対応 ----

/** 同意の選択肢と目的の対応（覚えたもの。2-4）。 */
export const peopleChoiceMappings = peopleSchema.table(
  "choice_mappings",
  {
    userId: uuid("user_id").notNull(),
    choiceKey: text("choice_key").notNull(),
    choiceText: text("choice_text").notNull(),
    purpose: text("purpose").notNull(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.choiceKey] }),
    check("people_choice_mappings_key_length", sql`char_length(${t.choiceKey}) BETWEEN 1 AND 500`),
    check("people_choice_mappings_text_length", sql`char_length(${t.choiceText}) BETWEEN 1 AND 500`),
    check("people_choice_mappings_purpose", sql`${t.purpose} IN (${inList(CONSENT_PURPOSES)})`),
  ],
);

// ---- 2-5. 人 ----

/** 人（2-5）。表示名は本名、なければ今のLINE名。別名は持たない（回答のLINE名と手で足したときのLINE名から作る。R10）。 */
export const peoplePersons = peopleSchema.table(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    realName: text("real_name"),
    realNameKey: text("real_name_key"),
    lineName: text("line_name"),
    lineNameKey: text("line_name_key"),
    enteredLineName: text("entered_line_name"),
    enteredLineNameKey: text("entered_line_name_key"),
    memoAppearance: text("memo_appearance"),
    memoTalk: text("memo_talk"),
    consentInvite: boolean("consent_invite").notNull().default(false),
    consentWork: boolean("consent_work").notNull().default(false),
    consentSource: text("consent_source").notNull().default("none"),
    consentBasisOn: date("consent_basis_on", { mode: "string" }),
    consentUpdatedAt: at("consent_updated_at"),
    // その人を作った取り込み（取り消しで消す人を見分ける。R14）
    createdByImportId: uuid("created_by_import_id").references((): AnyPgColumn => peopleImports.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    check("people_persons_real_name_length", sql`${t.realName} IS NULL OR char_length(${t.realName}) BETWEEN 1 AND 100`),
    check("people_persons_line_name_length", sql`${t.lineName} IS NULL OR char_length(${t.lineName}) BETWEEN 1 AND 100`),
    check("people_persons_entered_line_name_length", sql`${t.enteredLineName} IS NULL OR char_length(${t.enteredLineName}) BETWEEN 1 AND 100`),
    check("people_persons_memo_appearance_length", sql`${t.memoAppearance} IS NULL OR char_length(${t.memoAppearance}) <= 300`),
    check("people_persons_memo_talk_length", sql`${t.memoTalk} IS NULL OR char_length(${t.memoTalk}) <= 1000`),
    check("people_persons_consent_source", sql`${t.consentSource} IN ('none', 'response', 'manual')`),
    check("people_persons_has_name", sql`${t.realName} IS NOT NULL OR ${t.lineName} IS NOT NULL`),
    index("people_persons_user_idx").on(t.userId),
    index("people_persons_user_real_name_idx").on(t.userId, t.realNameKey),
    index("people_persons_user_line_name_idx").on(t.userId, t.lineNameKey),
  ],
);

// ---- 2-6. 回答（来た記録になる） ----

/** 回答（2-6）。回答があることが、そのイベントに来た記録になる（R12）。 */
export const peopleResponses = peopleSchema.table(
  "responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => peopleEvents.id, { onDelete: "cascade" }),
    importId: uuid("import_id")
      .notNull()
      .references(() => peopleImports.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => peoplePersons.id, { onDelete: "cascade" }),
    // 二重の取り込みの印（名前を含まないハッシュ。R8・R18）
    dedupeHash: text("dedupe_hash").notNull(),
    submittedAt: at("submitted_at"),
    lineName: text("line_name").notNull(),
    lineNameKey: text("line_name_key").notNull(),
    realName: text("real_name"),
    realNameKey: text("real_name_key"),
    nextAttendance: text("next_attendance"),
    bringFriends: text("bring_friends"),
    wantedConnections: text("wanted_connections").array().notNull().default(sql`'{}'::text[]`),
    careerInterests: text("career_interests").array().notNull().default(sql`'{}'::text[]`),
    consentChoices: text("consent_choices").array().notNull().default(sql`'{}'::text[]`),
    consentInvite: boolean("consent_invite").notNull().default(false),
    consentWork: boolean("consent_work").notNull().default(false),
    answers: jsonb("answers").$type<ResponseAnswer[]>().notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("people_responses_event_dedupe_idx").on(t.eventId, t.dedupeHash),
    check("people_responses_dedupe_hash", sql`${t.dedupeHash} ~ '^[0-9a-f]{64}$'`),
    check("people_responses_line_name_length", sql`char_length(${t.lineName}) BETWEEN 1 AND 100`),
    check("people_responses_real_name_length", sql`${t.realName} IS NULL OR char_length(${t.realName}) BETWEEN 1 AND 100`),
    check("people_responses_next_attendance_length", sql`${t.nextAttendance} IS NULL OR char_length(${t.nextAttendance}) <= 500`),
    check("people_responses_bring_friends_length", sql`${t.bringFriends} IS NULL OR char_length(${t.bringFriends}) <= 500`),
    check("people_responses_choices_count", sql`cardinality(${t.wantedConnections}) <= 30 AND cardinality(${t.careerInterests}) <= 30 AND cardinality(${t.consentChoices}) <= 30`),
    index("people_responses_user_line_name_idx").on(t.userId, t.lineNameKey),
    index("people_responses_person_idx").on(t.personId),
    index("people_responses_import_idx").on(t.importId),
  ],
);

// ---- 2-7. 手で足した会ったイベント ----

/** 手で足した会ったイベント（2-7）。 */
export const peopleManualAttendances = peopleSchema.table(
  "manual_attendances",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => peoplePersons.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => peopleEvents.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.eventId] }),
    index("people_manual_attendances_event_idx").on(t.eventId),
    index("people_manual_attendances_user_idx").on(t.userId),
  ],
);

// ---- 2-8. 同意の記録 ----

/** 同意が変わった記録（2-8）。手直しの事実は source = manual のいちばん新しい行（R11）。 */
export const peopleConsentChanges = peopleSchema.table(
  "consent_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => peoplePersons.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    invite: boolean("invite").notNull(),
    work: boolean("work").notNull(),
    source: text("source").notNull(),
    responseId: uuid("response_id").references(() => peopleResponses.id, { onDelete: "set null" }),
    basisOn: date("basis_on", { mode: "string" }).notNull(),
    changedAt: at("changed_at").notNull().defaultNow(),
  },
  (t) => [
    check("people_consent_changes_source", sql`${t.source} IN ('response', 'manual')`),
    index("people_consent_changes_person_idx").on(t.personId, t.changedAt),
    index("people_consent_changes_user_idx").on(t.userId),
  ],
);

// ---- 2-9. 消した人の来た記録（数だけ） ----

/** 消した人の来た記録（数だけ。2-9）。名前・答えは入れない（R13）。 */
export const peopleErasedAttendances = peopleSchema.table(
  "erased_attendances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => peopleEvents.id, { onDelete: "cascade" }),
    importId: uuid("import_id").references(() => peopleImports.id, { onDelete: "cascade" }),
    erasedAt: at("erased_at").notNull().defaultNow(),
  },
  (t) => [index("people_erased_attendances_event_idx").on(t.eventId), index("people_erased_attendances_user_idx").on(t.userId)],
);

// ---- 2-10. 消した人の回答の印（ハッシュだけ） ----

/** 消した人の回答の印（ハッシュだけ。2-10）。取り込みを取り消しても残す（同じCSVの上げ直しで戻さない。R13）。 */
export const peopleErasedResponses = peopleSchema.table(
  "erased_responses",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => peopleEvents.id, { onDelete: "cascade" }),
    dedupeHash: text("dedupe_hash").notNull(),
    userId: uuid("user_id").notNull(),
    erasedAt: at("erased_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.dedupeHash] }), index("people_erased_responses_user_idx").on(t.userId)],
);

// ---- 2-13. 受け取った出来事 ----

/** 受け取った出来事の番号（2-13。2回届いても同じ結果にする）。 */
export const peopleReceivedEvents = peopleSchema.table("received_events", {
  eventId: uuid("event_id").primaryKey(),
  receivedAt: at("received_at").notNull().defaultNow(),
});
