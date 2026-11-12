// Threadsが受け取る知らせ（specs/027-modular-monolith research.md R4、docs/module-map.md 1-4）。
// 共通（platform）の処理の途中でThreadsの処理が要るところを、知らせとして受け取る。組み立てが registerThreads() を呼ぶ。
import { createDb } from "../../kernel/db/client";
import {
  registerAppFeatures,
  registerAppLimits,
  registerHook,
  registerMeSection,
  registerModule,
  registerWithdrawalPreviewSection,
} from "../../platform";
import { THREADS_APP, THREADS_FEATURES, THREADS_LIMITS } from "./registry";
import { cleanupForWithdrawal } from "./accounts/withdrawal-cleanup";
import { buildThreadsMe, threadsWithdrawalPreview } from "./me/threads-me";
import { notifyWake } from "./publish/posting-schedule-service";

/** Threadsの受け取りを登録する。何度呼んでも1回だけ登録する（app.ts・index.ts・毎日の処理の初めで呼ぶ）。 */
export function registerThreads(): void {
  registerModule("threads", () => {
    // 機能のまとまりと上限の名前を、共通に登録する（specs/meguru/029 research.md R7）
    registerAppFeatures(THREADS_APP, THREADS_FEATURES);
    registerAppLimits(THREADS_APP, THREADS_LIMITS);
    // /api/me と退会の確かめに、Threadsの中身を足す（PR5 まで。前の画面のため。specs/meguru/029 contracts/api-routes.md 2）
    registerMeSection(THREADS_APP, buildThreadsMe);
    registerWithdrawalPreviewSection(THREADS_APP, (c) => threadsWithdrawalPreview(createDb(c.env.DATABASE_URL), c.get("user").id));
    // 退会：Threadsのデータを片づける（招待の申し込み・持ち主のアカウント・チーム・記録の名前。specs/meguru/029 research.md R8）
    registerHook("userWithdrawing", ({ tx, userId }) => cleanupForWithdrawal(tx, userId));
    // 上限が変わった：自動投稿の定期処理を起こす（specs/024）
    registerHook("limitsChanged", ({ env }) => notifyWake(env.AUTOPOST_KV, new Date()));
  });
}
