'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Image as ImageIcon,
  FileText,
  Send,
  Loader2,
  Key,
  Copy,
  Check,
  Plus,
  Calendar,
  MapPin,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Globe,
  ExternalLink,
  Trash2,
  AlertCircle,
  Clock,
  Zap,
  Paperclip,
  Link as LinkIcon,
  X,
  Upload,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Table2,
  Share2,
} from 'lucide-react';
import {
  Activity,
  CampaignType,
  PlatformId,
  PostAngle,
  ScheduledPost,
  PLATFORMS,
  CAMPAIGN_TYPES,
  ANGLE_CONFIG,
  STATUS_CONFIG,
  ApprovalStatus,
  ContextAttachment,
  ContextLink,
} from '@/lib/types';
import {
  generateSchedule,
  applyPlatformCaps,
  groupByDay,
  DaySchedule,
} from '@/lib/scheduler';
import { v4 as uuidv4 } from 'uuid';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, parseISO } from 'date-fns';

// ─── Helpers ──────────────────────────────────────────────────────

function getWeekRange(date: Date) {
  const start = startOfWeek(date, { weekStartsOn: 1 }); // Monday
  const end = endOfWeek(date, { weekStartsOn: 1 });
  return { start, end };
}

function formatDateRange(start: Date, end: Date) {
  return `${format(start, 'MMM d')} — ${format(end, 'MMM d, yyyy')}`;
}

function formatActivityDate(dateStr: string | any) {
  try {
    // Handle Wix date objects that may slip through
    let raw = dateStr;
    if (typeof raw === 'object' && raw !== null) {
      raw = raw.utcDate || raw.localDate || '';
    }
    if (typeof raw !== 'string' || !raw) return 'Date TBD';
    return format(parseISO(raw), 'EEE, MMM d · h:mm a');
  } catch {
    return typeof dateStr === 'string' ? dateStr : 'Date TBD';
  }
}

function getSourceBadge(source: Activity['source']) {
  switch (source) {
    case 'wix-event':
      return { label: 'Wix Event', color: 'bg-purple-100 text-purple-700' };
    case 'wix-booking':
      return { label: 'Wix Booking', color: 'bg-blue-100 text-blue-700' };
    case 'manual':
      return { label: 'Manual', color: 'bg-amber-100 text-amber-700' };
  }
}

// ─── Main Component ───────────────────────────────────────────────

export default function Home() {
  // API key
  const [apiKey, setApiKey] = useState('');

  // Week navigation
  const [currentDate, setCurrentDate] = useState(new Date());
  const weekRange = getWeekRange(currentDate);
  const weekStartKey = format(weekRange.start, 'yyyy-MM-dd');
  const weekEndKey = format(weekRange.end, 'yyyy-MM-dd');

  // Activities (from Wix + manual)
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [wixConnected, setWixConnected] = useState<boolean | null>(null);

  // Scheduled posts (auto-generated)
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);

  // Manual campaign dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualType, setManualType] = useState<CampaignType>('announcement');
  const [manualLink, setManualLink] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualImage, setManualImage] = useState<string | null>(null);
  const manualFileRef = useRef<HTMLInputElement>(null);

  // Generation state
  const [generatingPostId, setGeneratingPostId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('schedule');
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  // Expanded post detail
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);

  // Context panel for activities
  const [contextPanelId, setContextPanelId] = useState<string | null>(null);
  const contextFileRef = useRef<HTMLInputElement>(null);
  const [contextLinkInput, setContextLinkInput] = useState('');
  const [contextLinkLabel, setContextLinkLabel] = useState('');

  // Google Sheets export
  const [sheetsExporting, setSheetsExporting] = useState(false);
  const [sheetsUrl, setSheetsUrl] = useState<string | null>(null);
  const [sheetsSpreadsheetId, setSheetsSpreadsheetId] = useState('');
  const [showSheetsConfig, setShowSheetsConfig] = useState(false);

  // Add post to day dialog
  const [addPostDay, setAddPostDay] = useState<string | null>(null); // YYYY-MM-DD
  const [addPostActivityId, setAddPostActivityId] = useState<string>('');
  const [addPostAngle, setAddPostAngle] = useState<PostAngle>('teaser');
  const [addPostTime, setAddPostTime] = useState('10:00');
  const [addPostPlatforms, setAddPostPlatforms] = useState<PlatformId[]>(['redbook', 'linkedin', 'facebook', 'line', 'wechat', 'email']);

  // Manual post entries (not auto-generated, so they persist across re-renders)
  const [manualPosts, setManualPosts] = useState<ScheduledPost[]>([]);

  // Drag-and-drop state
  const [draggedPost, setDraggedPost] = useState<ScheduledPost | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  // Load API key from localStorage
  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) setApiKey(savedKey);
  }, []);

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    localStorage.setItem('gemini_api_key', val);
  };

  // Fetch activities from Wix — pull future month so T-14/T-7 posts land on current weeks
  const fetchActivities = useCallback(async () => {
    setIsLoadingActivities(true);
    setError(null);

    // Always fetch from today through +30 days to cover all scheduling offsets
    const today = format(new Date(), 'yyyy-MM-dd');
    const futureEnd = format(addDays(new Date(), 30), 'yyyy-MM-dd');

    try {
      const res = await fetch(`/api/wix/activities?from=${today}&to=${futureEnd}`);
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 500 && data.setupInstructions) {
          setWixConnected(false);
          setActivities((prev) => prev.filter((a) => a.source === 'manual'));
          return;
        }
        throw new Error(data.error);
      }

      setWixConnected(true);
      setActivities((prev) => {
        const manualOnes = prev.filter((a) => a.source === 'manual');
        const wixOnes: Activity[] = data.activities || [];
        return [...wixOnes, ...manualOnes].sort(
          (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
        );
      });
    } catch (err: any) {
      console.error('Fetch error:', err);
      setWixConnected(false);
    } finally {
      setIsLoadingActivities(false);
    }
  }, []); // No dependency on week — always fetches future month

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // ─── Removed posts tracking (persists across re-renders) ──────
  const [removedPostKeys, setRemovedPostKeys] = useState<Set<string>>(new Set());

  // Build a stable key for a post so we can track removals across regenerations
  const getPostKey = (post: ScheduledPost) =>
    `${post.activityId}__${post.postDate}__${post.angle}`;

  // ─── Auto-Schedule Engine ─────────────────────────────────────
  // Re-generate schedule whenever activities or week changes
  useEffect(() => {
    if (activities.length === 0) {
      setScheduledPosts(manualPosts);
      return;
    }

    // Generate schedule for the visible week
    const raw = generateSchedule(activities, {
      viewStart: weekRange.start,
      viewEnd: weekRange.end,
    });

    const capped = applyPlatformCaps(raw, weekRange.start);

    // Filter out removed posts
    const filtered = capped.filter((p) => !removedPostKeys.has(getPostKey(p)));

    // Merge with manually-added posts for this week
    const weekManualPosts = manualPosts.filter((p) => {
      return p.postDate >= weekStartKey && p.postDate <= weekEndKey;
    });

    const merged = [...filtered, ...weekManualPosts].sort((a, b) => {
      const dateCompare = a.postDate.localeCompare(b.postDate);
      if (dateCompare !== 0) return dateCompare;
      return a.postTime.localeCompare(b.postTime);
    });

    setScheduledPosts(merged);
  }, [activities, weekStartKey, weekEndKey, removedPostKeys, manualPosts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group posts into Mon-Fri grid
  const daySchedules: DaySchedule[] = useMemo(() => {
    return groupByDay(scheduledPosts, weekRange.start);
  }, [scheduledPosts, weekStartKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add manual campaign
  const addManualCampaign = () => {
    if (!manualTitle) return;
    const newActivity: Activity = {
      id: uuidv4(),
      title: manualTitle,
      description: manualNotes,
      startDate: manualDate || new Date().toISOString(),
      sourceUrl: manualLink,
      source: 'manual',
      type: manualType,
      mediaBase64: manualImage || undefined,
      notes: manualNotes,
      selected: true,
    };
    setActivities((prev) =>
      [...prev, newActivity].sort(
        (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      )
    );
    setManualTitle('');
    setManualDate('');
    setManualType('announcement');
    setManualLink('');
    setManualNotes('');
    setManualImage(null);
    setShowAddDialog(false);
  };

  const removeActivity = (id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id));
    // Also remove any manual posts associated with this activity
    setManualPosts((prev) => prev.filter((p) => p.activityId !== id));
  };

  // ─── Remove / Restore Scheduled Post ─────────────────────────
  const removeScheduledPost = (post: ScheduledPost) => {
    const key = getPostKey(post);
    // If it's a manual post, remove from manualPosts
    if (manualPosts.some((p) => p.id === post.id)) {
      setManualPosts((prev) => prev.filter((p) => p.id !== post.id));
    } else {
      // Auto-generated post: add to removed set
      setRemovedPostKeys((prev) => new Set(prev).add(key));
    }
  };

  // ─── Add Post to Specific Day ────────────────────────────────
  const handleAddPostToDay = () => {
    if (!addPostDay || !addPostActivityId) return;
    const activity = activities.find((a) => a.id === addPostActivityId);
    if (!activity) return;

    const newPost: ScheduledPost = {
      id: uuidv4(),
      activityId: activity.id,
      activityTitle: activity.title,
      activityType: activity.type,
      postDate: addPostDay,
      postTime: addPostTime,
      angle: addPostAngle,
      platforms: addPostPlatforms,
      status: 'draft',
      activity,
    };

    setManualPosts((prev) => [...prev, newPost]);
    setAddPostDay(null);
    setAddPostActivityId('');
    setAddPostAngle('teaser');
    setAddPostTime('10:00');
    setAddPostPlatforms(['redbook', 'linkedin', 'facebook', 'line', 'wechat', 'email']);
  };

  // ─── Drag & Drop: Move Post to Different Day ──────────────────
  const movePostToDate = (post: ScheduledPost, newDate: string) => {
    if (post.postDate === newDate) return; // dropped on same day

    const isManual = manualPosts.some((p) => p.id === post.id);

    if (isManual) {
      // Just update the date in-place
      setManualPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, postDate: newDate } : p))
      );
    } else {
      // Auto-generated post: remove original, add as manual with new date
      const key = getPostKey(post);
      setRemovedPostKeys((prev) => new Set(prev).add(key));
      const movedPost: ScheduledPost = {
        ...post,
        id: uuidv4(), // new id so it's independent
        postDate: newDate,
      };
      setManualPosts((prev) => [...prev, movedPost]);
    }
  };

  // Handle image upload
  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setFn: (val: string | null) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setFn(event.target?.result as string);
    reader.readAsDataURL(file);
  };

  // ─── Activity Context Helpers ─────────────────────────────────

  const updateActivity = (id: string, updates: Partial<Activity>) => {
    setActivities(prev =>
      prev.map(a => (a.id === id ? { ...a, ...updates } : a))
    );
  };

  const addContextMedia = (activityId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const attachment: ContextAttachment = {
        id: uuidv4(),
        type: file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'file',
        name: file.name,
        mimeType: file.type,
        dataUrl,
        addedAt: new Date().toISOString(),
      };
      setActivities(prev =>
        prev.map(a =>
          a.id === activityId
            ? { ...a, contextMedia: [...(a.contextMedia || []), attachment] }
            : a
        )
      );
    };
    reader.readAsDataURL(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const addContextLink = (activityId: string) => {
    if (!contextLinkInput.trim()) return;
    const link: ContextLink = {
      id: uuidv4(),
      url: contextLinkInput.trim(),
      label: contextLinkLabel.trim() || undefined,
      addedAt: new Date().toISOString(),
    };
    setActivities(prev =>
      prev.map(a =>
        a.id === activityId
          ? { ...a, contextLinks: [...(a.contextLinks || []), link] }
          : a
      )
    );
    setContextLinkInput('');
    setContextLinkLabel('');
  };

  const removeContextAttachment = (activityId: string, attachmentId: string) => {
    setActivities(prev =>
      prev.map(a =>
        a.id === activityId
          ? { ...a, contextMedia: (a.contextMedia || []).filter(m => m.id !== attachmentId) }
          : a
      )
    );
  };

  const removeContextLink = (activityId: string, linkId: string) => {
    setActivities(prev =>
      prev.map(a =>
        a.id === activityId
          ? { ...a, contextLinks: (a.contextLinks || []).filter(l => l.id !== linkId) }
          : a
      )
    );
  };

  const getContextCount = (activity: Activity) => {
    return (
      (activity.contextMedia?.length || 0) +
      (activity.contextLinks?.length || 0) +
      (activity.contextNotes ? 1 : 0)
    );
  };

  // ─── Per-Post Generation ─────────────────────────────────────
  const handleGeneratePost = async (post: ScheduledPost) => {
    if (!apiKey) {
      setError('Please enter your Gemini API Key in the field at the top of the page before generating content.');
      return;
    }

    if (!post.activity) {
      setError('Activity data not found for this post.');
      return;
    }

    setGeneratingPostId(post.id);
    setError(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          activities: [post.activity],
          campaignType: post.activityType,
          angle: post.angle,
          link: post.activity.sourceUrl || '',
          imageBase64: post.activity.mediaBase64,
          notes: post.activity.notes || '',
          platforms: post.platforms,
          contextMedia: post.activity.contextMedia || [],
          contextLinks: post.activity.contextLinks || [],
          contextNotes: post.activity.contextNotes || '',
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate');

      // Update the scheduled post with generated content
      setScheduledPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, generatedContent: data, status: 'needs_review' as ApprovalStatus }
            : p
        )
      );

      // Expand the post to show content
      setExpandedPostId(post.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGeneratingPostId(null);
    }
  };

  // Update post status
  const updatePostStatus = (postId: string, status: ApprovalStatus) => {
    setScheduledPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, status } : p))
    );
  };

  const copyToClipboard = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTab(key);
    setTimeout(() => setCopiedTab(null), 2000);
  };

  const totalPosts = scheduledPosts.length;
  const generatedCount = scheduledPosts.filter((p) => p.generatedContent).length;
  const ungeneratedPosts = scheduledPosts.filter((p) => !p.generatedContent);

  // ─── Batch Generate All ──────────────────────────────────────
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  const handleBatchGenerate = async () => {
    if (!apiKey) {
      setError('Please enter your Gemini API Key in the field at the top of the page before generating content.');
      return;
    }
    if (ungeneratedPosts.length === 0) return;

    setBatchGenerating(true);
    setBatchProgress({ current: 0, total: ungeneratedPosts.length });
    setError(null);

    for (let i = 0; i < ungeneratedPosts.length; i++) {
      const post = ungeneratedPosts[i];
      setBatchProgress({ current: i + 1, total: ungeneratedPosts.length });

      try {
        if (!post.activity) continue;

        setGeneratingPostId(post.id);

        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            activities: [post.activity],
            campaignType: post.activityType,
            angle: post.angle,
            link: post.activity.sourceUrl || '',
            imageBase64: post.activity.mediaBase64,
            notes: post.activity.notes || '',
            platforms: post.platforms,
            contextMedia: post.activity.contextMedia || [],
            contextLinks: post.activity.contextLinks || [],
            contextNotes: post.activity.contextNotes || '',
          }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to generate');

        setScheduledPosts((prev) =>
          prev.map((p) =>
            p.id === post.id
              ? { ...p, generatedContent: data, status: 'needs_review' as ApprovalStatus }
              : p
          )
        );
      } catch (err: any) {
        setError(`Failed on post ${i + 1}/${ungeneratedPosts.length}: ${err.message}`);
        break;
      }
    }

    setGeneratingPostId(null);
    setBatchGenerating(false);
  };

  // ─── Google Sheets Export ─────────────────────────────────────────
  // Load spreadsheet ID from localStorage
  useEffect(() => {
    const savedId = localStorage.getItem('sheets_spreadsheet_id');
    if (savedId) setSheetsSpreadsheetId(savedId);
  }, []);

  const handleExportToSheets = async () => {
    if (scheduledPosts.length === 0) {
      setError('No posts to export. Add activities and generate a schedule first.');
      return;
    }

    setSheetsExporting(true);
    setError(null);
    setSheetsUrl(null);

    try {
      const exportPosts = scheduledPosts.map((post) => ({
        activityTitle: post.activityTitle,
        postDate: post.postDate,
        postTime: post.postTime,
        angle: ANGLE_CONFIG[post.angle]?.label || post.angle,
        angleEmoji: ANGLE_CONFIG[post.angle]?.emoji || '',
        platforms: post.platforms
          .map((pid) => {
            const p = PLATFORMS.find((pl) => pl.id === pid);
            return p ? `${p.emoji} ${p.title}` : pid;
          })
          .join(', '),
        status: STATUS_CONFIG[post.status]?.label || post.status,
        sourceUrl: post.activity?.sourceUrl || '',
        // Generated content
        redbook: post.generatedContent?.redbook || '',
        linkedin: post.generatedContent?.linkedin || '',
        facebook: post.generatedContent?.facebook || '',
        line: post.generatedContent?.line || '',
        wechat: post.generatedContent?.wechat || '',
        emailSubject:
          typeof post.generatedContent?.email === 'object'
            ? post.generatedContent.email.subject
            : '',
        emailBody:
          typeof post.generatedContent?.email === 'object'
            ? post.generatedContent.email.body
            : '',
      }));

      const weekLabel = formatDateRange(weekRange.start, weekRange.end);

      const response = await fetch('/api/sheets/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posts: exportPosts,
          spreadsheetId: sheetsSpreadsheetId || undefined,
          sheetTitle: weekLabel,
          weekLabel,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to export');

      setSheetsUrl(data.url);

      // Save the spreadsheet ID for future exports
      if (data.spreadsheetId) {
        setSheetsSpreadsheetId(data.spreadsheetId);
        localStorage.setItem('sheets_spreadsheet_id', data.spreadsheetId);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSheetsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/20 font-sans">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-800">
                Campaign Matrix
              </h1>
              <p className="text-xs text-slate-500">The Joy Culture Foundation</p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {wixConnected === true && (
              <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs gap-1 hidden sm:flex">
                <Globe className="h-3 w-3" /> Wix Connected
              </Badge>
            )}
            {wixConnected === false && (
              <Badge className="bg-amber-100 text-amber-700 border-0 text-xs gap-1 hidden sm:flex">
                <AlertCircle className="h-3 w-3" /> Wix Not Configured
              </Badge>
            )}
            <div className="relative flex-1 sm:flex-none">
              <Key className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                type="password"
                placeholder="Gemini API Key"
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                className="pl-8 h-9 w-full sm:w-[240px] bg-slate-50 border-slate-200 text-sm"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-4 md:px-8 py-6 space-y-6">
        {/* Tab Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <TabsList className="bg-white shadow-sm border border-slate-200/60">
              <TabsTrigger
                value="schedule"
                className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white gap-2"
              >
                <Calendar className="h-4 w-4" />
                Weekly Schedule
              </TabsTrigger>
              <TabsTrigger
                value="activities"
                className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white gap-2"
              >
                <FileText className="h-4 w-4" />
                Activities
                <span className="text-xs opacity-60">({activities.length})</span>
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50"
                  >
                    <Plus className="h-4 w-4" />
                    Add Event
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Add Manual Event</DialogTitle>
                    <DialogDescription>
                      Add an event not from Wix (partnerships, external events, etc.)
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Title *</Label>
                      <Input
                        placeholder="Event title"
                        value={manualTitle}
                        onChange={(e) => setManualTitle(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Event Date *</Label>
                        <Input
                          type="datetime-local"
                          value={manualDate}
                          onChange={(e) => setManualDate(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                          value={manualType}
                          onValueChange={(v) => setManualType(v as CampaignType)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CAMPAIGN_TYPES.map((ct) => (
                              <SelectItem key={ct.value} value={ct.value}>
                                {ct.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Source Link</Label>
                      <Input
                        placeholder="https://..."
                        value={manualLink}
                        onChange={(e) => setManualLink(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Upload Image / Flyer</Label>
                      {!manualImage ? (
                        <div
                          className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-slate-50 transition-colors"
                          onClick={() => manualFileRef.current?.click()}
                        >
                          <ImageIcon className="h-6 w-6 mx-auto mb-1 text-slate-400" />
                          <span className="text-sm text-slate-500">Click to upload</span>
                          <input
                            type="file"
                            ref={manualFileRef}
                            onChange={(e) => handleImageUpload(e, setManualImage)}
                            accept="image/*"
                            className="hidden"
                          />
                        </div>
                      ) : (
                        <div className="relative rounded-lg overflow-hidden border group">
                          <img
                            src={manualImage}
                            alt="Preview"
                            className="w-full h-32 object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setManualImage(null)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <Textarea
                        placeholder="Additional context..."
                        value={manualNotes}
                        onChange={(e) => setManualNotes(e.target.value)}
                        className="h-20 resize-none"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={addManualCampaign} disabled={!manualTitle}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Event
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg border border-red-100 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">{error}</div>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
                ✕
              </button>
            </div>
          )}

          {/* ─── SCHEDULE TAB (Mon-Fri Grid) ──────────────────── */}
          <TabsContent value="schedule" className="mt-6 space-y-4">
            {/* Week Navigator */}
            <div className="flex items-center justify-between bg-white rounded-xl p-4 shadow-sm border border-slate-200/60">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-slate-800">
                  {formatDateRange(weekRange.start, weekRange.end)}
                </h2>
                <p className="text-xs text-slate-500">
                  {totalPosts} scheduled posts · {generatedCount} generated · {activities.length} events
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentDate(new Date())}
                  className="text-xs text-indigo-600"
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={fetchActivities}
                  disabled={isLoadingActivities}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isLoadingActivities ? 'animate-spin' : ''}`}
                  />
                </Button>
              </div>
            </div>

            {/* Generate Week Button */}
            {ungeneratedPosts.length > 0 && (
              <div className="flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-200/50">
                <div>
                  <p className="text-sm font-medium text-indigo-800">
                    {batchGenerating
                      ? `Generating ${batchProgress.current}/${batchProgress.total}...`
                      : `${ungeneratedPosts.length} post${ungeneratedPosts.length > 1 ? 's' : ''} ready to generate`}
                  </p>
                  <p className="text-xs text-indigo-600/70 mt-0.5">
                    {generatedCount > 0 ? `${generatedCount} already generated` : 'Generate content for all scheduled posts'}
                  </p>
                </div>
                <Button
                  onClick={handleBatchGenerate}
                  disabled={batchGenerating}
                  className={`gap-2 shadow-md ${
                    !apiKey
                      ? 'bg-slate-300 text-slate-500 hover:bg-slate-400'
                      : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white'
                  }`}
                >
                  {batchGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {batchProgress.current}/{batchProgress.total}
                    </>
                  ) : !apiKey ? (
                    <>
                      <Key className="h-4 w-4" />
                      API Key Required
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generate Week
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* ─── Google Sheets Export ────────────────────────── */}
            {scheduledPosts.length > 0 && (
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-200/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-emerald-800 flex items-center gap-2">
                      <Table2 className="h-4 w-4" />
                      Export to Google Sheets
                    </p>
                    <p className="text-xs text-emerald-600/70 mt-0.5">
                      Share the schedule with your team for review & editing
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-emerald-700 hover:text-emerald-900"
                      onClick={() => setShowSheetsConfig(!showSheetsConfig)}
                    >
                      {showSheetsConfig ? 'Hide' : 'Settings'}
                    </Button>
                    <Button
                      onClick={handleExportToSheets}
                      disabled={sheetsExporting}
                      className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md"
                    >
                      {sheetsExporting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Exporting...
                        </>
                      ) : (
                        <>
                          <Share2 className="h-4 w-4" />
                          Export to Sheets
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Config Section */}
                {showSheetsConfig && (
                  <div className="bg-white/60 rounded-lg p-3 space-y-2 border border-emerald-100">
                    <Label className="text-xs text-slate-600">
                      Google Sheet URL or ID
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Paste Google Sheet URL or ID here"
                        value={sheetsSpreadsheetId}
                        onChange={(e) => {
                          const val = e.target.value;
                          // Extract ID if user pastes full URL
                          const match = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                          const id = match ? match[1] : val;
                          setSheetsSpreadsheetId(id);
                          localStorage.setItem('sheets_spreadsheet_id', id);
                        }}
                        className="text-xs flex-1"
                      />
                      {sheetsSpreadsheetId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-red-500 hover:text-red-700"
                          onClick={() => {
                            setSheetsSpreadsheetId('');
                            localStorage.removeItem('sheets_spreadsheet_id');
                          }}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 space-y-1">
                      <p>
                        <strong>Setup:</strong> Create a blank Google Sheet → Share it (Editor) with{' '}
                        <button
                          className="text-emerald-600 hover:text-emerald-800 underline cursor-pointer"
                          onClick={() => {
                            navigator.clipboard.writeText('campaign-matrix@auto-marketing-490005.iam.gserviceaccount.com');
                            // Quick feedback
                            const el = document.getElementById('copy-email-feedback');
                            if (el) { el.textContent = '✓ Copied!'; setTimeout(() => el.textContent = '', 2000); }
                          }}
                        >
                          campaign-matrix@auto-marketing-490005.iam.gserviceaccount.com
                        </button>
                        <span id="copy-email-feedback" className="text-emerald-600 ml-1 font-medium"></span>
                      </p>
                      <p>Then paste the Sheet URL above. Each export adds a new tab named after the week.</p>
                    </div>
                  </div>
                )}

                {/* Success: Link to Sheet */}
                {sheetsUrl && (
                  <div className="flex items-center gap-3 bg-emerald-100/60 rounded-lg px-3 py-2 border border-emerald-200">
                    <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                    <p className="text-xs text-emerald-700 flex-1">
                      Exported successfully!
                    </p>
                    <a
                      href={sheetsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-900 bg-white hover:bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open Google Sheet
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Wix Setup Banner */}
            {wixConnected === false && (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-5 border border-amber-200/50">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <Globe className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-amber-800">Connect Your Wix Site</h3>
                    <p className="text-sm text-amber-700 mt-1">
                      Add <code className="bg-amber-100 px-1 rounded text-xs">WIX_API_KEY</code> and{' '}
                      <code className="bg-amber-100 px-1 rounded text-xs">WIX_SITE_ID</code> to
                      your <code className="bg-amber-100 px-1 rounded text-xs">.env.local</code>{' '}
                      file to automatically pull events and bookings.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Schedule Legend */}
            <div className="flex flex-wrap gap-2 px-1">
              {(Object.entries(ANGLE_CONFIG) as [PostAngle, typeof ANGLE_CONFIG[PostAngle]][]).map(
                ([key, config]) => (
                  <span
                    key={key}
                    className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${config.color}`}
                  >
                    {config.emoji} {config.label}
                  </span>
                )
              )}
            </div>

            {/* Mon–Fri Grid */}
            {isLoadingActivities ? (
              <div className="flex items-center justify-center py-20 text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : activities.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                <Calendar className="h-12 w-12 mx-auto mb-4 text-slate-300" />
                <h3 className="text-lg font-medium text-slate-500 mb-1">
                  No events found
                </h3>
                <p className="text-sm">
                  {wixConnected
                    ? 'No events or bookings found. Add events with dates in the next 2 weeks to see scheduled posts.'
                    : 'Connect Wix or add events manually.'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 gap-1"
                  onClick={() => setShowAddDialog(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add Event
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {daySchedules.map((day) => (
                  <div
                    key={day.dateStr}
                    className={`rounded-xl border transition-all ${
                      dragOverDay === day.dateStr
                        ? 'border-indigo-400 bg-indigo-50/60 ring-2 ring-indigo-200 shadow-lg'
                        : day.isToday
                        ? 'border-indigo-300 bg-indigo-50/30 shadow-md shadow-indigo-100'
                        : 'border-slate-200/60 bg-white shadow-sm'
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setDragOverDay(day.dateStr);
                    }}
                    onDragLeave={(e) => {
                      // Only clear if we're leaving the column itself, not entering a child
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOverDay(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverDay(null);
                      if (draggedPost) {
                        movePostToDate(draggedPost, day.dateStr);
                        setDraggedPost(null);
                      }
                    }}
                  >
                    {/* Day Header */}
                    <div
                      className={`px-3 py-2 border-b text-center ${
                        day.isToday
                          ? 'border-indigo-200 bg-indigo-100/50'
                          : 'border-slate-100 bg-slate-50/50'
                      }`}
                    >
                      <div
                        className={`text-xs font-medium uppercase tracking-wider ${
                          day.isToday ? 'text-indigo-600' : 'text-slate-400'
                        }`}
                      >
                        {day.dayName}
                      </div>
                      <div
                        className={`text-sm font-semibold ${
                          day.isToday ? 'text-indigo-800' : 'text-slate-700'
                        }`}
                      >
                        {day.monthDay}
                      </div>
                      {day.posts.length > 0 && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {day.posts.length} post{day.posts.length > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>

                    {/* Day Posts */}
                    <div className="p-2 space-y-2 min-h-[120px]">
                      {day.posts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[100px] text-slate-300 text-xs gap-2">
                          No posts
                          {activities.length > 0 && (
                            <button
                              onClick={() => {
                                setAddPostDay(day.dateStr);
                                setAddPostActivityId(activities[0]?.id || '');
                              }}
                              className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
                            >
                              <Plus className="h-3 w-3" />
                              Add post
                            </button>
                          )}
                        </div>
                      ) : (
                        day.posts.map((post) => {
                          const angleConfig = ANGLE_CONFIG[post.angle];
                          const statusConfig = STATUS_CONFIG[post.status];
                          const isExpanded = expandedPostId === post.id;
                          const isGenerating = generatingPostId === post.id;

                          return (
                            <div
                              key={post.id}
                              draggable
                              onDragStart={(e) => {
                                setDraggedPost(post);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', post.id);
                                // Make the drag image slightly transparent
                                if (e.currentTarget instanceof HTMLElement) {
                                  e.currentTarget.style.opacity = '0.5';
                                }
                              }}
                              onDragEnd={(e) => {
                                setDraggedPost(null);
                                setDragOverDay(null);
                                if (e.currentTarget instanceof HTMLElement) {
                                  e.currentTarget.style.opacity = '1';
                                }
                              }}
                            >
                              {/* Post Card */}
                              <div
                                className={`rounded-lg border p-2 cursor-grab active:cursor-grabbing transition-all hover:shadow-md ${
                                  isExpanded
                                    ? 'border-indigo-300 ring-1 ring-indigo-200 shadow-md'
                                    : post.generatedContent
                                    ? 'border-emerald-200 bg-emerald-50/30'
                                    : 'border-slate-200 hover:border-slate-300'
                                }`}
                                onClick={() =>
                                  setExpandedPostId(isExpanded ? null : post.id)
                                }
                              >
                                {/* Angle + Time + Delete */}
                                <div className="flex items-center justify-between mb-1">
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${angleConfig.color}`}
                                  >
                                    {angleConfig.emoji} {angleConfig.label}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                      <Clock className="h-2.5 w-2.5" />
                                      {post.postTime}
                                    </span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeScheduledPost(post);
                                      }}
                                      className="text-slate-300 hover:text-red-500 transition-colors ml-0.5"
                                      title="Remove post"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>

                                {/* Title */}
                                <p className="text-xs font-medium text-slate-700 truncate leading-tight">
                                  {post.activityTitle}
                                </p>

                                {/* Context indicator */}
                                {post.activity && getContextCount(post.activity) > 0 && (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <Paperclip className="h-2.5 w-2.5 text-indigo-400" />
                                    <span className="text-[9px] text-indigo-500 font-medium">
                                      {getContextCount(post.activity)} context
                                    </span>
                                  </div>
                                )}

                                {/* Status + Platforms */}
                                <div className="flex items-center justify-between mt-1.5">
                                  <span
                                    className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${statusConfig.color}`}
                                  >
                                    {statusConfig.label}
                                  </span>
                                  <div className="flex gap-0.5">
                                    {post.platforms.slice(0, 3).map((p) => {
                                      const plat = PLATFORMS.find((x) => x.id === p);
                                      return (
                                        <span
                                          key={p}
                                          className="text-[10px]"
                                          title={plat?.title}
                                        >
                                          {plat?.emoji}
                                        </span>
                                      );
                                    })}
                                    {post.platforms.length > 3 && (
                                      <span className="text-[9px] text-slate-400">
                                        +{post.platforms.length - 3}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Generate Button */}
                                {!post.generatedContent && (
                                  <Button
                                    size="sm"
                                    className={`w-full mt-2 h-7 text-xs gap-1 ${
                                      !apiKey
                                        ? 'bg-slate-300 text-slate-500 cursor-pointer'
                                        : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white'
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleGeneratePost(post);
                                    }}
                                    disabled={isGenerating}
                                  >
                                    {isGenerating ? (
                                      <>
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Generating...
                                      </>
                                    ) : !apiKey ? (
                                      <>
                                        <Key className="h-3 w-3" />
                                        API Key Required
                                      </>
                                    ) : (
                                      <>
                                        <Sparkles className="h-3 w-3" />
                                        Generate
                                      </>
                                    )}
                                  </Button>
                                )}
                              </div>

                              {/* Expanded Content Drawer */}
                              {isExpanded && post.generatedContent && (
                                <div className="mt-2 rounded-lg border border-indigo-200 bg-white overflow-hidden shadow-sm">
                                  {/* Status controls */}
                                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                                      Status:
                                    </span>
                                    <div className="flex gap-1">
                                      {(
                                        Object.entries(STATUS_CONFIG) as [
                                          ApprovalStatus,
                                          typeof STATUS_CONFIG[ApprovalStatus],
                                        ][]
                                      ).map(([key, config]) => (
                                        <button
                                          key={key}
                                          className={`text-[9px] px-2 py-0.5 rounded font-medium transition-all ${
                                            post.status === key
                                              ? config.color + ' ring-1 ring-offset-1'
                                              : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'
                                          }`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            updatePostStatus(post.id, key);
                                          }}
                                        >
                                          {config.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Platform content tabs */}
                                  <div className="max-h-[300px] overflow-y-auto">
                                    {post.platforms.map((platformId) => {
                                      const platform = PLATFORMS.find(
                                        (p) => p.id === platformId
                                      );
                                      if (!platform) return null;

                                      const content =
                                        post.generatedContent?.[
                                          platformId as keyof typeof post.generatedContent
                                        ];
                                      if (!content) return null;

                                      const isEmail = platformId === 'email';
                                      const displayText = isEmail
                                        ? typeof content === 'object'
                                          ? `Subject: ${(content as any).subject}\n\n${(content as any).body}`
                                          : String(content)
                                        : String(content);
                                      const copyKey = `${post.id}-${platformId}`;

                                      return (
                                        <div
                                          key={platformId}
                                          className="border-b border-slate-100 last:border-0"
                                        >
                                          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50/50">
                                            <span className="text-[10px] font-medium flex items-center gap-1">
                                              {platform.emoji} {platform.title}
                                            </span>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-5 px-1.5 text-[10px] gap-0.5"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                copyToClipboard(copyKey, displayText);
                                              }}
                                            >
                                              {copiedTab === copyKey ? (
                                                <>
                                                  <Check className="h-2.5 w-2.5 text-green-500" />
                                                  Copied
                                                </>
                                              ) : (
                                                <>
                                                  <Copy className="h-2.5 w-2.5" />
                                                  Copy
                                                </>
                                              )}
                                            </Button>
                                          </div>
                                          <div className="px-3 py-2">
                                            <p className="text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed line-clamp-6">
                                              {displayText}
                                            </p>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {/* Regenerate */}
                                  <div className="px-3 py-2 bg-slate-50 border-t border-slate-100">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="w-full h-6 text-[10px] gap-1"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleGeneratePost(post);
                                      }}
                                      disabled={generatingPostId === post.id}
                                    >
                                      {generatingPostId === post.id ? (
                                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                      ) : (
                                        <RefreshCw className="h-2.5 w-2.5" />
                                      )}
                                      Regenerate
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}

                      {/* Add post button at bottom of day */}
                      {activities.length > 0 && day.posts.length > 0 && (
                        <button
                          onClick={() => {
                            setAddPostDay(day.dateStr);
                            setAddPostActivityId(activities[0]?.id || '');
                          }}
                          className="w-full flex items-center justify-center gap-1 text-[10px] text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 font-medium py-1.5 rounded-md border border-dashed border-slate-200 hover:border-indigo-300 transition-all"
                        >
                          <Plus className="h-3 w-3" />
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Source Activities Summary */}
            {activities.length > 0 && (
              <Card className="border-0 shadow-sm bg-white/80">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <Zap className="h-4 w-4 text-indigo-500" />
                      Scheduling from {activities.length} event{activities.length > 1 ? 's' : ''}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Auto-scheduled at T-14, T-7, T-3, T-1, Day-of, T+1
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activities.map((a) => {
                      const badge = getSourceBadge(a.source);
                      return (
                        <div
                          key={a.id}
                          className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-100"
                        >
                          {a.sourceUrl ? (
                            <a
                              href={a.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"
                            >
                              {a.title}
                              <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                            </a>
                          ) : (
                            <span className="text-xs font-medium text-slate-700">
                              {a.title}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400">
                            {formatActivityDate(a.startDate)}
                          </span>
                          <Badge
                            className={`${badge.color} border-0 text-[9px] px-1.5 py-0`}
                          >
                            {badge.label}
                          </Badge>
                          <button
                            onClick={() => removeActivity(a.id)}
                            className="text-slate-400 hover:text-red-600 transition-colors"
                            title="Remove activity"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ─── ACTIVITIES TAB ──────────────────────────────────── */}
          <TabsContent value="activities" className="mt-6 space-y-4">
            <div className="flex items-center justify-between bg-white rounded-xl p-4 shadow-sm border border-slate-200/60">
              <h2 className="text-lg font-semibold text-slate-800">
                Source Events & Bookings
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={fetchActivities}
                disabled={isLoadingActivities}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoadingActivities ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>

            {activities.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                <Calendar className="h-12 w-12 mx-auto mb-4 text-slate-300" />
                <h3 className="text-lg font-medium text-slate-500 mb-1">No events</h3>
                <p className="text-sm">Connect Wix or add events manually.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {activities.map((activity) => {
                  const badge = getSourceBadge(activity.source);
                  const postCount = scheduledPosts.filter(
                    (p) => p.activityId === activity.id
                  ).length;
                  const ctxCount = getContextCount(activity);
                  const isContextOpen = contextPanelId === activity.id;

                  return (
                    <div
                      key={activity.id}
                      className={`bg-white rounded-xl border shadow-sm transition-all ${
                        isContextOpen
                          ? 'border-indigo-300 ring-1 ring-indigo-100 shadow-md'
                          : 'border-slate-200/60 hover:shadow-md'
                      }`}
                    >
                      {/* Activity Header */}
                      <div className="p-4 flex items-start gap-4">
                        {(activity.imageUrl || activity.mediaBase64) && (
                          <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border border-slate-100">
                            <img
                              src={activity.imageUrl || activity.mediaBase64 || ''}
                              alt={activity.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              {activity.sourceUrl ? (
                                <a
                                  href={activity.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline underline-offset-2 transition-colors truncate block"
                                >
                                  {activity.title}
                                  <ExternalLink className="h-3 w-3 inline-block ml-1 mb-0.5 opacity-50" />
                                </a>
                              ) : (
                                <h3 className="font-semibold text-slate-800 truncate">
                                  {activity.title}
                                </h3>
                              )}
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                <span className="text-xs text-slate-500 flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {formatActivityDate(activity.startDate)}
                                </span>
                                {activity.location && (
                                  <span className="text-xs text-slate-500 flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    {activity.location}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge className={`${badge.color} border-0 text-[10px] px-2 py-0.5`}>
                                {badge.label}
                              </Badge>
                              <Badge className="bg-indigo-50 text-indigo-600 border-0 text-[10px] px-2 py-0.5">
                                {postCount} posts
                              </Badge>
                              <button
                                  onClick={() => removeActivity(activity.id)}
                                  className="text-slate-400 hover:text-red-600 transition-colors"
                                  title="Remove activity"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                          </div>
                          {activity.description && (
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                              {activity.description}
                            </p>
                          )}
                          {activity.sourceUrl && (
                            <a
                              href={activity.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded-full transition-colors"
                            >
                              <Globe className="h-3 w-3" />
                              View Page
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                          {/* Post schedule + Context toggle row */}
                          <div className="flex items-center justify-between mt-2 gap-2">
                            {postCount > 0 && (
                              <div className="flex flex-wrap gap-1 flex-1">
                                {scheduledPosts
                                  .filter((p) => p.activityId === activity.id)
                                  .map((p) => {
                                    const ac = ANGLE_CONFIG[p.angle];
                                    return (
                                      <span
                                        key={p.id}
                                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${ac.color}`}
                                      >
                                        {ac.emoji} {p.postDate.slice(5)} @ {p.postTime}
                                      </span>
                                    );
                                  })}
                              </div>
                            )}
                            {/* Context Toggle Button */}
                            <Button
                              variant={isContextOpen ? 'default' : 'outline'}
                              size="sm"
                              className={`h-7 text-xs gap-1.5 flex-shrink-0 ${
                                isContextOpen
                                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                  : ctxCount > 0
                                  ? 'border-indigo-300 text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                  : 'border-dashed border-slate-300 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                              }`}
                              onClick={() =>
                                setContextPanelId(isContextOpen ? null : activity.id)
                              }
                            >
                              <Paperclip className="h-3 w-3" />
                              Context
                              {ctxCount > 0 && (
                                <span className={`text-[10px] rounded-full px-1.5 py-0 font-bold ${
                                  isContextOpen ? 'bg-white/20' : 'bg-indigo-100 text-indigo-700'
                                }`}>
                                  {ctxCount}
                                </span>
                              )}
                              {isContextOpen ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* ─── Collapsible Context Panel ─────────────────── */}
                      {isContextOpen && (
                        <div className="border-t border-indigo-100 bg-gradient-to-b from-indigo-50/40 to-white">
                          <div className="p-4 space-y-4">
                            {/* Section: Upload Media */}
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-5 h-5 rounded bg-violet-100 flex items-center justify-center">
                                  <Upload className="h-3 w-3 text-violet-600" />
                                </div>
                                <span className="text-xs font-semibold text-slate-700">
                                  Media &amp; Files
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  Images, flyers, PDFs
                                </span>
                              </div>

                              {/* Existing media thumbnails */}
                              {activity.contextMedia && activity.contextMedia.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-2">
                                  {activity.contextMedia.map((media) => (
                                    <div
                                      key={media.id}
                                      className="relative group rounded-lg overflow-hidden border border-slate-200 bg-white shadow-sm"
                                    >
                                      {media.type === 'image' ? (
                                        <img
                                          src={media.dataUrl}
                                          alt={media.name}
                                          className="w-20 h-20 object-cover"
                                        />
                                      ) : (
                                        <div className="w-20 h-20 flex flex-col items-center justify-center bg-slate-50">
                                          <FileText className="h-6 w-6 text-slate-400" />
                                          <span className="text-[8px] text-slate-400 mt-1 truncate max-w-[72px] px-1">
                                            {media.name}
                                          </span>
                                        </div>
                                      )}
                                      <button
                                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                        onClick={() =>
                                          removeContextAttachment(activity.id, media.id)
                                        }
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                      <div className="absolute bottom-0 inset-x-0 bg-black/50 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <span className="text-[8px] text-white truncate block">
                                          {media.name}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Upload button */}
                              <div
                                className="border-2 border-dashed border-slate-200 rounded-lg p-3 text-center cursor-pointer hover:bg-indigo-50/50 hover:border-indigo-300 transition-all"
                                onClick={() => contextFileRef.current?.click()}
                              >
                                <input
                                  type="file"
                                  ref={contextFileRef}
                                  onChange={(e) => addContextMedia(activity.id, e)}
                                  accept="image/*,.pdf"
                                  className="hidden"
                                />
                                <ImageIcon className="h-5 w-5 mx-auto mb-1 text-slate-400" />
                                <span className="text-xs text-slate-500">
                                  Click to upload image or PDF
                                </span>
                              </div>
                            </div>

                            {/* Section: Reference Links */}
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center">
                                  <LinkIcon className="h-3 w-3 text-blue-600" />
                                </div>
                                <span className="text-xs font-semibold text-slate-700">
                                  Reference Links
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  Websites, registrations, articles
                                </span>
                              </div>

                              {/* Existing links */}
                              {activity.contextLinks && activity.contextLinks.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {activity.contextLinks.map((link) => (
                                    <div
                                      key={link.id}
                                      className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 group"
                                    >
                                      <LinkIcon className="h-2.5 w-2.5 text-blue-500 flex-shrink-0" />
                                      <a
                                        href={link.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] text-blue-700 hover:underline truncate max-w-[200px]"
                                      >
                                        {link.label || link.url}
                                      </a>
                                      <button
                                        className="text-blue-300 hover:text-red-500 transition-colors"
                                        onClick={() =>
                                          removeContextLink(activity.id, link.id)
                                        }
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Add link form */}
                              <div className="flex gap-2">
                                <Input
                                  placeholder="https://..."
                                  value={contextLinkInput}
                                  onChange={(e) => setContextLinkInput(e.target.value)}
                                  className="flex-1 h-8 text-xs"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      addContextLink(activity.id);
                                    }
                                  }}
                                />
                                <Input
                                  placeholder="Label (optional)"
                                  value={contextLinkLabel}
                                  onChange={(e) => setContextLinkLabel(e.target.value)}
                                  className="w-[140px] h-8 text-xs"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      addContextLink(activity.id);
                                    }
                                  }}
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs gap-1 px-3"
                                  onClick={() => addContextLink(activity.id)}
                                  disabled={!contextLinkInput.trim()}
                                >
                                  <Plus className="h-3 w-3" />
                                  Add
                                </Button>
                              </div>
                            </div>

                            {/* Section: Notes / Extra Context */}
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-5 h-5 rounded bg-amber-100 flex items-center justify-center">
                                  <MessageSquare className="h-3 w-3 text-amber-600" />
                                </div>
                                <span className="text-xs font-semibold text-slate-700">
                                  Notes &amp; Context
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  Key details, talking points, tone guidance
                                </span>
                              </div>
                              <Textarea
                                placeholder="e.g. Mention the early-bird discount ends Friday. Use a warm, inviting tone. Highlight that childcare is provided..."
                                value={activity.contextNotes || ''}
                                onChange={(e) =>
                                  updateActivity(activity.id, {
                                    contextNotes: e.target.value,
                                  })
                                }
                                className="h-20 resize-none text-xs leading-relaxed"
                              />
                            </div>

                            {/* Context Summary */}
                            {ctxCount > 0 && (
                              <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                                <span className="text-[11px] text-slate-500">
                                  {ctxCount} context item{ctxCount > 1 ? 's' : ''} attached
                                  {' — '}
                                  <span className="text-indigo-600 font-medium">
                                    will be used during content generation
                                  </span>
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* ─── Add Post to Day Dialog ─────────────────────────────── */}
      <Dialog open={!!addPostDay} onOpenChange={(open) => !open && setAddPostDay(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-indigo-600" />
              Add Post to {addPostDay ? format(parseISO(addPostDay), 'EEEE, MMM d') : ''}
            </DialogTitle>
            <DialogDescription>
              Create a new scheduled post for this day.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Activity selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Activity / Event</Label>
              <Select value={addPostActivityId} onValueChange={setAddPostActivityId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select an activity..." />
                </SelectTrigger>
                <SelectContent>
                  {activities.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {a.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Angle selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Post Angle</Label>
              <Select value={addPostAngle} onValueChange={(v) => setAddPostAngle(v as PostAngle)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(ANGLE_CONFIG) as [PostAngle, typeof ANGLE_CONFIG[PostAngle]][]).map(([key, config]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {config.emoji} {config.label} — {config.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Time selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Post Time</Label>
              <Input
                type="time"
                value={addPostTime}
                onChange={(e) => setAddPostTime(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            {/* Platform toggles */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Platforms</Label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((platform) => {
                  const isSelected = addPostPlatforms.includes(platform.id);
                  return (
                    <button
                      key={platform.id}
                      onClick={() => {
                        setAddPostPlatforms((prev) =>
                          isSelected
                            ? prev.filter((p) => p !== platform.id)
                            : [...prev, platform.id]
                        );
                      }}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-sm'
                          : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      <span>{platform.emoji}</span>
                      <span>{platform.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddPostDay(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white gap-1"
              onClick={handleAddPostToDay}
              disabled={!addPostActivityId || addPostPlatforms.length === 0}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
