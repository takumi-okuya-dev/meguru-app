// 招待リンクから「アカウントを作る」へ進んだ人を、Threadsにつないだ後にリンクへ戻す（specs/011 contracts/ui-routes.md「招待の確認」、T019。specs/012 research.md R7）。
// このアプリで許可する方法は、APIの callback を通って「このアカウントの設定」へ戻るので、戻り先をこのタブの間だけ覚えておく。
// 覚えられない環境（プライベートブラウズなど）では戻さない（招待リンクをもう一度開けば続きから参加できる）。

const KEY = "tg.inviteReturn";
const INVITE_PATH = /^\/invite\/t_[A-Za-z0-9_-]{43}$/;

/**
 * 戻り先が招待リンクの形かを確かめる。
 * @param path - 戻り先
 * @returns 招待リンクなら true
 */
export function isInvitePath(path: string | null | undefined): path is string {
  return Boolean(path && INVITE_PATH.test(path));
}

/**
 * 追加の後に戻る招待リンクを覚える。
 * @param path - 招待リンクのパス（/invite/t_…）
 */
export function rememberInviteReturn(path: string) {
  if (!isInvitePath(path)) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // 覚えられない環境では何もしない
  }
}

/**
 * 覚えていた招待リンクを取り出して消す。
 * @returns 招待リンクのパス。なければNULL
 */
export function takeInviteReturn(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return isInvitePath(path) ? path : null;
  } catch {
    return null;
  }
}
