import { NextRequest, NextResponse } from 'next/server';
import { queryWixEvents, listWixServices, queryFutureCourses, WixService } from '@/lib/wix-client';
import { Activity } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * GET /api/wix/activities?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Fetches upcoming activities from Wix Bookings (COURSE-type services)
 * and merges them into a unified Activity[] format.
 *
 * Uses service schedule metadata (firstSessionStart/lastSessionEnd)
 * instead of the Calendar API which returns stale session records.
 */
export async function GET(req: NextRequest) {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;

  if (!apiKey || !siteId) {
    return NextResponse.json(
      {
        error: 'WIX_API_KEY and WIX_SITE_ID must be set in environment variables.',
        setupInstructions:
          'Go to Wix Dashboard → Settings → API Keys to create an API key, then add WIX_API_KEY and WIX_SITE_ID to .env.local',
      },
      { status: 500 }
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const fromDate =
    searchParams.get('from') || new Date().toISOString().split('T')[0];
  const toDate =
    searchParams.get('to') ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

  const options = { apiKey, siteId };

  // Some Wix fields may be objects instead of strings
  const str = (val: any): string | undefined => {
    if (!val) return undefined;
    if (typeof val === 'string') return val;
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  /**
   * Resolve a Wix media reference to a full CDN URL.
   * Wix returns image URLs in several formats:
   *   - "wix:image://v1/<mediaId>/<originalFilename>#..."  (URI scheme)
   *   - "<mediaId>"  (bare filename like "abc123~mv2.jpeg")
   *   - full https URL (already usable)
   */
  const resolveWixImageUrl = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    // Already a full URL
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    // Wix URI scheme: wix:image://v1/<mediaId>/<originalFilename>#originWidth=...&originHeight=...
    if (raw.startsWith('wix:image://')) {
      const parts = raw.replace('wix:image://v1/', '').split('/');
      const mediaId = parts[0];
      if (mediaId) return `https://static.wixstatic.com/media/${mediaId}`;
    }
    // Bare filename — prefix with CDN base
    return `https://static.wixstatic.com/media/${raw}`;
  };

  try {
    // Fetch COURSE and CLASS services from Wix Bookings
    const services = await queryFutureCourses(options, fromDate);

    const activities: Activity[] = [];

    // Convert services to Activities using schedule metadata
    for (const service of services) {
      const startDate = service.schedule?.firstSessionStart;
      if (!startDate) continue;

      // Map Wix service type → internal CampaignType
      const serviceType = (service as any).type;
      const campaignType = serviceType === 'CLASS' ? 'class' : 'workshop';

      activities.push({
        id: service.id || uuidv4(),
        title: str(service.name) || `Untitled ${serviceType === 'CLASS' ? 'Class' : 'Course'}`,
        description: str(service.description),
        startDate,
        endDate: service.schedule?.lastSessionEnd || undefined,
        location: undefined,
        imageUrl: resolveWixImageUrl(service.media?.mainMedia?.image?.url),
        sourceUrl:
          service.urls?.bookingPageUrl ||
          service.urls?.servicePage?.url,
        source: 'wix-booking',
        type: campaignType,
        selected: false,
      });
    }

    // Exclude recurring/drop-in activities that don't need marketing
    const excludePrefixes = ['online', 'drop in'];
    const filtered = activities.filter((a) => {
      const lower = a.title.toLowerCase();
      return !excludePrefixes.some((prefix) => lower.startsWith(prefix));
    });

    // Sort by start date (first session)
    filtered.sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

    return NextResponse.json({
      activities: filtered,
      meta: {
        fromDate,
        toDate,
        serviceCount: services.length,
        totalActivities: filtered.length,
      },
    });
  } catch (error: any) {
    console.error('Error fetching Wix activities:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch activities from Wix' },
      { status: 500 }
    );
  }
}
