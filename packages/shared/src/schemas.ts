// APIの入出力スキーマ（contracts/api.md「型」）。WebとAPIで共有する。
import { z } from "zod";
import { ERROR_CODES } from "./errors";
import { PLANS } from "./plans";

export const planSchema = z.enum(PLANS);
export const connectionStatusSchema = z.enum(["connected", "needs_reconnect"]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const accountSummarySchema = z.object({
  id: z.string(),
  /** Threadsのユーザー名（@なし） */
  username: z.string(),
  displayName: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  plan: planSchema,
  connectionStatus: connectionStatusSchema,
  /** ISO 8601 */
  lastUsedAt: z.string().nullable(),
});
export type AccountSummary = z.infer<typeof accountSummarySchema>;

export const accountLimitSchema = z.object({
  max: z.number().int(),
  used: z.number().int(),
});
export type AccountLimit = z.infer<typeof accountLimitSchema>;

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string().nullable(),
  }),
  accounts: z.array(accountSummarySchema),
  landingAccountId: z.string().nullable(),
  accountLimit: accountLimitSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const connectRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new") }),
  z.object({ mode: z.literal("reconnect"), accountId: z.string().uuid() }),
]);
export type ConnectRequest = z.infer<typeof connectRequestSchema>;

export const connectResponseSchema = z.object({ authorizeUrl: z.string().url() });

export const openAccountRequestSchema = z.object({
  /** ページを読み込むたびに作る乱数ID（research.md R10） */
  clientId: z.string().min(1).max(100),
  /** そのページでAccountの画面を開くたびに増える連番 */
  openSeq: z.number().int().nonnegative(),
});
export type OpenAccountRequest = z.infer<typeof openAccountRequestSchema>;

export const deleteAccountRequestSchema = z.object({
  confirmUsername: z.string(),
});

export const dataDeletionStatusSchema = z.object({
  status: z.enum(["pending", "completed", "failed"]),
  receivedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type DataDeletionStatus = z.infer<typeof dataDeletionStatusSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    /** CONFIG_ERROR のときの、誤っている設定の項目名（値は含めない） */
    details: z.array(z.string()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
