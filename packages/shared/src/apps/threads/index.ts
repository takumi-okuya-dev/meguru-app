// Threadsの共通の型（specs/meguru/029-threads-pattern1 tasks.md T021、contracts/api-routes.md 2）。
import type { z } from "zod";
import { meResponseSchema, withdrawalPreviewSchema } from "../../schemas";

/**
 * GET /api/threads/me のレスポンス（Threadsの「自分」）。今の GET /api/me のThreadsの部分と同じ形。
 * PR5 で /api/me からThreadsの項目を消すときに、ここへ定義を移す（それまでは同じ定義から取り出し、ずれないようにする）。
 */
export const threadsMeResponseSchema = meResponseSchema.pick({
  accounts: true,
  landingAccountId: true,
  accountLimit: true,
  threadsAccessMode: true,
  threadsConnectMethods: true,
  teams: true,
  features: true,
  dailyPostLimit: true,
  testerInvites: true,
});
/** GET /api/threads/me のレスポンス。 */
export type ThreadsMeResponse = z.infer<typeof threadsMeResponseSchema>;

/**
 * GET /api/threads/me/withdrawal-preview のレスポンス（退会で消えるアカウントと、チームの行き先）。
 * 今の GET /api/me/withdrawal-preview のThreadsの部分と同じ形（PR5 で、共通の側からThreadsの項目を消すときに定義を移す）。
 */
export const threadsWithdrawalPreviewSchema = withdrawalPreviewSchema.pick({ ownedAccounts: true, teams: true });
/** GET /api/threads/me/withdrawal-preview のレスポンス。 */
export type ThreadsWithdrawalPreview = z.infer<typeof threadsWithdrawalPreviewSchema>;
