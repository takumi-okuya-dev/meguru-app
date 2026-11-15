// 受け取ったファイルを保存する（ブラウザのダウンロード）。どのアプリの書き出しもこれを使う。
// 保存の URL は、保存が始まってから少し待って捨てる（すぐ捨てると、ブラウザによっては保存が始まる前に消える）。

/** 保存の URL を捨てるまで待つ時間（ミリ秒）。 */
export const REVOKE_DELAY_MS = 10_000;

/**
 * ファイルを保存する（a[download] を押したことにする）。
 * @param blob - ファイルの中身
 * @param filename - ファイル名
 */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  // ダウンロードが始まってから捨てる
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
