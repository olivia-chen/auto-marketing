import { NextRequest, NextResponse } from 'next/server';
import { getActivityFolder } from '@/lib/google-drive';

/**
 * POST /api/drive/folders
 * Body: { activityTitle: string, startDate: string }
 * 
 * Creates (or finds) the Google Drive folder for an activity.
 * Returns the folder URL for staff to upload media.
 */
export async function POST(req: NextRequest) {
  try {
    const { activityTitle, startDate } = await req.json();

    if (!activityTitle) {
      return NextResponse.json({ error: 'activityTitle is required' }, { status: 400 });
    }

    const result = await getActivityFolder(activityTitle, startDate || new Date().toISOString());

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Drive folder error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create/find Drive folder' },
      { status: 500 }
    );
  }
}
