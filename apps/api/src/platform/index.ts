// 共通（platform）の入口。アプリと組み立ては、共通をこの入口からだけ使う（docs/module-map.md 1-2）。
export * from "./hooks";
export * from "./schema";
export * from "./billing/billing-routes";
export * from "./billing/billing-service";
export * from "./billing/stripe-webhook-routes";
export * from "./features/feature-service";
export * from "./features/feature-sql";
export * from "./features/operator-feature-routes";
export * from "./identity/auth";
export * from "./identity/me-routes";
export * from "./operator/limit-service";
export * from "./operator/operator-events";
export * from "./operator/operator-limit-routes";
export * from "./operator/operator-only";
export * from "./operator/operator-settings";
export * from "./referrals/referral-routes";
export * from "./referrals/referral-service";
export * from "./test-groups/operator-test-group-routes";
export * from "./test-groups/test-group-service";
export * from "./test-groups/test-invite-routes";
export * from "./withdrawal/withdrawal-service";
// アプリを分けるための共通の土台（specs/meguru/029-threads-pattern1 contracts/platform-entry.md）
export { registerConsumer, deliverPendingEvents, purgeDeliveredEvents, type EventConsumer, type PlatformEvent, type PlatformEventType } from "./events/events";
export * from "./entitlement/entitlement";
export { reportUsage, billingQuantityOf, usingAppsOf, appUsageOf, usersWithUsage, type AppUsageReport } from "./usage/usage";
export { registerMeSection, registerWithdrawalPreviewSection, type MeSection } from "./identity/me-sections";
export { registerAppFeatures, registerAppLimits, appFeatures, appLimits, registeredApps, type AppFeatureDef, type AppLimitDef } from "./registry/registry";
export { currentUser, peopleNames, peopleProfiles, personName } from "./identity/people";
