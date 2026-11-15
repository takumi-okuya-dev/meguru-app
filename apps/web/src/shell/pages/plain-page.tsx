// 骨格を使わない読みもののページの入れ物（specs/015 contracts/ui-routes.md 1）。環境の帯を画面の一番上に出す
import { Outlet } from "react-router";
import { EnvBanner } from "../layout/EnvBanner";

/**
 * 骨格を使わない読みもののページの入れ物。環境の帯を画面の一番上に出す。
 * @returns 帯と、中の画面
 */
export function PlainPage() {
  return (
    <>
      <EnvBanner />
      <Outlet />
    </>
  );
}
