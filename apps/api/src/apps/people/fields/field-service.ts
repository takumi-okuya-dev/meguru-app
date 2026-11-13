// 自由な項目と SNS のリンク（specs/people/002-sales-list plan.md 3、FR-109・FR-110）。
import { FIELDS_MAX, LINK_KINDS, nameKey, type CustomField, type LinkKind, type PersonFieldValue, type PersonLinks } from "@meguru/shared/people";
import { and, asc, count, eq, inArray, max, sql } from "drizzle-orm";
import { withTransaction } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError, itemNotFound } from "../../../kernel/errors";
import { assertKeyFree, loadOwnedField, loadOwnedPerson, lockActiveOwner, lockOwner, touchPerson, type PeopleDb } from "../access";
import { peopleCustomFields, peoplePersonFieldValues, peoplePersonLinks } from "../schema";

/**
 * 作り手の自由な項目（並びの順）。
 * @param db - データベース
 * @param userId - 作り手
 * @returns 項目
 */
export async function listFields(db: PeopleDb, userId: string): Promise<CustomField[]> {
  return db
    .select({ id: peopleCustomFields.id, label: peopleCustomFields.label, position: peopleCustomFields.position })
    .from(peopleCustomFields)
    .where(eq(peopleCustomFields.userId, userId))
    .orderBy(asc(peopleCustomFields.position), asc(peopleCustomFields.createdAt));
}

/**
 * 人の自由な項目の値（すべての項目を並びの順に。値がなければ null）。
 * @param db - データベース
 * @param userId - 作り手
 * @param personId - 人
 * @returns 項目と値
 */
export async function fieldsOfPerson(db: PeopleDb, userId: string, personId: string): Promise<PersonFieldValue[]> {
  const [fields, values] = await Promise.all([
    listFields(db, userId),
    db
      .select({ fieldId: peoplePersonFieldValues.fieldId, value: peoplePersonFieldValues.value })
      .from(peoplePersonFieldValues)
      .where(and(eq(peoplePersonFieldValues.personId, personId), eq(peoplePersonFieldValues.userId, userId))),
  ]);
  const byField = new Map(values.map((v) => [v.fieldId, v.value]));
  return fields.map((f) => ({ fieldId: f.id, label: f.label, value: byField.get(f.id) ?? null }));
}

/**
 * 人の SNS のリンク。
 * @param db - データベース
 * @param userId - 作り手
 * @param personId - 人
 * @returns リンク
 */
export async function linksOfPerson(db: PeopleDb, userId: string, personId: string): Promise<PersonLinks> {
  const rows = await db
    .select({ kind: peoplePersonLinks.kind, url: peoplePersonLinks.url })
    .from(peoplePersonLinks)
    .where(and(eq(peoplePersonLinks.personId, personId), eq(peoplePersonLinks.userId, userId)));
  return Object.fromEntries(rows.map((r) => [r.kind, r.url])) as PersonLinks;
}

/**
 * 項目を足す（いちばん後ろ。30まで）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param label - 名前
 * @returns 項目
 */
export async function createField(env: Env, userId: string, label: string): Promise<CustomField> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockActiveOwner(tx, env, userId);
    const key = nameKey(label);
    await assertKeyFree(tx, peopleCustomFields, peopleCustomFields.labelKey, userId, key);
    const [stat] = await tx.select({ n: count(), last: max(peopleCustomFields.position) }).from(peopleCustomFields).where(eq(peopleCustomFields.userId, userId));
    if ((stat?.n ?? 0) >= FIELDS_MAX) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["label"]);
    const [row] = await tx
      .insert(peopleCustomFields)
      .values({ userId, label, labelKey: key, position: (stat?.last ?? -1) + 1 })
      .returning({ id: peopleCustomFields.id, label: peopleCustomFields.label, position: peopleCustomFields.position });
    return row!;
  });
}

/**
 * 項目の名前を直す。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param fieldId - 項目
 * @param label - 新しい名前
 * @returns 項目
 */
export async function renameField(env: Env, userId: string, fieldId: string, label: string): Promise<CustomField> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const f = await loadOwnedField(tx, userId, fieldId);
    const key = nameKey(label);
    await assertKeyFree(tx, peopleCustomFields, peopleCustomFields.labelKey, userId, key, f.id);
    await tx.update(peopleCustomFields).set({ label, labelKey: key }).where(eq(peopleCustomFields.id, f.id));
    return { id: f.id, label, position: f.position };
  });
}

/**
 * 項目を消す（値も外部キーで消える）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param fieldId - 項目
 */
export async function deleteField(env: Env, userId: string, fieldId: string): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const f = await loadOwnedField(tx, userId, fieldId);
    await tx.delete(peopleCustomFields).where(eq(peopleCustomFields.id, f.id));
  });
}

/**
 * 項目を並べ替える（すべての項目の番号を、並べたい順に渡す）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param fieldIds - 項目の番号（並べたい順）
 * @returns 並べ替えたあとの項目
 */
export async function reorderFields(env: Env, userId: string, fieldIds: string[]): Promise<CustomField[]> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const fields = await listFields(tx, userId);
    const mine = new Set(fields.map((f) => f.id));
    if (fieldIds.length !== mine.size || new Set(fieldIds).size !== fieldIds.length || !fieldIds.every((id) => mine.has(id))) {
      throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["fieldIds"]);
    }
    // 1回の UPDATE でまとめて並べ替える
    if (fieldIds.length > 0) {
      const values = sql.join(
        fieldIds.map((id, i) => sql`(${id}::uuid, ${i}::int)`),
        sql`, `,
      );
      await tx.execute(sql`UPDATE ${peopleCustomFields} AS f SET position = v.pos FROM (VALUES ${values}) AS v(id, pos) WHERE f.id = v.id AND f.user_id = ${userId}`);
    }
    return listFields(tx, userId);
  });
}

/**
 * 人の項目の値を入れる（null は消す）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param personId - 人
 * @param values - 項目と値
 * @returns 人の項目と値
 */
export async function setPersonFields(env: Env, userId: string, personId: string, values: { fieldId: string; value: string | null }[]): Promise<PersonFieldValue[]> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockActiveOwner(tx, env, userId);
    const p = await loadOwnedPerson(tx, userId, personId);
    const ids = [...new Set(values.map((v) => v.fieldId))];
    if (ids.length > 0) {
      const owned = await tx
        .select({ id: peopleCustomFields.id })
        .from(peopleCustomFields)
        .where(and(eq(peopleCustomFields.userId, userId), inArray(peopleCustomFields.id, ids)));
      if (owned.length !== ids.length) throw itemNotFound();
    }
    // 消すものは1回の DELETE、入れるものは1回の複数行の upsert でまとめる
    const removed = values.filter((v) => v.value === null).map((v) => v.fieldId);
    const kept = values.filter((v): v is { fieldId: string; value: string } => v.value !== null);
    if (removed.length > 0) {
      await tx.delete(peoplePersonFieldValues).where(and(eq(peoplePersonFieldValues.personId, p.id), inArray(peoplePersonFieldValues.fieldId, removed)));
    }
    if (kept.length > 0) {
      await tx
        .insert(peoplePersonFieldValues)
        .values(kept.map((v) => ({ personId: p.id, fieldId: v.fieldId, userId, value: v.value })))
        .onConflictDoUpdate({ target: [peoplePersonFieldValues.personId, peoplePersonFieldValues.fieldId], set: { value: sql`excluded.value` } });
    }
    await touchPerson(tx, userId, p.id);
    return fieldsOfPerson(tx, userId, p.id);
  });
}

/**
 * 人の SNS のリンクを直す（渡した種類だけ。null は外す。URL の形は入力で確かめてある）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param personId - 人
 * @param input - 種類ごとの URL
 * @returns リンク
 */
export async function setPersonLinks(env: Env, userId: string, personId: string, input: Partial<Record<LinkKind, string | null>>): Promise<PersonLinks> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockActiveOwner(tx, env, userId);
    const p = await loadOwnedPerson(tx, userId, personId);
    for (const kind of LINK_KINDS) {
      const url = input[kind];
      if (url === undefined) continue;
      if (url === null) await tx.delete(peoplePersonLinks).where(and(eq(peoplePersonLinks.personId, p.id), eq(peoplePersonLinks.kind, kind)));
      else {
        await tx
          .insert(peoplePersonLinks)
          .values({ personId: p.id, kind, userId, url })
          .onConflictDoUpdate({ target: [peoplePersonLinks.personId, peoplePersonLinks.kind], set: { url } });
      }
    }
    await touchPerson(tx, userId, p.id);
    return linksOfPerson(tx, userId, p.id);
  });
}
