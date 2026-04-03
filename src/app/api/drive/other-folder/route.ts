import { NextResponse } from 'next/server';
import { getOtherFolder } from '@/lib/google-drive';

/**
 * POST /api/drive/other-folder
 * Gets or creates the "0-Other" folder under the Photos root.
 */
export async function POST() {
  try {
    const result = await getOtherFolder();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Drive other-folder error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to find/create 0-Other folder' },
      { status: 500 }
    );
  }
}
