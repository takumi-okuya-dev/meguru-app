// Threadsを共通に登録する（組み立てが registerThreads() を呼ぶ。specs/meguru/029-threads-pattern1 contracts/module-boundaries.md 4）。
// 機能と上限の名前・/api/me に足す中身・共通の出来事の受け取りを、共通の入口の関数で登録する。
import { createDb } from "../../kernel/db/client";
import {
  registerAppFeatures,
  registerAppLimits,
  registerConsumer,
  registerMeSection,
  registerModule,
  registerWithdrawalPreviewSection,
} from "../../platform";
import { THREADS_APP, THREADS_FEATURES, THREADS_LIMITS } from "./registry";
import { onLimitsChanged, onUserWithdrawn } from "./events/received-events";
import { buildThreadsMe, threadsWithdrawalPreview } from "./me/threads-me";

/** Threadsの登録をする。何度呼んでも1回だけ登録する（app.ts・index.ts・毎日の処理の初めで呼ぶ）。 */
export function registerThreads(): void {
  registerModule("threads", () => {
    // 機能のまとまりと上限の名前を、共通に登録する（specs/meguru/029 research.md R7）
    // 機能のON/OFF（運営の画面と、ログインした人の features）は Threads が持つ（specs/meguru/029 T070）
    registerAppFeatures(THREADS_APP, THREADS_FEATURES, { switches: true });
    // 運営の上限の画面は Threads の上限を扱う（specs/meguru/029 T070）
    registerAppLimits(THREADS_APP, THREADS_LIMITS, { operatorScreen: true });
    // /api/me と退会の確かめに、Threadsの中身を足す（PR5 まで。前の画面のため。specs/meguru/029 contracts/api-routes.md 2）
    registerMeSection(THREADS_APP, buildThreadsMe);
    registerWithdrawalPreviewSection(THREADS_APP, (c) => threadsWithdrawalPreview(createDb(c.env.DATABASE_URL), c.get("user").id));
    // 共通の出来事（specs/meguru/029 research.md R8）：退会したらThreadsのデータを片づける、上限が変わったら自動投稿を起こす
    registerConsumer(THREADS_APP, "user.withdrawn", onUserWithdrawn);
    registerConsumer(THREADS_APP, "limits.changed", onLimitsChanged);
  });
}
