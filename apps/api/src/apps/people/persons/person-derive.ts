// 人の今のLINE名と同意を決め直す（specs/people/001-people-memo research.md R10・R11）。
// 取り込み・取り消し・まとめる・分けるのあと、動いた人をまとめて決め直す（人ごとに問い合わせを重ねない）。
import { jstDate, nameKey, resolveConsent, type ConsentFact } from "@meguru/shared/people";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { TxDb } from "../../../kernel/db/client";
import { peopleConsentChanges, peopleEvents, peoplePersons, peopleResponses } from "../schema";

/**
 * 人の今のLINE名と同意を決め直す。今のLINE名＝いちばん新しい回答（開催日 → 回答の時刻 → 取り込んだ時刻の新しい順）のLINE名、
 * 回答がなければ手で足したときのLINE名（それもなければ今のまま）。同意＝日付のいちばん新しい事実（resolveConsent）。
 * 同意が回答から変わったら consent_changes に1行書く（手直しの事実は、書いた道筋がもう1行書いている）。
 * @param tx - トランザクション（作り手のロックを取ったもの）
 * @param userId - 作り手
 * @param personIds - 決め直す人
 */
export async function derivePersons(tx: TxDb, userId: string, personIds: readonly string[]): Promise<void> {
  const ids = [...new Set(personIds)];
  if (ids.length === 0) return;
  const [persons, responses, manuals] = await Promise.all([
    tx
      .select({
        id: peoplePersons.id,
        lineName: peoplePersons.lineName,
        enteredLineName: peoplePersons.enteredLineName,
        consentInvite: peoplePersons.consentInvite,
        consentWork: peoplePersons.consentWork,
        consentSource: peoplePersons.consentSource,
        consentBasisOn: peoplePersons.consentBasisOn,
      })
      .from(peoplePersons)
      .where(and(eq(peoplePersons.userId, userId), inArray(peoplePersons.id, ids))),
    tx
      .select({
        id: peopleResponses.id,
        personId: peopleResponses.personId,
        lineName: peopleResponses.lineName,
        heldOn: peopleEvents.heldOn,
        submittedAt: peopleResponses.submittedAt,
        createdAt: peopleResponses.createdAt,
        invite: peopleResponses.consentInvite,
        work: peopleResponses.consentWork,
      })
      .from(peopleResponses)
      .innerJoin(peopleEvents, eq(peopleEvents.id, peopleResponses.eventId))
      .where(and(eq(peopleResponses.userId, userId), inArray(peopleResponses.personId, ids))),
    tx
      .selectDistinctOn([peopleConsentChanges.personId], {
        personId: peopleConsentChanges.personId,
        invite: peopleConsentChanges.invite,
        work: peopleConsentChanges.work,
        basisOn: peopleConsentChanges.basisOn,
        changedAt: peopleConsentChanges.changedAt,
      })
      .from(peopleConsentChanges)
      .where(and(eq(peopleConsentChanges.userId, userId), inArray(peopleConsentChanges.personId, ids), eq(peopleConsentChanges.source, "manual")))
      .orderBy(peopleConsentChanges.personId, desc(peopleConsentChanges.changedAt)),
  ]);

  const factsOf = new Map<string, ConsentFact[]>();
  const push = (personId: string, f: ConsentFact) => {
    const list = factsOf.get(personId);
    if (list) list.push(f);
    else factsOf.set(personId, [f]);
  };
  const latestResponse = new Map<string, (typeof responses)[number]>();
  for (const r of responses) {
    push(r.personId, { kind: "response", on: r.heldOn, submittedAt: r.submittedAt, createdAt: r.createdAt, invite: r.invite, work: r.work, responseId: r.id });
    const cur = latestResponse.get(r.personId);
    if (!cur || newerResponse(r, cur)) latestResponse.set(r.personId, r);
  }
  for (const m of manuals) push(m.personId, { kind: "manual", on: m.basisOn, changedAt: m.changedAt, invite: m.invite, work: m.work });

  const now = new Date();
  const updates: SQL[] = [];
  const changes: (typeof peopleConsentChanges.$inferInsert)[] = [];
  for (const p of persons) {
    const lineName = latestResponse.get(p.id)?.lineName ?? p.enteredLineName ?? p.lineName;
    const consent = resolveConsent(factsOf.get(p.id) ?? []);
    const consentChanged =
      consent.invite !== p.consentInvite || consent.work !== p.consentWork || consent.source !== p.consentSource || consent.basisOn !== p.consentBasisOn;
    if (lineName === p.lineName && !consentChanged) continue;
    updates.push(
      sql`(${p.id}::uuid, ${lineName}::text, ${lineName === null ? null : nameKey(lineName)}::text, ${consent.invite}::boolean, ${consent.work}::boolean,
        ${consent.source}::text, ${consent.basisOn}::date, ${consentChanged}::boolean)`,
    );
    // 回答から変わったときだけ記録を足す（手直しの事実は、手直しの道筋が書いた行そのもの）
    const valueChanged = consent.invite !== p.consentInvite || consent.work !== p.consentWork || consent.source !== p.consentSource;
    if (valueChanged && consent.fact?.kind === "response") {
      changes.push({
        personId: p.id,
        userId,
        invite: consent.invite,
        work: consent.work,
        source: "response",
        responseId: consent.fact.responseId,
        basisOn: consent.fact.on,
        changedAt: now,
      });
    }
  }
  if (updates.length > 0) {
    await tx.execute(sql`UPDATE ${peoplePersons} AS p SET
        line_name = v.line_name, line_name_key = v.line_name_key,
        consent_invite = v.ci, consent_work = v.cw, consent_source = v.cs, consent_basis_on = v.cb,
        consent_updated_at = CASE WHEN v.changed THEN ${now} ELSE p.consent_updated_at END,
        updated_at = ${now}
      FROM (VALUES ${sql.join(updates, sql`, `)}) AS v(id, line_name, line_name_key, ci, cw, cs, cb, changed)
      WHERE p.id = v.id AND p.user_id = ${userId}`);
  }
  if (changes.length > 0) await tx.insert(peopleConsentChanges).values(changes);
}

/** 回答の新しさを比べるのに使う項目。 */
export type ResponseOrderKey = { id: string; heldOn: string; submittedAt: Date | null; createdAt: Date };

/**
 * 回答 a が b より新しいか（開催日 → 回答の時刻（読めないものは古い）→ 取り込んだ時刻 → 番号）。「いちばん新しい回答」の決まりはここだけに置く
 * （SQL の写しは person-query.ts の latestResponseSql。並びを変えるときは両方を直す）。
 * @param a - 回答
 * @param b - 回答
 * @returns a が新しければ true
 */
export function newerResponse(a: ResponseOrderKey, b: ResponseOrderKey): boolean {
  if (a.heldOn !== b.heldOn) return a.heldOn > b.heldOn;
  const sa = a.submittedAt?.getTime() ?? -Infinity;
  const sb = b.submittedAt?.getTime() ?? -Infinity;
  if (sa !== sb) return sa > sb;
  if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() > b.createdAt.getTime();
  return a.id > b.id;
}

/**
 * 手直しの事実を記録する（手で足す・同意を直す。R11）。そのあと derivePersons で決め直す。
 * @param tx - トランザクション
 * @param userId - 作り手
 * @param personId - 人
 * @param consent - 直したあとの同意
 * @param at - 直した時刻
 */
export async function recordManualConsent(tx: TxDb, userId: string, personId: string, consent: { invite: boolean; work: boolean }, at = new Date()): Promise<void> {
  await tx.insert(peopleConsentChanges).values({ personId, userId, invite: consent.invite, work: consent.work, source: "manual", basisOn: jstDate(at), changedAt: at });
}

type SQL = ReturnType<typeof sql>;
