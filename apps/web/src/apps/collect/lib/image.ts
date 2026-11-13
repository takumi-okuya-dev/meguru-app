// PayPayのQRの画像を、送る前に画面で縮める（specs/collect/001-event-day-collection research.md R10）。
// 長い辺を1,000px以内にし、300KBを超えるときは JPEG の質を下げて収める。QRが読めるよう、縮めすぎない。
import { COLLECT_LIMITS } from "@meguru/shared";

/** 長い辺の上限（px）。 */
export const QR_MAX_SIDE = 1000;

/**
 * 縮めたときの大きさ（長い辺を上限に収め、縦横の比は変えない）。
 * @param width - 元の幅
 * @param height - 元の高さ
 * @param max - 長い辺の上限
 * @returns 幅と高さ
 */
export function fitSize(width: number, height: number, max = QR_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * 画像のファイルを読む。
 * @param file - 画像のファイル
 * @returns 画像
 */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読めませんでした"));
    };
    img.src = url;
  });
}

/**
 * キャンバスを画像のファイルにする。
 * @param canvas - キャンバス
 * @param type - 形式
 * @param quality - JPEG の質
 * @returns 画像のファイル
 */
function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を作れませんでした"))), type, quality));
}

/**
 * QRの画像を、送れる形（PNGかJPEG・長い辺1,000px以内・300KB以内）に縮める。
 * @param file - 選んだ画像
 * @returns 送る画像
 * @throws Error 読めない・どうしても300KBに収まらない
 */
export async function shrinkQrImage(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const size = fitSize(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を作れませんでした");
  // 透明なところを白にする（JPEGにしたときに黒くならないように）
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(img, 0, 0, size.width, size.height);
  const png = await toBlob(canvas, "image/png");
  if (png.size <= COLLECT_LIMITS.paypayQrBytes) return png;
  for (const quality of [0.9, 0.8, 0.7, 0.6]) {
    const jpeg = await toBlob(canvas, "image/jpeg", quality);
    if (jpeg.size <= COLLECT_LIMITS.paypayQrBytes) return jpeg;
  }
  throw new Error("画像が大きすぎます");
}
