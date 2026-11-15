// 紹介した人の入力欄（specs/collect/003-revenue-sharing FR-020）。前に使った名前を候補に出す（ブラウザの datalist）。
import { COLLECT_LIMITS } from "@meguru/shared";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { collectApi } from "../../lib/api";
import { collectQueryKeys } from "../../lib/query-keys";

/**
 * 紹介した人の入力欄。
 * @param props - value：値、onChange：変えたとき
 * @returns 入力欄
 */
export function ReferrerInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const listId = useId();
  const suggestions = useQuery({ queryKey: collectQueryKeys.referrers, queryFn: collectApi.referrers, staleTime: 60_000 });
  return (
    <>
      <Input
        aria-label="紹介した人"
        placeholder="紹介した人（任意）"
        list={listId}
        value={value}
        maxLength={COLLECT_LIMITS.referrer}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {(suggestions.data?.names ?? []).map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}
