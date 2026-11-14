// 集金管理を共通に登録する（組み立てが registerCollect() を呼ぶ。docs/module-map.md 6 の1）。
import { COLLECT_APP } from "@meguru/shared";
import { registerAppAccess, registerConsumer, registerModule } from "../../platform";
import { onUserWithdrawn } from "./inbox/received-events";
import { onListingStatusChanged, onPromotionEventDeleted, onPromotionEventSaved } from "./inbox/threads-candidates";

/** 集金管理の登録をする。何度呼んでも1回だけ登録する（app.ts・index.ts・毎日の処理の初めで呼ぶ）。 */
export function registerCollect(): void {
  registerModule(COLLECT_APP, () => {
    // 001 は、運営者が人ごと・テストのグループごとに開いた人だけが使う（specs/meguru/030-app-access、spec FR-003）
    registerAppAccess(COLLECT_APP, "granted");
    // 退会したら、その主催者のデータをすべて消す（contracts/events.md 1）
    registerConsumer(COLLECT_APP, "user.withdrawn", onUserWithdrawn);
    // Threads のイベントの候補（contracts/events.md 2。User Story 6）
    registerConsumer(COLLECT_APP, "threads.promotion_event.saved", onPromotionEventSaved);
    registerConsumer(COLLECT_APP, "threads.promotion_event.deleted", onPromotionEventDeleted);
    registerConsumer(COLLECT_APP, "threads.listing_status.changed", onListingStatusChanged);
  });
}
