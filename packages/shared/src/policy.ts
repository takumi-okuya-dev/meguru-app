// Threadsの規約への備え（specs/004-review-approval FR-038〜FR-044、research.md R7、contracts/policy-cautions.md）。
// 中身は contracts/policy-cautions.md を正とし、変えるときは文書と同じ変更で直して版の日付を変える。
// この一覧で、Metaによる制限・停止を防げるとは保証しない（画面では「注意」「おそれ」の言葉だけを使う。FR-043）。
import { normalizeForMatch, toOriginalRange } from "./normalize";
import type { PolicyCautionHit } from "./review";

/** 一覧の版（確認したMetaコミュニティ規定の日付）。 */
export const POLICY_LIST_VERSION = "2026-10-04";

/** プロンプトの「■絶対に守るルール(CORE RULES)」の先頭に、この順で入れる規約上のルール（FR-041）。 */
export const POLICY_PROMPT_RULES = [
  "景品・特典・抽選と引き換えに、いいね・フォロー・リポスト・シェア・コメントを求めないこと(Threadsの規約でスパムとして扱われる)",
  "いいね・コメントなどをした人にだけ内容を見せる・送る、という形にしないこと",
  "収益・成果・効果を「必ず」「誰でも」「確実に」のように断定しないこと",
  "病気の治療・予防や、健康・美容の効果をうたわないこと",
  "実在の人物・企業・公的機関になりすまさないこと。事実でない体験・実績・口コミを作らないこと",
  "人種・民族・国籍・宗教・性別・性的指向・障害などの属性を貶めないこと。特定の個人を名指しで攻撃しないこと",
] as const;

/** 「〜」：句点・改行を含まない0〜15文字（同じ文の中の近さで組み合わせる）。 */
const NEAR = "[^。\\n]{0,15}";

/** 「規約に注意」の分類（FR-038）。patterns は正規化した後の文字（小文字・半角）に当てる。 */
export type PolicyCaution = {
  id: string;
  label: string;
  policyName: string;
  policyUrl: string;
  suggestion: string;
  patterns: RegExp[];
};

const re = (...parts: string[]) => new RegExp(parts.join(""), "gu");

/** 「規約に注意」の4つの分類（contracts/policy-cautions.md）。 */
export const POLICY_CAUTIONS: readonly PolicyCaution[] = [
  {
    id: "engagement_reward",
    label: "見返りでの反応集め",
    policyName: "Metaコミュニティ規定「スパム」",
    policyUrl: "https://transparency.meta.com/policies/community-standards/spam/",
    suggestion: "景品や特典と引き換えに反応を求めず、内容そのものへの感想や質問を呼びかけましょう。",
    patterns: [
      re(
        "(いいね|フォロー|リポスト|シェア|コメント|拡散|保存)",
        NEAR,
        "(プレゼント|抽選|当選|当たる|差し上げ|配布|無料で)",
      ),
      re("(プレゼント|抽選|キャンペーン)", NEAR, "(いいね|フォロー|リポスト|シェア|コメント)(して|した|で|と)"),
    ],
  },
  {
    id: "engagement_gating",
    label: "反応しないと見られない形",
    policyName: "Metaコミュニティ規定「スパム」（エンゲージメント・ゲーティング）",
    policyUrl: "https://transparency.meta.com/policies/community-standards/spam/",
    suggestion: "反応を条件にせず、内容は誰でも見られる形で届けましょう。",
    patterns: [
      re(
        "(いいね|コメント|フォロー|リポスト)(したら|した人に|した方に|くれた人に|くれた方に|で)",
        NEAR,
        "(続き|全文|資料|特典|dm|送り|教え|公開)",
      ),
      re("(続き|全文)", NEAR, "(いいね|コメント)(で|したら)"),
    ],
  },
  {
    id: "guaranteed_results",
    label: "収益・成果の断定",
    policyName: "Metaコミュニティ規定「詐欺・欺瞞」（禁止される商慣行）",
    policyUrl: "https://transparency.meta.com/policies/community-standards/fraud-scams/",
    suggestion: "結果を約束せず、自分の経験として「〜だった」「〜という人もいる」と伝えましょう。",
    patterns: [
      re(
        "(必ず|絶対に?|確実に|100%|誰でも|だれでも|簡単に)",
        NEAR,
        "(儲か|稼げ|稼ぐ|稼い|月収|年収|収入|利益|不労所得|痩せ|結果が出)",
      ),
      re("(元本保証|損しない|リスクなし|リスクゼロ)"),
    ],
  },
  {
    id: "health_claims",
    label: "健康・医療の効果",
    policyName: "Metaコミュニティ規定「誤情報」「規制対象商品・サービス」",
    policyUrl: "https://transparency.meta.com/policies/community-standards/misinformation/",
    suggestion: "治療や効果をうたわず、自分が感じたことや習慣として伝えましょう。",
    patterns: [
      re(
        // 「がん」は「がんばる」を除く
        "(病気|症状|がん(?!ば)|癌|糖尿病|うつ|アトピー|花粉症|不眠|高血圧)",
        NEAR,
        "(治る|治った|治せる|完治|消える|消えた|予防できる|効く)",
      ),
      re("(飲むだけで|塗るだけで|食べるだけで|貼るだけで)", NEAR, "(痩せ|治|消え|若返|改善)"),
      re("(薬いらず|医者いらず|副作用なし)"),
    ],
  },
];

/**
 * 本文を「規約に注意」の一覧と照合する（FR-039）。照合の前の正規化はNGワードと同じ（全角／半角・大文字／小文字）。
 * @param body - 下書きの本文
 * @returns 当たった分類と、元の本文での範囲（POLICY_CAUTIONS の順）
 */
export function findPolicyCautions(body: string): PolicyCautionHit[] {
  const { normalized, toOriginal } = normalizeForMatch(body);
  const hits: PolicyCautionHit[] = [];
  for (const { patterns, ...caution } of POLICY_CAUTIONS) {
    const ranges: [number, number][] = [];
    for (const p of patterns) {
      for (const m of normalized.matchAll(p)) {
        if (m[0].length === 0) continue;
        ranges.push(toOriginalRange(toOriginal, m.index, m.index + m[0].length));
      }
    }
    if (ranges.length > 0) hits.push({ ...caution, ranges });
  }
  return hits;
}
