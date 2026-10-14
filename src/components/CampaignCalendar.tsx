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
  CalendarDays,
  Download,
  Loader2,
  ExternalLink,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  onExport,
  exporting = false,
}: {
  activities: Activity[];
  onAddEntry?: (dateISO: string) => void;
  onExport?: () => void;
  exporting?: boolean;
}) {
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));

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
                    className={`min-h-[90px] sm:min-h-[110px] border-b border-r border-slate-100 p-1.5 flex flex-col gap-1 ${
                      inMonth ? 'bg-white' : 'bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
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
                      {onAddEntry && inMonth && (
                        <button
                          onClick={() => onAddEntry(key)}
                          className="opacity-0 hover:opacity-100 focus:opacity-100 text-slate-300 hover:text-teal-600 transition-opacity"
                          title="Add entry on this day"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <div className="flex flex-col gap-0.5">
                      {entries.slice(0, 4).map((a) => {
                        const t = timeLabel(a);
                        const style = SOURCE_STYLE[a.source] || SOURCE_STYLE.manual;
                        const content = (
                          <>
                            {t && <span className="font-semibold mr-0.5">{t}</span>}
                            {a.title}
                          </>
                        );
                        return a.sourceUrl ? (
                          <a
                            key={a.id}
                            href={a.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={`text-[10px] leading-tight rounded px-1 py-0.5 truncate flex items-center gap-0.5 ${style}`}
                            title={a.title}
                          >
                            <span className="truncate">{content}</span>
                            <ExternalLink className="h-2 w-2 flex-shrink-0 opacity-60" />
                          </a>
                        ) : (
                          <span
                            key={a.id}
                            className={`text-[10px] leading-tight rounded px-1 py-0.5 truncate block ${style}`}
                            title={a.title}
                          >
                            {content}
                          </span>
                        );
                      })}
                      {entries.length > 4 && (
                        <span className="text-[10px] text-slate-400 px-1">
                          +{entries.length - 4} more
                        </span>
                      )}
                    </div>
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
    </div>
  );
}
