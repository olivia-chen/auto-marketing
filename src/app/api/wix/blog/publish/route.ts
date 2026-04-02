import { NextRequest, NextResponse } from 'next/server';
import { createAndPublishBlogPost } from '@/lib/wix-blog';

/**
 * POST /api/wix/blog/publish
 * Body: { title: string, bodyText: string, coverImageUrl?: string }
 * 
 * Creates a draft blog post on Wix and immediately publishes it.
 * Used for publishing recap posts to the TJCF News page.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;

  if (!apiKey || !siteId) {
    return NextResponse.json(
      { error: 'WIX_API_KEY and WIX_SITE_ID must be set in environment variables.' },
      { status: 500 }
    );
  }

  try {
    const { title, bodyText, coverImageUrl } = await req.json();

    if (!title || !bodyText) {
      return NextResponse.json(
        { error: 'title and bodyText are required' },
        { status: 400 }
      );
    }

    const result = await createAndPublishBlogPost(
      { apiKey, siteId },
      title,
      bodyText,
      coverImageUrl
    );

    return NextResponse.json({
      success: true,
      draftPostId: result.draftPostId,
      postUrl: result.postUrl,
      message: 'Post published to Wix Blog successfully!',
    });
  } catch (error: any) {
    console.error('Wix Blog publish error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to publish to Wix Blog' },
      { status: 500 }
    );
  }
}
