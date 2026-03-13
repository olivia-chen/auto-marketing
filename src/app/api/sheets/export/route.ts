import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';

interface ExportPost {
  activityTitle: string;
  postDate: string;
  postTime: string;
  angle: string;
  angleEmoji: string;
  platforms: string;
  status: string;
  sourceUrl?: string;
  // Generated content per platform
  redbook?: string;
  linkedin?: string;
  facebook?: string;
  line?: string;
  wechat?: string;
  emailSubject?: string;
  emailBody?: string;
}

interface ExportRequest {
  posts: ExportPost[];
  spreadsheetId?: string; // Existing sheet ID
  sheetTitle?: string;    // Tab name for the export
  weekLabel?: string;     // e.g. "Mar 9 — Mar 15, 2026"
}

function getAuth() {
  // Try loading from env var (JSON string of the service account key)
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentialsJson) {
    return null;
  }

  try {
    const credentials = JSON.parse(credentialsJson);

    // Fix: .env files often double-escape the \n in the private key.
    // The JWT signer needs actual newline characters, not literal "\\n".
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    // Need both scopes: spreadsheets for reading/writing, drive for creating & sharing
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
    return auth;
  } catch (e) {
    console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:', e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { posts, spreadsheetId, sheetTitle, weekLabel } =
      (await req.json()) as ExportRequest;

    if (!posts || posts.length === 0) {
      return NextResponse.json(
        { error: 'No posts to export' },
        { status: 400 }
      );
    }

    const auth = getAuth();
    if (!auth) {
      return NextResponse.json(
        {
          error:
            'Google Sheets is not configured. Add GOOGLE_SERVICE_ACCOUNT_KEY to .env.local (the full JSON of your service account key). See the setup guide.',
        },
        { status: 401 }
      );
    }

    const sheets = google.sheets({ version: 'v4', auth });

    // Determine the tab name
    const tabName = sheetTitle || weekLabel || `Export ${new Date().toISOString().slice(0, 10)}`;

    // ─── If an existing spreadsheet ID is provided, add a new tab ───
    if (spreadsheetId) {
      // Verify the spreadsheet is accessible
      let spreadsheet;
      try {
        spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      } catch (getErr: any) {
        const code = getErr.code || getErr.status;
        const msg = getErr.message || '';
        if (code === 404) {
          return NextResponse.json(
            { error: `Spreadsheet not found. Double-check the URL or ID. Make sure you shared the sheet with the service account as an Editor.` },
            { status: 404 }
          );
        }
        if (code === 403) {
          return NextResponse.json(
            { error: `No access to this spreadsheet. Share it (Editor) with: campaign-matrix@auto-marketing-490005.iam.gserviceaccount.com` },
            { status: 403 }
          );
        }
        if (code === 400 || msg.includes('not supported')) {
          return NextResponse.json(
            { error: `This document isn't a Google Sheet. Make sure you're using a Google Sheets URL (not Google Docs, Drive folder, or uploaded Excel file). Create a new blank Sheet at sheets.new.` },
            { status: 400 }
          );
        }
        throw getErr; // re-throw unknown errors
      }

      const existingSheet = spreadsheet.data.sheets?.find(
        (s) => s.properties?.title === tabName
      );

      if (existingSheet) {
        // Clear the existing tab and overwrite
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: `'${tabName}'!A:Z`,
        });
      } else {
        // Create a new tab
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: { title: tabName },
                },
              },
            ],
          },
        });
      }

      // Write data to the tab
      const rows = buildRows(posts, weekLabel);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      });

      // Apply formatting
      const sheetId = existingSheet
        ? existingSheet.properties?.sheetId
        : (
            await sheets.spreadsheets.get({ spreadsheetId })
          ).data.sheets
            ?.find((s) => s.properties?.title === tabName)
            ?.properties?.sheetId;

      if (sheetId !== undefined && sheetId !== null) {
        await applyFormatting(sheets, spreadsheetId, sheetId, rows.length, 14);
      }

      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId || 0}`;
      return NextResponse.json({ url, spreadsheetId, tabName });
    }

    // ─── No spreadsheet ID → create a new one via Drive API ───────
    const rows = buildRows(posts, weekLabel);
    const spreadsheetTitle = `Campaign Matrix — ${weekLabel || new Date().toISOString().slice(0, 10)}`;

    try {
      const drive = google.drive({ version: 'v3', auth });

      // Create spreadsheet via Drive API (more reliable than spreadsheets.create for service accounts)
      const driveRes = await drive.files.create({
        requestBody: {
          name: spreadsheetTitle,
          mimeType: 'application/vnd.google-apps.spreadsheet',
        },
        fields: 'id,webViewLink',
      });

      const newSpreadsheetId = driveRes.data.id!;

      // Rename the default "Sheet1" tab to our week label
      const info = await sheets.spreadsheets.get({ spreadsheetId: newSpreadsheetId });
      const defaultSheetId = info.data.sheets?.[0]?.properties?.sheetId ?? 0;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: newSpreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId: defaultSheetId, title: tabName },
                fields: 'title',
              },
            },
          ],
        },
      });

      // Write data
      await sheets.spreadsheets.values.update({
        spreadsheetId: newSpreadsheetId,
        range: `'${tabName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      });

      // Apply formatting
      await applyFormatting(sheets, newSpreadsheetId, defaultSheetId, rows.length, 14);

      // Make the spreadsheet accessible to anyone with the link
      await drive.permissions.create({
        fileId: newSpreadsheetId,
        requestBody: {
          role: 'writer',
          type: 'anyone',
        },
      });

      const url = `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}/edit`;
      return NextResponse.json({ url, spreadsheetId: newSpreadsheetId, tabName });
    } catch (createError: any) {
      // If creating fails (quota, permissions), guide the user to share an existing sheet
      console.error('Create sheet failed:', createError.message);
      const serviceEmail = (() => {
        try {
          return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}').client_email;
        } catch { return 'the service account email'; }
      })();

      return NextResponse.json(
        {
          error: `Could not create a new Google Sheet. Please create a blank Google Sheet manually, then share it (Editor access) with: ${serviceEmail} — then paste the sheet URL in Settings and try again.`,
        },
        { status: 403 }
      );
    }
  } catch (error: any) {
    console.error('Sheets Export Error:', error);
    // Log detailed Google API error info
    if (error.response?.data) {
      console.error('Google API Error Details:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.errors) {
      console.error('Google Errors:', JSON.stringify(error.errors, null, 2));
    }
    return NextResponse.json(
      { error: error.message || 'Failed to export to Google Sheets' },
      { status: 500 }
    );
  }
}

// ─── Build spreadsheet rows ───────────────────────────────────────

function buildRows(posts: ExportPost[], weekLabel?: string): string[][] {
  const header = [
    '📅 Post Date',
    '⏰ Time',
    '🎯 Angle',
    '📌 Activity',
    '📱 Platforms',
    '✅ Status',
    '📕 Redbook (小红书)',
    '💼 LinkedIn',
    '📘 Facebook',
    '💚 LINE',
    '💬 WeChat',
    '📧 Email Subject',
    '📧 Email Body',
    '🔗 Source URL',
  ];

  const titleRow = weekLabel
    ? [`Campaign Matrix — ${weekLabel}`, '', '', `Exported: ${new Date().toLocaleString()}`]
    : [`Campaign Matrix`, '', '', `Exported: ${new Date().toLocaleString()}`];

  const rows: string[][] = [titleRow, [], header];

  for (const post of posts) {
    rows.push([
      post.postDate,
      post.postTime,
      `${post.angleEmoji} ${post.angle}`,
      post.activityTitle,
      post.platforms,
      post.status,
      post.redbook || '',
      post.linkedin || '',
      post.facebook || '',
      post.line || '',
      post.wechat || '',
      post.emailSubject || '',
      post.emailBody || '',
      post.sourceUrl || '',
    ]);
  }

  return rows;
}

// ─── Apply header formatting ──────────────────────────────────────

async function applyFormatting(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetId: number,
  totalRows: number,
  totalCols: number
) {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Title row: bold, larger font, purple bg
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: totalCols,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, fontSize: 14 },
                  backgroundColor: {
                    red: 0.91,
                    green: 0.87,
                    blue: 1.0,
                    alpha: 1,
                  },
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          },
          // Header row (row 3): bold, freeze, bg color
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 2,
                endRowIndex: 3,
                startColumnIndex: 0,
                endColumnIndex: totalCols,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, fontSize: 11 },
                  backgroundColor: {
                    red: 0.93,
                    green: 0.93,
                    blue: 0.97,
                    alpha: 1,
                  },
                  horizontalAlignment: 'CENTER',
                },
              },
              fields:
                'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
            },
          },
          // Freeze header rows
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: { frozenRowCount: 3 },
              },
              fields: 'gridProperties.frozenRowCount',
            },
          },
          // Auto-resize columns
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: 6,
              },
            },
          },
          // Set content columns to fixed width (wider)
          ...Array.from({ length: 7 }, (_, i) => ({
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: 'COLUMNS' as const,
                startIndex: 6 + i,
                endIndex: 7 + i,
              },
              properties: { pixelSize: 300 },
              fields: 'pixelSize',
            },
          })),
          // Wrap text in content columns
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 3,
                endRowIndex: totalRows,
                startColumnIndex: 6,
                endColumnIndex: totalCols,
              },
              cell: {
                userEnteredFormat: {
                  wrapStrategy: 'WRAP',
                },
              },
              fields: 'userEnteredFormat.wrapStrategy',
            },
          },
        ],
      },
    });
  } catch (err) {
    // Formatting is nice-to-have, don't fail the export
    console.warn('Sheet formatting failed (non-critical):', err);
  }
}
