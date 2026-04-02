import { NextRequest, NextResponse } from 'next/server';
import { uploadFileToDrive } from '@/lib/google-drive';

/**
 * POST /api/drive/upload
 * Accepts multipart form data with:
 *   - folderId: string
 *   - files: File[] (one or more)
 * 
 * Uploads each file to the specified Google Drive folder.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const folderId = formData.get('folderId') as string;

    if (!folderId) {
      return NextResponse.json({ error: 'folderId is required' }, { status: 400 });
    }

    const files = formData.getAll('files') as File[];
    if (files.length === 0) {
      return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });
    }

    const results = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await uploadFileToDrive(
        folderId,
        file.name,
        file.type || 'application/octet-stream',
        buffer
      );
      results.push(result);
    }

    return NextResponse.json({ uploaded: results, count: results.length });
  } catch (error: any) {
    console.error('Drive upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to upload files' },
      { status: 500 }
    );
  }
}

// Increase body size limit for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};
