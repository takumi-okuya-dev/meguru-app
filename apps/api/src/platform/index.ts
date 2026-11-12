// 共通（platform）の入口。アプリと組み立ては、共通をこの入口からだけ使う（docs/module-map.md 1-2）。
// 表の定義（schema.ts）と SQL の部品（featureOnSql など）は出さない。アプリは入口の関数だけを使う
// （specs/meguru/029-threads-pattern1 contracts/platform-entry.md 1、tasks.md T036）。
// 組み立て：認証・APIの道筋・定期処理
export { allowBeforeSubscribe, allowSelfService, authMiddleware, optionalAuthMiddleware, clerkVerifier, type AuthVerifier, type AppEnv } from "./identity/auth";
export { meRoutes } from "./identity/me-routes";
export { billingRoutes } from "./billing/billing-routes";
export { stripeWebhookRoutes } from "./billing/stripe-webhook-routes";
export { reconcileSubscriptions, syncQuantity } from "./billing/billing-service";
export { operatorFeatureRoutes } from "./features/operator-feature-routes";
export { operatorLimitRoutes } from "./operator/operator-limit-routes";
export { operatorAppAccessRoutes } from "./access/operator-app-access-routes";
export { operatorTestGroupRoutes } from "./test-groups/operator-test-group-routes";
export { testInviteRoutes } from "./test-groups/test-invite-routes";
export { referralRoutes } from "./referrals/referral-routes";
export { clerkUserDeleter, resumeWithdrawals, WITHDRAWN_ACTOR_NAME, type ClerkUserDeleter } from "./withdrawal/withdrawal-service";
// 運営者
export { operatorOnly } from "./operator/operator-only";
export { recordOperatorEvent, countRecentApplyActions } from "./operator/operator-events";
// アプリを分けるための共通の土台（contracts/platform-entry.md）
export { registerModule } from "./registry/modules";
export { registerConsumer, deliverPendingEvents, nextPendingAttemptAt, purgeDeliveredEvents, type EventConsumer, type PlatformEvent, type PlatformEventType } from "./events/events";
export { readEventGate, shouldDeliver, nextEventCheckAt, writeEventGate } from "./events/delivery-gate";
export { loadAppEntitlement, loadAppEntitlements, loadAppFeatures, type AppEntitlement } from "./entitlement/entitlement";
export { reportUsage, billingQuantityOf, usingAppsOf, appUsageOf, usersWithUsage, type AppUsageReport } from "./usage/usage";
export {
  registerAppFeatures,
  registerAppLimits,
  registerAppAccess,
  appFeatures,
  appLimits,
  registeredApps,
  type AppFeatureDef,
  type AppLimitDef,
} from "./registry/registry";
// アプリの利用の許可（specs/meguru/030-app-access）：アプリの道筋の関所
export { requireAppAccess } from "./access/app-access";
export { operatorAppRegistryRoutes } from "./registry/registry-routes";
export { currentUser, peopleNames, peopleProfiles, personName, searchPeople } from "./identity/people";
