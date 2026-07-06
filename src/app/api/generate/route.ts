import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { Activity, PlatformId, PostAngle, ANGLE_CONFIG, ContextAttachment, ContextLink } from '@/lib/types';

type AIProvider = 'gemini' | 'openai';

// ─── Shared Prompt Builder ─────────────────────────────────────────

function buildPrompt(opts: {
  activities?: Activity[];
  campaignType?: string;
  angle?: PostAngle;
  link?: string;
  notes?: string;
  platforms: PlatformId[];
  contextMedia?: ContextAttachment[];
  contextLinks?: ContextLink[];
  contextNotes?: string;
  brandContext?: string;
}) {
  const {
    activities,
    campaignType,
    angle,
    link,
    notes,
    platforms,
    contextMedia = [],
    contextLinks = [],
    contextNotes = '',
    brandContext = '',
  } = opts;

  // Activity context
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

  // User-provided context (links, notes, media)
  let userContext = '';
  if (contextLinks.length > 0) {
    userContext += '\nREFERENCE LINKS (provided by user for context):\n';
    contextLinks.forEach((l, i) => {
      userContext += `  ${i + 1}. ${l.url}${l.label ? ` — ${l.label}` : ''}\n`;
    });
  }
  if (contextNotes) {
    userContext += `\nUSER NOTES / ADDITIONAL CONTEXT:\n${contextNotes}\n`;
  }
  if (contextMedia.length > 0) {
    userContext += `\nATTACHED MEDIA (${contextMedia.length} file${contextMedia.length > 1 ? 's' : ''}):\n`;
    contextMedia.forEach((m, i) => {
      userContext += `  ${i + 1}. ${m.name} (${m.type}) — analyze and incorporate details from this image\n`;
    });
  }

  // Angle-specific instructions
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

  // Platform instructions
  const platformInstructions = platforms
    .map((p) => {
      switch (p) {
        case 'redbook':
          return `"redbook": Xiaohongshu (小红书). Write in **Simplified Chinese (简体中文)**.

CRITICAL RULE: NEVER write announcement-style (公告体) content like "X/X活动安排" or "活动通知". ALWAYS write emotion-style (情绪体) content. Data shows emotion-style posts get 10-15x more engagement than announcements.

TITLE (max 20 chars including emoji):
- Use one of these proven formulas:
  A) 否定句: "你不必 [痛点]，[价值承诺] ❤️"
  B) 疑问句: "[身份标签] 最 [情绪] 的事是什么？"
  C) 反差型: "[看似不可能]，原来 [简单方法]"
  D) 数字清单: "[N]个 [免费/必备] [资源]，赶紧收藏🌟"
- End with one emoji (❤️ or 🆓 or 🌟)

BODY — follow this 4-part arc:
1. 情绪钩子 (2-3 sentences): Start with a pain point or shared feeling. Use "你" for direct address. Make the reader feel seen.
2. 重构认知 (2-3 sentences): Reframe the problem. "你不必吃这个苦" / "原来有办法". Give a fresh perspective.
3. 价值清单 (main body): Use 1️⃣2️⃣3️⃣ for numbered items, 🌟 for sub-items. Activity details go HERE, wrapped as "resources/solutions", not "institutional announcements". Weave in emotional descriptions between facts.
4. 温暖收尾 (2-3 sentences): Include "记得收藏🌟" nudge. Ask an open question to drive comments. End with warm slogan like "你不是一个人在战斗 ❤️".

VOICE: Warm community mom-friend, NOT institutional. Use 口语化 expressions. OK to mix in common English words (storytime, walk-in, burn out). Never use "尊敬的家长" or "本机构".

EMOJI: 15-25 total per post. Use 1️⃣-6️⃣ for lists, 🌟 for sub-items, ❤️ for emotion, 🆓 for free, 🤩 for excitement. Never use 🔥💯🙏.

HASHTAGS: 3-6 tags at the very end. Mix broad (#带娃 #湾区遛娃) + niche (#免费早教资源分享) + brand (#湾区小书虫亲子图书馆).

ACCOUNT: 湾区小书虫中文图书馆 — a nonprofit Chinese children's library in Menlo Park, Bay Area, part of The Joy Culture Foundation (凯芯文教基金会).`;
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
    })
    .filter(Boolean);

  // Brand context goes at the very top of the system prompt
  const brandPrefix = brandContext
    ? `BRAND & STYLE GUIDELINES (follow these closely):\n${brandContext}\n\n`
    : '';

  const systemPrompt = `${brandPrefix}You are an expert marketing copywriter for The Joy Culture Foundation — a nonprofit that promotes wellness, culture, and community events.

Create tailored marketing content for the following platforms based on the provided inputs.

${activityContext ? `UPCOMING ACTIVITIES:\n${activityContext}\n` : ''}
${campaignType ? `Campaign Type / Goal: "${campaignType}"` : ''}
${angleInstructions}
${link ? `Reference Link: ${link}` : ''}
${notes ? `Additional Notes/Context: ${notes}` : ''}
${userContext}

PLATFORM REQUIREMENTS:
${platformInstructions.map((p, i) => `${i + 1}. ${p}`).join('\n')}

IMPORTANT: Respond with a JSON object. The keys should be the platform IDs: ${platforms.map((p) => `"${p}"`).join(', ')}.
- For all platforms EXCEPT "email": the value should be a string with the ready-to-post text.
- For "email": the value should be an object with "subject" (string) and "body" (string, well-formatted with line breaks).

Return valid JSON only, no markdown code fences.`;

  return systemPrompt;
}

// ─── Gemini Generation ─────────────────────────────────────────────

async function generateWithGemini(opts: {
  apiKey: string;
  prompt: string;
  imageBase64?: string;
  contextMedia?: ContextAttachment[];
}) {
  const { apiKey, prompt, imageBase64, contextMedia = [] } = opts;
  const ai = new GoogleGenAI({ apiKey });

  const contents: any[] = [prompt];

  if (imageBase64) {
    const match = imageBase64.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
    if (match) {
      contents.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
  }

  for (const media of contextMedia) {
    if (media.type === 'image' && media.dataUrl) {
      const match = media.dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        contents.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: { responseMimeType: 'application/json' },
  });

  const resultText = response.text;
  if (!resultText) throw new Error('No content returned from Gemini');
  return resultText;
}

// ─── OpenAI Generation ─────────────────────────────────────────────

async function generateWithOpenAI(opts: {
  apiKey: string;
  prompt: string;
  imageBase64?: string;
  contextMedia?: ContextAttachment[];
}) {
  const { apiKey, prompt, imageBase64, contextMedia = [] } = opts;
  const openai = new OpenAI({ apiKey });

  // Build messages — OpenAI supports images via content parts
  const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: prompt },
  ];

  // Add main image
  if (imageBase64) {
    contentParts.push({
      type: 'image_url',
      image_url: { url: imageBase64, detail: 'auto' },
    });
  }

  // Add context media images
  for (const media of contextMedia) {
    if (media.type === 'image' && media.dataUrl) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: media.dataUrl, detail: 'auto' },
      });
    }
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: contentParts,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const resultText = response.choices[0]?.message?.content;
  if (!resultText) throw new Error('No content returned from OpenAI');
  return resultText;
}

// ─── Route Handler ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      activities,
      campaignType,
      angle,
      link,
      imageBase64,
      notes,
      apiKey,
      openaiApiKey,
      provider = 'gemini' as AIProvider,
      platforms,
      contextMedia,
      contextLinks,
      contextNotes,
      brandContext,
    } = body as {
      activities?: Activity[];
      campaignType?: string;
      angle?: PostAngle;
      link?: string;
      imageBase64?: string;
      notes?: string;
      apiKey?: string;
      openaiApiKey?: string;
      provider?: AIProvider;
      platforms?: PlatformId[];
      contextMedia?: ContextAttachment[];
      contextLinks?: ContextLink[];
      contextNotes?: string;
      brandContext?: string;
    };

    // Resolve the correct key based on provider
    const isOpenAI = provider === 'openai';
    const resolvedKey = isOpenAI
      ? openaiApiKey || process.env.OPENAI_API_KEY
      : apiKey || process.env.GEMINI_API_KEY;

    if (!resolvedKey) {
      return NextResponse.json(
        { error: `${isOpenAI ? 'OpenAI' : 'Gemini'} API Key is required` },
        { status: 401 }
      );
    }

    const allContextLinks = contextLinks || activities?.[0]?.contextLinks || [];
    const allContextNotes = contextNotes || activities?.[0]?.contextNotes || '';
    const allContextMedia = contextMedia || activities?.[0]?.contextMedia || [];

    const targetPlatforms: PlatformId[] = platforms || [
      'redbook',
      'linkedin',
      'facebook',
      'line',
      'wechat',
      'email',
    ];

    const prompt = buildPrompt({
      activities,
      campaignType,
      angle,
      link,
      notes,
      platforms: targetPlatforms,
      contextMedia: allContextMedia,
      contextLinks: allContextLinks,
      contextNotes: allContextNotes,
      brandContext,
    });

    let resultText: string;

    if (isOpenAI) {
      resultText = await generateWithOpenAI({
        apiKey: resolvedKey,
        prompt,
        imageBase64,
        contextMedia: allContextMedia,
      });
    } else {
      resultText = await generateWithGemini({
        apiKey: resolvedKey,
        prompt,
        imageBase64,
        contextMedia: allContextMedia,
      });
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
    console.error('AI API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Error generating content' },
      { status: 500 }
    );
  }
}
