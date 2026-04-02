/**
 * Auto-Schedule Engine
 *
 * Given a list of Activities (from Wix + manual), automatically generates
 * a ScheduledPost[] using timing rules relative to each event's start date.
 *
 * Rules (default):
 *   T-14 days  →  teaser      @ 10:00 AM
 *   T-7  days  →  details     @ 10:00 AM
 *   T-3  days  →  social_proof @ 6:00 PM
 *   T-1  day   →  urgency     @ 6:00 PM
 *   Day-of     →  day_of      @ 8:00 AM
 *   T+1  day   →  recap       @ 10:00 AM
 *
 * Weekday snapping: if a post date falls on Sat/Sun, snap to Friday (before)
 * or Monday (after) depending on which is closer.
 *
 * Platform frequency caps per week:
 *   LinkedIn: max 3/week
 *   Redbook:  max 5/week
 *   Facebook: max 6/week
 *   LINE/WeChat: max 7/week (daily ok)
 *   Email: max 2/week
 */

import {
  Activity,
  ScheduledPost,
  PostAngle,
  PlatformId,
  DEFAULT_SCHEDULE_RULES,
  ScheduleRule,
} from './types';
import {
  addDays,
  subDays,
  format,
  parseISO,
  startOfDay,
  isAfter,
  isBefore,
  getDay,
  isSameDay,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
} from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

// ─── Platform Caps (max posts per week) ──────────────────────────

const PLATFORM_WEEKLY_CAPS: Record<PlatformId, number> = {
  linkedin: 3,
  redbook: 5,
  facebook: 6,
  line: 7,
  wechat: 7,
  email: 2,
};

// ─── Weekday Snapping ────────────────────────────────────────────

/**
 * If a date falls on Saturday, snap to Friday.
 * If a date falls on Sunday, snap to Monday.
 */
function snapToWeekday(date: Date): Date {
  const day = getDay(date); // 0 = Sun, 6 = Sat
  if (day === 0) return addDays(date, 1); // Sunday → Monday
  if (day === 6) return subDays(date, 1); // Saturday → Friday
  return date;
}

// ─── Core Scheduler ──────────────────────────────────────────────

export interface SchedulerOptions {
  /** Only include posts that fall within this window */
  viewStart: Date;
  viewEnd: Date;
  /** Custom rules (defaults to DEFAULT_SCHEDULE_RULES) */
  rules?: ScheduleRule[];
  /** Skip posts that are in the past */
  skipPastPosts?: boolean;
}

/**
 * Generate a list of ScheduledPosts for the given activities.
 * Each activity gets up to 6 posts (T-14, T-7, T-3, T-1, Day-of, T+1)
 * snapped to weekdays and filtered to the view window.
 */
export function generateSchedule(
  activities: Activity[],
  options: SchedulerOptions
): ScheduledPost[] {
  const { viewStart, viewEnd, rules = DEFAULT_SCHEDULE_RULES, skipPastPosts = false } = options;
  const now = startOfDay(new Date());
  const posts: ScheduledPost[] = [];

  for (const activity of activities) {
    // Skip canceled activities
    if (activity.status === 'canceled') continue;

    const eventDate = startOfDay(parseISO(activity.startDate));

    for (const rule of rules) {
      let postDate: Date;

      if (rule.daysBeforeEvent > 0) {
        postDate = subDays(eventDate, rule.daysBeforeEvent);
      } else if (rule.daysBeforeEvent < 0) {
        postDate = addDays(eventDate, Math.abs(rule.daysBeforeEvent));
      } else {
        postDate = eventDate;
      }

      // Posts can land on any day including weekends

      const postDateStart = startOfDay(postDate);

      // Filter out posts outside the view window
      if (isBefore(postDateStart, startOfDay(viewStart))) continue;
      if (isAfter(postDateStart, startOfDay(viewEnd))) continue;

      // Optionally skip past posts
      if (skipPastPosts && isBefore(postDateStart, now)) continue;

      // For sold-out items: replace urgency/day_of with membership angle
      let angle = rule.angle;
      if (activity.status === 'sold_out') {
        if (angle === 'urgency' || angle === 'day_of') {
          // Skip these angles for sold-out events — they don't make sense
          continue;
        }
      }

      // Determine which platforms to target based on caps later
      const allPlatforms: PlatformId[] = [
        'redbook',
        'linkedin',
        'facebook',
        'line',
        'wechat',
        'email',
      ];

      posts.push({
        id: uuidv4(),
        activityId: activity.id,
        activityTitle: activity.title,
        activityType: activity.type,
        postDate: format(postDate, 'yyyy-MM-dd'),
        postTime: rule.defaultTime,
        angle,
        platforms: allPlatforms,
        status: 'draft',
        activity,
      });
    }
  }

  // Sort by date, then time
  posts.sort((a, b) => {
    const dateCompare = a.postDate.localeCompare(b.postDate);
    if (dateCompare !== 0) return dateCompare;
    return a.postTime.localeCompare(b.postTime);
  });

  return posts;
}

// ─── Apply Platform Frequency Caps ──────────────────────────────

/**
 * Given scheduled posts for a week, enforce per-platform frequency caps.
 * When a platform exceeds its weekly limit, lower-priority posts
 * (later offsets like social_proof/urgency) lose that platform.
 */
export function applyPlatformCaps(
  posts: ScheduledPost[],
  weekStart: Date
): ScheduledPost[] {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  // Count posts per platform for this week
  const platformCounts: Record<PlatformId, number> = {
    redbook: 0,
    linkedin: 0,
    facebook: 0,
    line: 0,
    wechat: 0,
    email: 0,
  };

  // Priority order: teaser/details/day_of are highest priority
  const anglePriority: Record<PostAngle, number> = {
    day_of: 6,
    details: 5,
    urgency: 4,
    teaser: 3,
    social_proof: 2,
    recap: 1,
  };

  // Sort by priority (highest first) so high-priority posts get platforms first
  const sortedPosts = [...posts].sort(
    (a, b) => (anglePriority[b.angle] || 0) - (anglePriority[a.angle] || 0)
  );

  const result: ScheduledPost[] = [];

  for (const post of sortedPosts) {
    const postDate = parseISO(post.postDate);
    if (isBefore(postDate, weekStart) || isAfter(postDate, weekEnd)) {
      result.push(post);
      continue;
    }

    // Recap posts are exempt from caps — they should always go to all platforms
    if (post.angle === 'recap') {
      result.push(post);
      continue;
    }

    // Filter platforms that haven't exceeded their cap
    const filteredPlatforms = post.platforms.filter((platform) => {
      return platformCounts[platform] < PLATFORM_WEEKLY_CAPS[platform];
    });

    if (filteredPlatforms.length > 0) {
      // Count these platforms
      for (const p of filteredPlatforms) {
        platformCounts[p]++;
      }
      result.push({ ...post, platforms: filteredPlatforms });
    }
    // If no platforms left after capping, skip this post entirely
  }

  // Re-sort by date/time
  result.sort((a, b) => {
    const dateCompare = a.postDate.localeCompare(b.postDate);
    if (dateCompare !== 0) return dateCompare;
    return a.postTime.localeCompare(b.postTime);
  });

  return result;
}

// ─── Group Posts by Day ──────────────────────────────────────────

export interface DaySchedule {
  date: Date;
  dateStr: string; // YYYY-MM-DD
  dayName: string; // Mon, Tue, etc.
  dayNumber: string; // 10, 11, etc.
  monthDay: string; // Mar 10
  posts: ScheduledPost[];
  isToday: boolean;
  isWeekend: boolean;
}

/**
 * Group ScheduledPosts into a Mon-Sun grid structure (7 days).
 */
export function groupByDay(
  posts: ScheduledPost[],
  weekStart: Date
): DaySchedule[] {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const today = startOfDay(new Date());

  return days.map((date) => {
    const day = getDay(date);
    const dateStr = format(date, 'yyyy-MM-dd');
    return {
      date,
      dateStr,
      dayName: format(date, 'EEE'),
      dayNumber: format(date, 'd'),
      monthDay: format(date, 'MMM d'),
      posts: posts.filter((p) => p.postDate === dateStr),
      isToday: isSameDay(date, today),
      isWeekend: day === 0 || day === 6,
    };
  });
}
