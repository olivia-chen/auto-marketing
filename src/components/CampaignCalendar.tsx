'use client';

import { useMemo, useState } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  format,
  parseISO,
  isValid,
  isSameMonth,
  isToday,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Activity } from '@/lib/types';

// ─── Helpers ──────────────────────────────────────────────────────

/** Safe parse of an activity's startDate to a Date (null if unusable). */
function toDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (typeof raw === 'object') {
    const o = raw as { utcDate?: string; localDate?: string };
    raw = o.utcDate || o.localDate || '';
  }
  if (typeof raw !== 'string' || !raw) return null;
  const d = parseISO(raw);
  return isValid(d) ? d : null;
}

const SOURCE_STYLE: Record<string, string> = {
  'wix-event': 'bg-purple-100 text-purple-800 hover:bg-purple-200',
  'wix-booking': 'bg-blue-100 text-blue-800 hover:bg-blue-200',
  manual: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Component ────────────────────────────────────────────────────

export default function CampaignCalendar({
  activities,
  onAddEntry,
  onSelectActivity,
  onExport,
  exporting = false,
}: {
  activities: Activity[];
  onAddEntry?: (dateISO: string) => void;
  onSelectActivity?: (activity: Activity) => void;
  onExport?: () => void;
  exporting?: boolean;
}) {
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  // Day-detail popup (opened via "+N more" or clicking a day)
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);

  // Bucket activities by yyyy-MM-dd
  const byDay = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const a of activities) {
      const d = toDate(a.startDate);
      if (!d) continue;
      const key = format(d, 'yyyy-MM-dd');
      const arr = map.get(key);
      if (arr) arr.push(a);
      else map.set(key, [a]);
    }
    // sort each day's entries by time
    for (const arr of map.values()) {
      arr.sort((x, y) => {
        const dx = toDate(x.startDate)?.getTime() ?? 0;
        const dy = toDate(y.startDate)?.getTime() ?? 0;
        return dx - dy;
      });
    }
    return map;
  }, [activities]);

  const weeks = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(viewDate), { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [viewDate]);

  const monthEntryCount = useMemo(() => {
    let n = 0;
    for (const [key, arr] of byDay) {
      const d = parseISO(key);
      if (isSameMonth(d, viewDate)) n += arr.length;
    }
    return n;
  }, [byDay, viewDate]);

  function timeLabel(a: Activity): string {
    const d = toDate(a.startDate);
    if (!d) return '';
    // Hide midnight (manual entries with no real time often land at 00:00)
    if (d.getHours() === 0 && d.getMinutes() === 0) return '';
    return format(d, 'h:mma').toLowerCase();
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-slate-200/60">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setViewDate((d) => subMonths(d, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-base sm:text-lg font-semibold text-slate-800 min-w-[9rem] text-center">
            {format(viewDate, 'MMMM yyyy')}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setViewDate((d) => addMonths(d, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs ml-1"
            onClick={() => setViewDate(startOfMonth(new Date()))}
          >
            Today
          </Button>
          <span className="text-xs text-slate-400 ml-1 hidden sm:inline">
            {monthEntryCount} this month
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onAddEntry && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs border-teal-200 text-teal-700 hover:bg-teal-50"
              onClick={() => onAddEntry(format(new Date(), 'yyyy-MM-dd'))}
            >
              <Plus className="h-4 w-4" /> Add entry
            </Button>
          )}
          {onExport && (
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-teal-600 hover:bg-teal-700 text-xs"
              onClick={onExport}
              disabled={exporting}
              title="Export the whole year to the Calendar Export Google Sheet"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export year
            </Button>
          )}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 overflow-hidden">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="px-2 py-2 text-[11px] font-semibold text-slate-500 text-center"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Weeks */}
        <div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7">
              {week.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const entries = byDay.get(key) || [];
                const inMonth = isSameMonth(day, viewDate);
                const today = isToday(day);
                return (
                  <div
                    key={key}
                    className={`group min-h-[90px] sm:min-h-[110px] border-b border-r border-slate-100 p-1.5 flex flex-col gap-1 ${
                      inMonth ? 'bg-white' : 'bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center">
                      <span
                        className={`text-[11px] font-medium h-5 w-5 flex items-center justify-center rounded-full ${
                          today
                            ? 'bg-teal-600 text-white'
                            : inMonth
                            ? 'text-slate-600'
                            : 'text-slate-300'
                        }`}
                      >
                        {format(day, 'd')}
                      </span>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      {entries.slice(0, 4).map((a) => {
                        const t = timeLabel(a);
                        const style = SOURCE_STYLE[a.source] || SOURCE_STYLE.manual;
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => onSelectActivity?.(a)}
                            className={`text-left text-[10px] leading-tight rounded px-1 py-0.5 truncate block w-full ${style} ${
                              onSelectActivity ? 'cursor-pointer' : ''
                            }`}
                            title={a.title}
                          >
                            {t && <span className="font-semibold mr-0.5">{t}</span>}
                            {a.title}
                          </button>
                        );
                      })}
                      {entries.length > 4 && (
                        <button
                          type="button"
                          onClick={() => setOpenDayKey(key)}
                          className="text-[10px] text-teal-600 hover:text-teal-800 hover:underline font-medium px-1 text-left"
                        >
                          +{entries.length - 4} more
                        </button>
                      )}
                    </div>

                    {/* Add-entry button pinned to the bottom of the day card */}
                    {onAddEntry && (
                      <button
                        type="button"
                        onClick={() => onAddEntry(key)}
                        className="mt-auto self-center w-full flex items-center justify-center gap-1 rounded-md py-1 text-[10px] font-medium border border-dashed border-teal-300 text-teal-600 bg-teal-50/70 hover:bg-teal-600 hover:text-white hover:border-teal-600 transition-colors"
                        title="Add entry on this day"
                      >
                        <Plus className="h-3 w-3" />
                        <span className="hidden sm:inline">Add</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-purple-200" /> Wix Event
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-blue-200" /> Wix Booking
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-200" /> Manual entry
        </span>
      </div>

      {/* Day-detail popup (all entries for a day) */}
      <Dialog open={!!openDayKey} onOpenChange={(open) => !open && setOpenDayKey(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {openDayKey ? format(parseISO(openDayKey), 'EEEE, MMMM d, yyyy') : ''}
            </DialogTitle>
            <DialogDescription>
              {openDayKey ? `${(byDay.get(openDayKey) || []).length} scheduled` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 max-h-[55vh] overflow-y-auto py-1">
            {openDayKey &&
              (byDay.get(openDayKey) || []).map((a) => {
                const t = timeLabel(a);
                const style = SOURCE_STYLE[a.source] || SOURCE_STYLE.manual;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setOpenDayKey(null);
                      onSelectActivity?.(a);
                    }}
                    className={`w-full text-left rounded-lg px-3 py-2 text-xs transition-colors ${style} hover:brightness-95`}
                  >
                    <div className="font-medium">
                      {t && <span className="mr-1 font-semibold">{t}</span>}
                      {a.title}
                    </div>
                    {(a.classroom || a.staff) && (
                      <div className="mt-0.5 opacity-80">
                        {[a.classroom, a.staff].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </button>
                );
              })}
          </div>
          {onAddEntry && openDayKey && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 border-teal-200 text-teal-700 hover:bg-teal-50"
              onClick={() => {
                const key = openDayKey;
                setOpenDayKey(null);
                onAddEntry(key);
              }}
            >
              <Plus className="h-4 w-4" /> Add entry on this day
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
