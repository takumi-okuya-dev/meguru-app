/**
 * 削除の確認入力の比較に使う正規化（contracts/api.md の DELETE）。
 * 前後の空白を除き、先頭の @ を1つだけ除き、小文字にする。
 * Webのボタンの有効・無効とAPIの検証の両方で、この関数だけを使う。
 * @param value - ユーザー名（@付きでもよい）
 * @returns 正規化したユーザー名
 */
export function normalizeUsername(value: string): string {
  const trimmed = value.trim();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return withoutAt.toLowerCase();
}
