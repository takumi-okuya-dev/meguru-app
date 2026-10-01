// 削除の確認入力の比較に使う正規化（contracts/api.md の DELETE）。
// Webのボタンの有効・無効とAPIの検証の両方で、この関数だけを使う。
export function normalizeUsername(value: string): string {
  const trimmed = value.trim();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return withoutAt.toLowerCase();
}
