import { Loading03Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

const sizes = { xs: 12, sm: 16, md: 20, lg: 24 };

export function Spinner({
  size = "md",
  className,
}: {
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  return <Icon icon={Loading03Icon} size={sizes[size]} strokeWidth={2} className={cn("animate-spin", className)} />;
}
