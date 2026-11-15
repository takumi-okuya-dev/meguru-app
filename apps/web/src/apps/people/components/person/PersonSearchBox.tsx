// 人を探す欄（名前・LINE名・メモ。specs/people/001-people-memo research.md R22）。入れた言葉は画面の中にだけ置く（R18）。
import { SEARCH_QUERY_MAX } from "@meguru/shared/people";
import { SearchIcon, XIcon } from "lucide-react";
import { useId } from "react";

/**
 * 人を探す欄。
 * @param props - value：入れた言葉、onChange：変わったとき、label：読み上げの名前、placeholder：空の欄の中の文字、autoFocus：開いたら入れられるようにする
 * @returns 探す欄
 */
export function PersonSearchBox({
  value,
  onChange,
  label = "人を探す",
  placeholder = "名前・LINE名・メモで探す",
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        id={id}
        type="search"
        autoComplete="off"
        autoFocus={autoFocus}
        className="h-11 w-full rounded-xl border border-input bg-card pr-11 pl-9 text-base md:h-10 md:text-[15px] [&::-webkit-search-cancel-button]:hidden"
        value={value}
        maxLength={SEARCH_QUERY_MAX}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== "" && (
        <button
          type="button"
          className="absolute top-0 right-0 flex size-11 items-center justify-center text-muted-foreground md:size-10"
          aria-label="探す言葉を消す"
          onClick={() => onChange("")}
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
