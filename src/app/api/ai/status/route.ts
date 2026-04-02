import { NextResponse } from 'next/server';

/**
 * Returns which AI providers have server-side API keys configured.
 * The frontend uses this to show which providers are available
 * without exposing actual key values.
 */
export async function GET() {
  return NextResponse.json({
    gemini: !!process.env.GEMINI_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
  });
}
