/**
 * Wix REST API client for Bookings and Events.
 * Uses API Key authentication with wix-site-id header.
 *
 * Setup instructions:
 * 1. Go to Wix Dashboard → Settings → API Keys Manager
 * 2. Create a new API key with permissions for:
 *    - Wix Bookings (read)
 *    - Wix Events (read)
 * 3. Copy the API key and site ID to .env.local
 */

const WIX_API_BASE = 'https://www.wixapis.com';

interface WixApiOptions {
  apiKey: string;
  siteId: string;
}

async function wixFetch(
  path: string,
  options: WixApiOptions,
  body?: object,
  method: string = 'POST'
) {
  const url = `${WIX_API_BASE}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: options.apiKey,
      'wix-site-id': options.siteId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wix API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ─── Wix Events API ──────────────────────────────────────────────

export interface WixEvent {
  id: string;
  title: string;
  description?: string;
  location?: {
    name?: string;
    address?: string;
  };
  dateAndTimeSettings?: {
    startDate?: string;
    endDate?: string;
  };
  scheduling?: {
    startDate?: string;
    endDate?: string;
  };
  mainImage?: {
    url?: string;
  };
  eventPageUrl?: string;
  status?: string;
}

/**
 * Query events from Wix Events V3.
 * Fetches UPCOMING and STARTED events from `fromDate` onward (no upper bound).
 */
export async function queryWixEvents(
  options: WixApiOptions,
  fromDate: string
): Promise<WixEvent[]> {
  try {
    const data = await wixFetch('/events/v3/events/query', options, {
      query: {
        filter: {
          status: { $in: ['UPCOMING', 'STARTED'] },
          'dateAndTimeSettings.startDate': {
            $gte: `${fromDate}T00:00:00.000Z`,
          },
        },
        sort: [
          {
            fieldName: 'dateAndTimeSettings.startDate',
            order: 'ASC',
          },
        ],
        paging: {
          limit: 50,
        },
      },
    });
    return data.events || [];
  } catch (error) {
    console.error('Error querying Wix Events:', error);
    return [];
  }
}

// ─── Wix Bookings API ────────────────────────────────────────────

export interface WixService {
  id: string;
  name: string;
  description?: string;
  type?: string;
  category?: {
    name?: string;
  };
  media?: {
    mainMedia?: {
      image?: {
        url?: string;
      };
    };
  };
  urls?: {
    bookingPageUrl?: string;
    servicePage?: {
      url?: string;
    };
  };
  schedule?: {
    id?: string;
    firstSessionStart?: string;
    lastSessionEnd?: string;
  };
}

export interface WixTimeSlot {
  startDate: string;
  endDate: string;
  serviceId: string;
  resource?: {
    name?: string;
  };
  location?: {
    name?: string;
  };
}

/**
 * List active booking services (paginated to get all).
 */
export async function listWixServices(
  options: WixApiOptions
): Promise<WixService[]> {
  try {
    let allServices: WixService[] = [];
    let offset = 0;
    let hasNext = true;
    while (hasNext) {
      const data = await wixFetch('/bookings/v2/services/query', options, {
        query: {
          filter: { hidden: false },
          paging: { limit: 100, offset },
        },
      });
      const services = data.services || [];
      allServices = allServices.concat(services);
      hasNext = data.pagingMetadata?.hasNext || false;
      offset += services.length;
      if (services.length === 0) break;
    }
    return allServices;
  } catch (error) {
    console.error('Error listing Wix Services:', error);
    return [];
  }
}

/**
 * Query COURSE and CLASS type services that have sessions in range.
 * Uses service schedule metadata (firstSessionStart/lastSessionEnd)
 * instead of the Calendar API which returns stale session records.
 */
export async function queryFutureCourses(
  options: WixApiOptions,
  fromDate: string
): Promise<WixService[]> {
  const serviceTypes = ['COURSE', 'CLASS'];

  async function fetchByType(type: string): Promise<WixService[]> {
    try {
      let all: WixService[] = [];
      let offset = 0;
      let hasNext = true;
      while (hasNext) {
        const data = await wixFetch('/bookings/v2/services/query', options, {
          query: {
            filter: { type },
            paging: { limit: 100, offset },
          },
        });
        const services: WixService[] = data.services || [];
        all = all.concat(services);
        hasNext = data.pagingMetadata?.hasNext || false;
        offset += services.length;
        if (services.length === 0) break;
      }
      return all;
    } catch (error) {
      console.error(`Error querying ${type} services:`, error);
      return [];
    }
  }

  // Fetch COURSE and CLASS in parallel
  const results = await Promise.all(serviceTypes.map(fetchByType));
  const allServices = results.flat();

  // Filter to services with sessions in range
  const fromTimestamp = new Date(`${fromDate}T00:00:00.000Z`).getTime();
  return allServices.filter((s) => {
    const lastEnd = s.schedule?.lastSessionEnd;
    if (!lastEnd) return false;
    return new Date(lastEnd).getTime() >= fromTimestamp;
  });
}

/**
 * List available time slots for appointments.
 */
export async function listAvailableTimeSlots(
  options: WixApiOptions,
  serviceId: string,
  fromDate: string,
  toDate: string
): Promise<WixTimeSlot[]> {
  try {
    const data = await wixFetch(
      '/bookings/v2/timeslots/availability/query',
      options,
      {
        serviceId,
        from: fromDate,
        to: toDate,
      }
    );
    return data.availabilityTimeSlots || [];
  } catch (error) {
    console.error('Error listing time slots:', error);
    return [];
  }
}

// Note: The Calendar V3 events/query API is used to fetch individual sessions
// for multi-session courses and classes.

export interface WixCalendarEvent {
  id: string;
  scheduleId?: string;
  title?: string;
  start?: {
    timestamp?: string;
    utcDate?: string;
    localDate?: string;
    timeZone?: string;
  };
  end?: {
    timestamp?: string;
    utcDate?: string;
    localDate?: string;
  };
  type?: string;
  status?: string;
}

/**
 * Get the effective start datetime string from a calendar event.
 */
export function getEventStartDate(event: WixCalendarEvent): string | undefined {
  return event.start?.utcDate || event.start?.timestamp || event.start?.localDate;
}

export function getEventEndDate(event: WixCalendarEvent): string | undefined {
  return event.end?.utcDate || event.end?.timestamp || event.end?.localDate;
}

/**
 * Query individual sessions for a service's schedule.
 * Uses Calendar V3 events/query to get each session date.
 */
export async function querySessionsForSchedule(
  options: WixApiOptions,
  scheduleId: string,
  fromDate: string,
  toDate: string
): Promise<WixCalendarEvent[]> {
  try {
    // Calendar V3 requires local date-time format (no Z suffix)
    const fromLocal = `${fromDate}T00:00:00.000`;
    const toLocal = `${toDate}T23:59:59.000`;

    const data = await wixFetch('/calendar/v3/events/query', options, {
      query: {
        filter: {
          scheduleId: { $eq: scheduleId },
        },
        paging: { limit: 100 },
      },
      fromLocalDate: fromLocal,
      toLocalDate: toLocal,
    });
    console.log(`[Calendar V3] Raw response for schedule ${scheduleId}: ${(data.events || []).length} events`);
    const allEvents = data.events || [];
    const filtered = allEvents.filter(
      (e: WixCalendarEvent) => e.type !== 'WORKING_HOURS' && e.status !== 'CANCELLED'
    );
    console.log(`[Calendar V3] ${allEvents.length} total events, ${filtered.length} after filtering`);
    return filtered;
  } catch (error: any) {
    console.error(`Error querying sessions for schedule ${scheduleId}:`, error?.message || error);
    return [];
  }
}

