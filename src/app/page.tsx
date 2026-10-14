'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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
  FileText,
  Loader2,
  Plus,
  Calendar,
  MapPin,
  RefreshCw,
  Globe,
  ExternalLink,
  Trash2,
  AlertCircle,
  Upload,
  X,
  LogOut,
  Search,
  ClipboardList,
} from 'lucide-react';
import { Activity, CampaignType, CAMPAIGN_TYPES } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import CampaignCalendar from '@/components/CampaignCalendar';
import { format, parseISO, addDays } from 'date-fns';

// ─── Helpers ──────────────────────────────────────────────────────

function formatActivityDate(dateStr: string | unknown) {
  try {
    let raw: unknown = dateStr;
    if (typeof raw === 'object' && raw !== null) {
      const o = raw as { utcDate?: string; localDate?: string };
      raw = o.utcDate || o.localDate || '';
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

type DriveFolderInfo = { folderId: string; folderUrl: string; folderName: string; path: string };

/** Coerce a possibly-object location (Wix address) to a display string. */
function locationText(loc: unknown): string {
  if (!loc) return '';
  if (typeof loc === 'string') return loc;
  if (typeof loc === 'object') {
    const o = loc as Record<string, unknown>;
    const v = o.formattedAddress || o.name || o.address || o.city || '';
    return typeof v === 'string' ? v : '';
  }
  return String(loc);
}

function getSourceBadge(source: Activity['source']) {
  switch (source) {
    case 'wix-event':
      return { label: 'Wix Event', color: 'bg-purple-100 text-purple-700' };
    case 'wix-booking':
      return { label: 'Wix Booking', color: 'bg-blue-100 text-blue-700' };
    case 'manual':
      return { label: 'Manual', color: 'bg-amber-100 text-amber-700' };
    default:
      return { label: 'Source', color: 'bg-slate-100 text-slate-600' };
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

  // Activities (from Wix + manual)
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [wixConnected, setWixConnected] = useState<boolean | null>(null);
  const [exportingCalendar, setExportingCalendar] = useState(false);

  // Manual event dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualType, setManualType] = useState<CampaignType>('announcement');
  const [manualLink, setManualLink] = useState('');
  const [manualNotes, setManualNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('schedule');
  const [activitySearch, setActivitySearch] = useState('');

  // Google Drive media state
  const [driveFolders, setDriveFolders] = useState<Record<string, DriveFolderInfo>>({});
  const [loadingDriveFolder, setLoadingDriveFolder] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadActivityRef = useRef<string | null>(null);
  const uploadActivityDataRef = useRef<Activity | null>(null);

  // "Other" upload state
  const [uploadingOther, setUploadingOther] = useState(false);
  const [otherUploadProgress, setOtherUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const otherFileInputRef = useRef<HTMLInputElement>(null);

  // ─── Fetch activities from Wix ────────────────────────────────
  const fetchActivities = useCallback(async () => {
    setIsLoadingActivities(true);
    setError(null);

    // Fetch from 7 days ago (for recent events) through +90 days
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
    } catch (err) {
      console.error('Fetch error:', err);
      setWixConnected(false);
    } finally {
      setIsLoadingActivities(false);
    }
  }, []);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Load shared manual calendar entries (persisted in the workflow sheet) and
  // merge them in, replacing any in-memory manual entries with the stored set.
  const fetchManualEntries = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/entries');
      if (!res.ok) return; // not configured / not signed in — leave as-is
      const data = await res.json();
      const stored: Activity[] = Array.isArray(data.entries) ? data.entries : [];
      setActivities((prev) => {
        const nonManual = prev.filter((a) => a.source !== 'manual');
        return [...nonManual, ...stored].sort(
          (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
        );
      });
    } catch (err) {
      console.error('Failed to load manual calendar entries:', err);
    }
  }, []);

  useEffect(() => {
    fetchManualEntries();
  }, [fetchManualEntries]);

  const filteredActivities = useMemo(() => {
    if (!activitySearch.trim()) return activities;
    const q = activitySearch.toLowerCase().trim();
    return activities.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        (a.description && a.description.toLowerCase().includes(q))
    );
  }, [activities, activitySearch]);

  // ─── Add manual campaign — persisted (shared) ─────────────────
  const addManualCampaign = async () => {
    if (!manualTitle) return;
    const startDate = manualDate || new Date().toISOString();
    const payload = {
      title: manualTitle,
      startDate,
      type: manualType,
      notes: manualNotes || undefined,
      sourceUrl: manualLink || undefined,
    };

    // Clear the form immediately for a responsive feel.
    setManualTitle('');
    setManualDate('');
    setManualType('announcement');
    setManualLink('');
    setManualNotes('');
    setShowAddDialog(false);

    const addLocal = (activity: Activity) => {
      setActivities((prev) =>
        [...prev, activity].sort(
          (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
        )
      );
    };

    try {
      const res = await fetch('/api/calendar/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.activity) {
        addLocal(data.activity as Activity);
      } else {
        // Persistence unavailable — keep the entry in-memory so the user
        // isn't blocked, but warn that it won't be shared/saved.
        addLocal({
          id: uuidv4(),
          title: payload.title,
          description: manualNotes,
          startDate,
          sourceUrl: manualLink || undefined,
          source: 'manual',
          type: manualType,
          notes: manualNotes,
          selected: false,
        });
        if (data?.error) console.warn('Manual entry not persisted:', data.error);
      }
    } catch (err) {
      console.error('Failed to save manual entry:', err);
      addLocal({
        id: uuidv4(),
        title: payload.title,
        description: manualNotes,
        startDate,
        sourceUrl: manualLink || undefined,
        source: 'manual',
        type: manualType,
        notes: manualNotes,
        selected: false,
      });
    }
  };

  const removeActivity = (id: string) => {
    const target = activities.find((a) => a.id === id);
    setActivities((prev) => prev.filter((a) => a.id !== id));
    // Delete the shared/persisted copy of manual entries (best-effort).
    if (target?.source === 'manual') {
      fetch(`/api/calendar/entries?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch((err) => console.error('Failed to delete manual entry:', err));
    }
  };

  // ─── Export whole year to the Calendar Export Google Sheet ───
  const exportCalendarYear = async () => {
    const year = new Date().getFullYear();
    type ExportEntry = { date: string; title: string; time?: string; source?: string };
    const entries = activities
      .map((a): ExportEntry | null => {
        let raw: unknown = a.startDate;
        if (raw && typeof raw === 'object') {
          const o = raw as { utcDate?: string; localDate?: string };
          raw = o.utcDate || o.localDate || '';
        }
        if (typeof raw !== 'string' || !raw) return null;
        const d = parseISO(raw);
        if (isNaN(d.getTime())) return null;
        if (d.getFullYear() !== year) return null;
        const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
        return {
          date: format(d, 'yyyy-MM-dd'),
          title: a.title,
          time: hasTime ? format(d, 'h:mma').toLowerCase() : undefined,
          source: a.source,
        };
      })
      .filter((e): e is ExportEntry => e !== null);

    setExportingCalendar(true);
    try {
      const res = await fetch('/api/calendar/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, entries }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Export failed. Please try again.');
        return;
      }
      const open = window.confirm(
        `Exported ${data.entryCount ?? entries.length} entries to the "${data.tabName}" tab of the Calendar Export sheet.\n\nOpen the sheet now?`
      );
      if (open && data.url) window.open(data.url, '_blank');
    } catch (err) {
      console.error('Calendar export failed:', err);
      alert('Export failed. Please check your connection and try again.');
    } finally {
      setExportingCalendar(false);
    }
  };

  // ─── Google Drive: open / create an event folder ──────────────
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
      setDriveFolders((prev) => ({ ...prev, [activity.id]: data }));

      // Force Google Drive to open under the TJCF account
      const userEmail = session?.user?.email || '';
      const tjcfEmail = userEmail.endsWith('@thejoyculturefoundation.org') ? userEmail : '';

      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const folderId = data.folderId;

      let driveUrl: string;
      if (isMobile && folderId) {
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
    } catch (err) {
      setError((err as Error).message);
      if (newWindow) newWindow.close();
    } finally {
      setLoadingDriveFolder(null);
    }
  };

  // ── Google Drive: trigger file picker for in-app upload ──
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
        setDriveFolders((prev) => ({ ...prev, [activityId]: data }));
      } catch (err) {
        setError((err as Error).message);
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

      setError(null);
      alert(`✅ ${files.length} file${files.length > 1 ? 's' : ''} uploaded successfully!`);
    } catch (err) {
      setError(`Upload failed: ${(err as Error).message}`);
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
    } catch (err) {
      setError(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploadingOther(false);
      setOtherUploadProgress({ current: 0, total: 0 });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/30 to-emerald-50/20 font-sans">
      {/* Hidden file inputs for photo upload */}
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
            <a href="/workflow">
              <Button
                variant="outline"
                size="sm"
                className="h-8 sm:h-9 gap-1 sm:gap-1.5 text-[10px] sm:text-xs border-teal-200 text-teal-700 hover:bg-teal-50 px-2 sm:px-3"
              >
                <ClipboardList className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="hidden sm:inline">Workflow</span>
                <span className="sm:hidden">Tasks</span>
              </Button>
            </a>

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
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="sticky top-[49px] sm:top-[57px] z-40 bg-slate-50/80 backdrop-blur-lg -mx-3 sm:-mx-4 md:-mx-8 px-3 sm:px-4 md:px-8 py-2 sm:py-3 border-b border-slate-200/40">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
              <TabsList className="bg-white shadow-sm border border-slate-200/60 w-full sm:w-auto">
                <TabsTrigger
                  value="schedule"
                  className="data-[state=active]:bg-teal-600 data-[state=active]:text-white gap-1.5 sm:gap-2 text-xs sm:text-sm flex-1 sm:flex-initial"
                >
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  Calendar
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
                        Add an event Wix doesn&apos;t track (classes, storytime, school
                        notes, partnerships). It&apos;s saved and shared with the team.
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

          {/* ─── CALENDAR TAB ──────────────────────────────────── */}
          <TabsContent value="schedule" className="mt-6 space-y-4">
            <CampaignCalendar
              activities={activities}
              onAddEntry={(dateISO) => {
                setManualDate(dateISO);
                setShowAddDialog(true);
              }}
              onExport={exportCalendarYear}
              exporting={exportingCalendar}
            />
          </TabsContent>

          {/* ─── ACTIVITIES TAB ──────────────────────────────────── */}
          <TabsContent value="activities" className="mt-6 space-y-4">
            <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-slate-200/60 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-semibold text-slate-800">
                  Source Events &amp; Bookings
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
                  return (
                    <div
                      key={activity.id}
                      id={`activity-${activity.id}`}
                      className="bg-white rounded-xl border border-slate-200/60 shadow-sm hover:shadow-md transition-all"
                    >
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
                                {locationText(activity.location) && (
                                  <span className="text-xs text-slate-500 flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    {locationText(activity.location)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap">
                              <Badge className={`${badge.color} border-0 text-[10px] px-2 py-0.5`}>
                                {badge.label}
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

                          {/* Google Drive: Upload & View event photos */}
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
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
