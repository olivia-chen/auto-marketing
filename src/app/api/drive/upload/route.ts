import { NextRequest, NextResponse } from 'next/server';
import { uploadFileToDrive } from '@/lib/google-drive';

// Allow large file uploads (base64 photos can be 15MB+)
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * POST /api/drive/upload
 * Accepts JSON body with:
 *   - folderId: string
 *   - fileName: string
 *   - mimeType: string
 *   - fileData: string (base64-encoded)
 * 
 * Uploads the file to the specified Google Drive folder.
 * Uses JSON instead of FormData to avoid iOS Safari parsing issues.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { folderId, fileName, mimeType, fileData } = body;

    if (!folderId) {
      return NextResponse.json({ error: 'folderId is required' }, { status: 400 });
    }
    if (!fileData) {
      return NextResponse.json({ error: 'fileData is required' }, { status: 400 });
    }

    const buffer = Buffer.from(fileData, 'base64');
    const safeName = fileName || `upload-${Date.now()}.jpg`;
    const safeMime = mimeType || 'application/octet-stream';

    const result = await uploadFileToDrive(folderId, safeName, safeMime, buffer);

    return NextResponse.json({ uploaded: result });
  } catch (error: any) {
    console.error('Drive upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to upload file' },
      { status: 500 }
    );
  }
}
