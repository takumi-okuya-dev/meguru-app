// アプリ向けの利用権（specs/meguru/029-threads-pattern1 research.md R4、contracts/platform-entry.md 2）。
// 契約（使える状態）・料金なし・運営者・機能のON/OFF・上限を、1つにまとめて返す。アプリは共通の表を読まず、これだけを使う。
// 判定の中身は今の関数（entitlementFromFacts・billingExemptSql・testAccessSql・機能のOFF）をそのまま使い、結果を変えない。
import type { Entitlement } from "@meguru/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { BillingMode } from "../../kernel/config";
import type { Db, TxDb } from "../../kernel/db/client";
import { billingFactsColumns, entitlementFromFacts } from "../billing/billing-service";
import { disabledAppFeaturesSql } from "../features/feature-sql";
import { appFeatures, appLimits } from "../registry/registry";
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
 * 利用者の番号をまとめて、アプリ向けの利用権を読む（問い合わせは3回。人数によらない）。
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
  const [rows, userLimits, defaults] = await Promise.all([
    db
      .select({
        ...billingFactsColumns(mode),
        id: users.id,
        clerkUserId: users.clerkUserId,
        disabled: disabledAppFeaturesSql(users.id, app),
      })
      .from(users)
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(inArray(users.id, ids)),
    db
      .select({ userId: userAppLimits.userId, key: userAppLimits.key, value: userAppLimits.value })
      .from(userAppLimits)
      .where(and(inArray(userAppLimits.userId, ids), eq(userAppLimits.app, app))),
    db.select({ key: appLimitDefaults.key, value: appLimitDefaults.value }).from(appLimitDefaults).where(eq(appLimitDefaults.app, app)),
  ]);
  const defaultOf = new Map(defaults.map((d) => [d.key, d.value]));
  const limitDefs = appLimits(app);
  const featureKeys = appFeatures(app).map((f) => f.key);
  for (const r of rows) {
    const operator = (mode.operators ?? []).includes(r.clerkUserId);
    const billing = entitlementFromFacts(mode, r, now);
    const off = new Set(r.disabled ?? []);
    const own = new Map(userLimits.filter((l) => l.userId === r.id).map((l) => [l.key, l.value]));
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
