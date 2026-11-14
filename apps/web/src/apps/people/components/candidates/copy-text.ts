// 文をクリップボードに書く（specs/people/001-people-memo research.md R17）。使えないとき（古いブラウザ・許可なし）は false を返し、画面が文を選んだ欄を出す。

/**
 * 文をクリップボードに書く。
 * @param text - 書く文
 * @returns 書けたら true。クリップボードがない・断られたら false
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = (navigator as Partial<Navigator>).clipboard;
  if (typeof clipboard?.writeText !== "function") return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
