// 人の今の同意の決め方（specs/people/001-people-memo research.md R11）。
// 「日付のいちばん新しい事実で決める」。事実は、その人の回答（日付＝イベントの開催日）と、作り手が手で直したこと（日付＝直した日）。
// 取り込み・取り消し・まとめる・分けるのたびに、APIがこの関数で決め直す（どの操作のあとでも同じ答えになる）。

/** 回答の事実。 */
export type ResponseConsentFact = {
  kind: "response";
  /** イベントの開催日（YYYY-MM-DD） */
  on: string;
  /** 回答の時刻（読めなければ null） */
  submittedAt: Date | null;
  /** 取り込んだ時刻 */
  createdAt: Date;
  invite: boolean;
  work: boolean;
  /** 回答の番号 */
  responseId: string;
};

/** 手直しの事実。 */
export type ManualConsentFact = {
  kind: "manual";
  /** 直した日（日本時間の YYYY-MM-DD） */
  on: string;
  /** 直した時刻 */
  changedAt: Date;
  invite: boolean;
  work: boolean;
};

/** 同意の事実。 */
export type ConsentFact = ResponseConsentFact | ManualConsentFact;

/** 決めた同意。 */
export type ResolvedConsent = {
  invite: boolean;
  work: boolean;
  /** none：事実がない。response：回答から。manual：手直しから */
  source: "none" | "response" | "manual";
  /** もとになった日（事実がなければ null） */
  basisOn: string | null;
  /** もとになった事実（なければ null） */
  fact: ConsentFact | null;
};

/**
 * 2つの事実の新しさを比べる。日付 → 同じ日なら手直しが先 → 回答どうしは回答の時刻（読めないものは古い）→ 取り込んだ時刻、手直しどうしは直した時刻。
 * @param a - 事実
 * @param b - 事実
 * @returns a が新しければ正
 */
function compareFacts(a: ConsentFact, b: ConsentFact): number {
  if (a.on !== b.on) return a.on < b.on ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "manual" ? 1 : -1;
  if (a.kind === "manual" && b.kind === "manual") return a.changedAt.getTime() - b.changedAt.getTime();
  const ra = a as ResponseConsentFact;
  const rb = b as ResponseConsentFact;
  const sa = ra.submittedAt?.getTime() ?? -Infinity;
  const sb = rb.submittedAt?.getTime() ?? -Infinity;
  if (sa !== sb) return sa < sb ? -1 : 1;
  return ra.createdAt.getTime() - rb.createdAt.getTime();
}

/**
 * 事実から、人の今の同意を決める（いちばん新しい事実の値。事実がなければ「なし」）。
 * @param facts - その人の回答と手直しの事実
 * @returns 決めた同意
 */
export function resolveConsent(facts: readonly ConsentFact[]): ResolvedConsent {
  let latest: ConsentFact | null = null;
  for (const f of facts) if (!latest || compareFacts(f, latest) > 0) latest = f;
  if (!latest) return { invite: false, work: false, source: "none", basisOn: null, fact: null };
  return { invite: latest.invite, work: latest.work, source: latest.kind, basisOn: latest.on, fact: latest };
}

/**
 * 時刻を日本時間の日付（YYYY-MM-DD）にする（手直しの事実の日付に使う）。
 * @param at - 時刻
 * @returns 日付
 */
export function jstDate(at: Date): string {
  return new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
