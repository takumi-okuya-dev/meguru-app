// 人物メモのAPIの入力と出力の形（specs/people/001-people-memo contracts/api.md、data-model.md）。
// 入力は zod で確かめ、出力は型だけを書く（APIと画面で同じ形を使う）。
import { z } from "zod";
import { CONSENT_PURPOSES, type Consent } from "./answers";
import { IMPORT_FIELDS, MEMO_APPEARANCE_MAX, MEMO_TALK_MAX, PERSON_NAME_MAX, SEARCH_QUERY_MAX, type ImportField } from "./fields";
import { INVITE_TEMPLATE_MAX } from "./invite";
import {
  CONTACT_CHANNELS,
  CONTACT_NOTE_MAX,
  FIELD_LABEL_MAX,
  FIELD_VALUE_MAX,
  isAllowedLinkUrl,
  LINK_URL_MAX,
  NEXT_ACTION_MAX,
  PERSON_GROUPS,
  PERSON_SORTS,
  TAG_NAME_MAX,
  TAGS_PER_PERSON_MAX,
  isRealMonthDay,
  type ContactChannel,
  type LinkKind,
  type PersonGroup,
  type PersonSort,
} from "./sales";
import { nameKey } from "./names";

/** 日付（YYYY-MM-DD。日本時間の日付）。 */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), { message: "invalid date" });
/** 番号。 */
const id = z.string().uuid();
/**
 * 文字の数（コードポイント）が上限までか。DBの char_length と画面の数え方にそろえる（絵文字を2文字と数えない。人物メモの PR2 で直した）。
 * @param max - 上限
 * @returns 確かめる関数
 */
const withinChars = (max: number) => (s: string) => [...s].length <= max;
/** 名前（前後の空白を外して1〜100文字）。 */
const personName = z.string().trim().min(1).refine(withinChars(PERSON_NAME_MAX), { message: "too long" });
/**
 * 空にできるメモ（前後の空白を外し、空なら null）。
 * @param max - 文字の上限
 * @returns zod のスキーマ
 */
const memo = (max: number) =>
  z
    .string()
    .refine(withinChars(max), { message: "too long" })
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
    // 次にやること（日付と文は一緒に。両方 null で消す。specs/people/002 FR-104）
    nextActionOn: dateString.nullable().optional(),
    nextActionNote: z.string().trim().min(1).refine(withinChars(NEXT_ACTION_MAX), { message: "too long" }).nullable().optional(),
    // 誕生日の月日（MM-DD。年は持たない。FR-105）
    birthdayMd: z
      .string()
      .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/)
      .refine(isRealMonthDay, { message: "invalid date" })
      .nullable()
      .optional(),
    // 来てくれそう度（3＝高・2＝中・1＝低、null＝なし。FR-107）
    likelihood: z.number().int().min(1).max(3).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty", path: ["realName"] })
  .refine((v) => (v.nextActionOn === undefined) === (v.nextActionNote === undefined) && (v.nextActionOn === null) === (v.nextActionNote === null), {
    message: "next action needs both",
    path: ["nextActionOn"],
  });

/** POST /api/people/persons/:personId/attendances の入力。 */
export const attendanceCreateSchema = z.object({ eventId: id });
/** POST /api/people/persons/:personId/merge の入力。 */
export const personMergeSchema = z.object({ otherPersonId: id });
/** DELETE /api/people/persons/:personId の入力。 */
export const personDeleteSchema = z.object({ confirmName: personName });
/** PUT /api/people/persons/:personId/consent の入力。 */
export const consentUpdateSchema = consentSchema;

/**
 * くり返せるクエリの値（1つなら文字、2つ以上なら配列で届く）を配列にする。
 * @returns zod のスキーマ
 */
const manyValues = () =>
  z
    .union([z.string().max(500), z.array(z.string().max(500)).max(30)])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]).filter((s) => s !== ""));

/** GET /api/people/persons のクエリ（R22）。`next`・`wanted`・`career`はくり返せる。 */
export const personListQuerySchema = z.object({
  q: z.string().max(SEARCH_QUERY_MAX).optional(),
  eventId: id.optional(),
  next: manyValues(),
  wanted: manyValues(),
  career: manyValues(),
  lastMetFrom: dateString.optional(),
  lastMetTo: dateString.optional(),
  // 002：タグ（どれかを持つ）・来てくれそう度・並べ方（FR-102・FR-103）
  tag: manyValues(),
  likelihood: manyValues(),
  sort: z.enum(PERSON_SORTS).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
/** GET /api/people/persons のクエリ（読んだあと）。 */
export type PersonListQuery = z.infer<typeof personListQuerySchema>;

// ---- 誘う候補・声かけ・設定（contracts/api.md 5・6。PR3） ----

/** 声かけの目的（交流会への誘い・仕事の相談先へのつなぎ）。 */
export const OUTREACH_PURPOSES = ["invite", "work"] as const;
/** 声かけの目的。 */
export type OutreachPurpose = (typeof OUTREACH_PURPOSES)[number];
/** 目的ごとの進み具合（R16）。 */
export const OUTREACH_STAGES = { invite: ["asked", "link_sent", "attended"], work: ["asked", "approved", "connected"] } as const;
/** 進み具合。 */
export type OutreachStage = (typeof OUTREACH_STAGES)[OutreachPurpose][number];
/** リピーターの目標の上限。 */
export const REPEATER_GOAL_MAX = 10_000;

/** GET /api/people/candidates のクエリ（人の一覧の絞り込み＋目的・誘う会・前に来た。FR-018・FR-019）。 */
export const candidateQuerySchema = personListQuerySchema.extend({
  purpose: z.enum(OUTREACH_PURPOSES),
  visitedOwn: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
/** GET /api/people/candidates のクエリ（読んだあと）。 */
export type CandidateQuery = z.infer<typeof candidateQuerySchema>;

/** POST /api/people/outreaches の入力（交流会への誘いは誘う会、仕事のつなぎは相談先の名前。R16）。 */
export const outreachCreateSchema = z.discriminatedUnion("purpose", [
  z.object({ personId: id, purpose: z.literal("invite"), eventId: id }),
  // 相談先は、見えない文字だけの名前を断る（nameKey が空だと、みな同じ相談先とみなされてしまう）
  z.object({ personId: id, purpose: z.literal("work"), targetName: personName.refine((s) => nameKey(s) !== "", { message: "empty" }) }),
]);
/** POST /api/people/outreaches の入力（読んだあと）。 */
export type OutreachCreateInput = z.infer<typeof outreachCreateSchema>;
/** PATCH /api/people/outreaches/:outreachId の入力。 */
export const outreachUpdateSchema = z.object({
  stage: z.enum([...new Set(Object.values(OUTREACH_STAGES).flat())] as [OutreachStage, ...OutreachStage[]]),
});
/** PUT /api/people/settings の入力。型の空白だけは null（初めの型）。 */
export const settingsUpdateSchema = z
  .object({
    inviteTemplate: z
      .string()
      .refine(withinChars(INVITE_TEMPLATE_MAX), { message: "too long" })
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v)),
    repeaterGoal: z.number().int().min(1).max(REPEATER_GOAL_MAX).nullable().optional(),
    // 人の一覧の並べ方（覚える。specs/people/002 FR-103）
    personView: z.object({ sort: z.enum(PERSON_SORTS), group: z.enum(PERSON_GROUPS) }).optional(),
  })
  .refine((v) => v.inviteTemplate !== undefined || v.repeaterGoal !== undefined || v.personView !== undefined, { message: "empty", path: ["inviteTemplate"] });

// ---- 声かけリスト（specs/people/002-sales-list plan.md 3） ----

/** タグの名前（前後の空白を外して1〜30文字。見えない文字だけは断る）。 */
const tagName = z
  .string()
  .trim()
  .min(1)
  .refine(withinChars(TAG_NAME_MAX), { message: "too long" })
  .refine((s) => nameKey(s) !== "", { message: "empty" });
/** POST /api/people/tags・PATCH /api/people/tags/:tagId の入力。 */
export const tagSaveSchema = z.object({ name: tagName });
/** PUT /api/people/persons/:personId/tags の入力（付けるタグに置き換える。新しい名前は作って付ける）。 */
export const personTagsSchema = z
  .object({ tagIds: z.array(id).max(TAGS_PER_PERSON_MAX).default([]), newTagNames: z.array(tagName).max(TAGS_PER_PERSON_MAX).default([]) })
  .refine((v) => v.tagIds.length + v.newTagNames.length <= TAGS_PER_PERSON_MAX, { message: "too many", path: ["tagIds"] });
/** POST /api/people/persons/:personId/next-action/done の入力。 */
export const nextActionDoneSchema = z.object({ log: z.boolean() });
/** 連絡の記録の文。 */
const contactNote = z.string().trim().min(1).refine(withinChars(CONTACT_NOTE_MAX), { message: "too long" });
/** POST /api/people/persons/:personId/contact-logs の入力。 */
export const contactLogCreateSchema = z.object({
  contactedOn: dateString,
  channel: z.enum(CONTACT_CHANNELS).exclude(["done"]),
  note: contactNote,
});
/** PATCH /api/people/contact-logs/:logId の入力。 */
export const contactLogUpdateSchema = z
  .object({ contactedOn: dateString.optional(), channel: z.enum(CONTACT_CHANNELS).exclude(["done"]).optional(), note: contactNote.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "empty", path: ["note"] });
/** 自由な項目の名前。 */
const fieldLabel = z
  .string()
  .trim()
  .min(1)
  .refine(withinChars(FIELD_LABEL_MAX), { message: "too long" })
  .refine((s) => nameKey(s) !== "", { message: "empty" });
/** POST /api/people/fields・PATCH /api/people/fields/:fieldId の入力。 */
export const fieldSaveSchema = z.object({ label: fieldLabel });
/** PUT /api/people/fields/order の入力（すべての項目の番号を、並べたい順に）。 */
export const fieldOrderSchema = z.object({ fieldIds: z.array(id).max(100) });
/** PUT /api/people/persons/:personId/fields の入力（null・空白は値を消す）。 */
export const personFieldsSchema = z.object({
  values: z
    .array(
      z.object({
        fieldId: id,
        value: z
          .string()
          .refine(withinChars(FIELD_VALUE_MAX), { message: "too long" })
          .nullable()
          .transform((s) => (s === null || s.trim() === "" ? null : s.trim())),
      }),
    )
    .max(100),
});
/**
 * SNS のリンクの1つ（null・空は外す。その種類のホストの https だけ）。
 * @param kind - 種類
 * @returns zod のスキーマ
 */
const linkUrl = (kind: LinkKind) =>
  z
    .string()
    .trim()
    .max(LINK_URL_MAX)
    .nullable()
    .optional()
    .transform((s) => (s === undefined ? undefined : s === null || s === "" ? null : s))
    .refine((s) => s === undefined || s === null || isAllowedLinkUrl(kind, s), { message: "invalid url" });
/** PUT /api/people/persons/:personId/links の入力。 */
export const personLinksSchema = z.object({ instagram: linkUrl("instagram"), x: linkUrl("x"), facebook: linkUrl("facebook") });
/** POST /api/people/persons/export の入力（人の一覧と同じ絞り込み。名前を URL に載せないよう本文で受ける）。 */
export const personExportSchema = z.object({
  q: z.string().max(SEARCH_QUERY_MAX).optional(),
  eventId: id.optional(),
  next: z.array(z.string().max(500)).max(30).default([]),
  wanted: z.array(z.string().max(500)).max(30).default([]),
  career: z.array(z.string().max(500)).max(30).default([]),
  lastMetFrom: dateString.optional(),
  lastMetTo: dateString.optional(),
  tag: z.array(id).max(30).default([]),
  likelihood: z.array(z.string()).max(4).default([]),
  sort: z.enum(PERSON_SORTS).optional(),
});

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

/** 人の一覧の1行（GET /api/people/persons。R22）。 */
export type PersonListItem = {
  id: string;
  displayName: string;
  realName: string | null;
  lineName: string | null;
  /** 最後に会った日（来たイベントの開催日のいちばん新しい日。会っていなければ null） */
  lastMetOn: string | null;
  /** 自分の会に来た回数 */
  ownEventCount: number;
  /** いちばん新しい回答の答え（回答がなければ null） */
  latestAnswers: AnswerSummary | null;
  consent: Consent;
  /** 002：タグ・来てくれそう度・次にやること・初めて会った日（並べ方とまとめた表示のため） */
  tags: PersonTag[];
  likelihood: number | null;
  nextAction: NextAction | null;
  firstMetOn: string | null;
};
/** GET /api/people/persons の返り。 */
export type PersonList = { persons: PersonListItem[]; total: number };
/** 選べる値と人数。 */
export type FacetValue = { value: string; count: number };
/** GET /api/people/facets の返り（いちばん新しい回答の値。多い順）。 */
export type PeopleFacets = { nextAttendance: FacetValue[]; wantedConnections: FacetValue[]; careerInterests: FacetValue[] };
/** 人の同意（人のページ）。 */
export type PersonConsent = Consent & { source: "none" | "response" | "manual"; basisOn: string | null };
/** 人（人のページの頭）。 */
export type PersonSummary = {
  id: string;
  displayName: string;
  realName: string | null;
  lineName: string | null;
  /** 別名（今のLINE名のほかの、回答のLINE名と手で足したときのLINE名。R10） */
  otherLineNames: string[];
  memoAppearance: string | null;
  memoTalk: string | null;
  consent: PersonConsent;
  lastMetOn: string | null;
  /** 002 */
  tags: PersonTag[];
  likelihood: number | null;
  nextAction: NextAction | null;
  birthdayMd: string | null;
};
/** 人のページの回答。 */
export type PersonResponse = {
  id: string;
  submittedAt: string | null;
  lineName: string;
  realName: string | null;
  nextAttendance: string | null;
  bringFriends: string | null;
  wantedConnections: string[];
  careerInterests: string[];
  consentChoices: string[];
  answers: { q: string; a: string }[];
};
/** 人のページの来たイベント（新しい順）。回答があれば via: response、手で足しただけなら manual。 */
export type PersonAttendance = { event: PeopleEvent; via: "response" | "manual"; responses: PersonResponse[] };
/** 同意の記録。 */
export type PersonConsentChange = Consent & { source: "response" | "manual"; basisOn: string; changedAt: string };
/** GET /api/people/persons/:personId の返り（outreaches は PR3 から）。 */
export type PersonDetail = {
  person: PersonSummary;
  attendances: PersonAttendance[];
  consentChanges: PersonConsentChange[];
  outreaches: Outreach[];
  /** 002：連絡の記録（新しい順）・自由な項目（項目の順）・SNS のリンク */
  contactLogs: ContactLog[];
  fields: PersonFieldValue[];
  links: PersonLinks;
};

/** 声かけ（contracts/api.md 5）。 */
export type Outreach = {
  id: string;
  personId: string;
  purpose: OutreachPurpose;
  event: { id: string; name: string; heldOn: string } | null;
  targetName: string | null;
  stage: OutreachStage;
  askedAt: string;
  linkSentAt: string | null;
  attendedAt: string | null;
  approvedAt: string | null;
  connectedAt: string | null;
};
/** 誘う候補の1行（人の一覧の行＋声かけ）。 */
export type CandidateItem = PersonListItem & { outreach: Outreach | null };
/** GET /api/people/candidates の返り。 */
export type CandidateList = { persons: CandidateItem[]; total: number };
/** GET /api/people/settings の返り。 */
export type PeopleSettings = { inviteTemplate: string | null; repeaterGoal: number | null; personView: PersonView };
/** GET /api/people/stats の返り。 */
export type PeopleStats = { repeaterCount: number; repeaterGoal: number | null; nextOwnEvent: PeopleEvent | null };

/** タグ（人数つき）。 */
export type PeopleTag = { id: string; name: string; personCount: number };
/** 人に付いたタグ。 */
export type PersonTag = { id: string; name: string };
/** 次にやること。 */
export type NextAction = { on: string; note: string };
/** 連絡の記録。 */
export type ContactLog = { id: string; contactedOn: string; channel: ContactChannel; note: string; createdAt: string };
/** 自由な項目。 */
export type CustomField = { id: string; label: string; position: number };
/** 人の自由な項目の値（項目の順。値がなければ null）。 */
export type PersonFieldValue = { fieldId: string; label: string; value: string | null };
/** 人の SNS のリンク。 */
export type PersonLinks = Partial<Record<LinkKind, string>>;
/** 人の一覧の並べ方。 */
export type PersonView = { sort: PersonSort; group: PersonGroup };
/** ホームの1行（人の一覧の行＋次にやること・誕生日）。 */
export type HomeItem = PersonListItem & { birthdayMd: string | null };
/** GET /api/people/home の返り。 */
export type PeopleHome = { today: HomeItem[]; overdue: HomeItem[]; birthdays: HomeItem[] };
/** 会ごとの声かけの一覧の1行。 */
export type OutreachBoardRow = PersonListItem & { outreach: Outreach };
/** GET /api/people/events/:eventId/outreach-board の返り。 */
export type OutreachBoard = { event: PeopleEvent; stages: { asked: OutreachBoardRow[]; link_sent: OutreachBoardRow[]; attended: OutreachBoardRow[] } };

/** 書き足し（取り消しで確かめる。R14）。 */
/** 書き足しの種類（sales は 002 の書き足し：タグ・次にやること・連絡の記録・来てくれそう度・誕生日・自由な項目・SNS のリンク）。 */
export type PersonNote = "memo" | "outreach" | "manual_consent" | "manual_attendance" | "sales";
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
