// 参考投稿の印：媒体・鮮度・解説の有無（specs/014-strategy-guidance US7-8、FR-082・FR-098）。
import { FRESHNESS_LEVELS, REFERENCE_PLATFORMS, type Freshness, type ReferencePlatform } from "@meguru/shared";
import { cn } from "@/lib/utils";

/**
 * 媒体・鮮度・解説の有無の印。
 * @param props - platform：媒体、freshness：鮮度、explained：解説があるか
 * @returns 印の並び
 */
export function ReferenceBadges({
  platform,
  freshness,
  explained,
}: {
  platform: ReferencePlatform;
  freshness: Freshness;
  explained: boolean;
}) {
  const platformLabel = REFERENCE_PLATFORMS.find((p) => p.value === platform)?.label ?? platform;
  const freshnessLabel = FRESHNESS_LEVELS.find((f) => f.value === freshness)?.label ?? freshness;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <span className="rounded-full border px-2 text-[11px]">{platformLabel}</span>
      <span
        className={cn(
          "rounded-full px-2 text-[11px]",
          freshness === "latest" && "bg-warning-bg text-warning",
          freshness === "active" && "bg-success-bg text-success",
          (freshness === "archive" || freshness === "unknown") && "bg-muted text-muted-foreground",
        )}
      >
        {freshnessLabel}
      </span>
      <span className="rounded-full border px-2 text-[11px]">{explained ? "解説あり" : "解説なし"}</span>
    </span>
  );
}
