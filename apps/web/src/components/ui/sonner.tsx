import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/lib/theme";

/**
 * 767px以下での通知の位置（specs/008 FR-070、research.md R13、docs/ui-design.md §11）。
 * ヘッダー（52px）と端末のセーフエリアの下に出し、メニュー・画面名・主な操作を隠さない。左右は16pxあける。
 */
const MOBILE_OFFSET = { top: "calc(env(safe-area-inset-top) + 60px)", left: "16px", right: "16px" };

/**
 * 通知（トースト）の置き場所。768px以上は上部中央のまま。
 * @param props - sonner の Toaster の設定（上書き用）
 * @returns 通知の置き場所
 */
export function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return <Sonner theme={resolved} position="top-center" mobileOffset={MOBILE_OFFSET} richColors {...props} />;
}
