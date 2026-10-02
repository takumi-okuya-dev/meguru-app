import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/lib/theme";

export function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return <Sonner theme={resolved} position="top-center" richColors {...props} />;
}
