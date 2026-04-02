/**
 * Wix Blog helper — create and publish recap posts to the Wix Blog.
 *
 * Uses Wix Blog REST API v3:
 *   1. Create a draft post with Ricos JSON richContent
 *   2. Publish the draft post
 */

const WIX_API_BASE = 'https://www.wixapis.com';

interface WixBlogOptions {
  apiKey: string;
  siteId: string;
}

// ─── Ricos JSON Helpers ─────────────────────────────────────────────

interface RicosNode {
  type: string;
  id?: string;
  nodes?: RicosNode[];
  textData?: {
    text: string;
    decorations?: { type: string; [key: string]: any }[];
  };
  paragraphData?: { textStyle?: { textAlignment?: string } };
  headingData?: { level: number; textStyle?: { textAlignment?: string } };
  imageData?: {
    image?: { src?: { url?: string; id?: string }; width?: number; height?: number };
    altText?: string;
  };
  dividerData?: { lineStyle?: string; width?: string };
}

/**
 * Convert plain text content into Ricos JSON nodes.
 * Splits on double newlines for paragraphs, single newlines for line breaks.
 */
export function textToRicosNodes(text: string): RicosNode[] {
  const nodes: RicosNode[] = [];
  const paragraphs = text.split(/\n{2,}/);

  for (const para of paragraphs) {
    if (!para.trim()) continue;

    const lines = para.split('\n');
    const textNodes: RicosNode[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim()) {
        textNodes.push({
          type: 'TEXT',
          id: generateId(),
          nodes: [],
          textData: {
            text: lines[i],
            decorations: [],
          },
        });
      }
      // Add a line break between lines (not after the last one)
      if (i < lines.length - 1) {
        textNodes.push({
          type: 'TEXT',
          id: generateId(),
          nodes: [],
          textData: {
            text: '\n',
            decorations: [],
          },
        });
      }
    }

    nodes.push({
      type: 'PARAGRAPH',
      id: generateId(),
      nodes: textNodes,
      paragraphData: { textStyle: { textAlignment: 'AUTO' } },
    });
  }

  return nodes;
}

/**
 * Build the full richContent object for a blog post.
 */
export function buildRichContent(title: string, bodyText: string): { nodes: RicosNode[] } {
  const nodes: RicosNode[] = [];

  // Body paragraphs
  const bodyNodes = textToRicosNodes(bodyText);
  nodes.push(...bodyNodes);

  return { nodes };
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// ─── Wix Blog API Calls ─────────────────────────────────────────────

/**
 * Extract the Wix media file ID from various URL formats.
 * Handles: wix:image://v1/{id}/..., full Wix static URLs, or raw IDs.
 */
function extractWixMediaId(url: string): string | null {
  if (!url) return null;

  // Handle wix:image://v1/{id}/... format
  const wixImageMatch = url.match(/wix:image:\/\/v1\/([^/]+)/);
  if (wixImageMatch) return wixImageMatch[1];

  // Handle https://static.wixstatic.com/media/{id}...
  const staticMatch = url.match(/static\.wixstatic\.com\/media\/([^/?]+)/);
  if (staticMatch) return staticMatch[1];

  // Handle raw file IDs (e.g. "abc123_filename.jpg")
  if (/^[a-f0-9]+_/.test(url) || /\.(jpg|jpeg|png|gif|webp)$/i.test(url)) {
    return url;
  }

  return null;
}

/**
 * Cache the member ID to avoid repeated API calls.
 */
let cachedMemberId: string | null = null;

/**
 * Get the site owner's member ID from the Wix Members API.
 * Required for 3rd-party API key authentication.
 */
async function getSiteOwnerMemberId(options: WixBlogOptions): Promise<string> {
  // Return cached value if available
  if (cachedMemberId) return cachedMemberId;

  // Check env variable first
  if (process.env.WIX_MEMBER_ID) {
    cachedMemberId = process.env.WIX_MEMBER_ID;
    return cachedMemberId;
  }

  // Query Wix Members API for the site owner
  console.log('[Wix Blog] Fetching site owner member ID...');
  const response = await fetch(`${WIX_API_BASE}/members/v1/members/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: options.apiKey,
      'wix-site-id': options.siteId,
    },
    body: JSON.stringify({
      query: {
        paging: { limit: 1 },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Wix Blog] Failed to get member ID:', errorText);
    throw new Error(
      `Cannot publish: unable to retrieve site member ID. ` +
      `Set WIX_MEMBER_ID in .env.local or ensure your API key has Members permissions. ` +
      `(${response.status}: ${errorText})`
    );
  }

  const data = await response.json();
  const members = data.members || [];
  if (members.length === 0) {
    throw new Error(
      'Cannot publish: no members found on site. ' +
      'Add WIX_MEMBER_ID to .env.local with the site owner member ID.'
    );
  }

  cachedMemberId = members[0].id;
  console.log('[Wix Blog] Using member ID:', cachedMemberId);
  return cachedMemberId!;
}

/**
 * Create a draft blog post on the Wix site.
 */
export async function createDraftPost(
  options: WixBlogOptions,
  title: string,
  bodyText: string,
  coverImageUrl?: string
): Promise<{ draftPostId: string }> {
  const richContent = buildRichContent(title, bodyText);

  // Add metadata to richContent (required by Wix Ricos format)
  const richContentWithMeta = {
    ...richContent,
    metadata: {
      version: 1,
      createdTimestamp: new Date().toISOString(),
      updatedTimestamp: new Date().toISOString(),
      id: generateId(),
    },
  };

  // Get the member ID for post ownership (required for 3rd-party API keys)
  const memberId = await getSiteOwnerMemberId(options);

  const body: any = {
    draftPost: {
      title,
      memberId,
      richContent: richContentWithMeta,
    },
  };

  // Add cover image if provided — must be { id: "fileId" } format
  if (coverImageUrl) {
    const mediaId = extractWixMediaId(coverImageUrl);
    if (mediaId) {
      body.draftPost.media = {
        wixMedia: {
          image: { id: mediaId },
        },
        displayed: true,
      };
    }
  }

  console.log('[Wix Blog] Creating draft post:', JSON.stringify(body, null, 2));

  const response = await fetch(`${WIX_API_BASE}/blog/v3/draft-posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: options.apiKey,
      'wix-site-id': options.siteId,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wix Create Draft error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return { draftPostId: data.draftPost?.id || data.id };
}

/**
 * Publish a draft post (makes it live on the Wix blog).
 */
export async function publishDraftPost(
  options: WixBlogOptions,
  draftPostId: string
): Promise<{ postUrl?: string }> {
  const response = await fetch(
    `${WIX_API_BASE}/blog/v3/draft-posts/${draftPostId}/publish`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: options.apiKey,
        'wix-site-id': options.siteId,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wix Publish error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return { postUrl: data.post?.url || undefined };
}

/**
 * Full flow: create draft → publish → return URL.
 */
export async function createAndPublishBlogPost(
  options: WixBlogOptions,
  title: string,
  bodyText: string,
  coverImageUrl?: string
): Promise<{ draftPostId: string; postUrl?: string }> {
  const { draftPostId } = await createDraftPost(options, title, bodyText, coverImageUrl);
  const { postUrl } = await publishDraftPost(options, draftPostId);
  return { draftPostId, postUrl };
}
