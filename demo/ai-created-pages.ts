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
  sp.rows[20] = menuItem(20, 'Jumbotron Simulator', '213');
  sp.rows[21] = menuItem(21, 'Color Clock', '214');
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
    articlePage(0x301, 'Arcade Shooter', 'Interactive Systems | 12 min read',
      ['Building a Full Arcade Shooter With AI',
       '', 'A full-featured arcade shooter built with Three.js, WebGPU, AI coding tools, procedural environments, layered weapon systems, bosses, and CRT-era visual flair.',
       '', 'This story documents building Vectronix from concept to shipped iOS game, using Claude and other AI tools throughout the entire process.',
       '', 'The game features nine enemy types, multi-phase boss encounters, dual fighter rescue mechanics, and two distinct visual modes inspired by classic vector displays and consumer CRT televisions.'],
      { red: 0x300, yellow: 0x302 }, G),
    articlePage(0x302, 'Tribal to CMS', 'Enterprise Systems | 10 min read',
      ['Turning Tribal Knowledge Into a Scalable CMS System',
       '', 'Transforming undocumented enterprise knowledge into a structured CMS architecture.',
       '', 'A decade of business logic lived in one persons head. Buried in spreadsheets, email threads, and institutional memory.',
       '', 'Using AI tools to extract, structure, and systematize this knowledge into a maintainable system.'],
      { red: 0x300, green: 0x301, yellow: 0x303 }, C),
    articlePage(0x303, 'AI Thinking', 'AI Tools for Thinking | 8 min read',
      ['Designing an AI Tool for Thinking',
       '', 'Voice journaling system that extracts themes, tracks mood, and generates weekly reflection summaries.',
       '', 'The goal: a journaling system that works the way people actually think, not the way apps want them to behave.',
       '', 'Speak naturally. The AI handles transcription, enhancement, sentiment analysis, and creates structured reflections while preserving your authentic voice.'],
      { red: 0x300, green: 0x302, yellow: 0x304 }, M),
    articlePage(0x304, 'Arcade Mechanic', 'Interactive Systems | 12 min read',
      ['Inventing a New Arcade Mechanic',
       '', 'Arcade game built around a new rotating defense mechanic using Phaser and custom shaders.',
       '', 'The challenge: create a game mechanic that feels both instantly understandable and endlessly deep.',
       '', 'The result was Radial Drift, where one finger controls a rotating shield. Simple input, complex emergent gameplay.'],
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
      ['How to Make Retro Games That Actually Look Authentic', '', 'Retro visuals were not just an aesthetic choice. They were the natural result of very specific technical limitations.', '', 'Understanding those limitations is the key to creating retro graphics that feel genuine rather than nostalgic pastiche.']],
    [0x402, 'Not a Slop Machine', 'AI Design | 9 min',
      ['AI Is Not a Slop Machine. People Are Using It Like One.', '', 'AI is a force multiplier. And force multipliers do not care whether they are multiplying rigor or recklessness.', '', 'The quality of AI output depends entirely on the quality of human input, judgment, and editorial standards.']],
    [0x403, 'Perf. Plans', 'Product | 6 min',
      ['Why Some of the Most Innovative People End Up on Performance Plans', '', 'Large organizations systems often discourage the exact innovation they claim to want.', '', 'The incentive structures reward predictability, not creativity.']],
    [0x404, 'Business Logic', 'UX Design | 8 min',
      ['A Decade of Business Logic Lived in One Persons Head. I Had to Turn It Into a System.', '', 'Chronicles converting undocumented expertise buried in spreadsheets into a scalable CMS design using AI.']],
    [0x405, 'Shipped a Game', 'AI Design | 10 min',
      ['How I Finally Shipped a Commercial Grade Arcade Game', '', 'From weekend prototype to published iOS, Android, and macOS game with AI assistance.', '', 'The journey of building Radial Drift from concept to three app stores.']],
    [0x406, 'Prompt Composer', 'AI Design | 7 min',
      ['I Built a Structured Prompt Composer for AI Video', '', 'An open-source tool for crafting better prompts for various AI video generators.']],
    [0x407, 'Renaissance', 'AI Design | 6 min',
      ['Stop Treating AI Like a Race. Start Treating It Like a Renaissance.', '', 'Shifting from competitive hoarding toward collaborative, generous knowledge-building.']],
    [0x408, 'No Portfolio', 'Career | 8 min',
      ['Im 51, a Senior Product Designer, and I DONT Have a Glossy Online Portfolio.', '', 'Prioritizing AI competencies over traditional design portfolio presentation. The work speaks for itself.']],
    [0x409, 'UX for AI Co.', 'UX Design | 12 min',
      ['Creating a UX Practice for an AI Company that Lacks One', '', 'Establishing comprehensive design practices at AI-focused organizations from scratch.']],
    [0x410, '1000 Followers', 'Social Media | 8 min',
      ['From 0-1000 Followers on X in 26 Days', '', 'Growth strategies and methods for building audience in the AI and design space.']],
    [0x411, 'Logo with AI', 'AI Design | 7 min',
      ['Creating a Logo with AI', '', 'Designing professional logos using various AI tools. Process, iterations, and results.']],
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
