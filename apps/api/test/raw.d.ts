// Vite の ?raw（ファイルの中身を文字列として読み込む）。wrangler.toml の検査で使う（specs/015 T004）
declare module "*?raw" {
  const content: string;
  export default content;
}
