/**
 * Google Drive helper — auto-create and manage media folders per activity.
 * 
 * Folder convention:
 *   📁 TJCF Marketing Media/
 *     📁 2026-03/
 *       📁 Spring Paint Class — Mar 15/
 *         📷 photos...
 */

import { google } from 'googleapis';

// ─── Auth ────────────────────────────────────────────────────────────

function getDriveAuth() {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentialsJson) return null;

  try {
    const credentials = JSON.parse(credentialsJson);
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }
    return new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
  } catch (e) {
    console.error('Failed to parse Google credentials:', e);
    return null;
  }
}

// Root folder: use env var for an existing shared folder, or create one
const ROOT_FOLDER_NAME = 'TJCF Marketing Media';
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || null;

// ─── Find or Create Folder ───────────────────────────────────────────

async function findFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string
): Promise<string | null> {
  const q = parentId
    ? `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`
    : `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`;

  const res = await drive.files.list({
    q,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });

  return res.data.files?.[0]?.id || null;
}

async function createFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string,
  driveId?: string
): Promise<{ id: string; webViewLink: string }> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  // For non-shared-drive folders, share so anyone with link can upload
  // (Shared Drive folders inherit permissions, so this may fail — that's OK)
  if (!driveId) {
    try {
      await drive.permissions.create({
        fileId: res.data.id!,
        requestBody: {
          role: 'writer',
          type: 'anyone',
        },
        supportsAllDrives: true,
      });
    } catch {
      // Shared Drives don't allow per-file permission changes — that's fine
    }
  }

  return {
    id: res.data.id!,
    webViewLink: res.data.webViewLink || `https://drive.google.com/drive/folders/${res.data.id}`,
  };
}

async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string,
  driveId?: string
): Promise<{ id: string; webViewLink: string }> {
  const existingId = await findFolder(drive, name, parentId);
  if (existingId) {
    return {
      id: existingId,
      webViewLink: `https://drive.google.com/drive/folders/${existingId}`,
    };
  }
  return createFolder(drive, name, parentId, driveId);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Get (or create) the Drive folder for a specific activity.
 * Returns the folder link for staff to upload to.
 */
export async function getActivityFolder(activityTitle: string, startDate: string) {
  const auth = getDriveAuth();
  if (!auth) throw new Error('Google Drive not configured');

  const drive = google.drive({ version: 'v3', auth });

  // 1. Root folder — use the configured shared folder, or find/create one
  let root: { id: string; webViewLink: string };
  let sharedDriveId: string | undefined;

  if (ROOT_FOLDER_ID) {
    // Verify the service account can access this folder and detect if it's in a Shared Drive
    try {
      const fileInfo = await drive.files.get({
        fileId: ROOT_FOLDER_ID,
        fields: 'id,name,driveId,parents',
        supportsAllDrives: true,
      });
      sharedDriveId = fileInfo.data.driveId || undefined;
      console.log('[Drive] Root folder info:', {
        id: fileInfo.data.id,
        name: fileInfo.data.name,
        driveId: fileInfo.data.driveId,
        parents: fileInfo.data.parents,
        isSharedDrive: !!sharedDriveId,
      });
    } catch (verifyErr: any) {
      const status = verifyErr?.code || verifyErr?.response?.status;
      console.error('[Drive] Root folder verify error:', status, verifyErr.message);
      if (status === 404) {
        throw new Error(
          `Google Drive folder not found or not shared with the service account. ` +
          `Please share folder ${ROOT_FOLDER_ID} with campaign-matrix@auto-marketing-490005.iam.gserviceaccount.com as Editor.`
        );
      }
      throw verifyErr;
    }
    root = {
      id: ROOT_FOLDER_ID,
      webViewLink: `https://drive.google.com/drive/folders/${ROOT_FOLDER_ID}`,
    };
  } else {
    root = await getOrCreateFolder(drive, ROOT_FOLDER_NAME);
  }

  // 2. Activity folder — named "YYYYMMDD-Activity Name" directly under root
  let datePrefix: string;
  try {
    const d = new Date(startDate);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    datePrefix = `${yyyy}${mm}${dd}`;
  } catch {
    datePrefix = 'undated';
  }
  const activityFolderName = `${datePrefix}-${activityTitle}`;
  console.log('[Drive] Creating activity folder:', activityFolderName, 'in parent:', root.id, 'sharedDriveId:', sharedDriveId);
  const activityFolder = await getOrCreateFolder(drive, activityFolderName, root.id, sharedDriveId);
  console.log('[Drive] Activity folder result:', activityFolder);

  const folderUrl = `https://drive.google.com/drive/folders/${activityFolder.id}`;

  return {
    folderId: activityFolder.id,
    folderUrl,
    folderName: activityFolderName,
    path: `Photos/${activityFolderName}`,
  };
}

/**
 * List image/video files in a Drive folder.
 */
export async function listFolderFiles(folderId: string) {
  const auth = getDriveAuth();
  if (!auth) throw new Error('Google Drive not configured');

  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and (mimeType contains 'image/' or mimeType contains 'video/')`,
    fields: 'files(id, name, mimeType, thumbnailLink, webContentLink, webViewLink, size, createdTime)',
    orderBy: 'createdTime desc',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (res.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name || 'Untitled',
    mimeType: f.mimeType || '',
    thumbnailUrl: f.thumbnailLink || null,
    viewUrl: f.webViewLink || null,
    downloadUrl: f.webContentLink || null,
    size: f.size ? parseInt(f.size, 10) : 0,
    createdAt: f.createdTime || '',
    isImage: (f.mimeType || '').startsWith('image/'),
    isVideo: (f.mimeType || '').startsWith('video/'),
  }));
}

export type DriveFile = Awaited<ReturnType<typeof listFolderFiles>>[number];

/**
 * Upload a file (buffer) to a specific Drive folder.
 */
export async function uploadFileToDrive(
  folderId: string,
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer
) {
  const auth = getDriveAuth();
  if (!auth) throw new Error('Google Drive not configured');

  const drive = google.drive({ version: 'v3', auth });
  const { Readable } = require('stream');

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(fileBuffer),
    },
    fields: 'id, name, webViewLink, thumbnailLink',
    supportsAllDrives: true,
  });

  return {
    id: res.data.id!,
    name: res.data.name || fileName,
    viewUrl: res.data.webViewLink || null,
    thumbnailUrl: res.data.thumbnailLink || null,
  };
}
