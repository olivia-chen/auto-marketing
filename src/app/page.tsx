'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSession, signOut } from 'next-auth/react';
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
  LogOut,
  Search,
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

/** Resolve Wix image:// URIs to real URLs */
function resolveWixImageUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('image://')) {
    const parts = url.replace('image://v1/', '').split('/');
    return `https://static.wixstatic.com/media/${parts[0]}`;
  }
  if (url.startsWith('wix:image://')) {
    const match = url.match(/wix:image:\/\/v1\/([^/]+)/);
    if (match) return `https://static.wixstatic.com/media/${match[1]}`;
  }
  return url;
}

type DriveFileInfo = {
  id: string; name: string; mimeType: string;
  thumbnailUrl: string | null; viewUrl: string | null;
  downloadUrl: string | null; size: number; createdAt: string;
  isImage: boolean; isVideo: boolean;
};
type DriveFolderInfo = { folderId: string; folderUrl: string; folderName: string; path: string };

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

/** Compress an image file client-side, return { base64, mimeType, fileName } */
function compressAndConvert(file: File): Promise<{ base64: string; mimeType: string; fileName: string }> {
  return new Promise((resolve, reject) => {
    // For videos, just read as base64 without compression
    if (file.type.startsWith('video/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve({
          base64: result.split(',')[1] || result,
          mimeType: file.type,
          fileName: file.name,
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    // For images, compress via canvas
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_SIZE = 2048;
      let { width, height } = img;
      if (width > MAX_SIZE || height > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64 = dataUrl.split(',')[1] || dataUrl;
      const baseName = file.name.replace(/\.[^.]+$/, '');
      resolve({
        base64,
        mimeType: 'image/jpeg',
        fileName: `${baseName}.jpg`,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };
    img.src = url;
  });
}

// ─── Main Component ───────────────────────────────────────────────

export default function Home() {
  const { data: session } = useSession();

  // API key
  // Server-side AI provider availability
  const [serverAiStatus, setServerAiStatus] = useState<{ gemini: boolean; openai: boolean }>({ gemini: false, openai: false });

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
  const [generatingPlatform, setGeneratingPlatform] = useState<string | null>(null); // tracks which platform is generating
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('schedule');
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  // Review modal state
  const [reviewModal, setReviewModal] = useState<{
    open: boolean;
    postTitle: string;
    platformId: string;
    platformTitle: string;
    platformEmoji: string;
    content: string;
  } | null>(null);

  // Preset system prompts
  const [promptPresets, setPromptPresets] = useState<{ name: string; prompt: string }[]>([]);
  const [showPresetEditor, setShowPresetEditor] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetPrompt, setNewPresetPrompt] = useState('');

  // Expanded post detail
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);

  // AI Settings
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openai'>('gemini');
  const [brandContext, setBrandContext] = useState('');
  const [showAiSettings, setShowAiSettings] = useState(false);

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

  // Google Drive media state
  const [driveFolders, setDriveFolders] = useState<Record<string, DriveFolderInfo>>({});
  const [driveFiles, setDriveFiles] = useState<Record<string, DriveFileInfo[]>>({});
  const [loadingDriveFolder, setLoadingDriveFolder] = useState<string | null>(null);
  const [loadingDriveFiles, setLoadingDriveFiles] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadActivityRef = useRef<string | null>(null);

  // "Other" upload state
  const [uploadingOther, setUploadingOther] = useState(false);
  const [otherUploadProgress, setOtherUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const otherFileInputRef = useRef<HTMLInputElement>(null);

  // Activity search
  const [activitySearch, setActivitySearch] = useState('');
  const filteredActivities = useMemo(() => {
    if (!activitySearch.trim()) return activities;
    const q = activitySearch.toLowerCase().trim();
    return activities.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.description && a.description.toLowerCase().includes(q))
    );
  }, [activities, activitySearch]);

  // Wix blog publish state
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);
  const [publishedPosts, setPublishedPosts] = useState<Record<string, { url: string }>>({});

  // Load AI settings from localStorage + fetch server-side provider status
  useEffect(() => {
    const savedProvider = localStorage.getItem('ai_provider') as 'gemini' | 'openai' | null;
    if (savedProvider) setAiProvider(savedProvider);
    const savedBrand = localStorage.getItem('brand_context');
    if (savedBrand) setBrandContext(savedBrand);

    // Load saved prompt presets
    const savedPresets = localStorage.getItem('prompt_presets');
    if (savedPresets) {
      try { setPromptPresets(JSON.parse(savedPresets)); } catch {}
    } else {
      // Default presets for TJCF
      const defaults = [
        { name: '🌿 TJCF Default', prompt: 'Write in a warm, community-focused tone. The Joy Culture Foundation promotes wellness, culture, and community through events and programs. Use emojis sparingly. Be inclusive and welcoming.' },
        { name: '🎉 Event Promo', prompt: 'Write exciting, energetic promotional copy. Focus on what attendees will experience and gain. Use action-oriented language. Include clear calls-to-action with registration details.' },
        { name: '📸 Event Recap', prompt: 'Write a grateful, celebratory recap. Highlight community impact, key moments, and participant experiences. Thank attendees and volunteers. Mention upcoming events.' },
        { name: '📢 Announcement', prompt: 'Write a clear, professional announcement. Lead with the most important information. Keep it concise but complete. Use a friendly yet authoritative tone.' },
      ];
      setPromptPresets(defaults);
      localStorage.setItem('prompt_presets', JSON.stringify(defaults));
    }

    // Fetch which AI providers have server-side keys configured
    fetch('/api/ai/status')
      .then((r) => r.json())
      .then((status) => {
        setServerAiStatus(status);
        if (savedProvider === 'openai' && !status.openai && status.gemini) {
          setAiProvider('gemini');
        } else if (savedProvider === 'gemini' && !status.gemini && status.openai) {
          setAiProvider('openai');
        }
      })
      .catch(() => {});
  }, []);

  const handleProviderChange = (val: 'gemini' | 'openai') => {
    setAiProvider(val);
    localStorage.setItem('ai_provider', val);
  };

  const handleBrandContextChange = (val: string) => {
    setBrandContext(val);
    localStorage.setItem('brand_context', val);
  };

  // Preset prompt management
  const savePreset = () => {
    if (!newPresetName.trim() || !newPresetPrompt.trim()) return;
    const updated = [...promptPresets, { name: newPresetName.trim(), prompt: newPresetPrompt.trim() }];
    setPromptPresets(updated);
    localStorage.setItem('prompt_presets', JSON.stringify(updated));
    setNewPresetName('');
    setNewPresetPrompt('');
    setShowPresetEditor(false);
  };

  const deletePreset = (index: number) => {
    const updated = promptPresets.filter((_, i) => i !== index);
    setPromptPresets(updated);
    localStorage.setItem('prompt_presets', JSON.stringify(updated));
  };

  const applyPreset = (prompt: string) => {
    handleBrandContextChange(prompt);
  };

  // ─── Per-Platform Generation ───────────────────────────────────
  const handleGeneratePlatform = async (post: ScheduledPost, platformId: PlatformId) => {
    const providerAvailable = aiProvider === 'openai' ? serverAiStatus.openai : serverAiStatus.gemini;
    if (!providerAvailable) {
      setError(`${aiProvider === 'openai' ? 'OpenAI' : 'Gemini'} is not configured on the server. Contact your administrator.`);
      return;
    }
    if (!post.activity) {
      setError('Activity data not found for this post.');
      return;
    }

    setGeneratingPostId(post.id);
    setGeneratingPlatform(platformId);
    setError(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          activities: [post.activity],
          campaignType: post.activityType,
          angle: post.angle,
          link: post.activity.sourceUrl || '',
          imageBase64: post.activity.mediaBase64,
          notes: post.activity.notes || '',
          platforms: [platformId],
          contextMedia: post.activity.contextMedia || [],
          contextLinks: post.activity.contextLinks || [],
          contextNotes: post.activity.contextNotes || '',
          brandContext: brandContext || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate');

      // Merge into existing generatedContent (keep other platforms)
      setScheduledPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                generatedContent: { ...(p.generatedContent || {}), ...data },
                status: 'needs_review' as ApprovalStatus,
              }
            : p
        )
      );
      setExpandedPostId(post.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGeneratingPostId(null);
      setGeneratingPlatform(null);
    }
  };

  // Open review modal for a platform's content
  const openReviewModal = (post: ScheduledPost, platformId: PlatformId) => {
    const platform = PLATFORMS.find((p) => p.id === platformId);
    if (!platform) return;
    const content = post.generatedContent?.[platformId as keyof typeof post.generatedContent];
    if (!content) return;

    const isEmail = platformId === 'email';
    const displayText = isEmail
      ? typeof content === 'object'
        ? `Subject: ${(content as any).subject}\n\n${(content as any).body}`
        : String(content)
      : String(content);

    setReviewModal({
      open: true,
      postTitle: post.activity?.title || 'Post',
      platformId,
      platformTitle: platform.title,
      platformEmoji: platform.emoji,
      content: displayText,
    });
  };

  // Fetch activities from Wix — pull from 2 weeks ago through far future
  const fetchActivities = useCallback(async () => {
    setIsLoadingActivities(true);
    setError(null);

    // Fetch from 7 days ago (for recap/past events) through +90 days
    const fromDate = format(addDays(new Date(), -7), 'yyyy-MM-dd');
    const futureEnd = format(addDays(new Date(), 90), 'yyyy-MM-dd');

    try {
      const res = await fetch(`/api/wix/activities?from=${fromDate}&to=${futureEnd}`);
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
    const providerAvailable = aiProvider === 'openai' ? serverAiStatus.openai : serverAiStatus.gemini;
    if (!providerAvailable) {
      setError(`${aiProvider === 'openai' ? 'OpenAI' : 'Gemini'} is not configured on the server. Contact your administrator.`);
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
          provider: aiProvider,
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
          brandContext: brandContext || undefined,
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
    const providerAvailable = aiProvider === 'openai' ? serverAiStatus.openai : serverAiStatus.gemini;
    if (!providerAvailable) {
      setError(`${aiProvider === 'openai' ? 'OpenAI' : 'Gemini'} is not configured on the server. Contact your administrator.`);
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
            provider: aiProvider,
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
            brandContext: brandContext || undefined,
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

  // ── Google Drive: open/create activity folder ──
  const openDriveFolder = async (activity: Activity) => {
    // Open window synchronously (before await) to avoid iOS Safari popup blocker
    const newWindow = window.open('about:blank', '_blank');
    setLoadingDriveFolder(activity.id);
    try {
      const res = await fetch('/api/drive/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityTitle: activity.title, startDate: activity.startDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create folder');
      setDriveFolders(prev => ({ ...prev, [activity.id]: data }));

      // Force Google Drive to open under the TJCF account
      const userEmail = session?.user?.email || '';
      const tjcfEmail = userEmail.endsWith('@thejoyculturefoundation.org') ? userEmail : '';

      // Detect mobile device
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const folderId = data.folderId;

      let driveUrl: string;
      if (isMobile && folderId) {
        // Use Google Drive app deep link on mobile for native upload experience
        driveUrl = `https://drive.google.com/drive/folders/${folderId}`;
      } else {
        driveUrl = tjcfEmail
          ? `${data.folderUrl}?authuser=${encodeURIComponent(tjcfEmail)}`
          : `${data.folderUrl}?authuser=0&hd=thejoyculturefoundation.org`;
      }

      if (newWindow) {
        newWindow.location.href = driveUrl;
      } else {
        window.location.href = driveUrl;
      }
    } catch (err: any) {
      setError(err.message);
      if (newWindow) newWindow.close();
    } finally {
      setLoadingDriveFolder(null);
    }
  };

  // ── Google Drive: trigger file picker for in-app upload ──
  // Store the activity info for when files are selected
  const uploadActivityDataRef = useRef<Activity | null>(null);

  const triggerUpload = (activityId: string, activity: Activity) => {
    // Open file picker SYNCHRONOUSLY to preserve user gesture (avoids iOS blocker)
    uploadActivityRef.current = activityId;
    uploadActivityDataRef.current = activity;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const activityId = uploadActivityRef.current;
    const activity = uploadActivityDataRef.current;
    if (!files || files.length === 0 || !activityId || !activity) return;

    // Resolve the Drive folder (create if needed)
    let folder = driveFolders[activityId];
    if (!folder) {
      setUploadingMedia(activityId);
      setUploadProgress({ current: 0, total: files.length });
      try {
        const res = await fetch('/api/drive/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activityTitle: activity.title, startDate: activity.startDate }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create folder');
        folder = data;
        setDriveFolders(prev => ({ ...prev, [activityId]: data }));
      } catch (err: any) {
        setError(err.message);
        setUploadingMedia(null);
        setUploadProgress({ current: 0, total: 0 });
        return;
      }
    } else {
      setUploadingMedia(activityId);
      setUploadProgress({ current: 0, total: files.length });
    }

    // Upload files
    try {
      for (let i = 0; i < files.length; i++) {
        setUploadProgress({ current: i + 1, total: files.length });
        const file = files[i];
        const compressed = await compressAndConvert(file);

        const res = await fetch('/api/drive/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderId: folder.folderId,
            fileName: compressed.fileName,
            mimeType: compressed.mimeType,
            fileData: compressed.base64,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `Failed to upload ${file.name}`);
        }
      }

      // Success notification
      setError(null);
      alert(`✅ ${files.length} file${files.length > 1 ? 's' : ''} uploaded successfully!`);
    } catch (err: any) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      setUploadingMedia(null);
      setUploadProgress({ current: 0, total: 0 });
      uploadActivityRef.current = null;
      uploadActivityDataRef.current = null;
    }
  };

  // ── Google Drive: "Other" upload ──
  const triggerOtherUpload = () => {
    if (otherFileInputRef.current) {
      otherFileInputRef.current.value = '';
      otherFileInputRef.current.click();
    }
  };

  const handleOtherFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingOther(true);
    setOtherUploadProgress({ current: 0, total: files.length });

    try {
      // Get/create the 0-Other folder
      const folderRes = await fetch('/api/drive/other-folder', { method: 'POST' });
      const folderData = await folderRes.json();
      if (!folderRes.ok) throw new Error(folderData.error || 'Failed to get 0-Other folder');

      for (let i = 0; i < files.length; i++) {
        setOtherUploadProgress({ current: i + 1, total: files.length });
        const file = files[i];
        const compressed = await compressAndConvert(file);

        const res = await fetch('/api/drive/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderId: folderData.folderId,
            fileName: compressed.fileName,
            mimeType: compressed.mimeType,
            fileData: compressed.base64,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `Failed to upload ${file.name}`);
        }
      }

      alert(`✅ ${files.length} file${files.length > 1 ? 's' : ''} uploaded to 0-Other!`);
    } catch (err: any) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      setUploadingOther(false);
      setOtherUploadProgress({ current: 0, total: 0 });
    }
  };

  // ── Google Drive: load media files from folder ──
  const loadDriveMedia = async (activity: Activity) => {
    const folder = driveFolders[activity.id];
    if (!folder) {
      // First create/find the folder
      setLoadingDriveFolder(activity.id);
      try {
        const res = await fetch('/api/drive/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activityTitle: activity.title, startDate: activity.startDate }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to find folder');
        setDriveFolders(prev => ({ ...prev, [activity.id]: data }));
        setLoadingDriveFolder(null);
        // Now load files
        setLoadingDriveFiles(activity.id);
        const filesRes = await fetch(`/api/drive/files?folderId=${data.folderId}`);
        const filesData = await filesRes.json();
        if (filesRes.ok) setDriveFiles(prev => ({ ...prev, [activity.id]: filesData.files || [] }));
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoadingDriveFolder(null);
        setLoadingDriveFiles(null);
      }
      return;
    }
    setLoadingDriveFiles(activity.id);
    try {
      const res = await fetch(`/api/drive/files?folderId=${folder.folderId}`);
      const data = await res.json();
      if (res.ok) setDriveFiles(prev => ({ ...prev, [activity.id]: data.files || [] }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingDriveFiles(null);
    }
  };

  // ── Wix Blog: publish post ──
  const handlePublishToWix = async (post: ScheduledPost) => {
    if (!post.generatedContent) return;
    setPublishingPostId(post.id);
    try {
      // Use the first available content (facebook, linkedin, etc.)
      const content = post.generatedContent.facebook ||
        post.generatedContent.linkedin ||
        post.generatedContent.redbook ||
        Object.values(post.generatedContent).find(v => typeof v === 'string' && v.length > 0) || '';
      const res = await fetch('/api/wix/blog/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: post.activityTitle,
          bodyText: String(content),
          coverImageUrl: post.activity?.imageUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed');
      setPublishedPosts(prev => ({ ...prev, [post.id]: { url: data.postUrl || '' } }));
      updatePostStatus(post.id, 'posted');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPublishingPostId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/30 to-emerald-50/20 font-sans">
      {/* Hidden file input for photo upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />
      <input
        ref={otherFileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={handleOtherFileUpload}
      />
      {/* Top Header Bar */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-teal-200/60 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-8 py-2 sm:py-3 flex flex-row justify-between items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img
              src="/tjcf-logo.png"
              alt="The Joy Culture Foundation"
              className="h-8 sm:h-10 w-auto object-contain flex-shrink-0"
            />
            <div className="h-8 w-px bg-teal-200 hidden sm:block" />
            <div className="hidden sm:block">
              <h1 className="text-lg font-bold tracking-tight text-teal-800">
                Campaign Matrix
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
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
            {/* AI provider status badge */}
            <Badge className={`border-0 text-xs gap-1 hidden sm:flex ${
              (aiProvider === 'openai' ? serverAiStatus.openai : serverAiStatus.gemini)
                ? 'bg-teal-100 text-teal-700'
                : 'bg-red-100 text-red-700'
            }`}>
              <Sparkles className="h-3 w-3" />
              {aiProvider === 'openai' ? 'OpenAI' : 'Gemini'}
              {(aiProvider === 'openai' ? serverAiStatus.openai : serverAiStatus.gemini) ? '' : ' — Not Configured'}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="h-8 sm:h-9 gap-1 sm:gap-1.5 text-[10px] sm:text-xs border-teal-200 text-teal-700 hover:bg-teal-50 px-2 sm:px-3"
              onClick={() => setShowAiSettings(!showAiSettings)}
            >
              <Sparkles className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="hidden sm:inline">AI Settings</span>
              <span className="sm:hidden">AI</span>
              {showAiSettings ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>

            {/* User Avatar & Sign Out */}
            {session?.user && (
              <div className="flex items-center gap-2 ml-1">
                <div className="hidden sm:flex items-center gap-1.5">
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt={session.user.name || ''}
                      className="h-7 w-7 rounded-full border border-slate-200"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold">
                      {session.user.name?.[0] || session.user.email?.[0] || '?'}
                    </div>
                  )}
                  <span className="text-xs text-slate-500 max-w-[100px] truncate">
                    {session.user.name?.split(' ')[0] || session.user.email}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50"
                  onClick={() => signOut()}
                  title="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* AI Settings Panel (collapsible) */}
        {showAiSettings && (
          <div className="border-t border-teal-100 bg-gradient-to-r from-teal-50/50 to-emerald-50/50">
            <div className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-8 py-3 sm:py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                {/* Provider Selection */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">AI Provider</Label>
                  <div className="flex gap-2">
                    <button
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        aiProvider === 'gemini'
                          ? 'bg-teal-600 text-white shadow-md shadow-teal-200'
                          : 'bg-white border border-slate-200 text-slate-600 hover:border-teal-300'
                      }`}
                      onClick={() => handleProviderChange('gemini')}
                    >
                      ✨ Gemini
                    </button>
                    <button
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        aiProvider === 'openai'
                          ? 'bg-teal-600 text-white shadow-md shadow-teal-200'
                          : 'bg-white border border-slate-200 text-slate-600 hover:border-teal-300'
                      }`}
                      onClick={() => handleProviderChange('openai')}
                    >
                      🤖 OpenAI
                    </button>
                  </div>
                </div>

                {/* Provider Status */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</Label>
                  <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`h-2 w-2 rounded-full ${serverAiStatus.gemini ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className={serverAiStatus.gemini ? 'text-slate-700' : 'text-slate-400'}>Gemini {serverAiStatus.gemini ? '— Ready' : '— Not configured'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`h-2 w-2 rounded-full ${serverAiStatus.openai ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className={serverAiStatus.openai ? 'text-slate-700' : 'text-slate-400'}>OpenAI {serverAiStatus.openai ? '— Ready' : '— Not configured'}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">API keys are managed by the administrator</p>
                  </div>
                </div>

                {/* Brand Context */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Brand Voice & Style</Label>
                  <Textarea
                    placeholder="e.g. Warm, community-focused, bilingual. Use emojis sparingly..."
                    value={brandContext}
                    onChange={(e) => handleBrandContextChange(e.target.value)}
                    className="h-[72px] text-sm bg-white border-slate-200 resize-none"
                  />
                </div>
              </div>

              {/* Prompt Presets Row */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Prompt Presets</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] gap-1 text-teal-600"
                    onClick={() => setShowPresetEditor(!showPresetEditor)}
                  >
                    <Plus className="h-3 w-3" />
                    {showPresetEditor ? 'Cancel' : 'New Preset'}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {promptPresets.map((preset, idx) => (
                    <div key={idx} className="group relative">
                      <button
                        className={`text-xs px-3 py-1.5 rounded-lg transition-all border ${
                          brandContext === preset.prompt
                            ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300 hover:bg-teal-50'
                        }`}
                        onClick={() => applyPreset(preset.prompt)}
                        title={preset.prompt}
                      >
                        {preset.name}
                      </button>
                      <button
                        className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-red-100 text-red-500 text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-200"
                        onClick={(e) => { e.stopPropagation(); deletePreset(idx); }}
                        title="Delete preset"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                {/* New Preset Editor */}
                {showPresetEditor && (
                  <div className="bg-white rounded-lg border border-teal-200 p-3 space-y-2 mt-2">
                    <Input
                      placeholder="Preset name (e.g. 🎯 Sales Push)"
                      value={newPresetName}
                      onChange={(e) => setNewPresetName(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <Textarea
                      placeholder="System prompt instructions..."
                      value={newPresetPrompt}
                      onChange={(e) => setNewPresetPrompt(e.target.value)}
                      className="h-16 text-sm resize-none"
                    />
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-teal-600 hover:bg-teal-700"
                      onClick={savePreset}
                      disabled={!newPresetName.trim() || !newPresetPrompt.trim()}
                    >
                      Save Preset
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Tab Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="sticky top-[49px] sm:top-[57px] z-40 bg-slate-50/80 backdrop-blur-lg -mx-3 sm:-mx-4 md:-mx-8 px-3 sm:px-4 md:px-8 py-2 sm:py-3 border-b border-slate-200/40">
           <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
            <TabsList className="bg-white shadow-sm border border-slate-200/60 w-full sm:w-auto">
              <TabsTrigger
                value="schedule"
                className="data-[state=active]:bg-teal-600 data-[state=active]:text-white gap-1.5 sm:gap-2 text-xs sm:text-sm flex-1 sm:flex-initial"
              >
                <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Schedule
              </TabsTrigger>
              <TabsTrigger
                value="activities"
                className="data-[state=active]:bg-teal-600 data-[state=active]:text-white gap-1.5 sm:gap-2 text-xs sm:text-sm flex-1 sm:flex-initial"
              >
                <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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
                    className="gap-1 border-dashed border-teal-300 text-teal-600 hover:bg-teal-50"
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
            <div className="flex items-center justify-between bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-slate-200/60">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
                onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-center min-w-0 flex-1 px-1">
                <h2 className="text-sm sm:text-lg font-semibold text-slate-800">
                  {formatDateRange(weekRange.start, weekRange.end)}
                </h2>
                <p className="text-[10px] sm:text-xs text-slate-500 truncate">
                  {totalPosts} posts · {generatedCount} generated · {activities.length} events
                </p>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentDate(new Date())}
                  className="text-[10px] sm:text-xs text-teal-600 h-8 px-2 sm:px-3"
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
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
              <div className="flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-teal-200/50">
                <div>
                  <p className="text-sm font-medium text-teal-800">
                    {batchGenerating
                      ? `Generating ${batchProgress.current}/${batchProgress.total}...`
                      : `${ungeneratedPosts.length} post${ungeneratedPosts.length > 1 ? 's' : ''} ready to generate`}
                  </p>
                  <p className="text-xs text-teal-600/70 mt-0.5">
                    {generatedCount > 0 ? `${generatedCount} already generated` : 'Generate content for all scheduled posts'}
                  </p>
                </div>
                <Button
                  onClick={handleBatchGenerate}
                  disabled={batchGenerating}
                  className={`gap-2 shadow-md ${
                    !(serverAiStatus.gemini || serverAiStatus.openai)
                      ? 'bg-slate-300 text-slate-500 hover:bg-slate-400'
                      : 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-indigo-700 hover:to-purple-700 text-white'
                  }`}
                >
                  {batchGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {batchProgress.current}/{batchProgress.total}
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
            <div className="flex flex-wrap gap-1.5 sm:gap-2 px-1">
              {(Object.entries(ANGLE_CONFIG) as [PostAngle, typeof ANGLE_CONFIG[PostAngle]][]).map(
                ([key, config]) => (
                  <span
                    key={key}
                    className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${config.color}`}
                    title={`${config.description} — ${config.timing}`}
                  >
                    {config.emoji} {config.label}
                    <span className="opacity-60 text-[9px]">({config.timing})</span>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                {daySchedules.map((day) => (
                  <div
                    key={day.dateStr}
                    className={`rounded-xl border transition-all ${
                      dragOverDay === day.dateStr
                        ? 'border-indigo-400 bg-teal-50/60 ring-2 ring-teal-200 shadow-lg'
                        : day.isToday
                        ? 'border-teal-300 bg-teal-50/30 shadow-md shadow-teal-100'
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
                          ? 'border-teal-200 bg-teal-100/50'
                          : 'border-slate-100 bg-slate-50/50'
                      }`}
                    >
                      <div
                        className={`text-xs font-medium uppercase tracking-wider ${
                          day.isToday ? 'text-teal-600' : 'text-slate-400'
                        }`}
                      >
                        {day.dayName}
                      </div>
                      <div
                        className={`text-sm font-semibold ${
                          day.isToday ? 'text-teal-800' : 'text-slate-700'
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
                              className="flex items-center gap-1 text-[10px] text-teal-500 hover:text-teal-700 font-medium transition-colors"
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
                                className={`rounded-lg border p-2 cursor-pointer active:cursor-grabbing transition-all hover:shadow-md ${
                                  isExpanded
                                    ? 'border-teal-300 ring-1 ring-teal-200 shadow-md'
                                    : post.generatedContent
                                    ? 'border-emerald-200 bg-emerald-50/30'
                                    : 'border-slate-200 hover:border-slate-300'
                                }`}
                                onClick={() => {
                                  // Navigate to Activities tab and highlight the activity
                                  setActiveTab('activities');
                                  setContextPanelId(post.activityId);
                                  // Scroll to the activity card after tab switch
                                  setTimeout(() => {
                                    const el = document.getElementById(`activity-${post.activityId}`);
                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  }, 100);
                                }}
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

                                {/* Per-Platform Generate/Content */}
                                <div className="mt-2 space-y-1">
                                  {post.platforms.map((platformId) => {
                                    const platform = PLATFORMS.find((p) => p.id === platformId);
                                    if (!platform) return null;

                                    const content = post.generatedContent?.[platformId as keyof typeof post.generatedContent];
                                    const isPlatformGenerating = generatingPostId === post.id && generatingPlatform === platformId;
                                    const isEmail = platformId === 'email';
                                    const displayText = content
                                      ? isEmail
                                        ? typeof content === 'object'
                                          ? `Subject: ${(content as any).subject}\n\n${(content as any).body}`
                                          : String(content)
                                        : String(content)
                                      : '';
                                    const copyKey = `${post.id}-${platformId}`;

                                    return (
                                      <div key={platformId} className="rounded-md border border-slate-200 overflow-hidden">
                                        <div className="flex items-center justify-between px-2 py-1 bg-slate-50">
                                          <span className="text-[10px] font-medium flex items-center gap-1">
                                            {platform.emoji} {platform.title}
                                          </span>
                                          <div className="flex items-center gap-0.5">
                                            {content && (
                                              <>
                                                <button
                                                  className="h-5 px-1.5 text-[9px] rounded text-slate-500 hover:bg-slate-200 flex items-center gap-0.5 transition-colors"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    copyToClipboard(copyKey, displayText);
                                                  }}
                                                >
                                                  {copiedTab === copyKey ? (
                                                    <><Check className="h-2.5 w-2.5 text-green-500" /> Copied</>
                                                  ) : (
                                                    <><Copy className="h-2.5 w-2.5" /> Copy</>
                                                  )}
                                                </button>
                                                <button
                                                  className="h-5 px-1.5 text-[9px] rounded text-teal-600 hover:bg-teal-100 flex items-center gap-0.5 transition-colors"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    openReviewModal(post, platformId);
                                                  }}
                                                >
                                                  <ExternalLink className="h-2.5 w-2.5" /> Review
                                                </button>
                                              </>
                                            )}
                                            <button
                                              className={`h-5 px-1.5 text-[9px] rounded flex items-center gap-0.5 transition-colors ${
                                                content
                                                  ? 'text-slate-500 hover:bg-slate-200'
                                                  : 'text-white bg-teal-600 hover:bg-teal-700'
                                              }`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleGeneratePlatform(post, platformId);
                                              }}
                                              disabled={isPlatformGenerating}
                                            >
                                              {isPlatformGenerating ? (
                                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                              ) : content ? (
                                                <RefreshCw className="h-2.5 w-2.5" />
                                              ) : (
                                                <Sparkles className="h-2.5 w-2.5" />
                                              )}
                                              {isPlatformGenerating ? '...' : content ? 'Redo' : 'Generate'}
                                            </button>
                                          </div>
                                        </div>

                                        {/* Preview of content (click to review) */}
                                        {content && (
                                          <button
                                            className="w-full px-2 py-1.5 text-left hover:bg-teal-50/30 transition-colors cursor-pointer"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openReviewModal(post, platformId);
                                            }}
                                          >
                                            <p className="text-[10px] text-slate-500 whitespace-pre-wrap leading-relaxed line-clamp-2">
                                              {displayText}
                                            </p>
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}

                                  {/* Generate All button */}
                                  {!post.generatedContent && (
                                    <Button
                                      size="sm"
                                      className="w-full h-7 text-xs gap-1 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleGeneratePost(post);
                                      }}
                                      disabled={generatingPostId === post.id && !generatingPlatform}
                                    >
                                      {generatingPostId === post.id && !generatingPlatform ? (
                                        <><Loader2 className="h-3 w-3 animate-spin" /> Generating All...</>
                                      ) : (
                                        <><Sparkles className="h-3 w-3" /> Generate All Platforms</>
                                      )}
                                    </Button>
                                  )}
                                </div>

                                {/* Publish to Website as Blog */}
                                {post.generatedContent && (
                                  <button
                                    className={`w-full mt-1 flex items-center justify-center gap-1 py-1 rounded-md border text-[10px] font-medium transition-colors ${
                                      post.status === 'posted'
                                        ? 'border-blue-200 bg-blue-50 text-blue-600'
                                        : publishingPostId === post.id
                                        ? 'border-teal-300 bg-teal-50 text-teal-700'
                                        : 'border-teal-200 bg-teal-50/50 text-teal-600 hover:bg-teal-100 hover:border-teal-300'
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (post.status !== 'posted') {
                                        handlePublishToWix(post);
                                      }
                                    }}
                                    disabled={publishingPostId === post.id || post.status === 'posted'}
                                  >
                                    {publishingPostId === post.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : post.status === 'posted' ? (
                                      <Check className="h-3 w-3" />
                                    ) : (
                                      <Globe className="h-3 w-3" />
                                    )}
                                    {post.status === 'posted' ? 'Published to Blog' : 'Publish to Website as Blog'}
                                  </button>
                                )}
                              </div>
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
                          className="w-full flex items-center justify-center gap-1 text-[10px] text-slate-400 hover:text-teal-600 hover:bg-teal-50 font-medium py-1.5 rounded-md border border-dashed border-slate-200 hover:border-teal-300 transition-all"
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
                      <Zap className="h-4 w-4 text-teal-500" />
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
                              className="text-xs font-medium text-teal-600 hover:text-teal-800 hover:underline flex items-center gap-1"
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
            <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-slate-200/60 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-semibold text-slate-800">
                  Source Events & Bookings
                </h2>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-[10px] sm:text-xs gap-1 sm:gap-1.5 border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100 hover:text-orange-700"
                    onClick={triggerOtherUpload}
                    disabled={uploadingOther}
                  >
                    {uploadingOther ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {otherUploadProgress.current}/{otherUploadProgress.total}
                      </>
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    Upload Other Photos
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
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search activities..."
                  value={activitySearch}
                  onChange={(e) => setActivitySearch(e.target.value)}
                  className="h-8 pl-8 text-sm bg-slate-50 border-slate-200 focus:bg-white"
                />
                {activitySearch && (
                  <button
                    onClick={() => setActivitySearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {activities.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                <Calendar className="h-12 w-12 mx-auto mb-4 text-slate-300" />
                <h3 className="text-lg font-medium text-slate-500 mb-1">No events</h3>
                <p className="text-sm">Connect Wix or add events manually.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredActivities.map((activity) => {
                  const badge = getSourceBadge(activity.source);
                  const postCount = scheduledPosts.filter(
                    (p) => p.activityId === activity.id
                  ).length;
                  const ctxCount = getContextCount(activity);
                  const isContextOpen = contextPanelId === activity.id;

                  return (
                    <div
                      key={activity.id}
                      id={`activity-${activity.id}`}
                      className={`bg-white rounded-xl border shadow-sm transition-all ${
                        isContextOpen
                          ? 'border-teal-300 ring-1 ring-teal-100 shadow-md'
                          : 'border-slate-200/60 hover:shadow-md'
                      }`}
                    >
                      {/* Activity Header */}
                      <div className="p-3 sm:p-4 flex items-start gap-3 sm:gap-4">
                        {(activity.imageUrl || activity.mediaBase64) && (
                          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg overflow-hidden flex-shrink-0 border border-slate-100">
                            <img
                              src={resolveWixImageUrl(activity.imageUrl) || activity.mediaBase64 || ''}
                              alt={activity.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-2">
                            <div className="min-w-0">
                              {activity.sourceUrl ? (
                                <a
                                  href={activity.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-semibold text-teal-700 hover:text-teal-900 hover:underline underline-offset-2 transition-colors truncate block"
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
                            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap">
                              <Badge className={`${badge.color} border-0 text-[10px] px-2 py-0.5`}>
                                {badge.label}
                              </Badge>
                              <Badge className="bg-teal-50 text-teal-600 border-0 text-[10px] px-2 py-0.5">
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

                          {/* Google Drive: Upload & Browse Media */}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] sm:text-xs gap-1 sm:gap-1.5 border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 hover:text-teal-800"
                              onClick={() => triggerUpload(activity.id, activity)}
                              disabled={uploadingMedia === activity.id || loadingDriveFolder === activity.id}
                            >
                              {uploadingMedia === activity.id ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  {uploadProgress.current}/{uploadProgress.total}
                                </>
                              ) : loadingDriveFolder === activity.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Upload className="h-3 w-3" />
                              )}
                              Upload Photos
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] sm:text-xs gap-1 sm:gap-1.5 border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 hover:text-blue-700"
                              onClick={() => openDriveFolder(activity)}
                              disabled={loadingDriveFolder === activity.id}
                            >
                              <ExternalLink className="h-3 w-3" />
                              View in Drive
                            </Button>
                          </div>
                          {/* Context toggle row */}
                          <div className="flex items-center justify-end mt-2 gap-2">
                            <Button
                              variant={isContextOpen ? 'default' : 'outline'}
                              size="sm"
                              className={`h-7 text-xs gap-1.5 flex-shrink-0 ${
                                isContextOpen
                                  ? 'bg-teal-600 hover:bg-teal-700 text-white'
                                  : ctxCount > 0
                                  ? 'border-teal-300 text-teal-600 bg-teal-50 hover:bg-teal-100'
                                  : 'border-dashed border-slate-300 text-slate-500 hover:border-teal-300 hover:text-teal-600'
                              }`}
                              onClick={() =>
                                setContextPanelId(isContextOpen ? null : activity.id)
                              }
                            >
                              <Paperclip className="h-3 w-3" />
                              Add Context
                              {ctxCount > 0 && (
                                <span className={`text-[10px] rounded-full px-1.5 py-0 font-bold ${
                                  isContextOpen ? 'bg-white/20' : 'bg-teal-100 text-teal-700'
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
                                className="border-2 border-dashed border-slate-200 rounded-lg p-3 text-center cursor-pointer hover:bg-teal-50/50 hover:border-teal-300 transition-all"
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
                                  <span className="text-teal-600 font-medium">
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
              <Plus className="h-4 w-4 text-teal-600" />
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
                          ? 'bg-teal-50 border-teal-300 text-teal-700 shadow-sm'
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
              className="bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-indigo-700 hover:to-purple-700 text-white gap-1"
              onClick={handleAddPostToDay}
              disabled={!addPostActivityId || addPostPlatforms.length === 0}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Review Modal ─────────────────────────────────── */}
      <Dialog open={!!reviewModal?.open} onOpenChange={(open) => !open && setReviewModal(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <span className="text-xl">{reviewModal?.platformEmoji}</span>
              {reviewModal?.platformTitle} — {reviewModal?.postTitle}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Review the generated content below. Click Copy to copy to clipboard.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
              <pre className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed font-sans">
                {reviewModal?.content}
              </pre>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (reviewModal?.content) {
                  navigator.clipboard.writeText(reviewModal.content);
                  setCopiedTab('review-modal');
                  setTimeout(() => setCopiedTab(null), 2000);
                }
              }}
            >
              {copiedTab === 'review-modal' ? (
                <><Check className="h-3.5 w-3.5 text-green-500" /> Copied!</>
              ) : (
                <><Copy className="h-3.5 w-3.5" /> Copy to Clipboard</>
              )}
            </Button>
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => setReviewModal(null)}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
