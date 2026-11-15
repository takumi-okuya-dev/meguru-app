// 売上・経費・紹介と運営メンバーへの分配の入力と出力の形（specs/collect/003-revenue-sharing contracts/api.md、data-model.md）。
import { z } from "zod";
import { countChars } from "../../text";
import { RATIO_TENTHS, SHARING_ROLES } from "./distribution";
import { COLLECT_LIMITS } from "./schemas";

/** 003 の上限（spec Edge Cases「金額の上限」、data-model.md）。 */
export const SHARING_LIMITS = {
  expenseName: 40,
  expenseAmountMax: 999_999,
  expensesPerEvent: 100,
  memberName: 40,
  membersPerEvent: 20,
  referrer: COLLECT_LIMITS.referrer,
  /** 紹介した人の候補の数 */
  referrerSuggestions: 20,
  /** 招待のリンクの期限（日） */
  inviteDays: 7,
} as const;

/** 招待のトークンの頭（research R6）。 */
export const SHARING_INVITE_TOKEN_PREFIX = "ci_";

/**
 * 前後の空白を除いた必須の文字列。
 * @param max - 文字数の上限
 * @returns zod のスキーマ
 */
const requiredText = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s !== "", { message: "required" })
    .refine((s) => countChars(s) <= max, { message: `max ${max}` });

/**
 * 任意の文字列（空・null は null）。
 * @param max - 文字数の上限
 * @returns zod のスキーマ
 */
const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => (s == null || s.trim() === "" ? null : s.trim()))
    .refine((s) => s === null || countChars(s) <= max, { message: `max ${max}` });

const expenseAmount = z.number().int().min(1).max(SHARING_LIMITS.expenseAmountMax);
const ratioTenths = z.number().int().min(RATIO_TENTHS.min).max(RATIO_TENTHS.max);

/** POST …/expenses の入力（立て替えた人は運営メンバーか名前のどちらか）。 */
export const createExpenseRequestSchema = z
  .object({
    name: requiredText(SHARING_LIMITS.expenseName),
    amount: expenseAmount,
    payerMemberId: z.uuid().nullish(),
    payerName: optionalText(SHARING_LIMITS.memberName),
  })
  .refine((v) => !(v.payerMemberId && v.payerName), { message: "payer is either member or name", path: ["payerName"] });
/** POST …/expenses の入力。 */
export type CreateExpenseRequest = z.infer<typeof createExpenseRequestSchema>;

/** PATCH …/expenses/:expenseId の入力（1つは要る。立て替えた人を変えるときは payerMemberId と payerName を両方送る）。 */
export const updateExpenseRequestSchema = z
  .object({
    name: requiredText(SHARING_LIMITS.expenseName).optional(),
    amount: expenseAmount.optional(),
    payerMemberId: z.uuid().nullish(),
    payerName: optionalText(SHARING_LIMITS.memberName).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nothing to update", path: ["name"] })
  .refine((v) => !(v.payerMemberId && v.payerName), { message: "payer is either member or name", path: ["payerName"] });
/** PATCH …/expenses/:expenseId の入力。 */
export type UpdateExpenseRequest = z.infer<typeof updateExpenseRequestSchema>;

/** POST …/members の入力。リーダーで傾斜がなければ既定（1.2倍）。 */
export const createSharingMemberRequestSchema = z.object({
  name: requiredText(SHARING_LIMITS.memberName),
  role: z.enum(SHARING_ROLES),
  ratioTenths: ratioTenths.nullish(),
});
/** POST …/members の入力。 */
export type CreateSharingMemberRequest = z.infer<typeof createSharingMemberRequestSchema>;

/** PATCH …/members/:memberId の入力（1つは要る）。 */
export const updateSharingMemberRequestSchema = z
  .object({
    name: requiredText(SHARING_LIMITS.memberName).optional(),
    role: z.enum(SHARING_ROLES).optional(),
    ratioTenths: ratioTenths.nullish(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nothing to update", path: ["name"] });
/** PATCH …/members/:memberId の入力。 */
export type UpdateSharingMemberRequest = z.infer<typeof updateSharingMemberRequestSchema>;

/** 経費。 */
export const expenseSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number().int(),
  /** 立て替えた人（運営メンバーなら memberId がある） */
  payer: z.object({ memberId: z.string().nullable(), name: z.string() }).nullable(),
});
/** 経費。 */
export type Expense = z.infer<typeof expenseSchema>;

/** 運営メンバー。 */
export const sharingMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(SHARING_ROLES),
  ratioTenths: z.number().int().nullable(),
  isOwner: z.boolean(),
  /** めぐるの利用者とつながっている */
  linked: z.boolean(),
  /** 使える招待のリンク（期限だけ。リンクは出したときにしか見せない） */
  invite: z.object({ expiresAt: z.string() }).nullable(),
});
/** 運営メンバー。 */
export type SharingMember = z.infer<typeof sharingMemberSchema>;

/** 分配の結果（distribution.ts の DistributionResult）。 */
export const distributionSchema = z.object({
  amount: z.number().int(),
  deficit: z.boolean(),
  count: z.number().int(),
  leaderCount: z.number().int(),
  memberCount: z.number().int(),
  shares: z.array(z.object({ memberId: z.string(), base: z.number().int(), remainder: z.number().int(), total: z.number().int() })),
  remainderTo: z.string().nullable(),
});
/** 分配の結果。 */
export type Distribution = z.infer<typeof distributionSchema>;

/** 売上（支払い済み・振込待ち・確かめ待ち）。 */
export const revenueSchema = z.object({ paid: z.number().int(), awaiting: z.number().int(), awaitingConfirmation: z.number().int() });

/** 立て替えの戻し（運営メンバーでない人は memberId が null）。 */
export const reimbursementSchema = z.object({ memberId: z.string().nullable(), name: z.string(), amount: z.number().int() });

/** GET …/sharing の応答（主催者）。 */
export const sharingSnapshotSchema = z.object({
  event: z.object({ id: z.string(), name: z.string(), startsAt: z.string() }),
  revenue: revenueSchema,
  expenses: z.array(expenseSchema),
  expenseTotal: z.number().int(),
  members: z.array(sharingMemberSchema),
  /** リーダーの傾斜の合計の上限（10倍の整数。メンバーがいなければ null） */
  maxRatioTenths: z.number().int().nullable(),
  /** A＝支払い済み − 経費 */
  current: distributionSchema,
  /** A′＝支払い済み＋振込待ち − 経費 */
  projected: distributionSchema,
  reimbursements: z.array(reimbursementSchema),
});
/** GET …/sharing の応答。 */
export type SharingSnapshot = z.infer<typeof sharingSnapshotSchema>;

/** POST …/members/:memberId/invite の応答（リンクを見せるのはこのときだけ）。 */
export const sharingInviteCreatedSchema = z.object({ url: z.string(), expiresAt: z.string() });
/** POST …/members/:memberId/invite の応答。 */
export type SharingInviteCreated = z.infer<typeof sharingInviteCreatedSchema>;

/** GET …/referrals の行（name が null は「紹介なし」）。 */
export const referralRowSchema = z.object({
  name: z.string().nullable(),
  people: z.number().int(),
  attended: z.number().int(),
  paid: z.number().int(),
  awaiting: z.number().int(),
});
/** GET …/referrals の行。 */
export type ReferralRow = z.infer<typeof referralRowSchema>;
/** GET …/referrals の応答。 */
export const referralListSchema = z.object({ rows: z.array(referralRowSchema) });
/** GET /referrers の応答。 */
export const referrerSuggestionsSchema = z.object({ names: z.array(z.string()) });

/** GET /invites/:token の応答（招待を受ける人）。 */
export const sharingInviteInfoSchema = z.object({
  event: z.object({ name: z.string(), startsAt: z.string() }),
  memberName: z.string(),
  /** 開いた人がこのイベントの主催者（受けられない） */
  ownerIsYou: z.boolean(),
  /** 開いた人が同じイベントでもうつながっている（受けられない） */
  alreadyLinked: z.boolean(),
});
/** GET /invites/:token の応答。 */
export type SharingInviteInfo = z.infer<typeof sharingInviteInfoSchema>;
/** POST /invites/:token/accept の応答。 */
export const sharingInviteAcceptedSchema = z.object({ eventId: z.string() });

/** GET /shares の行（つながったイベント）。 */
export const sharedEventSchema = z.object({
  eventId: z.string(),
  name: z.string(),
  startsAt: z.string(),
  memberName: z.string(),
  /** 今の分配での自分の受け取る合計（分配額＋立て替えの戻し。赤字なら負担の目安） */
  total: z.number().int(),
  deficit: z.boolean(),
});
/** GET /shares の行。 */
export type SharedEvent = z.infer<typeof sharedEventSchema>;
/** GET /shares の応答。 */
export const sharedEventListSchema = z.object({ events: z.array(sharedEventSchema) });

/** GET /shares/:eventId の応答（読むだけ。名簿・参加者・紹介は入れない）。 */
export const memberSharingViewSchema = sharingSnapshotSchema.extend({
  members: z.array(sharingMemberSchema.omit({ invite: true })),
  /** 開いた人の運営メンバーの番号 */
  you: z.string(),
});
/** GET /shares/:eventId の応答。 */
export type MemberSharingView = z.infer<typeof memberSharingViewSchema>;
