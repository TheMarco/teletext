/**
 * AI-Created website as a comprehensive Teletext service.
 * All textual content from ai-created.com rendered as authentic teletext pages.
 *
 * Page map:
 * 100 — Main index
 * 200 — Products index
 * 201-215 — Individual product pages
 * 300 — Stories index
 * 301-304 — Individual story pages
 * 400 — Lab Notes index
 * 401-411 — Individual lab note pages
 * 500 — Media index
 * 600 — About (2 subpages)
 */

import type { TeletextPage, TeletextService, TeletextRow, TeletextToken } from '../src/model/types.js';
import { createEmptyPage, createEmptySubpage, controlToken, charToken, mosaicToken, fillToken } from '../src/model/factories.js';

// ─── Helpers ────────────────────────────────────────────────────

const R = 0x01, G = 0x02, Y = 0x03, B = 0x04, M = 0x05, C = 0x06, W = 0x07;
const MR = 0x11, MG = 0x12, MY = 0x13, MB = 0x14, MM = 0x15, MC = 0x16, MW = 0x17;
const DH = 0x0D, FL = 0x08, NBG = 0x1D, BBG = 0x1C;

function ctrl(code: number) { return controlToken(code); }
function text(s: string): TeletextToken[] { return s.split('').map(c => charToken(c.charCodeAt(0))); }
function fill(n: number, c = 0x20) { return fillToken(n, c); }
function mos(code: number) { return mosaicToken(code, true); }

function row(index: number, ...tokens: TeletextToken[]): TeletextRow {
  let cols = 0;
  for (const t of tokens) {
    if (t.kind === 'fill') cols += (t as any).count;
    else if (t.kind !== 'comment') cols++;
  }
  const padded = [...tokens];
  if (cols < 40) padded.push(fill(40 - cols));
  return { index, tokens: padded };
}

function header(pageNum: string, title: string): TeletextRow {
  const total = 1 + 10 + 1 + pageNum.length + 1 + title.length;
  const f = Math.max(0, 40 - total);
  const f1 = Math.floor(f / 2), f2 = f - f1;
  return row(0, ctrl(W), ...text('AI-CREATED'), fill(f1), ctrl(Y), ...text(pageNum), fill(f2), ctrl(C), ...text(title));
}

function sep(idx: number, color: number): TeletextRow {
  const t: TeletextToken[] = [ctrl(color)];
  for (let i = 0; i < 39; i++) t.push(mos(0x2C));
  return row(idx, ...t);
}

function blank(idx: number): TeletextRow { return row(idx, fill(40)); }

function fastext(r: string, g: string, y: string, c: string): TeletextRow {
  return row(23, ctrl(R), ...text(r.padEnd(9)), ctrl(G), ...text(g.padEnd(9)), ctrl(Y), ...text(y.padEnd(9)), ctrl(C), ...text(c.padEnd(9)));
}

function textRow(idx: number, color: number, s: string): TeletextRow {
  return row(idx, ctrl(color), ...text(' ' + s.substring(0, 38)));
}

function titleRow(idx: number, color: number, s: string): TeletextRow {
  return row(idx, ctrl(DH), ctrl(color), fill(2), ...text(s.substring(0, 16)));
}

function menuItem(idx: number, label: string, pageNum: string): TeletextRow {
  const dots = '.'.repeat(Math.max(1, 34 - label.length - pageNum.length));
  return row(idx, ctrl(C), ...text(' ' + label + dots), ctrl(W), ...text(pageNum));
}

/**
 * Build a multi-subpage text article from paragraphs.
 * Each subpage holds ~16 rows of text (rows 4-20).
 */
function articlePage(
  pageNum: number, title: string, subtitle: string,
  paragraphs: string[], ft: { red?: number; green?: number; yellow?: number; cyan?: number },
  titleColor: number = Y,
): TeletextPage {
  const page = createEmptyPage(pageNum);
  page.description = title;
  page.fastext = ft as any;
  const pn = pageNum.toString(16).toUpperCase();

  // Word-wrap paragraphs into 38-char lines
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (para === '') {
      // Only add blank line if previous line wasn't already blank
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      if (line.length + word.length + 1 > 38) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + ' ' + word : word;
      }
    }
    if (line) lines.push(line);
  }
  // Trim trailing blanks
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  // Split into subpages — rows 4-20 = 17 lines per page
  const linesPerPage = 17;
  const totalPages = Math.max(1, Math.ceil(lines.length / linesPerPage));

  page.subpages = [];
  for (let p = 0; p < totalPages; p++) {
    const sp = createEmptySubpage(p);
    sp.rows[0] = header(pn, title.substring(0, 10).toUpperCase());
    sp.rows[1] = titleRow(1, titleColor, title.substring(0, 16).toUpperCase());
    sp.rows[2] = blank(2);
    if (p === 0 && subtitle) {
      sp.rows[3] = textRow(3, C, subtitle.substring(0, 38));
    } else {
      sp.rows[3] = textRow(3, W, `(page ${p + 1}/${totalPages})`);
    }

    const startLine = p * linesPerPage;
    for (let i = 0; i < linesPerPage; i++) {
      const lineIdx = startLine + i;
      if (lineIdx < lines.length && lines[lineIdx]) {
        sp.rows[4 + i] = textRow(4 + i, W, lines[lineIdx]);
      } else {
        sp.rows[4 + i] = blank(4 + i);
      }
    }

    sp.rows[21] = totalPages > 1 ? textRow(21, C, `Page ${p + 1} of ${totalPages}`) : blank(21);
    sp.rows[22] = sep(22, MR);
    sp.rows[23] = fastext(
      ft.red ? 'Back' : 'Index',
      ft.green ? 'Prev' : '',
      ft.yellow ? 'Next' : '',
      ft.cyan ? 'More' : '',
    );

    page.subpages.push(sp);
  }

  if (totalPages > 1) page.defaultCycle = { mode: 'time', value: 20 };
  return page;
}

// ─── Page 100: Main Index ───────────────────────────────────────

function page100(): TeletextPage {
  const page = createEmptyPage(0x100);
  page.description = 'AI-Created Main Index';
  page.fastext = { red: 0x200, green: 0x300, yellow: 0x400, cyan: 0x500 };
  const sp = page.subpages[0];

  sp.rows[0] = header('100', 'INDEX');
  sp.rows[1] = row(1, ctrl(MC), ...Array(39).fill(null).map(() => mos(0x7F)));
  sp.rows[2] = titleRow(2, C, 'AI-CREATED');
  sp.rows[3] = blank(3);
  sp.rows[4] = textRow(4, W, 'AI-Native Products. Real Prototypes.');
  sp.rows[5] = textRow(5, W, 'Shipped Software.');
  sp.rows[6] = sep(6, MY);
  sp.rows[7] = textRow(7, Y, 'Main Sections');
  sp.rows[8] = menuItem(8, 'Products (15)', '200');
  sp.rows[9] = menuItem(9, 'Stories (4)', '300');
  sp.rows[10] = menuItem(10, 'Lab Notes (11)', '400');
  sp.rows[11] = menuItem(11, 'Media', '500');
  sp.rows[12] = menuItem(12, 'About Marco', '600');
  sp.rows[13] = sep(13, MC);
  sp.rows[14] = textRow(14, Y, 'Featured Products');
  sp.rows[15] = blank(15);
  sp.rows[16] = row(16, ctrl(G), ...text(' Vectronix'), fill(14), ctrl(W), ...text('Arcade   201'));
  sp.rows[17] = row(17, ctrl(G), ...text(' My AI Diary'), fill(12), ctrl(W), ...text('AI Tool  202'));
  sp.rows[18] = row(18, ctrl(G), ...text(' Radial Drift'), fill(11), ctrl(W), ...text('Game     203'));
  sp.rows[19] = row(19, ctrl(G), ...text(' HexaX'), fill(18), ctrl(W), ...text('Game     204'));
  sp.rows[20] = row(20, ctrl(G), ...text(' Deadfall'), fill(15), ctrl(W), ...text('Game     205'));
  sp.rows[21] = blank(21);
  sp.rows[22] = sep(22, MR);
  sp.rows[23] = fastext('Products', 'Stories', 'Lab Notes', 'Media');
  return page;
}

// ─── Page 200: Products Index ───────────────────────────────────

function page200(): TeletextPage {
  const page = createEmptyPage(0x200);
  page.description = 'Products';
  page.fastext = { red: 0x100, green: 0x300, yellow: 0x400 };
  const sp = page.subpages[0];

  sp.rows[0] = header('200', 'PRODUCTS');
  sp.rows[1] = titleRow(1, Y, 'PRODUCTS');
  sp.rows[2] = blank(2);
  sp.rows[3] = textRow(3, W, 'Games');
  sp.rows[4] = menuItem(4, 'Vectronix', '201');
  sp.rows[5] = menuItem(5, 'Radial Drift', '203');
  sp.rows[6] = menuItem(6, 'HexaX', '204');
  sp.rows[7] = menuItem(7, 'Deadfall', '205');
  sp.rows[8] = menuItem(8, 'Stack Overflow', '206');
  sp.rows[9] = menuItem(9, 'Rummy 500', '207');
  sp.rows[10] = blank(10);
  sp.rows[11] = textRow(11, W, 'AI & Tools');
  sp.rows[12] = menuItem(12, 'My AI Diary', '202');
  sp.rows[13] = menuItem(13, 'Calorie Counter', '208');
  sp.rows[14] = menuItem(14, 'Thought2Tweet', '209');
  sp.rows[15] = menuItem(15, 'Persona Personified', '210');
  sp.rows[16] = blank(16);
  sp.rows[17] = textRow(17, W, 'Creative & Utility');
  sp.rows[18] = menuItem(18, 'Audio Visualizer', '211');
  sp.rows[19] = menuItem(19, 'Last Weather App', '212');
  sp.rows[20] = menuItem(20, 'Jumbotron/Color Clock', '213');
  sp.rows[21] = menuItem(21, 'Social Media Downloader', '215');
  sp.rows[22] = sep(22, MR);
  sp.rows[23] = fastext('Index', 'Stories', 'Lab Notes', '');
  return page;
}

// ─── Product pages ──────────────────────────────────────────────

const products: Array<[number, string, string, string, string, string[], number]> = [
  [0x201, 'Vectronix', 'Hardcore arcade space combat. No mercy. No filler.', 'iOS | Game', 'Free',
    ['A high-intensity retro shooter that fuses classic arcade DNA with modern precision systems. Relentless formations, aggressive dive attacks, and split-second survival across 9 unique enemy types with coordinated dives, escort mechanics, and multi-phase tractor-beam boss encounters.',
     'Features dual fighter rescue mechanics with risk-based scoring that rewards aggression. Challenge stages and power-ups acquired through UFO encounters.',
     'Two handcrafted display modes: Vector mode features blue phosphor glow, bloom, and persistence trails. CRT mode adds curved distortion, scanlines, and NTSC warmth.',
     'No ads. No in-app purchases. Pure skill.',
     'Built with Phaser, WebGL, and Claude Code.'], R],
  [0x202, 'My AI Diary', 'Journaling, redesigned for the way we live now.', 'Web | AI Tool', 'Free',
    ['Completely rethinks how we journal in the age of AI. Speak naturally and the AI turns your raw voice into a beautifully written journal entry that still sounds like you.',
     'Features transcription, enhancement, tagging, sentiment analysis, smart summaries, encrypted storage, and PDF export.',
     'The goal: a journaling system that works the way people actually think, not the way apps want them to behave.',
     'Available at diary.ai-created.com',
     'Built with Next.js, OpenAI API, Whisper, IndexedDB, and Augment Code.'], M],
  [0x203, 'Radial Drift', 'One finger. One mistake ends the run.', 'iOS/Android/macOS', 'Free',
    ['Premium arcade survival game built on a single, unforgiving mechanic. Rotate your shield with intuitive swipe controls to defend your core against escalating waves of enemies.',
     'Clean geometry meets explosive neon visuals, paired with an original EDM/Trance soundtrack featuring 20 full tracks.',
     'Available on the App Store, Google Play, and Mac App Store.',
     'Built with Phaser, WebGL, and Claude Code.'], R],
  [0x204, 'HexaX', 'Pure arcade design. No nonsense. Just skill.', 'iOS/Andr/Mac/Web', 'Free',
    ['Defend a glowing hexagonal tunnel divided into six walls. Enemies and hazards approach from the distance, one segment at a time.',
     'Rather than moving your ship, you rotate the world to line up shots and evade danger by planning ahead.',
     'Includes Vector Display and CRT Mode options.',
     'Built with Phaser, WebGL, Three.js, and Claude Code.'], C],
  [0x205, 'Deadfall', 'A childhood dream finally brought to life.', 'macOS/Windows', 'Free',
    ['An homage to arcade games from the late 1980s, emphasizing challenging gameplay and retro aesthetics.',
     '10 hand-crafted levels with AI-assisted sprites that underwent extensive manual editing.',
     'Particle effects, period-authentic graphics, music and sound design.',
     'Built with Phaser and Augment Code.'], G],
  [0x206, 'Stack Overflow', 'SNES-style retro falling blocks game.', 'Web | Puzzle', 'Free',
    ['A falling blocks puzzle game with SNES-era visual style. Clean mechanics, responsive controls, satisfying gameplay.',
     'Classic arcade puzzle design with modern web technology.'], Y],
  [0x207, 'Rummy 500', 'The first Rummy 500 that actually works on phones.', 'Web | Cards', 'Free',
    ['A proper Rummy 500 implementation that works well on mobile devices.',
     'Full rules implementation, AI opponents, clean interface. No compromises on the card game experience.'], M],
  [0x208, 'Calorie Counter', 'The most frictionless food intake logger ever created.', 'Web | Health', 'Free',
    ['Multiple entry methods: barcode scanning, text input, voice entry, and food photography.',
     'Uses OpenAI API to process entries and calculate nutritional information, providing caloric values and macronutrient breakdowns.',
     'Custom goal-setting functionality, CSV export options, and comprehensive graphical analytics for tracking food intake over time.',
     'Built with Next.js, OpenAI API, Tailwind CSS, Augment Code, and Claude Code.'], C],
  [0x209, 'Thought2Tweet', 'Turn fleeting thoughts into engaging social media posts.', 'Web | AI Tool', 'Free',
    ['Record voice input, which AI then transforms into social media content. Uses OpenAI Whisper for speech-to-text conversion.',
     'Generates both concise tweets and extended-form posts in various styles. Multiple tone options, thread support.',
     'Mobile-first design with wake-lock functionality.',
     'Built with OpenAI API, Next.js, Tailwind CSS, and Augment Code.'], B],
  [0x210, 'Persona', 'A Custom GPT to help you work with personas.', 'Web | AI Tool', 'Free',
    ['A specialized GPT that helps you create and work with user personas for product design and research.',
     'Streamlines the persona creation process using AI to generate realistic, detailed user profiles.'], G],
  [0x211, 'Audio Visualizer', 'Captivating video visualizations of your music.', 'Web | Creative', 'Free',
    ['Generate stunning video visualizations from your audio files.',
     'Multiple visual styles available, real-time rendering, and export to video format.',
     'Explore the boundaries of AI-generated visual content synced to music.'], R],
  [0x212, 'Weather App', 'Weather information, not weather entertainment.', 'Web | Utility', 'Free',
    ['Weather information presented cleanly without gamification, social features, or news articles.',
     'Just the weather. No ads, no distractions, no entertainment layer on top of data you need.'], C],
  [0x213, 'Jumbotron Sim', 'See your name in lights at a major sporting event.', 'Web | Creative', 'Free',
    ['See your name displayed on a simulated jumbotron at a major sporting event.',
     'A fun creative experiment built with web technology.'], Y],
  [0x214, 'Color Clock', 'A 1991 clock design, brought to life with AI coding.', 'Web | Creative', 'Free',
    ['A design concept from 1991 finally realized with modern code.',
     'Time displayed through smooth color transitions. A personal project brought to life after 30+ years.'], M],
  [0x215, 'SM Downloader', 'Save content from any platform without the friction.', 'Web | Utility', 'Free',
    ['Save content from any social media platform without the friction of dealing with platform-specific download tools.',
     'Simple, clean interface. Paste a URL, get your content. No ads, no sign-up walls.'], C],
];

function buildProductPages(): TeletextPage[] {
  return products.map(([num, name, tagline, platform, category, desc, color], i) => {
    const prev = i > 0 ? products[i - 1][0] as number : 0;
    const next = i < products.length - 1 ? products[i + 1][0] as number : 0;
    return articlePage(num as number, name as string, `${platform} | ${category}`,
      [tagline as string, '', ...(desc as string[])],
      { red: 0x200, green: prev || undefined, yellow: next || undefined } as any,
      color as number);
  });
}

// ─── Page 300: Stories Index + Articles ──────────────────────────

function page300(): TeletextPage {
  const page = createEmptyPage(0x300);
  page.description = 'Stories';
  page.fastext = { red: 0x100, green: 0x200, yellow: 0x400 };
  const sp = page.subpages[0];
  sp.rows[0] = header('300', 'STORIES');
  sp.rows[1] = titleRow(1, G, '0>1 STORIES');
  sp.rows[2] = blank(2);
  sp.rows[3] = textRow(3, C, 'Behind-the-scenes product narratives');
  sp.rows[4] = blank(4);
  sp.rows[5] = menuItem(5, 'Building an Arcade Shooter', '301');
  sp.rows[6] = textRow(6, W, '  with AI - 12 min');
  sp.rows[7] = blank(7);
  sp.rows[8] = menuItem(8, 'Tribal Knowledge to CMS', '302');
  sp.rows[9] = textRow(9, W, '  Enterprise systems - 10 min');
  sp.rows[10] = blank(10);
  sp.rows[11] = menuItem(11, 'AI Tool for Thinking', '303');
  sp.rows[12] = textRow(12, W, '  Voice journaling - 8 min');
  sp.rows[13] = blank(13);
  sp.rows[14] = menuItem(14, 'New Arcade Mechanic', '304');
  sp.rows[15] = textRow(15, W, '  Game design - 12 min');
  sp.rows[22] = sep(22, MR);
  sp.rows[23] = fastext('Index', 'Products', 'Lab Notes', '');
  return page;
}

function storyPages(): TeletextPage[] {
  return [
    articlePage(0x301, 'Terminus', 'Interactive Systems | 12 min read',
      ['BUILDING A FULL ARCADE SHOOTER WITH AI',
       '', 'Terminus Breach started with a different kind of ambition than Radial Drift. This one was not about inventing a completely new gameplay mechanic. It was about proving that I could take a genre Ive loved for years, the classic side-scrolling shooter, and build a version of it that felt deep, polished, atmospheric, and genuinely complete.',
       '', 'Games like R-Type, Gradius, and other late-80s and early-90s arcade shooters have always had a special place in my head. I wanted to build something in that lineage. Not a throwaway prototype. Not a shallow AI-generated experiment. A real game with enemies, bosses, progression, upgrades, systems, style, and enough mechanical depth to feel like it could have existed as a serious arcade release in another era.',
       '', 'STARTING WITH A VISUAL EXPERIMENT',
       '', 'The project began with a much smaller question. I wanted to see if I could create a side-scrolling neon cave that felt exciting to move through. I chose Three.js and WebGPU because I wanted the best browser-based performance I could get without stepping into Unity or Unreal.',
       '', 'The first version was close, but not quite right. It leaned too far into actual 3D space and didnt yet feel like a proper side-scroller. So I kept adjusting the prompts, the camera, and the rendering until I found the right balance: a game that plays like a side-scroller, but still has real depth and dimensionality.',
       '', 'A MODERN TWIST ON VINTAGE ARCADE DNA',
       '', 'Once I had the terrain shaping working properly, the game started finding its identity. The scrolling lines at the top and bottom of the environment are a clear nod to older games like Scramble and Defender, but I pushed them into a more modern wireframe direction.',
       '', 'I also added an optional CRT shader, because I love old tube-display visuals to an almost unreasonable degree. Once it was in, the whole thing clicked much harder. The scanlines, glow, softened image, and subtle arcade-monitor feel gave the game exactly the kind of vintage character I wanted.',
       '', 'FINDING THE CORE LOOP',
       '', 'Once I had a ship on screen, movement controls, terrain, and some floating asteroids to shoot, I hit the moment that matters most in any game project: Is the basic loop actually fun? That is the question that decides whether a concept deserves more of your time. In this case, the answer was yes.',
       '', 'EXPANDING THE ENEMY SYSTEM',
       '', 'I wanted a broad enemy roster with distinct silhouettes, attack patterns, and tactical roles. Some are airborne. Some are ground-based. Some fire direct shots. Others launch rockets, bullet volleys, shockwave-style attacks, or heavy beam weapons. Some move in formation. Some act more like embedded defenses.',
       '', 'The player should not feel like they are solving the same encounter over and over. Every new enemy type needed to add a new kind of tension or decision-making.',
       '', 'A FULL WEAPON MATRIX',
       '', 'No arcade shooter feels complete if the player can only fire one basic shot forever. Weapons are not just functional. They are part of the fantasy. I built a full upgrade matrix inspired by the layered weapon progression systems in games like R-Type and Gradius.',
       '', 'These include faster ship movement, faster bullets, side shots, rear shots, spread shots in multiple strengths, homing missiles in increasing counts, and shield support.',
       '', 'MAKING THE NUKE MATTER',
       '', 'I spent a ridiculous amount of time making the explosion look as good as possible. It has the double flash, the expanding shockwave, the mushroom cloud, and embers falling out of the plume. It is dramatic, excessive, and exactly what it should be.',
       '', 'I made nukes scarce. The player can only hold a limited number. Then I introduced heavily armored ground-based mini-bosses that can technically be destroyed with conventional weapons, but doing so is slow, dangerous, and often lethal. That gave the nuke a real strategic role.',
       '', 'USING MULTIPLE AI MODELS',
       '', 'Throughout this project, I moved back and forth between Claude Code and OpenAI Codex constantly. Some things worked better in one environment than the other. That back-and-forth turned out to be one of the most useful parts of the whole process.',
       '', 'Instead of using AI as a novelty, I used multiple models as complementary collaborators. One could generate. Another could review. One could refactor. Another could optimize.',
       '', 'WHY THIS PROJECT MATTERS',
       '', 'Terminus Breach shows how I work. I like taking an idea that starts as a rough visual or mechanical spark and pushing it all the way through to something cohesive, polished, and real. Yes, it is a game. But it is also proof of how I take something from zero to one.'],
      { red: 0x300, yellow: 0x302 }, G),
    articlePage(0x302, 'CMS System', 'Enterprise Systems | 10 min read',
      ['TURNING TRIBAL KNOWLEDGE INTO A SCALABLE CMS SYSTEM',
       '', 'Large retail organizations run on product data. Every item in the catalog may include hundreds of attributes: fabric, fit, sleeve length, pattern, compliance labels, country of origin, seasonal variants, and countless category-specific details.',
       '', 'In theory these attributes live in a CMS. In reality, the system I inherited was something else entirely.',
       '', 'Years of business logic had accumulated across massive spreadsheets. Thousands of attributes were interconnected through implicit rules, exceptions, and dependencies. The system worked - but only because one person had spent years learning its internal logic. Her knowledge WAS the infrastructure.',
       '', 'THE REAL PROBLEM WASNT THE INTERFACE',
       '', 'At first glance, the project looked like a standard CMS redesign. But the deeper I went, the clearer it became that the interface was not the real problem. The real problem was the data model itself.',
       '', 'The existing system treated attributes as disconnected form fields. But product data behaves more like a structured knowledge system: attributes depend on other attributes, categories define allowable attribute sets, vendor submissions require validation, internal teams curate and refine product data over time.',
       '', 'USING AI TO MAP THE HIDDEN SYSTEM',
       '', 'I conducted hours of interviews with the team member who had been maintaining the system. Instead of manually synthesizing everything, I used AI to accelerate the analysis. I fed transcripts into the model and asked it to identify workflows, map entity relationships, detect hidden dependencies, surface contradictions, and highlight ambiguous rules.',
       '', 'The AI didnt design the system. But it compressed a mountain of information into something I could actually reason about.',
       '', 'BUILDING A PROTOTYPE INSTEAD OF A SPECIFICATION',
       '', 'The domain complexity was simply too high for static designs. So I built a high-fidelity interactive prototype implementing category hierarchies, attribute schemas, dependency mapping, vendor submission flows, internal review workflows, validation rules, and versioning logic.',
       '', 'The prototype immediately changed the conversation. Instead of discussing abstract workflows, the team could interact with a working system. Hidden edge cases surfaced quickly: vendor submissions conflicting with existing attributes, seasonal overrides, category exceptions, validation conflicts.',
       '', 'LESSONS FROM THE PROJECT',
       '', 'Enterprise product systems are rarely limited by UI. They are limited by poor conceptual models. Once the underlying data structure improves, the user experience becomes dramatically simpler.',
       '', 'Turning tribal knowledge into structured systems is one of the most important challenges inside large organizations. This prototype demonstrated a path toward a more resilient future.'],
      { red: 0x300, green: 0x301, yellow: 0x303 }, C),
    articlePage(0x303, 'AI Diary', 'AI Tools for Thinking | 8 min read',
      ['DESIGNING AN AI TOOL FOR THINKING',
       '', 'Journaling has always seemed like a powerful tool. It helps with reflection, memory, and understanding whats happening in your life. But traditional journaling has one big problem: it requires discipline most people dont have.',
       '', 'Writing for thirty minutes every day sounds good in theory. In practice, it rarely happens. That realization is what started this project. I wanted the benefits of journaling without the friction. And the obvious solution was voice.',
       '', 'THE INSIGHT: SPEAKING IS EASIER THAN WRITING',
       '', 'There are many moments in a normal day when reflection would be easy if the barrier were low enough. Driving home. Walking somewhere. Sitting in the car before going into a meeting. In those moments, speaking for two minutes is effortless. Writing for ten minutes is not.',
       '', 'Voice journaling removes most of the friction. You can simply talk. But once AI enters the picture, something much more interesting becomes possible. Instead of storing raw entries, the system can turn spoken thoughts into structured knowledge.',
       '', 'A JOURNAL THAT UNDERSTANDS WHAT YOU SAID',
       '', 'You tap the record button and start talking. When youre finished, the recording is transcribed into text, AI processes the entry, and metadata is generated. The system extracts themes, mood, tags, and key ideas. The entry is stored in a searchable archive.',
       '', 'Instead of a collection of disconnected notes, the journal gradually becomes a structured record of your life.',
       '', 'WEEKLY REFLECTIONS GENERATED BY AI',
       '', 'Every week, the AI generates a weekly summary. This acts as a week in review built entirely from your own recorded thoughts. The summary includes mood trends, recurring themes, major highs and lows, meaningful quotes from entries, and graphical mood timelines.',
       '', 'These reflections often surface patterns that are difficult to notice in real time. It is one of the moments where the system starts to feel genuinely intelligent rather than just automated.',
       '', 'A PERSONAL KNOWLEDGE ARCHIVE',
       '', 'Over time, the system becomes something more than a journal. It becomes a searchable archive of your thoughts, experiences, and intentions. You can ask: What was I worried about last month? What goals did I say I wanted to work on? What patterns keep repeating?',
       '', 'Because the entries are structured with metadata and themes, the archive becomes queryable. Instead of isolated journal entries, you get a knowledge base about your own life.',
       '', 'THE BIGGER VISION',
       '', 'AI is changing the kinds of tools we can build. For the first time, software can help people reflect on their lives at scale. This project explores what happens when you treat journaling not as a notebook, but as a thinking tool.'],
      { red: 0x300, green: 0x302, yellow: 0x304 }, M),
    articlePage(0x304, 'Radial Drift', 'Interactive Systems | 12 min read',
      ['INVENTING A NEW ARCADE MECHANIC',
       '', 'Radial Drift started with a simple challenge I set for myself. I wanted to build a game that didnt feel like a variation of something that already existed. Many indie games reinterpret familiar mechanics. I wanted to explore something genuinely new.',
       '', 'THE MOMENT THE IDEA APPEARED',
       '', 'I was using ChatGPT to brainstorm possible game concepts. Most of the ideas it generated were variations of existing genres. At some point I stopped reading the suggestions and started thinking about what I would find interesting instead.',
       '', 'What if the player controlled a rotating wheel with a gap, and enemies emerged from the center of the screen? The goal would be to intercept them before they reached the ring. The player would rotate the wheel using a single finger, positioning the gap strategically while firing a lightning strike through the opening. It immediately felt like something different.',
       '', 'A ONE-FINGER CONTROL SYSTEM',
       '', 'The entire game can be played with one finger. The player rotates a partial wheel - roughly 270 degrees of structure with a 90-degree opening. Enemies emerge from the center of the screen and travel outward. The player must rotate the wheel and align the gap with incoming enemies to eliminate them.',
       '', 'The simplicity of the control hides a surprising amount of strategy. Small adjustments in rotation determine whether incoming threats are intercepted or collide with the ring.',
       '', 'RAPID PROTOTYPING TO TEST THE IDEA',
       '', 'For the first prototype: a draggable rotating wheel, a simple barrier line, basic enemies emerging from the center, collision detection. The goal was to answer one question as quickly as possible: Is this actually fun?',
       '', 'The prototype was immediately engaging. That moment confirmed the concept was worth developing into a full game.',
       '', 'EXPANDING THE ENEMY SYSTEM',
       '', 'Splitters break apart into multiple fragments when struck. Bomb Units trigger explosions that eliminate nearby enemies. Missiles are fast, lethal threats that destroy the player instantly. Maelstrom Formations are clusters spiraling outward in dynamic patterns. Each new enemy type added another layer to the gameplay.',
       '', 'CRAFTING THE VISUAL STYLE',
       '', 'The aesthetic draws inspiration from classic vector arcade games from the 1980s - titles like Tempest and early vector-display shooters. Glowing neon lines, geometric enemy shapes, bright particle explosions, high-contrast color palettes. Each level introduces a unique visual theme.',
       '', 'I implemented custom WebGL shaders inside the Phaser 3 engine. These generate animated backgrounds that respond to each levels theme. The result is twenty different visual environments.',
       '', 'MUSIC FROM DJ FLY',
       '', 'Radial Drift features 20 original EDM trance tracks from DJ Fly (FL-AI), an AI-driven DJ persona. Each level is paired with a different track, reinforcing the energy and rhythm of the gameplay.',
       '', 'WHY THIS PROJECT MATTERS',
       '', 'Radial Drift represents the ability to start with a rough idea - sometimes literally on a Saturday afternoon - and carry it all the way through to a finished product. The journey from idea to prototype to polished experience is one of the most satisfying aspects of creating software.'],
      { red: 0x300, green: 0x303 }, R),
  ];
}

// ─── Page 400: Lab Notes Index + Articles ───────────────────────

function page400(): TeletextPage {
  const page = createEmptyPage(0x400);
  page.description = 'Lab Notes';
  page.fastext = { red: 0x100, green: 0x200, yellow: 0x300 };
  const sp = page.subpages[0];
  sp.rows[0] = header('400', 'LAB NOTES');
  sp.rows[1] = titleRow(1, B, 'LAB NOTES');
  sp.rows[2] = blank(2);
  sp.rows[3] = textRow(3, C, 'Technical insights from the lab');
  sp.rows[4] = blank(4);
  sp.rows[5] = menuItem(5, 'Retro Games Look Authentic', '401');
  sp.rows[6] = menuItem(6, 'AI Is Not a Slop Machine', '402');
  sp.rows[7] = menuItem(7, 'Innovators on Perf. Plans', '403');
  sp.rows[8] = menuItem(8, 'Business Logic in One Head', '404');
  sp.rows[9] = menuItem(9, 'Shipped a Commercial Game', '405');
  sp.rows[10] = menuItem(10, 'Prompt Composer for Video', '406');
  sp.rows[11] = menuItem(11, 'AI Like a Renaissance', '407');
  sp.rows[12] = menuItem(12, 'No Glossy Portfolio', '408');
  sp.rows[13] = menuItem(13, 'UX Practice for AI Co.', '409');
  sp.rows[14] = menuItem(14, '0-1000 Followers on X', '410');
  sp.rows[15] = menuItem(15, 'Creating a Logo with AI', '411');
  sp.rows[22] = sep(22, MR);
  sp.rows[23] = fastext('Index', 'Products', 'Stories', '');
  return page;
}

function labNotePages(): TeletextPage[] {
  const notes: Array<[number, string, string, string[]]> = [
    [0x401, 'Retro Games', 'Game Development | 10 min',
      ['HOW TO MAKE RETRO GAMES THAT ACTUALLY LOOK AUTHENTIC',
       '', 'Retro is having a moment. Again. Everywhere you look, people are making games inspired by older eras of technology. Pixel art is back. CRT vibes are back. Low-fi visuals are back.',
       '', 'And yet a lot of so-called retro work doesnt actually look retro at all. It looks like modern high-resolution art wearing a fake mustache.',
       '', 'Retro visuals were not just an aesthetic choice. They were the natural result of very specific technical limitations. If you want your work to feel convincing, you cannot just sprinkle scanlines on top and call it a day.',
       '', 'START BY CHOOSING A REAL RENDERING RESOLUTION',
       '', 'The first thing I do is pick a target resolution and commit to it. Not sort of. Not approximately. Actually commit to it. In Deadfall I used 256x224, which matches the SNES resolution.',
       '', 'A lot of developers try to fake retro by making pixel-art-looking assets and dropping them into a modern high-resolution scene. That is usually where things start going sideways.',
       '', 'LOW-RES RENDERING PLUS CLEAN UPSCALING',
       '', 'The correct approach is nearest-neighbor interpolation. That keeps the pixels hard-edged and discrete. You want to upscale by whole-number multiples only: 2x, 3x, 4x. Anything else introduces subpixel distortion.',
       '', 'MAKE YOUR ARTWORK OBEY THE SAME CONSTRAINTS',
       '', 'Reduce color count aggressively. Think 32 colors. Or 16. Sometimes fewer. That color reduction is not a compromise. It is part of the charm. When you limit the palette, you naturally introduce banding, posterization, and dithering.',
       '', 'SPRITES NEED DISCIPLINE, NOT VIBES',
       '', 'Work in powers of two. For Deadfall I used 16x16 sprites. At 16x16, every pixel matters. You cannot hide behind detail. You need strong shapes, readable silhouettes, and intentional animation.',
       '', 'If you want truly great retro sprites, expect to hand-edit them. A lot. AI tools are simply not very good at this yet.',
       '', 'THE FASTEST WAY TO BREAK THE ILLUSION',
       '', 'Retro style is mostly about consistency. A crisp 16x16 sprite next to a smoothly rotated UI element? Broken. Pixel art scaled by 2.75x with filtering artifacts? Broken.',
       '', 'MY GROUND RULES:',
       '1. Render everything in the same base resolution',
       '2. Reduce your colors on purpose',
       '3. Be very careful with rotation',
       '4. Upscale only in whole-number steps',
       '', 'And then add CRT effects on top. Scanlines, phosphor glow, curvature, bloom. New is old. Old is new.']],
    [0x402, 'Slop Machine', 'AI Design | 9 min',
      ['AI IS NOT A SLOP MACHINE. PEOPLE ARE USING IT LIKE ONE.',
       '', 'The dissonance around AIs efficacy is completely insane right now. Depending on who you ask, AI is either turning designers and engineers into unstoppable 10x operators, or it is mostly a bullshit narrative used to justify layoffs.',
       '', 'AI is not necessarily a slop machine. It becomes one when people use it to avoid thinking.',
       '', 'WHEN AI FAILS, IT IS USUALLY THE USER',
       '', 'When people use AI as a replacement for judgment, taste, verification, and accountability, of course the results are often garbage. In coding: security issues, brittle code, hallucinated dependencies. In design: sameness, shallow thinking, generic outputs.',
       '', 'But that does not mean AI only produces garbage. That conclusion is just as lazy as the worst AI use.',
       '', 'MY OWN EXPERIENCE SAYS OTHERWISE',
       '', 'I have used AI to create a whole portfolio of super polished apps and games that go far beyond my plain-vanilla coding ability. AI let me go further than I could have gone on my own, but only because I stayed in the loop.',
       '', 'I pushed, questioned, rewrote, tested, refined, art-directed, and polished. I used AI to expand my range, not to abdicate responsibility.',
       '', 'AI IS A FORCE MULTIPLIER',
       '', 'Force multipliers do not care whether they are multiplying rigor or recklessness. If you already have taste, judgment, persistence, and standards, AI can be incredible. If you use it to skip thinking, it will happily help you produce polished-looking nonsense at industrial scale.',
       '', 'JUDGMENT IS THE BOTTLENECK NOW',
       '', 'AI can dramatically expand what a capable, quality-conscious person is able to build. But it does not remove the need for craft. Once output becomes cheap, judgment becomes the bottleneck.',
       '', 'AI did not help me make good work by letting me care less. It helped me make better work by letting me do more while still caring just as much. Maybe more.',
       '', 'Slop is what happens when people confuse acceleration with exemption.']],
    [0x403, 'Perf. Plans', 'Product | 6 min',
      ['WHY INNOVATIVE PEOPLE END UP ON PERFORMANCE PLANS',
       '', 'Large organizations say they want innovation. Their systems often reward the opposite.',
       '', 'Organizations have two distinct worker archetypes: operators and builders. Operators excel at maintaining systems through coordination and process. Builders thrive in ambiguity, exploring unsolved problems in the 0-to-1 phase.',
       '', 'THE VISIBILITY TRAP',
       '', 'Performance metrics favor operators. Organizations measure success through visible signals: meetings, stakeholder updates, alignment. But builders often work in deep focus on exploratory tasks that appear quiet from the outside.',
       '', 'Once negative narratives form - not collaborative, not visible - they stick. The independence and experimentation that make builders effective at innovation are interpreted as misalignment.',
       '', 'THE ORGANIZATIONAL COST',
       '', 'When companies reward predictability over experimentation, they filter out exactly the people needed for innovation. Innovation is celebrated rhetorically while constrained structurally.',
       '', 'The real challenge isnt choosing between operators and builders. Both are valuable. Organizations must create environments where each can succeed without forcing one to behave like the other.']],
    [0x404, 'Business Logic', 'UX Design | 8 min',
      ['A DECADE OF BUSINESS LOGIC IN ONE PERSONS HEAD',
       '', 'The companys product attribute system had grown organically beyond its original structure. Thousands of attributes interconnected through implicit rules, exceptions, and dependencies.',
       '', 'One person had become the connective tissue holding it all together, understanding invisible dependencies throughout the system.',
       '', 'USING AI AS A RESEARCH ASSISTANT',
       '', 'I fed hours of recorded conversations into AI and requested it identify workflows, dependencies, entity relationships, and contradictions. AI didnt design anything. It didnt make product decisions.',
       '', 'Instead, AI compressed raw information into something manageable, transforming tribal knowledge into documented logic.',
       '', 'BUILDING AN INTERACTIVE PROTOTYPE',
       '', 'I built an interactive prototype, not static wireframes, allowing teams to click through workflows and surface hidden assumptions. When stakeholders interacted with the design, previously unmentioned edge cases emerged naturally.',
       '', 'The prototype served as an alignment tool, ending opinion battles. Understanding doesnt require knowing everything upfront; structure reveals systems layer by layer.']],
    [0x405, 'Shipped a Game', 'AI Design | 10 min',
      ['HOW I FINALLY SHIPPED A COMMERCIAL GRADE ARCADE GAME',
       '', 'I had wanted to make an original arcade game since my teenage years. The problem was never motivation. It was skills and time. Mostly time. With a full-time job and family, dedicating months to learning game engines seemed unrealistic.',
       '', 'THE SPARK',
       '', 'On a Saturday afternoon, I brainstormed with ChatGPT about vintage vector arcade aesthetics. The concept: a rotating wheel with enemies emerging from the center. I verified the mechanic was genuinely novel.',
       '', 'DEVELOPMENT',
       '', 'Built a rough prototype in one afternoon using AI coding assistance. Received critical feedback on difficulty curves from game developer friend Tim Samoff. Spent extensive time on polish: playtesting, bug fixes, shader tweaking, edge case resolution.',
       '', 'Created a custom tool for real-time background shader adjustments. All 20 soundtrack tracks created using Suno AI.',
       '', 'AIs ACTUAL ROLE',
       '', 'AI didnt make the game. It accelerated development across specific domains: game frameworks, rendering details, low-level graphics concepts, performance optimization. The critical difference-maker remained human judgment through obsessive iteration and playtesting.',
       '', 'Tools used: Claude Code, Augment Code, Suno, ElevenLabs. Radial Drift is now available on macOS, Android, and iOS App Store.']],
    [0x406, 'Prompt Composer', 'AI Design | 7 min',
      ['I BUILT A STRUCTURED PROMPT COMPOSER FOR AI VIDEO',
       '', 'An open-source browser-based tool designed to help creators write better prompts for AI video generators like Googles Veo 3, Runway, Pika, and Luma.',
       '', 'The tool outputs prompts in four formats: JSON, YAML, XML, and Markdown. Structured prompts work better than unstructured text when communicating with AI systems.',
       '', 'Beyond formatting, the tool includes built-in educational resources covering cinematography terminology: lighting types, camera movements, scene types, lens types, and cinematic styles.',
       '', 'The real value lies in putting more intention into how we talk to machines.',
       '', 'Available free at prompt-composer.vercel.app and on GitHub at github.com/TheMarco/JSONPrompt. Fork it, modify it, embed it.']],
    [0x407, 'Renaissance', 'AI Design | 6 min',
      ['STOP TREATING AI LIKE A RACE. START TREATING IT LIKE A RENAISSANCE.',
       '', 'Tech and global players approach AI through zero-sum competition: hoarding talent, protecting insights, building secretive cultures. This extends beyond startups to nation-states racing for AI dominance.',
       '', 'THE COUNTERINTUITIVE REALITY',
       '', 'Generous players build stronger networks and deeper trust. The most successful ecosystems operate from abundance, not scarcity.',
       '', 'You cant run out of love. There is always enough for everyone and you can always have more of it. This principle applies to knowledge-sharing in technology.',
       '', 'VISION FOR CHANGE',
       '', 'Publish best practices and prompts openly. Open-source tools and workflows. Celebrate competitors breakthroughs. Build collective progress.',
       '', 'The current moment is like the Industrial Revolution: limitless market expansion and new categories exist for everyone, rendering competition unnecessary.',
       '', 'Build through radical generosity. Transform AI development from a race into a creative renaissance.']],
    [0x408, 'No Portfolio', 'Career | 8 min',
      ['IM 51, A SENIOR PRODUCT DESIGNER, AND I DONT HAVE A GLOSSY PORTFOLIO.',
       '', 'Design job openings are scarce with hundreds of applicants competing at the portfolio-review stage. Even talented designers with impressive work frequently dont get hired.',
       '', 'Product design isnt art. Its not merely about aesthetics or design flows.',
       '', 'AI WILL CHANGE DESIGN WORK',
       '', 'AI will soon handle much of routine design tasks. Prompting an AI to create a fully annotated sign-in flow with specific requirements generates near-perfect results in minutes, informed by thousands of successful UX patterns.',
       '', 'At 51, competing against thirty-something designers with flashy portfolios would be disadvantageous. My solution: deep AI expertise.',
       '', 'Learn large language models, image generators, and design automation tools. Position yourself as a 10x designer who multiplies productivity through AI.',
       '', 'Invest in AI capabilities, not portfolio aesthetics. Substance matters: expertise, adaptability, and speed.']],
    [0x409, 'UX for AI Co.', 'UX Design | 12 min',
      ['CREATING A UX PRACTICE FOR AN AI COMPANY THAT LACKS ONE',
       '', 'A strategic approach to building UX infrastructure at AI companies, using Midjourney as a case study.',
       '', 'PHASE 1 (MONTHS 1-3): FOUNDATION',
       '', 'Conduct comprehensive UX audits across all touchpoints. Build a design team including researchers, product designers, design systems specialists, and UX writers.',
       '', 'PHASE 2 (MONTHS 4-6): RESEARCH AND STRATEGY',
       '', 'Execute deep user research through interviews and usability testing. Establish design principles: Transparency, Control, Accessibility, and Trust.',
       '', 'PHASE 3 (MONTHS 7-12): IMPLEMENTATION',
       '', 'Develop design systems with component libraries for AI interactions. Create rapid prototypes and conduct iterative testing.',
       '', 'KEY CHALLENGES: Explaining complex AI technology, managing user expectations about AI limitations, adapting to rapidly evolving AI models.',
       '', 'Use progressive disclosure: showing users just enough information to make informed decisions without overwhelming them.',
       '', 'The most successful AI companies will be those that invest in UX as heavily as they invest in their AI models.']],
    [0x410, '1000 Followers', 'Social Media | 8 min',
      ['FROM 0-1000 FOLLOWERS ON X IN 26 DAYS',
       '', 'VALUE-FIRST CONTENT',
       '', 'Educational threads about AI tools dominated the strategy. Step-by-step tutorials for AI image generation and tool comparisons. Each post provided immediately actionable insights.',
       '', 'CONSISTENT POSTING SCHEDULE',
       '', 'Morning educational content (8-9 AM EST), afternoon quick tips (1-2 PM EST), evening behind-the-scenes posts (6-7 PM EST). Batched content creation on Sundays.',
       '', 'COMMUNITY ENGAGEMENT',
       '', 'Prioritized genuine interaction: responding to comments, engaging with other creators, building relationships within the AI/design community.',
       '', 'RESULTS',
       '', 'Weeks 1-2: 0 to 150 followers (2-3 daily posts). Weeks 3-4: 150 to 1000 followers (one viral thread with 50k+ views).',
       '', 'Five pillars: genuine value in each post, reliability through consistent output, authentic relationships over follower counts, sharing genuine expertise, and allowing growth to compound over time.',
       '', 'Algorithm gaming fails. Audience service succeeds.']],
    [0x411, 'Logo with AI', 'AI Design | 7 min',
      ['CREATING A LOGO WITH AI',
       '', 'Using AI tools to design professional logos quickly and affordably, democratizing brand identity creation.',
       '', 'ADVANTAGES: Generate dozens of concepts in minutes. Significantly cheaper than traditional designers. No design experience required. Easy exploration of multiple creative directions.',
       '', 'RECOMMENDED TOOLS',
       '', 'Midjourney: Abstract, artistic designs; requires post-processing. DALL-E 3: Text-integrated logos with excellent rendering. Looka: Complete brand packages with vector outputs. Brandmark: Minimalist, modern aesthetic.',
       '', 'THE PROCESS',
       '', '1. Define your brand: industry, values, personality, target audience. 2. Craft effective prompts: logo type, company, industry, style, colors, mood, minimalist, vector style. 3. Generate 20-50 variations. 4. Refine and iterate using image-to-image generation.',
       '', 'CRITICAL: Convert raster AI outputs to vector format using Adobe Illustrator, Inkscape, or Vector Magic for scalability.',
       '', 'Test logos across sizes, colors, and backgrounds. Research trademark availability. Create multiple versions: monochrome, reversed, favicon.',
       '', 'AI democratizes logo design, but success still requires understanding design principles, brand strategy, and proper execution.']],
  ];
  return notes.map(([num, title, sub, paras], i) => {
    const prev = i > 0 ? notes[i - 1][0] as number : 0;
    const next = i < notes.length - 1 ? notes[i + 1][0] as number : 0;
    return articlePage(num as number, title as string, sub as string, paras as string[],
      { red: 0x400, green: prev || undefined, yellow: next || undefined } as any);
  });
}

// ─── Page 500: Media ────────────────────────────────────────────

function page500(): TeletextPage {
  const page = createEmptyPage(0x500);
  page.description = 'Media';
  page.fastext = { red: 0x100, green: 0x200 };
  const sp = page.subpages[0];
  sp.rows[0] = header('500', 'MEDIA');
  sp.rows[1] = titleRow(1, R, 'MEDIA');
  sp.rows[2] = blank(2);
  sp.rows[3] = textRow(3, Y, 'Video Experiments');
  sp.rows[4] = textRow(4, W, 'AI-generated and AI-assisted video');
  sp.rows[5] = textRow(5, W, 'content on the @AIandDesign channel.');
  sp.rows[6] = blank(6);
  sp.rows[7] = textRow(7, Y, 'AI Music & Sound');
  sp.rows[8] = textRow(8, W, '1000+ tracks across 6+ genres using');
  sp.rows[9] = textRow(9, W, 'Suno, Udio, and custom pipelines.');
  sp.rows[10] = textRow(10, C, 'Original compositions, game soundtracks');
  sp.rows[11] = textRow(11, C, 'ambient/experimental, vocal synthesis.');
  sp.rows[12] = blank(12);
  sp.rows[13] = textRow(13, Y, 'Writing & Storytelling');
  sp.rows[14] = textRow(14, W, 'AI-assisted creative writing:');
  sp.rows[15] = textRow(15, G, '- Why AI art can be real art');
  sp.rows[16] = textRow(16, G, '- Using ChatGPT to fight bigotry');
  sp.rows[17] = textRow(17, G, '- The battle of Neonfall');
  sp.rows[18] = textRow(18, G, '- Requiem for Prometheus: AGI story');
  sp.rows[19] = blank(19);
  sp.rows[20] = textRow(20, M, 'YouTube & X: @AIandDesign');
  sp.rows[22] = sep(22, MR);
  sp.rows[23] = fastext('Index', 'Products', '', '');
  return page;
}

// ─── Page 600: About ────────────────────────────────────────────

function page600(): TeletextPage {
  return articlePage(0x600, 'About Marco', 'Product innovator. 25+ years.',
    ['Marco van Hylckama Vlieg',
     '',
     'Ive spent 25+ years building digital products across startups, agencies, and major tech companies. Product design, UX research, full-stack development, audio production. The work has always been about making things that ship.',
     '',
     'Today I focus on AI-native product design. I invent new product ideas, prototype them rapidly, build real systems, and ship polished experiences. Everything on this site was designed, built, and shipped by one person.',
     '',
     'AI didnt replace those skills. It collapsed the gap between knowing how something should work and having it running in production. The result is a higher volume of finished products built to a higher standard than was previously possible for a single builder.',
     '',
     'THE LAB',
     '',
     'AI-Created is my independent product lab. I ship real products: apps that solve problems, games worth playing, and creative tools that do things nothing else does. Everything is built with AI as a first-class part of the architecture.',
     '',
     'Every project is an experiment in what one person can ship with deep domain knowledge and current AI tooling. Some ship to app stores. Some stay as prototypes. All of them teach me something about what works and what doesnt.',
     '',
     'The 0-to-1 stories document that process: the problem, the idea, the system that got built, and what was learned along the way.',
     '',
     'WHAT I BRING',
     '',
     'Deep experience in product design and engineering across consumer apps, enterprise systems, and interactive media. Ive worked at companies where software at scale matters and where shipping is the only metric.',
     '',
     'A product innovation mindset that starts with real problems and ends with working software. Not decks. Not wireframes that sit in Figma. Systems that run.',
     '',
     'The ability to move from idea to polished product without handoffs, translation layers, or communication overhead. One person. Full stack. Shipped.',
     '',
     'TECH STACK',
     '',
     'Next.js, Swift, TypeScript, OpenAI, WebGL, Tailwind CSS, Framer Motion, Supabase',
     '',
     'CONTACT',
     '',
     'info@ai-created.com',
     'YouTube & X: @AIandDesign',
     'LinkedIn: Marco van Hylckama Vlieg',
     'ai-created.com'],
    { red: 0x100, green: 0x200, yellow: 0x300 }, C);
}

// ─── Build complete service ─────────────────────────────────────

export function buildAICreatedService(): TeletextService {
  return {
    id: 'ai-created',
    title: 'AI-Created Teletext',
    defaultLanguageSubset: 'english',
    pages: [
      page100(),
      page200(),
      ...buildProductPages(),
      page300(),
      ...storyPages(),
      page400(),
      ...labNotePages(),
      page500(),
      page600(),
    ],
  };
}
