// 使えない機能の画面（specs/019-feature-switches contracts/ui-routes.md 3、FR-006）
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FeatureUnavailable } from "@/apps/threads/components/FeatureUnavailable";
import { ApiError } from "@/lib/api-client";
import { isFeatureDisabled } from "@/lib/save-error";

describe("FeatureUnavailable", () => {
  it("見出しとホームへのリンクだけを出し、理由や料金は出さない", () => {
    render(
      <MemoryRouter>
        <FeatureUnavailable accountId="acc-1" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "この機能は今は使えません" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ホームへ" })).toHaveAttribute("href", "/accounts/acc-1");
    expect(screen.queryByText(/料金|プラン|契約/)).toBeNull();
  });

  it("isFeatureDisabled は FEATURE_DISABLED だけを見分ける", () => {
    expect(isFeatureDisabled(new ApiError("FEATURE_DISABLED", 403, ["strategy"]))).toBe(true);
    expect(isFeatureDisabled(new ApiError("BILLING_REQUIRED", 403, ["trial_ended"]))).toBe(false);
  });
});
