// 手伝う人の端末の印をブラウザに保存する（specs/collect/001-event-day-collection research.md R7、tasks.md T052）。
// 受付用リンクごとに localStorage へ。ブラウザの保存が使えない（シークレットウィンドウ・保存を止めている）ときは持たない
// （その画面を開いている間だけ使い、開き直したら名前を入れ直す）。
const keyOf = (token: string) => `collect:device:${token}`;

/** 手伝う人の端末の印。 */
export type StoredDevice = { helperId: string; deviceSecret: string; name: string };

/**
 * 保存した端末の印を読む。
 * @param token - 受付用リンクのトークン
 * @returns 端末の印（ない・読めないなら null）
 */
export function loadDevice(token: string): StoredDevice | null {
  try {
    const raw = window.localStorage.getItem(keyOf(token));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredDevice>;
    return typeof value.helperId === "string" && typeof value.deviceSecret === "string" && typeof value.name === "string"
      ? { helperId: value.helperId, deviceSecret: value.deviceSecret, name: value.name }
      : null;
  } catch {
    return null;
  }
}

/**
 * 端末の印を保存する（保存できなくても続ける）。
 * @param token - 受付用リンクのトークン
 * @param device - 端末の印
 */
export function saveDevice(token: string, device: StoredDevice): void {
  try {
    window.localStorage.setItem(keyOf(token), JSON.stringify(device));
  } catch {
    // 保存が使えない：開いている間だけ使う
  }
}

/**
 * 端末の印を消す（合わなくなったとき）。
 * @param token - 受付用リンクのトークン
 */
export function forgetDevice(token: string): void {
  try {
    window.localStorage.removeItem(keyOf(token));
  } catch {
    // 保存が使えない
  }
}
