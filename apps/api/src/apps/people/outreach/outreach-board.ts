// 会ごとの声かけの一覧（specs/people/002-sales-list plan.md 3、FR-108）。誘う会への誘いの声かけを、進み具合ごとに並べる。
import type { OutreachBoard, OutreachBoardRow } from "@meguru/shared/people";
import { sql } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { loadOwnedEvent } from "../access";
import { toEvent } from "../events/event-service";
import { NO_FILTER, queryPersons } from "../persons/person-list";
import { peopleOutreaches } from "../schema";
import { inviteOutreachesFor } from "./outreach-service";


/**
 * 会ごとの声かけの一覧。自分の会でなければ 400（よその会には誘わない）。
 * @param db - データベース
 * @param userId - 作り手
 * @param eventId - 誘う会
 * @returns 進み具合ごとの人と声かけ
 */
export async function outreachBoard(db: Db, userId: string, eventId: string): Promise<OutreachBoard> {
  const event = await loadOwnedEvent(db, userId, eventId);
  if (!event.isOwn) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["eventId"]);
  const { persons } = await queryPersons(
    db,
    userId,
    NO_FILTER,
    [sql`EXISTS (SELECT 1 FROM ${peopleOutreaches} o WHERE o.person_id = p.id AND o.purpose = 'invite' AND o.event_id = ${eventId})`],
    { limit: 5000, offset: 0, orderBy: sql`likelihood DESC NULLS LAST, name_key, id` },
  );
  const outreaches = await inviteOutreachesFor(db, userId, eventId, persons.map((p) => p.id));
  const stages: OutreachBoard["stages"] = { asked: [], link_sent: [], attended: [] };
  for (const { birthdayMd: _, ...p } of persons) {
    const outreach = outreaches.get(p.id);
    if (!outreach) continue;
    const row: OutreachBoardRow = { ...p, outreach };
    stages[outreach.stage as keyof OutreachBoard["stages"]].push(row);
  }
  return { event: toEvent(event), stages };
}
