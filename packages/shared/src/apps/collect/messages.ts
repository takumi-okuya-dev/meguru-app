// 振込待ちの人への連絡文（specs/collect/001-event-day-collection FR-052、tasks.md T064）。アプリからは送らず、主催者がコピーして送る。
/** 連絡文の材料。 */
export type TransferMessageInput = {
  name: string;
  eventName: string;
  amount: number;
  number: number;
  kana: string | null;
  bankText: string | null;
};

/**
 * 名義の例（ふりがながあればカタカナにして空白を除く。なければ「ヤマダタロウ」）。
 * @param kana - ふりがな
 * @returns 名義の例
 */
function holderExample(kana: string | null): string {
  if (!kana) return "ヤマダタロウ";
  return kana
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/\s+/gu, "");
}

/**
 * 振込待ちの人への連絡文を作る。
 * @param input - 名前・イベント名・金額・受付番号・ふりがな・振込先の案内
 * @returns 連絡文
 */
export function buildTransferMessage(input: TransferMessageInput): string {
  const lines = [
    `${input.name}さん`,
    "",
    `先日は「${input.eventName}」にお越しいただき、ありがとうございました。`,
    `参加費${input.amount.toLocaleString("ja-JP")}円のお振込みを、まだ確認できていません。お手数ですが、次の振込先へお願いします。`,
    "",
    `振込の名義の前に受付番号「${input.number}」を付けてください（例：${input.number}${holderExample(input.kana)}）。`,
    "",
    input.bankText ? `【振込先】\n${input.bankText}` : "振込先は主催者にお問い合わせください。",
    "",
    "行き違いでお振込み済みでしたら、ご容赦ください。",
  ];
  return lines.join("\n");
}
