// 人物メモを共通に登録する（組み立てが registerPeople() を呼ぶ。specs/people/001-people-memo research.md R3・R19）。
import { registerAppAccess, registerConsumer, registerModule } from "../../platform";
import { onUserWithdrawn } from "./inbox/withdrawal";
import { PEOPLE_APP } from "./registry";

/** 人物メモの登録をする。何度呼んでも1回だけ登録する（app.ts・index.ts・毎日の処理の初めで、registerThreads() の隣で呼ぶ）。 */
export function registerPeople(): void {
  registerModule(PEOPLE_APP, () => {
    // 運営者が開いた人だけが使える（specs/meguru/030-app-access）
    registerAppAccess(PEOPLE_APP, "granted");
    // 退会したら、その人の人物メモのデータを消す（contracts/events.md）
    registerConsumer(PEOPLE_APP, "user.withdrawn", onUserWithdrawn);
  });
}
