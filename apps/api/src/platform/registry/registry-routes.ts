// GET /api/operator/app-registry（運営者だけ）：登録されたアプリの機能と上限の一覧（specs/meguru/029-threads-pattern1 tasks.md T069）。
// 運営の画面は、アプリの機能の名前・表示名・上限の範囲を直接書かず、この一覧で出す。
import type { OperatorAppRegistry } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../identity/auth";
import { operatorOnly } from "../operator/operator-only";
import { appFeatures, appLimits, registeredApps, requireFeatureSettingsApp } from "./registry";

/**
 * 登録の一覧を、運営の画面に返す形にする（機能も上限も、登録した順）。
 * @returns アプリごとの機能と上限
 */
export function appRegistryView(): OperatorAppRegistry {
  const owner = requireFeatureSettingsApp();
  return {
    apps: registeredApps().map((app) => ({
      app,
      featureSwitches: app === owner,
      features: appFeatures(app).map((f) => ({ key: f.key, label: f.label, ...(f.description ? { description: f.description } : {}) })),
      limits: Object.entries(appLimits(app)).map(([key, l]) => ({ key, label: l.label, min: l.min, max: l.max, operatorValue: l.operatorValue })),
    })),
  };
}

/**
 * 運営者の登録の一覧のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function operatorAppRegistryRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/operator/app-registry", authed, operatorOnly, (c) => c.json(appRegistryView()));
}
