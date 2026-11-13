// 誘う候補（specs/people/001-people-memo contracts/api.md 5、FR-018・FR-019、tasks.md T076）。
// その目的の同意が真の人だけを、APIの問い合わせの条件で返す（画面では絞らない。SC-003）。並びと形は人の一覧と同じ。
import type { CandidateList, CandidateQuery } from "@meguru/shared/people";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { loadOwnedEvent } from "../access";
import { queryPersons } from "../persons/person-list";
import { inviteOutreachesFor } from "./outreach-service";

/**
 * 誘う候補を読む。eventId は誘う会（人は絞らず、その会への声かけを行に入れる）。visitedOwn は自分の会に1回以上来た人だけ。
 * @param db - データベース
 * @param userId - 作り手
 * @param query - 目的・誘う会・前に来た・人の一覧と同じ絞り込み
 * @returns 候補と全体の数
 */
export async function listCandidates(db: Db, userId: string, query: CandidateQuery): Promise<CandidateList> {
  const { purpose, visitedOwn, eventId, ...rest } = query;
  // 誘う会は交流会への誘いのときだけ使う（仕事のつなぎでは見ない）
  if (purpose === "invite" && eventId) await loadOwnedEvent(db, userId, eventId);
  const extra: SQL[] = [purpose === "invite" ? sql`p.consent_invite = true` : sql`p.consent_work = true`];
  if (visitedOwn) extra.push(sql`coalesce(st.own_count, 0) >= 1`);
  const list = await queryPersons(db, userId, rest, extra);
  // 声かけは交流会への誘いの誘う会のものだけ入れる（仕事のつなぎの最新の声かけは PR4）
  const outreaches = purpose === "invite" && eventId ? await inviteOutreachesFor(db, userId, eventId, list.persons.map((p) => p.id)) : new Map();
  return { total: list.total, persons: list.persons.map((p) => ({ ...p, outreach: outreaches.get(p.id) ?? null })) };
}
