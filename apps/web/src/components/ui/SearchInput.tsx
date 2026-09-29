import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = "Search...", className }: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Icon
        icon={Search01Icon}
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-tertiary"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-9 pr-8"
      />
      {value && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-text-secondary transition-colors hover:text-text-primary"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <Icon icon={Cancel01Icon} size={12} />
        </button>
      )}
    </div>
  );
}
