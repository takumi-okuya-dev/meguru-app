// Threadsの共通の型（specs/meguru/029-threads-pattern1 tasks.md T021、contracts/api-routes.md 2）。
import { z } from "zod";
import { accountLimitSchema, accountSummarySchema, connectionMethodSchema, meTeamSchema } from "../../schemas";
import { FEATURES } from "./features";

export * from "./features";

/** GET /api/threads/me のレスポンス（Threadsの「自分」。029 の前の GET /api/me の Threads の部分。specs/meguru/029 contracts/api-routes.md 2）。 */
export const threadsMeResponseSchema = z.object({
  accounts: z.array(accountSummarySchema),
  landingAccountId: z.string().nullable(),
  accountLimit: accountLimitSchema,
  /** Threads連携の公開範囲（specs/002 FR-028）。testers の間は、アカウント追加画面に検証期間の案内を出す */
  threadsAccessMode: z.enum(["testers", "public"]),
  /**
   * つなぐ方法のうち、画面に出すもの（既定は両方）。
   * App Review を通すまで、または通らなかったときは `token` だけにできる。
   */
  threadsConnectMethods: z.array(connectionMethodSchema).min(1),
  /** 入っているチーム（参加した順。入っていなければ空。specs/011 research.md R5） */
  teams: z.array(meTeamSchema),
  /** 自分の使えるまとまり（人 ∪ グループ。specs/019 contracts/api.md） */
  features: z.array(z.enum(FEATURES)),
  /** 自分のアカウントの1日の投稿数の上限。null は上限なし（運営者。specs/024 contracts/api.md） */
  dailyPostLimit: z.number().int().nullable(),
  /** 招待の管理（テスター招待の申し込み）がONか（specs/024 research.md R4） */
  testerInvites: z.object({ enabled: z.boolean() }),
});
/** GET /api/threads/me のレスポンス。 */
export type ThreadsMeResponse = z.infer<typeof threadsMeResponseSchema>;

/** GET /api/threads/me/withdrawal-preview のレスポンス（退会で消えるアカウントと、チームの行き先）。 */
export const threadsWithdrawalPreviewSchema = z.object({
  ownedAccounts: z.array(z.object({ id: z.string(), name: z.string() })),
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isAdmin: z.boolean(),
      outcome: z.enum(["transfer", "delete", "leave"]),
      nextAdminName: z.string().nullable(),
    }),
  ),
});
/** GET /api/threads/me/withdrawal-preview のレスポンス。 */
export type ThreadsWithdrawalPreview = z.infer<typeof threadsWithdrawalPreviewSchema>;
