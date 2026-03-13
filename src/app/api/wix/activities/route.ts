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

  try {
    // Fetch future COURSE services (these are the bookings you care about)
    const futureCourses = await queryFutureCourses(options, fromDate);

    const activities: Activity[] = [];

    // Convert COURSE services to Activities using schedule metadata
    for (const course of futureCourses) {
      const startDate = course.schedule?.firstSessionStart;
      if (!startDate) continue;

      activities.push({
        id: course.id || uuidv4(),
        title: str(course.name) || 'Untitled Course',
        description: str(course.description),
        startDate,
        endDate: course.schedule?.lastSessionEnd || undefined,
        location: undefined, // Services don't have location at top level
        imageUrl: course.media?.mainMedia?.image?.url,
        sourceUrl:
          course.urls?.bookingPageUrl ||
          course.urls?.servicePage?.url,
        source: 'wix-booking',
        type: 'class',
        selected: false,
      });
    }

    // Sort by start date (first session)
    activities.sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

    return NextResponse.json({
      activities,
      meta: {
        fromDate,
        toDate,
        courseCount: futureCourses.length,
        totalActivities: activities.length,
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
