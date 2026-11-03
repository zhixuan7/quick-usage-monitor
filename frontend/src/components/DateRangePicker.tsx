'use client';

/**
 * Absolute date-range picker used on every data page: a calendar popover with
 * "Last 7 / 30 / 90 days" presets alongside free day-range selection.
 * Ranges are day-granular, limited to the log retention window, and never
 * extend into the future.
 */
import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { subDays, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DayRange, lastNDays, formatDayRange, matchPreset } from '@/lib/timerange';
import { cn } from '@/lib/utils';

const PRESETS = [7, 30, 90];
const MAX_LOOKBACK_DAYS = 90;

export default function DateRangePicker({
  value,
  onChange,
}: {
  value: DayRange;
  onChange: (range: DayRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);

  const preset = matchPreset(value, PRESETS);
  const label = preset ? `Last ${preset} days` : formatDayRange(value);
  const today = new Date();

  function apply(range: DayRange) {
    onChange(range);
    setDraft(undefined);
    setOpen(false);
  }

  function handleSelect(next: DateRange | undefined) {
    setDraft(next);
    if (next?.from && next?.to && next.from.getTime() !== next.to.getTime()) {
      apply({ from: next.from, to: next.to });
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setDraft(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-start bg-white font-normal shadow-card">
          <CalendarIcon className="mr-2 h-4 w-4 text-quick-600" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex">
          <div className="flex flex-col gap-1 border-r p-3">
            <span className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Presets
            </span>
            {PRESETS.map((n) => (
              <Button
                key={n}
                variant="ghost"
                size="sm"
                className={cn(
                  'justify-start font-normal',
                  preset === n && !draft && 'bg-quick-100 font-medium text-quick-800 hover:bg-quick-100',
                )}
                onClick={() => apply(lastNDays(n))}
              >
                Last {n} days
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={subDays(today, 30)}
            selected={draft ?? { from: value.from, to: value.to }}
            onSelect={handleSelect}
            disabled={{
              after: today,
              before: startOfDay(subDays(today, MAX_LOOKBACK_DAYS)),
            }}
          />
        </div>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Pick a preset or select a start and end day (up to {MAX_LOOKBACK_DAYS} days back).
        </p>
      </PopoverContent>
    </Popover>
  );
}
