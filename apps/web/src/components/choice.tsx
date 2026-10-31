import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** A select over a fixed set of string options, labelled by `items`. */
export function Choice<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  readonly items: Readonly<Record<T, string>>;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly className?: string;
}) {
  const isItem = (next: string | null): next is T => next !== null && next in items;

  return (
    <Select items={items} value={value} onValueChange={(next) => isItem(next) && onChange(next)}>
      <SelectTrigger aria-label={label} className={cn("w-full", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries<string>(items).map(([key, text]) => (
          <SelectItem key={key} value={key}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
