// 人物メモのAPIの入力と出力の形（specs/people/001-people-memo contracts/api.md、data-model.md）。
// 入力は zod で確かめ、出力は型だけを書く（APIと画面で同じ形を使う）。
import { z } from "zod";
import { CONSENT_PURPOSES, type Consent } from "./answers";
import { IMPORT_FIELDS, MEMO_APPEARANCE_MAX, MEMO_TALK_MAX, PERSON_NAME_MAX, type ImportField } from "./fields";

/** 日付（YYYY-MM-DD。日本時間の日付）。 */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), { message: "invalid date" });
/** 番号。 */
const id = z.string().uuid();
/** 名前（前後の空白を外して1〜100文字）。 */
const personName = z.string().trim().min(1).max(PERSON_NAME_MAX);
/**
 * 空にできるメモ（前後の空白を外し、空なら null）。
 * @param max - 文字の上限
 * @returns zod のスキーマ
 */
const memo = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((s) => (s === null || s.trim() === "" ? null : s.trim()));

/** 列の項目。 */
export const importFieldSchema = z.enum(IMPORT_FIELDS);
/** 同意の選択肢の目的。 */
export const consentPurposeSchema = z.enum(CONSENT_PURPOSES);
/** 目的ごとの同意。 */
export const consentSchema = z.object({ invite: z.boolean(), work: z.boolean() });

// ---- イベント（contracts/api.md 2） ----

/** POST /api/people/events の入力。 */
export const eventCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  heldOn: dateString,
  isOwn: z.boolean(),
});
/** PATCH /api/people/events/:eventId の入力（1つ以上）。 */
export const eventUpdateSchema = eventCreateSchema.partial().refine((v) => Object.keys(v).length > 0, { message: "empty", path: ["name"] });

/** 取り消し・イベントを消すの本文。 */
export const keepPeopleSchema = z.object({ keepPeopleWithNotes: z.boolean().optional() });

// ---- 取り込み（contracts/api.md 3） ----
// 行・列・文字の上限は checkCsvLimits で確かめ、400 IMPORT_TOO_LARGE にする（VALIDATION_FAILED と分けるため、ここでは確かめない）。

const importBase = {
  eventId: id,
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  consentChoices: z.record(z.string(), consentPurposeSchema).optional(),
};

/** POST /api/people/imports/preview の入力。 */
export const importPreviewSchema = z.object({
  ...importBase,
  columns: z.array(importFieldSchema.nullable()).optional(),
});

/** 行ごとの決め。 */
export const importDecisionSchema = z
  .object({ row: z.number().int().min(0), action: z.enum(["new", "link", "skip"]), personId: id.optional() })
  .refine((d) => (d.action === "link") === (d.personId !== undefined), { message: "personId", path: ["personId"] });

/** POST /api/people/imports の入力。 */
export const importCommitSchema = z.object({
  ...importBase,
  columns: z.array(importFieldSchema.nullable()),
  decisions: z.array(importDecisionSchema).max(500).default([]),
});

// ---- 人（contracts/api.md 4。PR2で使う） ----

/** POST /api/people/persons の入力。 */
export const personCreateSchema = z
  .object({
    realName: personName.optional(),
    lineName: personName.optional(),
    eventId: id.optional(),
    consent: consentSchema,
  })
  .refine((v) => v.realName !== undefined || v.lineName !== undefined, { message: "required", path: ["realName"] });

/** PATCH /api/people/persons/:personId の入力。 */
export const personUpdateSchema = z
  .object({
    realName: personName.nullable().optional(),
    memoAppearance: memo(MEMO_APPEARANCE_MAX).optional(),
    memoTalk: memo(MEMO_TALK_MAX).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty", path: ["realName"] });

/** POST /api/people/persons/:personId/attendances の入力。 */
export const attendanceCreateSchema = z.object({ eventId: id });
/** POST /api/people/persons/:personId/merge の入力。 */
export const personMergeSchema = z.object({ otherPersonId: id });
/** DELETE /api/people/persons/:personId の入力。 */
export const personDeleteSchema = z.object({ confirmName: z.string().trim().min(1).max(PERSON_NAME_MAX) });

// ---- 出力の型 ----

/** GET /api/people/me。 */
export type PeopleMe = { personCount: number; eventCount: number };

/** イベント。 */
export type PeopleEvent = { id: string; name: string; heldOn: string; isOwn: boolean };
/** イベントの一覧の1行。 */
export type PeopleEventListItem = PeopleEvent & { attendeeCount: number; importCount: number };
/** 取り込みの数。 */
export type PeopleImportSummary = {
  id: string;
  createdAt: string;
  rowCount: number;
  importedCount: number;
  createdPeopleCount: number;
  linkedCount: number;
  skippedCount: number;
};
/** イベントの数字（firstTimeCount・returningCount は自分の会だけ。PR3から）。 */
export type PeopleEventStats = { attendeeCount: number; erasedCount: number; firstTimeCount?: number; returningCount?: number };
/** GET /api/people/events/:eventId。 */
export type PeopleEventDetail = { event: PeopleEvent; stats: PeopleEventStats; imports: PeopleImportSummary[] };
/** その会に来た人。 */
export type PeopleAttendee = { personId: string; displayName: string; lineName: string | null; via: "response" | "manual"; firstTime?: boolean };

/** 列の対応（プレビューの返り）。 */
export type ImportColumn = { header: string; field: ImportField | null; source: "sent" | "remembered" | "preset" | "none" };
/** 列の対応の誤り。 */
export type ImportMappingError = { code: "line_name_missing" | "duplicate_field"; field?: ImportField };
/** 行の判定。 */
export type ImportRowStatus = "new" | "candidate" | "duplicate_in_file" | "already_imported" | "erased" | "invalid";
/** 取り込めない理由。 */
export type ImportInvalidReason = "line_name_empty" | "line_name_too_long" | "real_name_too_long";
/** 答えの要約（候補の見分けに使う）。 */
export type AnswerSummary = { nextAttendance: string | null; wantedConnections: string[]; careerInterests: string[] };
/** 同じ人の候補。 */
export type ImportCandidate = {
  personId: string;
  displayName: string;
  lineName: string | null;
  otherLineNames: string[];
  realName: string | null;
  reasons: ("line_name" | "line_name_loose" | "real_name")[];
  recentEvents: { name: string; heldOn: string }[];
  latestAnswers: AnswerSummary | null;
};
/** 行のプレビュー。 */
export type ImportPreviewRow = {
  row: number;
  status: ImportRowStatus;
  invalidReason?: ImportInvalidReason;
  groupId?: number;
  lineName?: string;
  realName?: string | null;
  answers?: AnswerSummary;
  consent?: Consent;
  candidates?: ImportCandidate[];
};
/** POST /api/people/imports/preview の返り。 */
export type ImportPreview = {
  columns: ImportColumn[];
  mappingErrors: ImportMappingError[];
  unknownConsentChoices: string[];
  summary: { newCount: number; candidateCount: number; duplicateInFileCount: number; skippedCount: number };
  rows: ImportPreviewRow[];
};
/** POST /api/people/imports の返り。 */
export type ImportResult = { import: Omit<PeopleImportSummary, "createdAt"> };

/** 書き足し（取り消しで確かめる。R14）。 */
export type PersonNote = "memo" | "outreach" | "manual_consent" | "manual_attendance";
/** GET /api/people/imports/:importId/undo-preview の返り。 */
export type ImportUndoPreview = {
  responseCount: number;
  removedPeopleCount: number;
  peopleWithNotes: { personId: string; displayName: string; notes: PersonNote[] }[];
};
/** GET /api/people/events/:eventId/delete-preview の返り。 */
export type EventDeletePreview = ImportUndoPreview & { importCount: number; outreachCount: number };
/** 取り消し・イベントを消すの返り。 */
export type UndoResult = { removedPeopleCount: number; keptPeopleCount: number };
