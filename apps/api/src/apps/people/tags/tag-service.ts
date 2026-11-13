// タグ（specs/people/002-sales-list plan.md 3、FR-101）。作り手ごとに持ち、同じ名前（nameKey）は1つ。
import { nameKey, TAGS_MAX, TAGS_PER_PERSON_MAX, type PeopleTag, type PersonTag } from "@meguru/shared/people";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError, itemNotFound } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadOwnedPerson, lockActiveOwner, lockOwner, type PeopleDb } from "../access";
import { peoplePersonTags, peopleTags } from "../schema";

/**
 * 人に付いたタグ（名前の順）。
 * @param db - データベース
 * @param userId - 作り手
 * @param personId - 人
 * @returns タグ
 */
export async function tagsOfPerson(db: PeopleDb, userId: string, personId: string): Promise<PersonTag[]> {
  return db
    .select({ id: peopleTags.id, name: peopleTags.name })
    .from(peoplePersonTags)
    .innerJoin(peopleTags, eq(peopleTags.id, peoplePersonTags.tagId))
    .where(and(eq(peoplePersonTags.personId, personId), eq(peoplePersonTags.userId, userId)))
    .orderBy(asc(peopleTags.nameKey));
}

/**
 * 作り手のタグ（名前の順・人数つき）。
 * @param db - データベース
 * @param userId - 作り手
 * @returns タグ
 */
export async function listTags(db: Db, userId: string): Promise<PeopleTag[]> {
  const rows = await db
    .select({ id: peopleTags.id, name: peopleTags.name, personCount: sql<number>`(SELECT count(*) FROM ${peoplePersonTags} pt WHERE pt.tag_id = ${peopleTags.id})::int` })
    .from(peopleTags)
    .where(eq(peopleTags.userId, userId))
    .orderBy(asc(peopleTags.nameKey));
  return rows.map((r) => ({ ...r, personCount: Number(r.personCount) }));
}

/**
 * 作り手のタグを読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param tagId - タグ
 * @returns タグの行
 */
async function loadOwnedTag(db: PeopleDb, userId: string, tagId: string) {
  if (!isUuid(tagId)) throw itemNotFound();
  const [row] = await db
    .select()
    .from(peopleTags)
    .where(and(eq(peopleTags.id, tagId), eq(peopleTags.userId, userId)));
  if (!row) throw itemNotFound();
  return row;
}

/**
 * 同じ名前のタグがあれば 409 PEOPLE_NAME_TAKEN（直すときは自分自身を除く）。
 * @param tx - トランザクション
 * @param userId - 作り手
 * @param key - nameKey
 * @param exceptId - 除くタグ
 */
async function assertNameFree(tx: TxDb, userId: string, key: string, exceptId?: string): Promise<void> {
  const [same] = await tx
    .select({ id: peopleTags.id })
    .from(peopleTags)
    .where(and(eq(peopleTags.userId, userId), eq(peopleTags.nameKey, key)));
  if (same && same.id !== exceptId) throw new AppError("PEOPLE_NAME_TAKEN", 409, "name taken");
}

/**
 * タグを作る（作り手のタグは100まで）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param name - 名前
 * @returns 作ったタグ
 */
export async function createTag(env: Env, userId: string, name: string): Promise<PersonTag> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockActiveOwner(tx, env, userId);
    const key = nameKey(name);
    await assertNameFree(tx, userId, key);
    const [n] = await tx.select({ n: count() }).from(peopleTags).where(eq(peopleTags.userId, userId));
    if ((n?.n ?? 0) >= TAGS_MAX) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["name"]);
    const [row] = await tx.insert(peopleTags).values({ userId, name, nameKey: key }).returning({ id: peopleTags.id, name: peopleTags.name });
    return row!;
  });
}

/**
 * タグの名前を直す。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param tagId - タグ
 * @param name - 新しい名前
 * @returns タグ
 */
export async function renameTag(env: Env, userId: string, tagId: string, name: string): Promise<PersonTag> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const tag = await loadOwnedTag(tx, userId, tagId);
    const key = nameKey(name);
    await assertNameFree(tx, userId, key, tag.id);
    await tx.update(peopleTags).set({ name, nameKey: key }).where(eq(peopleTags.id, tag.id));
    return { id: tag.id, name };
  });
}

/**
 * タグを消す（付けていた人からも外れる）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param tagId - タグ
 */
export async function deleteTag(env: Env, userId: string, tagId: string): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const tag = await loadOwnedTag(tx, userId, tagId);
    await tx.delete(peopleTags).where(eq(peopleTags.id, tag.id));
  });
}

/**
 * 人のタグを置き換える。新しい名前は作って付ける（同じ名前のタグがあればそれを使う）。1人に20まで。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param personId - 人
 * @param input - 付けるタグと、新しい名前
 * @returns 付いたタグ
 */
export async function setPersonTags(env: Env, userId: string, personId: string, input: { tagIds: string[]; newTagNames: string[] }): Promise<PersonTag[]> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockActiveOwner(tx, env, userId);
    const p = await loadOwnedPerson(tx, userId, personId);
    const ids = new Set(input.tagIds);
    if (ids.size > 0) {
      const owned = await tx
        .select({ id: peopleTags.id })
        .from(peopleTags)
        .where(and(eq(peopleTags.userId, userId), inArray(peopleTags.id, [...ids])));
      if (owned.length !== ids.size) throw itemNotFound();
    }
    // 新しい名前：同じ名前のタグがあればそれを、なければ作る
    const byKey = new Map<string, string>();
    for (const name of input.newTagNames) if (!byKey.has(nameKey(name))) byKey.set(nameKey(name), name);
    if (byKey.size > 0) {
      const existing = await tx
        .select({ id: peopleTags.id, key: peopleTags.nameKey })
        .from(peopleTags)
        .where(and(eq(peopleTags.userId, userId), inArray(peopleTags.nameKey, [...byKey.keys()])));
      for (const e of existing) {
        ids.add(e.id);
        byKey.delete(e.key);
      }
      if (byKey.size > 0) {
        const [n] = await tx.select({ n: count() }).from(peopleTags).where(eq(peopleTags.userId, userId));
        if ((n?.n ?? 0) + byKey.size > TAGS_MAX) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["newTagNames"]);
        const created = await tx
          .insert(peopleTags)
          .values([...byKey].map(([key, name]) => ({ userId, name, nameKey: key })))
          .returning({ id: peopleTags.id });
        for (const c of created) ids.add(c.id);
      }
    }
    if (ids.size > TAGS_PER_PERSON_MAX) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["tagIds"]);
    await tx.delete(peoplePersonTags).where(and(eq(peoplePersonTags.personId, p.id), eq(peoplePersonTags.userId, userId)));
    if (ids.size > 0) await tx.insert(peoplePersonTags).values([...ids].map((tagId) => ({ personId: p.id, tagId, userId })));
    return tagsOfPerson(tx, userId, p.id);
  });
}
