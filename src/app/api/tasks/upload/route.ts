import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isConfigured } from '@/lib/tasks-store';
import {
  getWorkflowAttachmentsFolderId,
  uploadFileToDrive,
} from '@/lib/google-drive';

// Screenshots can be a few MB as base64.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * POST /api/tasks/upload
 * Body: { fileName, mimeType, fileData (base64) }
 * Uploads to the "Workflow Attachments" Drive folder and returns the
 * attachment metadata to store on a task.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'File storage is not configured (GOOGLE_SERVICE_ACCOUNT_KEY).' },
      { status: 503 }
    );
  }

  let body: { fileName?: string; mimeType?: string; fileData?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.fileData) {
    return NextResponse.json({ error: 'fileData is required' }, { status: 400 });
  }

  const buffer = Buffer.from(body.fileData, 'base64');
  if (buffer.length === 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json(
      { error: 'File too large (max 15 MB).' },
      { status: 413 }
    );
  }

  const name = (body.fileName || `upload-${Date.now()}`).slice(0, 200);
  const mimeType = body.mimeType || 'application/octet-stream';

  try {
    const folderId = await getWorkflowAttachmentsFolderId();
    const result = await uploadFileToDrive(folderId, name, mimeType, buffer);
    return NextResponse.json({
      attachment: {
        name: result.name,
        url: result.viewUrl,
        thumbnailUrl: result.thumbnailUrl,
        mimeType,
      },
    });
  } catch (err) {
    console.error('POST /api/tasks/upload failed:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Upload failed' },
      { status: 500 }
    );
  }
}
