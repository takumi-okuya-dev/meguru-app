// Threads のイベントの候補（specs/collect/001-event-day-collection User Story 6、FR-060〜FR-064、data-model.md 2-10）。PR4 の分。
import { z } from "zod";
import { COLLECT_MEDIA } from "./media";

/** Threads のイベントの候補（GET /api/collect/threads-candidates の1行）。 */
export const threadsCandidateSchema = z.object({
  promotionId: z.string(),
  name: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  venue: z.string().nullable(),
  capacity: z.number().int().nullable(),
  feeAmount: z.number().int().nullable(),
  feeNote: z.string().nullable(),
  /** 掲載済みの媒体（集金管理の媒体の値） */
  postedMedia: z.array(z.enum(COLLECT_MEDIA)),
  /** この候補から作ったイベント（あれば） */
  usedByEventId: z.string().nullable(),
});
/** Threads のイベントの候補。 */
export type ThreadsCandidate = z.infer<typeof threadsCandidateSchema>;

/** GET /api/collect/threads-candidates の応答（開催日時の近い順。過ぎたものは後ろ）。 */
export const threadsCandidateListSchema = z.object({ candidates: z.array(threadsCandidateSchema) });
/** GET /api/collect/threads-candidates の応答。 */
export type ThreadsCandidateList = z.infer<typeof threadsCandidateListSchema>;
