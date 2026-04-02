import { NextRequest, NextResponse } from 'next/server';
import { listFolderFiles } from '@/lib/google-drive';

/**
 * GET /api/drive/files?folderId=xxx
 * 
 * Lists image/video files in a Google Drive folder.
 * Returns thumbnails for display in the campaign dashboard.
 */
export async function GET(req: NextRequest) {
  try {
    const folderId = req.nextUrl.searchParams.get('folderId');

    if (!folderId) {
      return NextResponse.json({ error: 'folderId query parameter is required' }, { status: 400 });
    }

    const files = await listFolderFiles(folderId);

    return NextResponse.json({ files, count: files.length });
  } catch (error: any) {
    console.error('Drive files error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list Drive files' },
      { status: 500 }
    );
  }
}
