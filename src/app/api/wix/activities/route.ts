import { NextRequest, NextResponse } from 'next/server';
import { queryFutureCourses, querySessionsForSchedule } from '@/lib/wix-client';
import { Activity } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * GET /api/wix/activities?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Fetches upcoming activities from Wix Bookings (COURSE-type services)
 * and expands multi-session courses into individual session activities.
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
   */
  const resolveWixImageUrl = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    if (raw.startsWith('wix:image://')) {
      const parts = raw.replace('wix:image://v1/', '').split('/');
      const mediaId = parts[0];
      if (mediaId) return `https://static.wixstatic.com/media/${mediaId}`;
    }
    return `https://static.wixstatic.com/media/${raw}`;
  };

  try {
    // Fetch COURSE and CLASS services from Wix Bookings
    const services = await queryFutureCourses(options, fromDate);

    const activities: Activity[] = [];

    // For each service, fetch individual sessions and create one Activity per session
    for (const service of services) {
      const scheduleId = service.schedule?.id;
      const serviceName = str(service.name) || 'Untitled';
      const serviceType = (service as any).type;
      const campaignType = serviceType === 'CLASS' ? 'class' : 'workshop';
      const imageUrl = resolveWixImageUrl(service.media?.mainMedia?.image?.url);
      const sourceUrl = service.urls?.bookingPageUrl || service.urls?.servicePage?.url;

      if (scheduleId) {
        // Query individual sessions from Calendar V3
        console.log(`[Sessions] Querying sessions for "${serviceName}" scheduleId=${scheduleId} from=${fromDate} to=${toDate}`);
        const sessions = await querySessionsForSchedule(options, scheduleId, fromDate, toDate);
        console.log(`[Sessions] Got ${sessions.length} sessions for "${serviceName}"`, sessions.length > 0 ? JSON.stringify(sessions[0]).slice(0, 200) : 'EMPTY');

        if (sessions.length > 1) {
          // Multi-session: create one activity per session
          sessions.sort((a, b) => {
            const aTime = a.start?.timestamp ? new Date(a.start.timestamp).getTime() : 0;
            const bTime = b.start?.timestamp ? new Date(b.start.timestamp).getTime() : 0;
            return aTime - bTime;
          });

          sessions.forEach((session, index) => {
            const sessionStart = session.start?.timestamp;
            if (!sessionStart) return;

            activities.push({
              id: session.id || `${service.id}-session-${index}`,
              title: `${serviceName} (Session ${index + 1}/${sessions.length})`,
              description: str(service.description),
              startDate: sessionStart,
              endDate: session.end?.timestamp || undefined,
              location: undefined,
              imageUrl,
              sourceUrl,
              source: 'wix-booking',
              type: campaignType,
              selected: false,
            });
          });
        } else if (sessions.length === 1) {
          // Single session
          const session = sessions[0];
          activities.push({
            id: session.id || service.id || uuidv4(),
            title: serviceName,
            description: str(service.description),
            startDate: session.start?.timestamp || service.schedule?.firstSessionStart || new Date().toISOString(),
            endDate: session.end?.timestamp || undefined,
            location: undefined,
            imageUrl,
            sourceUrl,
            source: 'wix-booking',
            type: campaignType,
            selected: false,
          });
        } else {
          // No sessions returned — fall back to service metadata
          const startDate = service.schedule?.firstSessionStart;
          if (!startDate) continue;
          activities.push({
            id: service.id || uuidv4(),
            title: serviceName,
            description: str(service.description),
            startDate,
            endDate: service.schedule?.lastSessionEnd || undefined,
            location: undefined,
            imageUrl,
            sourceUrl,
            source: 'wix-booking',
            type: campaignType,
            selected: false,
          });
        }
      } else {
        // No schedule ID — use service-level dates
        const startDate = service.schedule?.firstSessionStart;
        if (!startDate) continue;
        activities.push({
          id: service.id || uuidv4(),
          title: serviceName,
          description: str(service.description),
          startDate,
          endDate: service.schedule?.lastSessionEnd || undefined,
          location: undefined,
          imageUrl,
          sourceUrl,
          source: 'wix-booking',
          type: campaignType,
          selected: false,
        });
      }
    }

    // Exclude recurring/drop-in activities
    const excludePrefixes = ['online', 'drop in'];
    const filtered = activities.filter((a) => {
      const lower = a.title.toLowerCase();
      return !excludePrefixes.some((prefix) => lower.startsWith(prefix));
    });

    // Sort by start date
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
