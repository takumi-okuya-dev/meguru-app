// 機能のまとまりごとのON/OFFの読み書き（specs/019-feature-switches research.md R7・R8、data-model.md）。
// 人の設定とグループの設定の読み書きはここだけに置く。使えるかの判定は feature-sql.ts と authorizeAccount（access.ts）だけ。
import {
  FEATURE_EVENTS_LIMIT,
  type FeatureSettingsList,
  type FeatureSettingsRequest,
  type OperatorUser,
} from "@meguru/shared";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../kernel/db/client";
import { featureDisables, featureSettingEvents, groupFeatureDisables, testGroupMembers, testGroups, users } from "../schema";
import type { Env } from "../../kernel/env";
import { AppError } from "../../kernel/errors";
import { isUuid } from "../../kernel/validate";
import { personName } from "../identity/people";
import { appFeatures, requireFeatureSettingsApp } from "../registry/registry";

/** 運営者（認証のミドルウェアが入れる users の行の一部）。 */
type Operator = { id: string; displayName: string | null; email: string };

/** 登録したまとまりすべての値（名前 → ON/OFF。true ならON）。 */
type FeatureValues = FeatureSettingsRequest["features"];

const userNotFound = () => new AppError("USER_NOT_FOUND", 404, "user not found");

/**
 * 読み書きするアプリ（登録の一覧の requireFeatureSettingsApp）。どの問い合わせも、このアプリの行だけを読み書きする
 * （2本目のアプリが同じ表に行を足しても混ざらない。PR #92 のセルフレビュー、specs/meguru/029 tasks.md T027）。
 * 外から呼ぶ関数の初めで1回だけ決め、中の関数に渡す（途中で変わらないように）。
 */
const appOf = requireFeatureSettingsApp;

/**
 * アプリが登録したまとまりの名前（登録の順。共通はアプリの名前を知らない。specs/meguru/029 tasks.md T070）。
 * @param app - アプリの番号
 * @returns まとまりの名前
 */
const keysOf = (app: string): string[] => appFeatures(app).map((d) => d.key);

/**
 * OFFのまとまりを登録の順に並べる（登録していない名前は除く）。
 * @param app - アプリの番号
 * @param values - OFFのまとまり（順不同）
 * @returns 登録の順のOFFのまとまり
 */
const ordered = (app: string, values: readonly string[] | null | undefined): string[] =>
  keysOf(app).filter((f) => (values ?? []).includes(f));

/**
 * 保存する値が、登録したまとまりとちょうどそろっているかを確かめる（足りない・知らない名前は受け付けない）。
 * @param app - アプリの番号
 * @param input - 保存する値
 * @throws AppError VALIDATION_FAILED（そろっていないとき）
 */
function assertAllFeatures(app: string, input: FeatureValues): void {
  const keys = keysOf(app);
  const given = Object.keys(input);
  if (given.length !== keys.length || !keys.every((k) => typeof input[k] === "boolean")) {
    throw new AppError("VALIDATION_FAILED", 400, "features must list every registered feature", undefined, ["features"]);
  }
}

/**
 * 1人の今の設定と、入っている閉じていないグループの設定を読む。
 * @param db - データベース（トランザクションの中でもよい）
 * @param app - アプリの番号
 * @param where - users を引く条件
 * @returns 見つかった人と今の設定。いなければ null
 */
async function readUser(db: Db | TxDb, app: string, where: SQL): Promise<OperatorUser | null> {
  const [u] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      disabled: sql<string[]>`coalesce((SELECT array_agg(${featureDisables.feature}) FROM ${featureDisables} WHERE ${featureDisables.userId} = ${users.id} AND ${featureDisables.app} = ${app}), '{}')`,
      groupId: testGroups.id,
      groupName: testGroups.name,
      groupDisabled: sql<string[]>`coalesce((SELECT array_agg(${groupFeatureDisables.feature}) FROM ${groupFeatureDisables} WHERE ${groupFeatureDisables.groupId} = ${testGroups.id} AND ${groupFeatureDisables.app} = ${app}), '{}')`,
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
    disabled: ordered(app, u.disabled),
    group: u.groupId && u.groupName !== null ? { id: u.groupId, name: u.groupName, disabled: ordered(app, u.groupDisabled) } : null,
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
  const found = await readUser(db, appOf(), sql`lower(${users.email}) = ${email}`);
  if (!found) throw userNotFound();
  return found;
}

/**
 * 今のOFFと保存する値から、OFFにする・ONに戻すまとまりを求める。
 * @param app - アプリの番号
 * @param before - 今のOFF
 * @param input - 登録したまとまりすべての値
 * @returns OFFにするまとまりと、ONに戻すまとまり
 */
function diff(app: string, before: readonly string[], input: FeatureValues) {
  const toDisable = keysOf(app).filter((f) => !input[f] && !before.includes(f));
  const toEnable = before.filter((f) => input[f]);
  return { toDisable, toEnable, changes: [...toDisable.map(disabledChange), ...toEnable.map(enabledChange)] };
}
const disabledChange = (feature: string) => ({ feature, action: "disabled" as const });
const enabledChange = (feature: string) => ({ feature, action: "enabled" as const });

/**
 * 人の設定を、まとまりごとにまとめて保存する（あとから保存したほうが残る）。値が変わったまとまりだけを記録する（FR-014）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param userId - 設定を変える人の users.id
 * @param input - 登録したまとまりすべての値
 * @returns 保存した後の設定
 * @throws AppError USER_NOT_FOUND
 */
export async function saveFeatureSettings(env: Env, operator: Operator, userId: string, input: FeatureValues): Promise<OperatorUser> {
  if (!isUuid(userId)) throw userNotFound();
  return withTransaction(env.DATABASE_URL, async (tx) => {
    // 設定を変える人の行に鍵をかけてから今の設定を読む（同じ人を同時に変えたとき、記録が実際の変化と食い違わないように）
    const [locked] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!locked) throw userNotFound();
    const app = appOf();
    assertAllFeatures(app, input);
    const before = (await readUser(tx, app, eq(users.id, userId)))!;
    const { toDisable, toEnable, changes } = diff(app, before.disabled, input);
    if (toDisable.length > 0) {
      await tx
        .insert(featureDisables)
        .values(toDisable.map((feature) => ({ userId, app, feature, disabledByUserId: operator.id })))
        .onConflictDoNothing();
    }
    if (toEnable.length > 0) {
      await tx
        .delete(featureDisables)
        .where(and(eq(featureDisables.userId, userId), eq(featureDisables.app, app), inArray(featureDisables.feature, toEnable)));
    }
    await recordChanges(tx, app, operator, { userId, name: before.name }, changes);
    return { ...before, disabled: keysOf(app).filter((f) => !input[f]) };
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
  return saveFeatureSettings(env, operator, userId, Object.fromEntries(keysOf(appOf()).map((k) => [k, true])));
}

/**
 * グループの設定を、まとまりごとにまとめて保存する（FR-017）。閉じたグループは変えられない。
 * @param tx - トランザクション（グループの行に鍵をかけたもの）
 * @param operator - 運営者
 * @param group - グループの id と名前
 * @param input - 登録したまとまりすべての値
 */
export async function saveGroupFeatures(tx: TxDb, operator: Operator, group: { id: string; name: string }, input: FeatureValues) {
  const app = appOf();
  assertAllFeatures(app, input);
  const before = ordered(
    app,
    (
      await tx
        .select({ feature: groupFeatureDisables.feature })
        .from(groupFeatureDisables)
        .where(and(eq(groupFeatureDisables.groupId, group.id), eq(groupFeatureDisables.app, app)))
    ).map((r) => r.feature),
  );
  const { toDisable, toEnable, changes } = diff(app, before, input);
  if (toDisable.length > 0) {
    await tx
      .insert(groupFeatureDisables)
      .values(toDisable.map((feature) => ({ groupId: group.id, app, feature, disabledByUserId: operator.id })))
      .onConflictDoNothing();
  }
  if (toEnable.length > 0) {
    await tx
      .delete(groupFeatureDisables)
      .where(and(eq(groupFeatureDisables.groupId, group.id), eq(groupFeatureDisables.app, app), inArray(groupFeatureDisables.feature, toEnable)));
  }
  await recordChanges(tx, app, operator, { groupId: group.id, name: group.name }, changes);
}

/**
 * グループの設定でOFFのまとまりを読む（グループの詳しい内容に出す）。
 * @param db - データベース
 * @param groupId - test_groups.id
 * @returns OFFのまとまり（登録の順）
 */
export async function groupDisabledFeatures(db: Db | TxDb, groupId: string): Promise<string[]> {
  const app = appOf();
  const rows = await db
    .select({ feature: groupFeatureDisables.feature })
    .from(groupFeatureDisables)
    .where(and(eq(groupFeatureDisables.groupId, groupId), eq(groupFeatureDisables.app, app)));
  return ordered(app, rows.map((r) => r.feature));
}

/**
 * 変わったまとまりごとに記録を1行ずつ残す（その時点の名前を写す。research.md R7）。
 * @param tx - トランザクション
 * @param app - アプリの番号
 * @param operator - 運営者
 * @param subject - 設定を変えられた人（userId）かグループ（groupId）と、その名前
 * @param changes - 変わったまとまりと、OFFにしたかONに戻したか
 */
async function recordChanges(
  tx: TxDb,
  app: string,
  operator: Operator,
  subject: { userId?: string; groupId?: string; name: string },
  changes: { feature: string; action: "disabled" | "enabled" }[],
) {
  if (changes.length === 0) return;
  await tx.insert(featureSettingEvents).values(
    changes.map((c) => ({
      app,
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
  const app = appOf();
  const lastChanged = sql<Date | string | null>`(SELECT max(${featureSettingEvents.createdAt}) FROM ${featureSettingEvents} WHERE ${featureSettingEvents.subjectUserId} = ${users.id} AND ${featureSettingEvents.app} = ${app})`;
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
      .where(eq(featureDisables.app, app))
      .groupBy(users.id)
      .orderBy(desc(updatedAt), users.id),
    db
      .select()
      .from(featureSettingEvents)
      .where(eq(featureSettingEvents.app, app))
      .orderBy(desc(featureSettingEvents.createdAt), desc(featureSettingEvents.id))
      .limit(FEATURE_EVENTS_LIMIT),
  ]);
  return {
    users: rows.map((u) => ({
      userId: u.id,
      name: personName(u),
      email: u.email,
      disabled: ordered(app, u.disabled),
      updatedAt: new Date(u.updatedAt).toISOString(),
    })),
    events: events.map((e) => ({
      feature: e.feature,
      action: e.action as "disabled" | "enabled",
      actorName: e.actorName,
      subjectName: e.subjectName,
      subjectKind: e.subjectGroupId ? ("group" as const) : ("user" as const),
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
