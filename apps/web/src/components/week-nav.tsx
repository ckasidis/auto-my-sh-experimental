import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDays, formatDateRange, startOfWeek, today } from "@/lib/dates";

/** Steps a Monday-to-Sunday week back and forth, with a way back to this week. */
export function WeekNav({
  monday,
  onChange,
}: {
  readonly monday: string;
  readonly onChange: (monday: string) => void;
}) {
  const thisWeek = startOfWeek(today());

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChange(addDays(monday, -7))}
        aria-label="Previous week"
      >
        <ChevronLeftIcon />
      </Button>
      <p className="flex-1 text-center text-sm font-medium">
        {formatDateRange(monday, addDays(monday, 6))}
      </p>
      {monday !== thisWeek && (
        <Button variant="outline" size="sm" onClick={() => onChange(thisWeek)}>
          This week
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChange(addDays(monday, 7))}
        aria-label="Next week"
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}
