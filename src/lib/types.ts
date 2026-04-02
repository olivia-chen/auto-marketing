// ─── Context Attachments (media, links, notes for generation) ─────

export interface ContextAttachment {
  id: string;
  type: 'image' | 'pdf' | 'file';
  name: string;
  mimeType: string;
  dataUrl: string; // base64 data URL
  addedAt: string; // ISO timestamp
}

export interface ContextLink {
  id: string;
  url: string;
  label?: string;
  addedAt: string;
}

// ─── Core Activity (from Wix + Manual) ────────────────────────────

export interface Activity {
  id: string;
  title: string;
  description?: string;
  startDate: string; // ISO date string
  endDate?: string;
  location?: string;
  imageUrl?: string;
  sourceUrl?: string;
  source: 'wix-booking' | 'wix-event' | 'manual';
  type: CampaignType;
  // For manual additions
  mediaBase64?: string;
  notes?: string;
  // Whether this item is selected for content generation
  selected?: boolean;
  // Status from Wix
  status?: 'scheduled' | 'sold_out' | 'canceled';
  // For recurring items
  recurrenceKey?: string;
  // ─── Context for generation (user-provided) ──────
  contextMedia?: ContextAttachment[];
  contextLinks?: ContextLink[];
  contextNotes?: string;
}

// ─── Campaign Types ───────────────────────────────────────────────

export type CampaignType =
  | 'promotion'
  | 'recap'
  | 'announcement'
  | 'journal'
  | 'member-benefit'
  | 'partner-spotlight'
  | 'volunteer'
  | 'urgent-update'
  | 'evergreen'
  | 'event-reminder'
  | 'workshop'
  | 'class'
  | 'other';

export const CAMPAIGN_TYPES: { value: CampaignType; label: string }[] = [
  { value: 'promotion', label: '🎯 Promotion' },
  { value: 'event-reminder', label: '📅 Event Reminder' },
  { value: 'workshop', label: '🎨 Workshop' },
  { value: 'class', label: '📚 Class' },
  { value: 'announcement', label: '📢 Announcement' },
  { value: 'recap', label: '📸 Recap' },
  { value: 'journal', label: '📝 Journal / Story' },
  { value: 'member-benefit', label: '💎 Member Benefit' },
  { value: 'partner-spotlight', label: '🤝 Partner Spotlight' },
  { value: 'volunteer', label: '🙌 Volunteer / Community' },
  { value: 'urgent-update', label: '🚨 Urgent Update' },
  { value: 'evergreen', label: '🌿 Evergreen' },
  { value: 'other', label: '✨ Other' },
];

// ─── Post Angle (teaser → details → urgency → recap) ─────────────

export type PostAngle =
  | 'teaser'
  | 'details'
  | 'social_proof'
  | 'urgency'
  | 'day_of'
  | 'recap';

export const ANGLE_CONFIG: Record<
  PostAngle,
  { label: string; emoji: string; description: string; color: string; timing: string }
> = {
  teaser: {
    label: 'Teaser',
    emoji: '🔮',
    description: 'Early awareness, build curiosity',
    color: 'bg-violet-100 text-violet-700',
    timing: '14 days before',
  },
  details: {
    label: 'Details',
    emoji: '📋',
    description: 'Full info: what/when/where/how',
    color: 'bg-blue-100 text-blue-700',
    timing: '7 days before',
  },
  social_proof: {
    label: 'Social Proof',
    emoji: '⭐',
    description: 'Benefits, testimonials, value',
    color: 'bg-amber-100 text-amber-700',
    timing: '3 days before',
  },
  urgency: {
    label: 'Urgency',
    emoji: '⚡',
    description: 'Last chance, limited spots',
    color: 'bg-red-100 text-red-700',
    timing: '1 day before',
  },
  day_of: {
    label: 'Day-of',
    emoji: '📍',
    description: 'Today logistics, excitement',
    color: 'bg-emerald-100 text-emerald-700',
    timing: 'Day of event',
  },
  recap: {
    label: 'Recap',
    emoji: '📸',
    description: 'Post-event highlights, photos',
    color: 'bg-pink-100 text-pink-700',
    timing: '1 day after',
  },
};

// ─── Schedule Rule Definition ─────────────────────────────────────

export interface ScheduleRule {
  daysBeforeEvent: number; // positive = before, 0 = day-of, negative = after
  angle: PostAngle;
  defaultTime: string; // HH:mm
}

export const DEFAULT_SCHEDULE_RULES: ScheduleRule[] = [
  { daysBeforeEvent: 14, angle: 'teaser', defaultTime: '10:00' },
  { daysBeforeEvent: 7, angle: 'details', defaultTime: '10:00' },
  { daysBeforeEvent: 3, angle: 'social_proof', defaultTime: '18:00' },
  { daysBeforeEvent: 1, angle: 'urgency', defaultTime: '18:00' },
  { daysBeforeEvent: 0, angle: 'day_of', defaultTime: '08:00' },
  { daysBeforeEvent: -1, angle: 'recap', defaultTime: '10:00' },
];

// ─── Approval Status ──────────────────────────────────────────────

export type ApprovalStatus = 'draft' | 'needs_review' | 'approved' | 'posted';

export const STATUS_CONFIG: Record<
  ApprovalStatus,
  { label: string; color: string }
> = {
  draft: { label: 'Draft', color: 'bg-slate-100 text-slate-600' },
  needs_review: { label: 'Review', color: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approved', color: 'bg-emerald-100 text-emerald-700' },
  posted: { label: 'Posted', color: 'bg-blue-100 text-blue-700' },
};

// ─── Scheduled Post (the core auto-schedule output) ───────────────

export interface ScheduledPost {
  id: string;
  activityId: string;
  activityTitle: string;
  activityType: CampaignType;
  postDate: string; // YYYY-MM-DD
  postTime: string; // HH:mm
  angle: PostAngle;
  platforms: PlatformId[];
  status: ApprovalStatus;
  generatedContent?: GeneratedContent;
  notes?: string;
  // Reference to the source activity for generation
  activity?: Activity;
  // Per-post context (overrides activity-level context when present)
  contextNotes?: string;
  contextMedia?: ContextAttachment[];
  contextLinks?: ContextLink[];
}

// ─── Platforms ────────────────────────────────────────────────────

export type PlatformId =
  | 'redbook'
  | 'linkedin'
  | 'facebook'
  | 'line'
  | 'wechat'
  | 'email';

export interface PlatformConfig {
  id: PlatformId;
  title: string;
  label: string;
  emoji: string;
  color: string;
}

export const PLATFORMS: PlatformConfig[] = [
  { id: 'redbook', title: '小红书 Redbook', label: '简体中文 · 长文', emoji: '📕', color: '#FF2442' },
  { id: 'linkedin', title: 'LinkedIn', label: 'English', emoji: '💼', color: '#0A66C2' },
  { id: 'facebook', title: 'Facebook', label: '繁中 + EN', emoji: '📘', color: '#1877F2' },
  { id: 'line', title: 'LINE Group', label: '繁體中文 · 短', emoji: '💚', color: '#06C755' },
  { id: 'wechat', title: 'WeChat Group', label: '简体中文 · 短', emoji: '💬', color: '#07C160' },
  { id: 'email', title: 'Email Newsletter', label: 'Subject + Body', emoji: '📧', color: '#EA4335' },
];

// ─── Generated Content ───────────────────────────────────────────

export interface GeneratedContent {
  redbook: string;
  linkedin: string;
  facebook: string;
  line: string;
  wechat: string;
  email: {
    subject: string;
    body: string;
  };
}

// ─── Week Schedule (for display) ─────────────────────────────────

export interface WeekSchedule {
  weekStart: string;
  weekEnd: string;
  activities: Activity[];
}
