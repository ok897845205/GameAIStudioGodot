import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        default: "bg-secondary text-secondary-foreground",
        muted: "bg-muted text-muted-foreground",
        success: "bg-success/15 text-success",
        warning: "bg-warning/20 text-warning-foreground",
        danger: "bg-danger/15 text-danger",
        info: "bg-info/15 text-info",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
