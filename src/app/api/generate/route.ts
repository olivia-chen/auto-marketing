import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { Activity, PlatformId, PostAngle, ANGLE_CONFIG, ContextAttachment, ContextLink } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const {
      activities,
      campaignType,
      angle,
      link,
      imageBase64,
      notes,
      apiKey,
      platforms,
      contextMedia,
      contextLinks,
      contextNotes,
    } = (await req.json()) as {
      activities?: Activity[];
      campaignType?: string;
      angle?: PostAngle;
      link?: string;
      imageBase64?: string;
      notes?: string;
      apiKey?: string;
      platforms?: PlatformId[];
      contextMedia?: ContextAttachment[];
      contextLinks?: ContextLink[];
      contextNotes?: string;
    };

    const finalApiKey = apiKey || process.env.GEMINI_API_KEY;

    if (!finalApiKey) {
      return NextResponse.json(
        { error: 'Gemini API Key is required' },
        { status: 401 }
      );
    }

    const ai = new GoogleGenAI({ apiKey: finalApiKey });

    // Build activity context if available
    let activityContext = '';
    if (activities && activities.length > 0) {
      activityContext = activities
        .map((a, i) => {
          return `Activity ${i + 1}:
  - Title: ${a.title}
  - Date/Time: ${a.startDate}${a.endDate ? ` to ${a.endDate}` : ''}
  - Type: ${a.type}
  - Location: ${a.location || 'TBD'}
  - Description: ${a.description || 'N/A'}
  - Source URL: ${a.sourceUrl || 'N/A'}
  - Status: ${a.status || 'scheduled'}`;
        })
        .join('\n\n');
    }

    // Build user-provided context (links, notes, media descriptions)
    let userContext = '';
    const allContextLinks = contextLinks || activities?.[0]?.contextLinks || [];
    const allContextNotes = contextNotes || activities?.[0]?.contextNotes || '';
    const allContextMedia = contextMedia || activities?.[0]?.contextMedia || [];

    if (allContextLinks.length > 0) {
      userContext += '\nREFERENCE LINKS (provided by user for context):\n';
      allContextLinks.forEach((l, i) => {
        userContext += `  ${i + 1}. ${l.url}${l.label ? ` — ${l.label}` : ''}\n`;
      });
    }
    if (allContextNotes) {
      userContext += `\nUSER NOTES / ADDITIONAL CONTEXT:\n${allContextNotes}\n`;
    }
    if (allContextMedia.length > 0) {
      userContext += `\nATTACHED MEDIA (${allContextMedia.length} file${allContextMedia.length > 1 ? 's' : ''}):\n`;
      allContextMedia.forEach((m, i) => {
        userContext += `  ${i + 1}. ${m.name} (${m.type}) — analyze and incorporate details from this image\n`;
      });
    }

    // Build angle-specific instructions
    let angleInstructions = '';
    if (angle && ANGLE_CONFIG[angle]) {
      const config = ANGLE_CONFIG[angle];
      angleInstructions = `\nCONTENT ANGLE: "${config.label}" — ${config.description}

Your content must follow this angle:`;

      switch (angle) {
        case 'teaser':
          angleInstructions += `
- Create CURIOSITY and ANTICIPATION
- Don't reveal all details — tease what's coming
- Use questions or "coming soon" framing
- Focus on WHY this matters, not logistics
- Make people want to learn more`;
          break;
        case 'details':
          angleInstructions += `
- Provide COMPLETE information: what, when, where, who, how
- Include date, time, location, registration link
- Clear, organized structure
- Make it easy to share and save
- Include practical details people need`;
          break;
        case 'social_proof':
          angleInstructions += `
- Emphasize VALUE and BENEFITS
- Use testimonials, past success stories, or participant quotes (create realistic ones for TJCF)
- Highlight what attendees will gain or learn
- Show community impact
- Frame as "don't miss out" without being pushy`;
          break;
        case 'urgency':
          angleInstructions += `
- Create URGENCY — this is the last-chance reminder
- "Tomorrow!" / "Last few spots!" / "Register by tonight!"
- Short, punchy, action-oriented
- Strong call-to-action
- Include direct registration link`;
          break;
        case 'day_of':
          angleInstructions += `
- "TODAY!" energy — excitement and logistics
- Include: time, location, what to bring, parking, contact
- Warm welcome tone
- "See you there!" enthusiasm
- Last-minute helpful tips`;
          break;
        case 'recap':
          angleInstructions += `
- Celebrate what happened — highlights and impact
- "Thank you to everyone who joined!"
- Share key moments, learnings, or quotes
- Mention upcoming next sessions if recurring
- Community gratitude tone
- Encourage sharing and tagging`;
          break;
      }
    }

    // Determine which platforms to generate for
    const targetPlatforms = platforms || [
      'redbook',
      'linkedin',
      'facebook',
      'line',
      'wechat',
      'email',
    ];

    const platformInstructions = targetPlatforms.map((p) => {
      switch (p) {
        case 'redbook':
          return `"redbook": Xiaohongshu (Redbook). Write in **Simplified Chinese (简体中文)**. Highly engaging, visually appealing long-form text with emojis. Lifestyle-oriented tone with story-telling. Include popular relevant hashtags. This is for a culture/wellness foundation.`;
        case 'linkedin':
          return `"linkedin": LinkedIn. Write in **English**. Professional, value-oriented, clean formatting. Insightful or celebratory tone. Include 3-5 professional hashtags. Focus on the foundation's mission and impact.`;
        case 'facebook':
          return `"facebook": Facebook. Write in **both Traditional Chinese (繁體中文) AND English** — put the Traditional Chinese text first, then a divider "---", then the English version. Engaging, conversational, community-focused. Include a clear call-to-action.`;
        case 'line':
          return `"line": LINE Group message. Write in **Traditional Chinese (繁體中文)**. Very short (2-3 sentences max), concise, call-to-action focused. Suitable for quick group chat. Use a few emojis.`;
        case 'wechat':
          return `"wechat": WeChat Group message. Write in **Simplified Chinese (简体中文)**. Very short (2-3 sentences max), direct, friendly, easy to read on mobile. Suitable for community group chat.`;
        case 'email':
          return `"email": Email Newsletter. Provide a JSON object with "subject" (catchy email subject line in English, under 60 chars) and "body" (well-formatted email body in English with greeting, event details, call-to-action, and sign-off from "The Joy Culture Foundation team").`;
        default:
          return '';
      }
    }).filter(Boolean);

    const promptString = `You are an expert marketing copywriter for The Joy Culture Foundation — a nonprofit that promotes wellness, culture, and community events.

Create tailored marketing content for the following platforms based on the provided inputs.

${activityContext ? `UPCOMING ACTIVITIES:\n${activityContext}\n` : ''}
${campaignType ? `Campaign Type / Goal: "${campaignType}"` : ''}
${angleInstructions}
${link ? `Reference Link: ${link}` : ''}
${notes ? `Additional Notes/Context: ${notes}` : ''}
${userContext}

PLATFORM REQUIREMENTS:
${platformInstructions.map((p, i) => `${i + 1}. ${p}`).join('\n')}

${imageBase64 || allContextMedia.length > 0 ? 'Image(s)/flyer(s) have been attached — analyze them and incorporate all relevant details (text, design elements, key info).' : ''}

IMPORTANT: Respond with a JSON object. The keys should be the platform IDs: ${targetPlatforms.map((p) => `"${p}"`).join(', ')}.
- For all platforms EXCEPT "email": the value should be a string with the ready-to-post text.
- For "email": the value should be an object with "subject" (string) and "body" (string, well-formatted with line breaks).

Return valid JSON only, no markdown code fences.`;

    const contents: any[] = [promptString];

    if (imageBase64) {
      const match = imageBase64.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
      if (match) {
        contents.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      }
    }

    // Add context media as additional images
    if (allContextMedia.length > 0) {
      for (const media of allContextMedia) {
        if (media.type === 'image' && media.dataUrl) {
          const match = media.dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
          if (match) {
            contents.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error('No content returned from Gemini');
    }

    let parsed;
    try {
      parsed = JSON.parse(resultText);
    } catch {
      const cleaned = resultText.replace(/```json\n?|\n?```/g, '').trim();
      parsed = JSON.parse(cleaned);
    }

    return NextResponse.json(parsed);
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Error generating content' },
      { status: 500 }
    );
  }
}
