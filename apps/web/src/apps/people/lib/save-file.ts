// 受け取ったファイルを保存する（ブラウザのダウンロード）。書き出したCSVは、保存のあとすぐに画面から捨てる（FR-111・FR-112）。

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
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
