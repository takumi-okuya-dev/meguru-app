// 誘う候補（specs/people/001-people-memo contracts/api.md 5、FR-018・FR-019、tasks.md T076）。
// その目的の同意が真の人だけを、APIの問い合わせの条件で返す（画面では絞らない。SC-003）。並びと形は人の一覧と同じ。
import { NO_INVITE_EVENT, type CandidateList, type CandidateQuery, type PeopleEvent } from "@meguru/shared/people";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { loadOwnedEvent } from "../access";
import { nextOwnEvent, toEvent } from "../events/event-service";
import { queryPersons } from "../persons/person-list";
import { inviteOutreachesFor, latestWorkOutreachesFor } from "./outreach-service";

/**
 * 誘う候補を読む。eventId は誘う会（人は絞らず、その会への声かけを行に入れる）。書かなければ次の自分の会、none なら選んでいない。
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
  const inviteEvent: PeopleEvent | null =
    purpose !== "invite" || eventParam === NO_INVITE_EVENT
      ? null
      : eventParam
        ? toEvent(await loadOwnedEvent(db, userId, eventParam))
        : await nextOwnEvent(db, userId, now);
  const eventId = inviteEvent?.id;
  const extra: SQL[] = [purpose === "invite" ? sql`p.consent_invite = true` : sql`p.consent_work = true`];
  if (visitedOwn) extra.push(sql`coalesce(st.own_count, 0) >= 1`);
  const list = await queryPersons(db, userId, rest, extra);
  // 声かけ：交流会への誘いは誘う会への声かけ、仕事のつなぎはその人の最新の声かけ
  const ids = list.persons.map((p) => p.id);
  const outreaches =
    purpose === "work" ? await latestWorkOutreachesFor(db, userId, ids) : eventId ? await inviteOutreachesFor(db, userId, eventId, ids) : new Map();
  return { total: list.total, persons: list.persons.map(({ birthdayMd: _, ...p }) => ({ ...p, outreach: outreaches.get(p.id) ?? null })), inviteEvent };
}
