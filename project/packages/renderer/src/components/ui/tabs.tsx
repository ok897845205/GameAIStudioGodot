import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type TabItem = {
  value: string;
  label: ReactNode;
  accent?: string;
};

export function Tabs({
  value,
  onValueChange,
  tabs,
  className,
  size = "default",
}: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: TabItem[];
  className?: string;
  size?: "default" | "sm";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-lg bg-muted p-1",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            onClick={() => onValueChange(tab.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            style={
              active && tab.accent
                ? { color: tab.accent }
                : undefined
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
