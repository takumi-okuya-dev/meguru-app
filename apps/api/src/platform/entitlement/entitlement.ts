// アプリ向けの利用権（specs/meguru/029-threads-pattern1 research.md R4、contracts/platform-entry.md 2）。
// 契約（使える状態）・料金なし・運営者・機能のON/OFF・上限を、1つにまとめて返す。アプリは共通の表を読まず、これだけを使う。
// 判定の中身は今の関数（entitlementFromFacts・billingExemptSql・testAccessSql・機能のOFF）をそのまま使い、結果を変えない。
import type { Entitlement } from "@meguru/shared";
import { eq, inArray, sql } from "drizzle-orm";
import type { BillingMode } from "../../kernel/config";
import type { Db, TxDb } from "../../kernel/db/client";
import { billingFactsColumns, entitlementFromFacts } from "../billing/billing-service";
import { disabledAppFeaturesSql } from "../features/feature-sql";
import { appFeatures, appLimits } from "../registry/registry";
import { personName } from "../identity/people";
import { appLimitDefaults, subscriptions, userAppLimits, users } from "../schema";

/** アプリ向けの利用権。 */
export type AppEntitlement = {
  /** full：すべて使える。read_only：読むだけ（未払いなど）。none：使えない（契約前・見つからない） */
  access: "full" | "read_only" | "none";
  /** 契約の使える状態（今の Entitlement。画面の帯・読むだけの理由に使う） */
  billing: Entitlement;
  /** 料金なし（運営者・料金なしの印・テスト用のグループ） */
  billingExempt: boolean;
  /** 運営者か */
  operator: boolean;
  /** ONの機能（アプリが登録した名前） */
  features: ReadonlySet<string>;
  /** 上限（アプリが登録した名前。null は上限なし） */
  limits: Readonly<Record<string, number | null>>;
  /** 退会を受け付けた人か（アプリは、出来事が届いて片づけるまでの間、その人の持ち物を誰にも見せない。029 research.md R8） */
  withdrawn: boolean;
  /** 画面と記録に出す名前（peopleNames と同じ決め方。利用権と一緒に読めば、名前を別に読まずに済む） */
  name: string;
};

/**
 * 契約の使える状態から、使えるかを決める。テスト版に入れない人は、今の判定どおり読むだけ（readOnlyReason が test_access）。
 * @param e - 契約の使える状態
 * @returns full・read_only・none
 */
function accessOf(e: Entitlement): AppEntitlement["access"] {
  if (e.fullAccess) return "full";
  return e.state === "unsubscribed" ? "none" : "read_only";
}

/**
 * 利用者の番号をまとめて、アプリ向けの利用権を読む（問い合わせは1回。人数によらない）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param mode - 決済のモード（運営者の一覧を含む）
 * @param userIds - 利用者の番号（重複は1つにまとめる）
 * @param app - アプリの番号
 * @param now - 今の時刻
 * @returns 利用者の番号ごとの利用権（見つからない番号は入らない）
 */
export async function loadAppEntitlements(
  db: Db | TxDb,
  mode: BillingMode,
  userIds: readonly string[],
  app: string,
  now: Date = new Date(),
): Promise<Map<string, AppEntitlement>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, AppEntitlement>();
  if (ids.length === 0) return out;
  // 問い合わせは1回（利用者の行・契約・機能のOFF・人ごとの上限・既定の上限）。APIのたびに通る判定なので、同時の接続を増やさない
  const rows = await db
    .select({
      ...billingFactsColumns(mode),
      id: users.id,
      clerkUserId: users.clerkUserId,
      withdrawalRequestedAt: users.withdrawalRequestedAt,
      displayName: users.displayName,
      email: users.email,
      disabled: disabledAppFeaturesSql(users.id, app),
      ownLimits: sql<{ key: string; value: number }[]>`coalesce((SELECT json_agg(json_build_object('key', l."key", 'value', l."value"))
        FROM ${userAppLimits} l WHERE l."user_id" = ${users.id} AND l."app" = ${app}), '[]'::json)`,
      defaultLimits: sql<{ key: string; value: number }[]>`coalesce((SELECT json_agg(json_build_object('key', d."key", 'value', d."value"))
        FROM ${appLimitDefaults} d WHERE d."app" = ${app}), '[]'::json)`,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(inArray(users.id, ids));
  const limitDefs = appLimits(app);
  const featureKeys = appFeatures(app).map((f) => f.key);
  for (const r of rows) {
    const operator = (mode.operators ?? []).includes(r.clerkUserId);
    const billing = entitlementFromFacts(mode, r, now);
    const off = new Set(r.disabled ?? []);
    const own = new Map((r.ownLimits ?? []).map((l) => [l.key, l.value]));
    const defaultOf = new Map((r.defaultLimits ?? []).map((d) => [d.key, d.value]));
    const limits: Record<string, number | null> = {};
    for (const [key, def] of Object.entries(limitDefs)) {
      limits[key] = operator ? def.operatorValue : (own.get(key) ?? defaultOf.get(key) ?? def.max);
    }
    out.set(r.id, {
      access: accessOf(billing),
      billing,
      billingExempt: r.billingExempt,
      operator,
      features: new Set(featureKeys.filter((k) => !off.has(k))),
      limits,
      withdrawn: r.withdrawalRequestedAt !== null,
      name: personName({ displayName: r.displayName, email: r.email }),
    });
  }
  return out;
}

/**
 * 1人のアプリ向けの利用権を読む。
 * @param db - データベース（トランザクションの中でもよい）
 * @param mode - 決済のモード
 * @param userId - 利用者の番号
 * @param app - アプリの番号
 * @param now - 今の時刻
 * @returns 利用権。利用者がいなければ null
 */
export async function loadAppEntitlement(
  db: Db | TxDb,
  mode: BillingMode,
  userId: string,
  app: string,
  now: Date = new Date(),
): Promise<AppEntitlement | null> {
  return (await loadAppEntitlements(db, mode, [userId], app, now)).get(userId) ?? null;
}
