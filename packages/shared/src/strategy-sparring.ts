// AIと壁打ちして課題を埋める（specs/018-strategy-ai-sparring research.md R2〜R4、data-model.md）。
// 対象の項目・範囲の絞り込み・AIの答えの読み取り・反映の候補を、画面から切り離した純粋な関数で持つ。
// プロンプトの文は strategy-prompts.ts の buildSparringPrompt。アプリはAIを呼ばない（Constitution原則III）。
import { STRATEGY_TEXT_MAX } from "./limits";
import { strategyFieldOf as fieldOf, type StrategySectionId, type StrategyTextKey, type StrategyValues } from "./strategy";
import { checkStrategy, type StrategyCheck } from "./strategy-guidance";
import { countChars, isBlank } from "./text";

/** 壁打ちで扱う項目（表示の順）。テキストの15項目・目的の5問・活動の軸。近い人間性と下書きの4項目は入れない（Clarifications 2026-11-02）。 */
export const SPARRING_KEYS = [
  "purposeOrigin",
  "purposeSelf",
  "purposeOthers",
  "purposeFuture",
  "purposeStance",
  "activityAxis",
  "finalAction",
  "targetPersona",
  "realWorries",
  "desiredSelfImage",
  "perceivedImage",
  "contentThemeMix",
  "antiPersona",
  "benchmarkAccounts",
  "funnelDesign",
  "postGenres",
  "dmReplyTemplate",
  "inquiryQualityTips",
  "toneNotes",
  "differentiation",
  "successMetrics",
] as const satisfies readonly StrategyTextKey[];

/** 壁打ちで扱う項目のキー。 */
export type SparringKey = (typeof SPARRING_KEYS)[number];

/** 範囲で選べる区分（下書きは入れない）。 */
export const SPARRING_SECTION_IDS = ["purpose", "sales", "account", "funnel", "tone", "other"] as const satisfies readonly StrategySectionId[];

/** 範囲で選べる区分の ID。 */
export type SparringSectionId = (typeof SPARRING_SECTION_IDS)[number];

/** 項目ごとの完成版の始まりの目印の前半。Markdown の見出し・区切り線にならない文字にする（research.md R2）。 */
export const SPARRING_ITEM_BEGIN_PREFIX = "【項目：";
/** 項目ごとの完成版の終わりの目印。 */
export const SPARRING_ITEM_END = "【項目ここまで】";

/**
 * 項目ごとの完成版の始まりの目印の行。
 * @param label - 項目の名前
 * @returns 目印の行
 */
export function sparringBeginLine(label: string): string {
  return `${SPARRING_ITEM_BEGIN_PREFIX}${label}】`;
}

/**
 * 質問の対象を求める（FR-004）。
 * @param values - 課題の今の値（未保存を含む）
 * @param range - sections：選んだ区分、onlyIncomplete：未入力と短めの項目だけにするか
 * @param check - 求め済みの自動チェック（画面がすでに求めていれば渡す。省略すると求める）
 * @returns 質問の対象のキー（表示の順）
 */
export function selectSparringTargets(
  values: StrategyValues,
  range: { sections: readonly SparringSectionId[]; onlyIncomplete: boolean },
  check: StrategyCheck = checkStrategy(values),
): SparringKey[] {
  return SPARRING_KEYS.filter((key) => {
    if (!(range.sections as readonly string[]).includes(fieldOf(key).section)) return false;
    if (!range.onlyIncomplete) return true;
    // 活動の軸は自動チェックがないので、空のときだけ残す
    if (key === "activityAxis") return isBlank(values.activityAxis);
    return check.items[key].status !== "ok";
  });
}

/** 読み取れた項目ごとの完成版。 */
export type SparringItem = { key: SparringKey; text: string };

/** 答えの読み取りの結果（data-model.md）。 */
export type SparringParseResult = {
  /** 読み取れた項目ごとの完成版（表示の順） */
  items: SparringItem[];
  /** 対象の項目に引き当てられなかった名前（重ねない。出てきた順） */
  unknown: string[];
  /** 始まりの目印が1つでもあったか */
  markerFound: boolean;
};

/**
 * 名前を比べる形にそろえる：NFKC・小文字にし、空白・括弧・句読点・コロン・疑問符を除く（research.md R3）。
 * @param name - 項目の名前
 * @returns そろえた名前
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s「」『』()（）"'“”‘’、。，．,.:：?？]/g, "");
}

/** 項目の名前（と、括弧の中を省いた名前）から、対象の項目のキーを引く表。 */
const KEY_BY_NAME: ReadonlyMap<string, SparringKey> = (() => {
  const map = new Map<string, SparringKey>();
  for (const key of SPARRING_KEYS) {
    const label = fieldOf(key).label;
    map.set(normalizeName(label), key);
    map.set(normalizeName(label.replace(/（[^）]*）|\([^)]*\)/g, "")), key);
  }
  return map;
})();

const PURPOSE_BY_NUMBER: Record<string, SparringKey> = {
  q1: "purposeOrigin",
  q2: "purposeSelf",
  q3: "purposeOthers",
  q4: "purposeFuture",
  q5: "purposeStance",
};

/**
 * 項目の名前を、対象の項目のキーに引き当てる。目的の5問は「Q1」〜「Q5」で始まる名前も受ける。
 * @param name - 目印の中の名前
 * @returns キー。引き当てられなければ null
 */
function keyOfName(name: string): SparringKey | null {
  const n = normalizeName(name);
  const exact = KEY_BY_NAME.get(n);
  if (exact) return exact;
  const q = /^q([1-5])(?!\d)/.exec(n);
  return q ? (PURPOSE_BY_NUMBER[`q${q[1]}`] ?? null) : null;
}

/**
 * 行を囲む装飾（リストの印・太字・コード・見出し・引用）を除く。
 * @param line - 答えの1行
 * @returns 装飾を除いた行
 */
function stripDecoration(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*+・]|\d+[.)．])(?:\s+|$)/, "")
    .replace(/^[#>*_`\s]+/, "")
    .replace(/[*_`\s]+$/, "");
}

const BEGIN_RE = /^【\s*項目\s*[：:]\s*(.*?)\s*】$/;
const END_RE = /^【\s*項目\s*ここまで\s*】$/;
const FENCE_RE = /^\s*```/;
/** 目印を、同じ行の文から切り離すための形（AIが目印と文を1行に書いたとき・改行が詰まって貼られたとき）。 */
const MARKER_SPLIT_RE = /(【\s*項目\s*(?:[：:][^】\n]*|ここまで\s*)】)/g;
/** プロンプトの「完成版の形」の見本の中身。AIが形をそのまま書き写したときは、案として扱わない。 */
const PLACEHOLDER = "(完成版)";

/**
 * 貼り付けたAIの答えから、項目ごとの完成版を読み取る（FR-010〜FR-014、research.md R3）。
 * @param text - 貼り付けたAIの答え
 * @returns 読み取れた項目・読み取れなかった名前・目印があったか
 */
export function parseSparringAnswer(text: string): SparringParseResult {
  const found = new Map<SparringKey, string>();
  const unknown: string[] = [];
  let markerFound = false;
  let current: { name: string; lines: string[] } | null = null;

  const finish = () => {
    if (!current) return;
    const body = current.lines.join("\n").trim();
    const key = keyOfName(current.name);
    if (key === null) {
      if (current.name !== "" && !unknown.includes(current.name)) unknown.push(current.name);
    } else if (body !== "" && body.normalize("NFKC") !== PLACEHOLDER) {
      // 同じ項目が2回以上あれば、後のもの（会話の中で直した版が後に出るため。FR-011）
      found.set(key, body);
    }
    current = null;
  };

  const lines = text.replace(MARKER_SPLIT_RE, "\n$1\n").split(/\r?\n/);
  for (const raw of lines) {
    const line = stripDecoration(raw);
    const begin = BEGIN_RE.exec(line);
    if (begin) {
      finish();
      markerFound = true;
      current = { name: (begin[1] ?? "").trim(), lines: [] };
      continue;
    }
    if (END_RE.test(line)) {
      finish();
      continue;
    }
    // 目印を切り離したあとに残る、装飾だけの行（「**」「1.」、コードブロックの「```」など）は中身に入れない
    if (current && (raw.trim() === "" || (line !== "" && !FENCE_RE.test(raw)))) current.lines.push(raw.trim() === "" ? "" : raw);
  }
  finish();

  const items = SPARRING_KEYS.flatMap((key) => {
    const body = found.get(key);
    return body === undefined ? [] : [{ key, text: body }];
  });
  return { items, unknown, markerFound };
}

/** 反映の候補（data-model.md）。 */
export type SparringCandidate = {
  key: SparringKey;
  label: string;
  /** 今の入力（画面の今の値） */
  current: string;
  /** 新しい案 */
  proposed: string;
  /** はじめの選択 */
  selected: boolean;
  /** 新しい案が今の入力と同じ */
  same: boolean;
  /** 新しい案が文字数の上限を超える */
  over: boolean;
};

/**
 * 読み取れた完成版から、反映の候補を作る（FR-015〜FR-018）。
 * @param items - 読み取れた項目ごとの完成版
 * @param values - 課題の今の値（未保存を含む）
 * @returns 表示の順の候補
 */
export function buildSparringCandidates(items: readonly SparringItem[], values: StrategyValues): SparringCandidate[] {
  const byKey = new Map(items.map((i) => [i.key, i.text]));
  return SPARRING_KEYS.flatMap((key) => {
    const proposed = byKey.get(key);
    if (proposed === undefined) return [];
    const current = values[key];
    const same = current.trim() === proposed.trim();
    return [
      {
        key,
        label: fieldOf(key).label,
        current,
        proposed,
        // 空の項目だけをはじめから選ぶ。書いてある項目は本人が見比べて選ぶ（Clarifications 2026-11-02）
        selected: isBlank(current) && !same,
        same,
        over: countChars(proposed) > STRATEGY_TEXT_MAX,
      },
    ];
  });
}
