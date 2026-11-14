// 人のページの同意の段：目的ごとの同意（直す）と、同意の記録（いつ・どちらの目的・回答から／手で直した）。
// specs/people/001-people-memo contracts/api.md 4、research.md R11。直すと「手で直した」記録になり、APIが同意を決め直す。
import type { Consent, PersonConsent, PersonConsentChange } from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { peopleApi } from "../../lib/api";
import { refreshPersons } from "../../lib/refresh";
import { formatHeldOn } from "../format";
import { CONSENT_KEYS, CONSENT_LABELS } from "./labels";

/**
 * 今の同意のもとの文。
 * @param consent - 今の同意
 * @returns 文
 */
function sourceLabel(consent: PersonConsent): string {
  if (consent.source === "none" || consent.basisOn === null) return "記録がないので、同意なしとして扱います。";
  return consent.source === "response"
    ? `${formatHeldOn(consent.basisOn)}の会の回答から決めています。`
    : `${formatHeldOn(consent.basisOn)}に手で直した同意です。`;
}

/**
 * 同意の記録の1行の文（どちらの目的に同意したか）。
 * @param c - 同意
 * @returns 文
 */
function consentText(c: Consent): string {
  return CONSENT_KEYS.map((k) => `${CONSENT_LABELS[k]}：${c[k] ? "同意" : "同意なし"}`).join("・");
}

/**
 * 同意の段。
 * @param props - personId：人、consent：今の同意、changes：同意の記録（新しい順）
 * @returns 同意の段
 */
export function PersonConsentSection({ personId, consent, changes }: { personId: string; consent: PersonConsent; changes: PersonConsentChange[] }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (next: Consent) => peopleApi.updateConsent(personId, next),
    onSuccess: async (result, next) => {
      // あとの日付の回答があると、手で直しても回答の同意のまま（R11）
      setNotice(result.invite !== next.invite || result.work !== next.work ? "あとの日付の回答があるため、回答の同意が使われています。" : null);
      await refreshPersons(queryClient);
    },
  });
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-sm font-medium text-muted-foreground">
        個別の案内の同意
      </h2>
      <div className="divide-y rounded-2xl border bg-card">
        {CONSENT_KEYS.map((k) => (
          <div key={k} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <label htmlFor={`${id}-${k}`} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center text-sm">
              {CONSENT_LABELS[k]}
            </label>
            <Switch
              id={`${id}-${k}`}
              checked={consent[k]}
              disabled={save.isPending}
              onCheckedChange={(checked) => save.mutate({ invite: consent.invite, work: consent.work, [k]: checked })}
            />
          </div>
        ))}
      </div>
      <p className="text-[13px] text-muted-foreground">{sourceLabel(consent)}</p>
      {notice && <p className="text-[13px] text-muted-foreground">{notice}</p>}
      {save.isError && (
        <p role="alert" className="text-[13px] text-destructive">
          {describeError(save.error)}
        </p>
      )}
      {changes.length > 0 && (
        <details className="rounded-2xl border bg-card px-4 py-2 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center">同意の記録（{changes.length}件）</summary>
          <ul className="space-y-2 pb-2">
            {changes.map((c, i) => (
              <li key={`${c.changedAt}-${i}`} className="space-y-0.5">
                <div className="text-muted-foreground">
                  {formatDateTime(c.changedAt)}・{c.source === "response" ? `回答（${formatHeldOn(c.basisOn)}の会）` : "手で直した"}
                </div>
                <div>{consentText(c)}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
