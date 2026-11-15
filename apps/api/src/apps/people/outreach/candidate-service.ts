// 誘う候補（specs/people/001-people-memo contracts/api.md 5、FR-018・FR-019、tasks.md T076）。
// その目的の同意が真の人だけを、APIの問い合わせの条件で返す（画面では絞らない。SC-003）。並びと形は人の一覧と同じ。
import { NEXT_INVITE_EVENT, type CandidateList, type CandidateQuery, type PeopleEvent } from "@meguru/shared/people";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { loadOwnedEvent } from "../access";
import { nextOwnEvent, toEvent } from "../events/event-service";
import { queryPersons } from "../persons/person-list";
import { inviteOutreachesFor, latestWorkOutreachesFor } from "./outreach-service";

/**
 * 誘う会を決める。next なら次の自分の会、番号ならその会（ない・ほかの作り手のものなら 404）、書かなければ選んでいない。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventParam - クエリの eventId
 * @param now - 今の時刻
 * @returns 誘う会（選んでいなければ null）
 */
async function resolveInviteEvent(db: Db, userId: string, eventParam: string | undefined, now: Date): Promise<PeopleEvent | null> {
  if (!eventParam) return null;
  if (eventParam === NEXT_INVITE_EVENT) return nextOwnEvent(db, userId, now);
  return toEvent(await loadOwnedEvent(db, userId, eventParam));
}

/**
 * 誘う候補を読む。eventId は誘う会（人は絞らず、その会への声かけを行に入れる）。next なら次の自分の会、書かなければ選んでいない。
 * visitedOwn は自分の会に1回以上来た人だけ。
 * @param db - データベース
 * @param userId - 作り手
 * @param query - 目的・誘う会・前に来た・人の一覧と同じ絞り込み
 * @param now - 今の時刻（次の自分の会を決める）
 * @returns 候補と全体の数と、行の声かけを読んだ誘う会
 */
export async function listCandidates(db: Db, userId: string, query: CandidateQuery, now = new Date()): Promise<CandidateList> {
  const { purpose, visitedOwn, eventId: eventParam, ...rest } = query;
  // 誘う会は交流会への誘いのときだけ使う（仕事のつなぎでは見ない）。画面が次の自分の会を別に読んで待たなくてよいよう、ここで決める
  const extra: SQL[] = [purpose === "invite" ? sql`p.consent_invite = true` : sql`p.consent_work = true`];
  if (visitedOwn) extra.push(sql`coalesce(st.own_count, 0) >= 1`);
  // 誘う会を決めるのと人を読むのは、互いに待たない
  const [inviteEvent, list] = await Promise.all([resolveInviteEvent(db, userId, purpose === "invite" ? eventParam : undefined, now), queryPersons(db, userId, rest, extra)]);
  const eventId = inviteEvent?.id;
  // 声かけ：交流会への誘いは誘う会への声かけ、仕事のつなぎはその人の最新の声かけ
  const ids = list.persons.map((p) => p.id);
  const outreaches =
    purpose === "work" ? await latestWorkOutreachesFor(db, userId, ids) : eventId ? await inviteOutreachesFor(db, userId, eventId, ids) : new Map();
  return { total: list.total, persons: list.persons.map(({ birthdayMd: _, ...p }) => ({ ...p, outreach: outreaches.get(p.id) ?? null })), inviteEvent };
}
