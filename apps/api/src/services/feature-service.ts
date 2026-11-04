// 機能のまとまりごとのON/OFFの読み書き（specs/019-feature-switches research.md R7・R8、data-model.md）。
// 人の設定とグループの設定の読み書きはここだけに置く。使えるかの判定は feature-sql.ts と authorizeAccount（access.ts）だけ。
import {
  FEATURE_EVENTS_LIMIT,
  FEATURES,
  type Feature,
  type FeatureSettingsList,
  type FeatureSettingsRequest,
  type OperatorUser,
} from "@threads-grower/shared";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../db/client";
import { featureDisables, featureSettingEvents, groupFeatureDisables, testGroupMembers, testGroups, users } from "../db/schema";
import type { Env } from "../env";
import { AppError } from "../lib/errors";
import { isUuid, personName } from "./access";

/** 運営者（認証のミドルウェアが入れる users の行の一部）。 */
type Operator = { id: string; displayName: string | null; email: string };

/** 3つすべてのまとまりの値（true ならON）。 */
type FeatureValues = FeatureSettingsRequest["features"];

const userNotFound = () => new AppError("USER_NOT_FOUND", 404, "user not found");

/**
 * OFFのまとまりを FEATURES の順に並べる。
 * @param values - OFFのまとまり（順不同）
 * @returns FEATURES の順のOFFのまとまり
 */
const ordered = (values: readonly string[] | null | undefined): Feature[] => FEATURES.filter((f) => (values ?? []).includes(f));

/**
 * 1人の今の設定と、入っている閉じていないグループの設定を読む。
 * @param db - データベース（トランザクションの中でもよい）
 * @param where - users を引く条件
 * @returns 見つかった人と今の設定。いなければ null
 */
async function readUser(db: Db | TxDb, where: SQL): Promise<OperatorUser | null> {
  const [u] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      disabled: sql<string[]>`coalesce((SELECT array_agg(${featureDisables.feature}) FROM ${featureDisables} WHERE ${featureDisables.userId} = ${users.id}), '{}')`,
      groupId: testGroups.id,
      groupName: testGroups.name,
      groupDisabled: sql<string[]>`coalesce((SELECT array_agg(${groupFeatureDisables.feature}) FROM ${groupFeatureDisables} WHERE ${groupFeatureDisables.groupId} = ${testGroups.id}), '{}')`,
    })
    .from(users)
    .leftJoin(testGroupMembers, eq(testGroupMembers.userId, users.id))
    // 閉じたグループの設定は効かないので、出さない（FR-018）
    .leftJoin(testGroups, and(eq(testGroups.id, testGroupMembers.groupId), isNull(testGroups.closedAt)))
    .where(where)
    .limit(1);
  if (!u) return null;
  return {
    userId: u.id,
    name: personName(u),
    email: u.email,
    disabled: ordered(u.disabled),
    group: u.groupId && u.groupName !== null ? { id: u.groupId, name: u.groupName, disabled: ordered(u.groupDisabled) } : null,
  };
}

/**
 * メールアドレスの完全一致で1人を探す（部分一致では探さない。research.md R8）。
 * @param db - データベース
 * @param email - 前後の空白を除き、小文字にしたメールアドレス
 * @returns 見つかった人と今の設定
 * @throws AppError USER_NOT_FOUND
 */
export async function findUserByEmail(db: Db, email: string): Promise<OperatorUser> {
  const found = await readUser(db, sql`lower(${users.email}) = ${email}`);
  if (!found) throw userNotFound();
  return found;
}

/**
 * 今のOFFと保存する値から、OFFにする・ONに戻すまとまりを求める。
 * @param before - 今のOFF
 * @param input - 3つすべての値
 * @returns OFFにするまとまりと、ONに戻すまとまり
 */
function diff(before: readonly Feature[], input: FeatureValues) {
  const toDisable = FEATURES.filter((f) => !input[f] && !before.includes(f));
  const toEnable = before.filter((f) => input[f]);
  return { toDisable, toEnable, changes: [...toDisable.map(disabledChange), ...toEnable.map(enabledChange)] };
}
const disabledChange = (feature: Feature) => ({ feature, action: "disabled" as const });
const enabledChange = (feature: Feature) => ({ feature, action: "enabled" as const });

/**
 * 人の設定を、まとまりごとにまとめて保存する（あとから保存したほうが残る）。値が変わったまとまりだけを記録する（FR-014）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param userId - 設定を変える人の users.id
 * @param input - 3つすべての値
 * @returns 保存した後の設定
 * @throws AppError USER_NOT_FOUND
 */
export async function saveFeatureSettings(env: Env, operator: Operator, userId: string, input: FeatureValues): Promise<OperatorUser> {
  if (!isUuid(userId)) throw userNotFound();
  return withTransaction(env.DATABASE_URL, async (tx) => {
    // 設定を変える人の行に鍵をかけてから今の設定を読む（同じ人を同時に変えたとき、記録が実際の変化と食い違わないように）
    const [locked] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!locked) throw userNotFound();
    const before = (await readUser(tx, eq(users.id, userId)))!;
    const { toDisable, toEnable, changes } = diff(before.disabled, input);
    if (toDisable.length > 0) {
      await tx
        .insert(featureDisables)
        .values(toDisable.map((feature) => ({ userId, feature, disabledByUserId: operator.id })))
        .onConflictDoNothing();
    }
    if (toEnable.length > 0) {
      await tx.delete(featureDisables).where(and(eq(featureDisables.userId, userId), inArray(featureDisables.feature, toEnable)));
    }
    await recordChanges(tx, operator, { userId, name: before.name }, changes);
    return { ...before, disabled: FEATURES.filter((f) => !input[f]) };
  });
}

/**
 * 人の設定をすべてONに戻す（行を消し、消したまとまりごとに enabled を記録する。グループの設定は変えない。FR-013）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param userId - users.id
 * @returns 戻した後の設定
 * @throws AppError USER_NOT_FOUND
 */
export async function resetFeatureSettings(env: Env, operator: Operator, userId: string): Promise<OperatorUser> {
  return saveFeatureSettings(env, operator, userId, { autopost: true, strategy: true, team: true });
}

/**
 * グループの設定を、まとまりごとにまとめて保存する（FR-017）。閉じたグループは変えられない。
 * @param tx - トランザクション（グループの行に鍵をかけたもの）
 * @param operator - 運営者
 * @param group - グループの id と名前
 * @param input - 3つすべての値
 */
export async function saveGroupFeatures(tx: TxDb, operator: Operator, group: { id: string; name: string }, input: FeatureValues) {
  const before = ordered(
    (await tx.select({ feature: groupFeatureDisables.feature }).from(groupFeatureDisables).where(eq(groupFeatureDisables.groupId, group.id))).map(
      (r) => r.feature,
    ),
  );
  const { toDisable, toEnable, changes } = diff(before, input);
  if (toDisable.length > 0) {
    await tx
      .insert(groupFeatureDisables)
      .values(toDisable.map((feature) => ({ groupId: group.id, feature, disabledByUserId: operator.id })))
      .onConflictDoNothing();
  }
  if (toEnable.length > 0) {
    await tx
      .delete(groupFeatureDisables)
      .where(and(eq(groupFeatureDisables.groupId, group.id), inArray(groupFeatureDisables.feature, toEnable)));
  }
  await recordChanges(tx, operator, { groupId: group.id, name: group.name }, changes);
}

/**
 * グループの設定でOFFのまとまりを読む（グループの詳しい内容に出す）。
 * @param db - データベース
 * @param groupId - test_groups.id
 * @returns OFFのまとまり（FEATURES の順）
 */
export async function groupDisabledFeatures(db: Db | TxDb, groupId: string): Promise<Feature[]> {
  const rows = await db.select({ feature: groupFeatureDisables.feature }).from(groupFeatureDisables).where(eq(groupFeatureDisables.groupId, groupId));
  return ordered(rows.map((r) => r.feature));
}

/**
 * 変わったまとまりごとに記録を1行ずつ残す（その時点の名前を写す。research.md R7）。
 * @param tx - トランザクション
 * @param operator - 運営者
 * @param subject - 設定を変えられた人（userId）かグループ（groupId）と、その名前
 * @param changes - 変わったまとまりと、OFFにしたかONに戻したか
 */
async function recordChanges(
  tx: TxDb,
  operator: Operator,
  subject: { userId?: string; groupId?: string; name: string },
  changes: { feature: Feature; action: "disabled" | "enabled" }[],
) {
  if (changes.length === 0) return;
  await tx.insert(featureSettingEvents).values(
    changes.map((c) => ({
      subjectUserId: subject.userId ?? null,
      subjectGroupId: subject.groupId ?? null,
      feature: c.feature,
      action: c.action,
      actorUserId: operator.id,
      actorName: personName(operator),
      subjectName: subject.name,
    })),
  );
}

/**
 * 人の設定でOFFのまとまりがある人の一覧と、最近の変更（人とグループ。FR-013・FR-014、research.md R7）。
 * 「最後に変えた日」は、その人の記録のうち一番新しい日時（ONに戻した変更も含む。data-model.md）。
 * @param db - データベース
 * @returns 一覧と最近の変更
 */
export async function listFeatureSettings(db: Db): Promise<FeatureSettingsList> {
  const lastChanged = sql<Date | string | null>`(SELECT max(${featureSettingEvents.createdAt}) FROM ${featureSettingEvents} WHERE ${featureSettingEvents.subjectUserId} = ${users.id})`;
  // 記録のない行（運営者の画面を通さずに入れた行）は、OFFにした時刻で並べる
  const updatedAt = sql<Date | string>`coalesce(${lastChanged}, max(${featureDisables.disabledAt}))`;
  const [rows, events] = await Promise.all([
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        disabled: sql<string[]>`array_agg(${featureDisables.feature})`,
        updatedAt,
      })
      .from(featureDisables)
      .innerJoin(users, eq(users.id, featureDisables.userId))
      .groupBy(users.id)
      .orderBy(desc(updatedAt), users.id),
    db.select().from(featureSettingEvents).orderBy(desc(featureSettingEvents.createdAt), desc(featureSettingEvents.id)).limit(FEATURE_EVENTS_LIMIT),
  ]);
  return {
    users: rows.map((u) => ({
      userId: u.id,
      name: personName(u),
      email: u.email,
      disabled: ordered(u.disabled),
      updatedAt: new Date(u.updatedAt).toISOString(),
    })),
    events: events.map((e) => ({
      feature: e.feature as Feature,
      action: e.action as "disabled" | "enabled",
      actorName: e.actorName,
      subjectName: e.subjectName,
      subjectKind: e.subjectGroupId ? ("group" as const) : ("user" as const),
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
