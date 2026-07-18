'use strict';
const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ── Conversation memory (per JID, keeps last 8 exchanges) ────────────────────
const conversationMemory = new Map();
const MEMORY_MAX = 8;

function rememberMessage(jid, role, text) {
    if (!conversationMemory.has(jid)) conversationMemory.set(jid, []);
    const mem = conversationMemory.get(jid);
    mem.push({ role, text, ts: Date.now() });
    if (mem.length > MEMORY_MAX) mem.shift();
}

function getMemory(jid) {
    return conversationMemory.get(jid) || [];
}

function buildContextPrompt(jid, currentQuery) {
    const mem = getMemory(jid).slice(-6); // last 6 turns
    if (!mem.length) return currentQuery;
    const history = mem.map(m => `${m.role === 'user' ? 'User' : 'Silva'}: ${m.text}`).join('\n');
    return `You are Silva, a smart, friendly WhatsApp AI assistant. Stay in character. Be concise and helpful.\n\nConversation so far:\n${history}\n\nUser: ${currentQuery}\nSilva:`;
}
const os = require('os');

function detectPlatform() {
    if (process.env.PLATFORM) return process.env.PLATFORM;
    if (process.env.HEROKU_APP_NAME || process.env.DYNO) return 'Heroku';
    if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME) return 'Railway';
    if (process.env.RENDER) return 'Render';
    if (process.env.VERCEL) return 'Vercel';
    if (process.env.FLY_APP_NAME) return 'Fly.io';
    if (process.env.KOYEB_SERVICE_NAME) return 'Koyeb';
    if (process.env.REPL_ID || process.env.REPLIT_DB_URL) return 'Replit';
    return `${os.type()} Server`;
}

const BOT_IDENTITY = {
    name: config.BOT_NAME || '𝗠𝗨𝗗𝗔𝗦𝗦𝗔𝗥 𝗠𝗗',
    version: '4.0.1',
    language: 'Node.js',
    library: 'Baileys',
    repo: '',
    website: '',
    get platform() { return detectPlatform(); },
    developer: config.OWNER_NAME || '𝙈𝙐𝘿𝘼𝙎𝙎𝘼𝙍 شہنشاہ',
    ownerName: config.OWNER_NAME || '𝗠𝗨𝗗𝗔𝗦𝗦𝗔𝗥 𝗠𝗗',
    ownerNumber: config.OWNER_NUMBER || '',
    features: [
        'Auto View Status', 'Anti-Delete Messages', 'Download Songs & Videos',
        'View-Once Recovery', 'Fake Recording/Typing', 'Always Online',
        'Auto Like Status', 'AI/ChatGPT Integration', 'Status Downloader',
        'Anti-Call', 'Smart Chatbot', 'Auto Bio Update', 'Auto React',
        'Auto Read Messages', 'Auto Save Contacts', 'Anti-Ban Protection',
        'WhatsApp Safe Mode', 'Sudo System', 'Multi-Prefix Support'
    ],
};

function getPluginMap() {
    const map = new Map();
    try {
        // Use the same plugin list handler.js loaded — guaranteed same instances
        const { plugins } = require('../handler');
        for (const p of plugins) {
            if (Array.isArray(p.commands) && typeof p.run === 'function') {
                for (const cmd of p.commands) {
                    if (!map.has(cmd)) map.set(cmd, p);
                }
            }
        }
        if (map.size > 0) return map;
    } catch { /* fallback below */ }

    // Fallback: scan plugins directory directly
    const dir = path.join(__dirname);
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        try {
            const p = require(path.join(dir, f));
            const mods = Array.isArray(p) ? p : [p];
            for (const mod of mods) {
                if (Array.isArray(mod?.commands) && typeof mod.run === 'function') {
                    for (const cmd of mod.commands) {
                        if (!map.has(cmd)) map.set(cmd, mod);
                    }
                }
            }
        } catch {}
    }
    return map;
}

function pluginMap() {
    return getPluginMap();
}

function formatUptime() {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function getPlatformInfo() {
    const memUsed = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const totalMem = Math.round(os.totalmem() / 1024 / 1024);
    return {
        platform: detectPlatform(),
        os: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        nodeVersion: process.version,
        memory: `${memUsed}MB / ${totalMem}MB`,
        cpus: os.cpus().length,
        hostname: os.hostname(),
        uptime: formatUptime(),
        pid: process.pid,
    };
}

function getActiveFeatures() {
    const features = [];
    if (config.AUTO_STATUS_SEEN) features.push('Auto View Status');
    if (config.AUTO_STATUS_REACT) features.push('Auto Like Status');
    if (config.ANTIDELETE_GROUP || config.ANTIDELETE_PRIVATE) features.push('Anti-Delete');
    if (config.ANTIVV) features.push('View-Once Recovery');
    if (config.AUTO_TYPING) features.push('Fake Typing');
    if (config.AUTO_RECORDING) features.push('Fake Recording');
    if (config.ALWAYS_ONLINE) features.push('Always Online');
    if (config.READ_MESSAGE) features.push('Auto Read');
    if (config.ANTILINK) features.push('Anti-Link');
    if (config.ANTI_BAD) features.push('Anti-Bad Words');
    return features;
}

// ── Natural language intent map ───────────────────────────────────────────────
// Maps everyday words/phrases → actual bot plugin commands.
const intentMap = [
    // ── Music & Audio ────────────────────────────────────────────────────────
    { pattern: /\b(play|download\s+song|get\s+song|stream)\b/i,                        cmd: 'play',        label: '🎵 Fetching music',             strip: /\bplay\b|\bdownload\s+song\b|\bget\s+song\b|\bstream\b/gi },
    { pattern: /\b(yt\s*video|ytvideo|youtube\s*video|watch\s+on\s+youtube|ytv)\b/i,  cmd: 'ytmp4',       label: '🎬 Downloading YouTube video',   strip: /\byt\s*video\b|\bytvideo\b|\byoutube\s*video\b|\bwatch\s+on\s+youtube\b|\bytv\b/gi },
    { pattern: /\blyrics?\b/i,                                                          cmd: 'lyrics',      label: '🎤 Fetching lyrics',            strip: /\blyrics?\b/gi },
    { pattern: /\b(speak|say|read\s+aloud|text\s*to\s*speech|tts)\b/i,                cmd: 'tts',         label: '🔊 Converting text to speech',  strip: /\bspeak\b|\bsay\b|\bread\s+aloud\b|\btext\s*to\s*speech\b|\btts\b/gi },
    { pattern: /\bspotify\b/i,                                                          cmd: 'spotify',     label: '🎵 Searching Spotify',          strip: /\bspotify\b/gi },

    // ── Social Media Downloads ───────────────────────────────────────────────
    { pattern: /\btiktok\b|\btik\s*tok\b/i,                                             cmd: 'tiktok',      label: '🎵 Downloading TikTok',         strip: /\btiktok\b|\btik\s*tok\b/gi },
    { pattern: /\binstagram\b|\binsta\b/i,                                               cmd: 'ig',          label: '📸 Downloading Instagram',      strip: /\binstagram\b|\binsta\b/gi },
    { pattern: /\bfacebook\b|\bfb\b/i,                                                  cmd: 'facebook',    label: '📘 Downloading Facebook',       strip: /\bfacebook\b|\bfb\b/gi },
    { pattern: /\bpinterest\b/i,                                                         cmd: 'pinterest',   label: '📌 Searching Pinterest',        strip: /\bpinterest\b/gi },
    { pattern: /\btwitter\b|\btweet\b|\bx\.com\b/i,                                     cmd: 'twitter',     label: '🐦 Downloading Twitter/X',      strip: /\btwitter\b|\btweet\b|\bx\.com\b/gi },

    // ── Images & Stickers ────────────────────────────────────────────────────
    { pattern: /\bsticker\b/i,                                                           cmd: 'sticker',     label: '🎭 Creating sticker',           strip: /\bsticker\b/gi },
    { pattern: /\b(generate|create|make|draw|imagine)\s+(an?\s+)?(ai\s+)?(image|photo|picture|art|artwork|illustration)\b/i, cmd: 'imagine', label: '🎨 Generating AI image', strip: /\b(generate|create|make|draw|imagine)\s+(an?\s+)?(ai\s+)?(image|photo|picture|art|artwork|illustration)\b/gi },
    { pattern: /\bimagine\b/i,                                                           cmd: 'imagine',     label: '🎨 Generating AI image',        strip: /\bimagine\b/gi },
    { pattern: /\b(quotly|quote\s*sticker|quote\s*card|q2s)\b/i,                       cmd: 'quotly',      label: '💬 Creating quote sticker',     strip: /\b(quotly|quote\s*sticker|quote\s*card|q2s)\b/gi },

    // ── AI & Analysis ────────────────────────────────────────────────────────
    { pattern: /\b(describe|analyze|caption|what\s+(is|in)\s+(this|the)\s+image|identify\s+this)\b/i, cmd: 'describe', label: '👁️ Analyzing image', strip: /\b(describe|analyze|caption|what\s+(is|in)\s+(this|the)\s+image|identify\s+this)\b/gi },
    { pattern: /\b(summarize|summary|tldr|tl;dr|brief|shorten)\b/i,                    cmd: 'summarize',   label: '📝 Summarizing text',           strip: /\b(summarize|summary|tldr|tl;dr|brief|shorten)\b/gi },
    { pattern: /\bgemini\b|\bchatgpt\b|\bgpt\b/i,                                       cmd: 'gemini',      label: '🤖 Asking Gemini AI',           strip: /\bgemini\b|\bchatgpt\b|\bgpt\b/gi },

    // ── Info & Search ────────────────────────────────────────────────────────
    { pattern: /\bwikipedia\b|\bwiki\b/i,                                                cmd: 'wiki',        label: '📚 Searching Wikipedia',        strip: /\bwikipedia\b|\bwiki\b/gi },
    { pattern: /\btranslate\b|\btranslation\b/i,                                         cmd: 'translate',   label: '🌐 Translating',                strip: /\btranslate\b|\btranslation\b/gi },
    { pattern: /\bdefine\b|\bdefinition\b|\bdictionary\b/i,                              cmd: 'define',      label: '📖 Looking up definition',      strip: /\bdefine\b|\bdefinition\b|\bdictionary\b/gi },
    // NOTE: \bgithub\b only fires for plain user profiles (not repo paths / silvatech)
    { pattern: /\bgithub\b(?!.*\/)/i,                                                    cmd: 'githubstalk', label: '🐙 Fetching GitHub profile',    strip: /\bgithub\b/gi },

    // ── Productivity ─────────────────────────────────────────────────────────
    { pattern: /\b(remind\s+me|set\s+(a\s+)?reminder|reminder)\b/i,                    cmd: 'remind',      label: '⏰ Setting reminder',           strip: /\b(remind\s+me|set\s+(a\s+)?reminder|reminder)\b/gi },
    { pattern: /\b(save\s+(a\s+)?note|note\s+down|take\s+note)\b/i,                    cmd: 'notes',       label: '📝 Saving note',                strip: /\b(save\s+(a\s+)?note|note\s+down|take\s+note)\b/gi },
    { pattern: /\b(get\s+(my\s+)?note|show\s+(my\s+)?note|read\s+(my\s+)?note)\b/i,   cmd: 'notes',       label: '📝 Fetching note',              strip: /\b(get\s+(my\s+)?note|show\s+(my\s+)?note|read\s+(my\s+)?note)\b/gi },
    { pattern: /\b(create\s+(a\s+)?poll|make\s+(a\s+)?poll|start\s+(a\s+)?poll)\b/i,  cmd: 'poll',        label: '📊 Creating poll',              strip: /\b(create\s+(a\s+)?poll|make\s+(a\s+)?poll|start\s+(a\s+)?poll)\b/gi },
    { pattern: /\b(schedule\s+(a\s+)?message|schedule\s+send)\b/i,                     cmd: 'schedule',    label: '⏱️ Scheduling message',        strip: /\b(schedule\s+(a\s+)?message|schedule\s+send)\b/gi },

    // ── Tools ────────────────────────────────────────────────────────────────
    { pattern: /\bqr\s*code\b|\bqrcode\b/i,                                             cmd: 'qr',          label: '📱 Generating QR code',         strip: /\bqr\s*code\b|\bqrcode\b/gi },
    { pattern: /\bscreenshoot?\b/i,                                                      cmd: 'screenshot',  label: '📸 Taking screenshot',          strip: /\bscreenshoot?\b/gi },
    { pattern: /\bspeedtest\b|\bspeed\s*test\b|\binternet\s+speed\b/i,                  cmd: 'speedtest',   label: '🌐 Running speed test',         strip: /\bspeedtest\b|\bspeed\s*test\b|\binternet\s+speed\b/gi },
    { pattern: /\bweather\b|\bforecast\b|\btemperature\s+in\b/i,                        cmd: 'weather',     label: '🌤️ Checking weather',          strip: /\bweather\b|\bforecast\b|\btemperature\s+in\b/gi },

    // ── Fun & Knowledge ──────────────────────────────────────────────────────
    { pattern: /\briddle\b/i,                                                            cmd: 'riddle',      label: '🧩 Getting a riddle',           strip: /\briddle\b/gi },
    { pattern: /\bproverb\b|\bsaying\b|\bwisdom\b|\badage\b/i,                         cmd: 'proverb',     label: '📜 Fetching a proverb',         strip: /\bproverb\b|\bsaying\b|\bwisdom\b|\badage\b/gi },
    { pattern: /\brhyme\b/i,                                                             cmd: 'rhyme',       label: '🎵 Finding rhymes',             strip: /\brhyme\b/gi },

    // ── GitHub SilvaTechB ────────────────────────────────────────────────────
    { pattern: /\bsilvatech\b.*\b(repos?|github|projects?)\b|\b(silvatech|silvarepos)\b/i, cmd: 'silvatech', label: '🐙 Fetching SilvaTechB repos',  strip: /\bsilvatech\b|\bsilvarepos?\b/gi },

    // ── Bot Status ───────────────────────────────────────────────────────────
    { pattern: /\buptime\b|\bruntime\b/i,                                                cmd: 'uptime',      label: '⏱️ Checking uptime',           strip: /\buptime\b|\bruntime\b/gi },
    { pattern: /\balive\b|\bping\b/i,                                                    cmd: 'alive',       label: '⚡ Checking bot status',        strip: /\balive\b|\bping\b/gi },
    { pattern: /\bmenu\b|\bcommands\b/i,                                                 cmd: 'menu',        label: '📋 Loading menu',               strip: /\bmenu\b|\bcommands\b/gi },
];

function findIntent(query) {
    for (const intent of intentMap) {
        if (intent.pattern.test(query)) {
            const stripped = query.replace(intent.strip, '').replace(/\s+/g, ' ').trim();
            return {
                cmd: intent.cmd,
                label: intent.label,
                pluginArgs: stripped ? stripped.split(/\s+/).filter(Boolean) : [],
            };
        }
    }
    return null;
}

// ── Built-in smart conversation engine (no API key needed) ───────────────────
const smartResponses = [
    { p: /^(hi+|hello+|hey+|howdy|sup|yo+|hii+|ello)\b/i,
      r: [`Hey! 👋 What can I do for you today?`, `Hello! 😊 How can I help you?`, `Hey there! I'm Silva, your WhatsApp assistant. What do you need? 🤖`] },
    { p: /how (are you|r u|are u|do you do)|what('?s| is) (up|good)|wassup|wyd\b/i,
      r: [`All systems go! ⚡ I'm here and ready to help. What do you need?`, `Running perfectly! 🤖 What can I do for you?`, `Doing great, thanks for asking! 😊 Ready to assist.`] },
    { p: /thank(s| you|u)|thx|ty\b/i,
      r: [`You're welcome! 😊`, `Happy to help! Anything else? 🤖`, `Anytime! That's what I'm here for. 😊`] },
    { p: /good (morning|mornin|afternoon|evening|night)/i,
      r: [`Good morning! ☀️ Hope you have an amazing day!`, `Hey! 😊 Hope your day is going great!`, `Good day! 🌟 What can I help you with?`] },
    { p: /i('?m| am) bored|bored\b/i,
      r: [`Let's fix that! 🎮 Try:\n• \`silva play <your fav song>\`\n• \`.joke\` for a laugh\n• \`.wyr\` for Would You Rather\n• \`.8ball will today be fun?\``] },
    { p: /i (love|like|adore) you|luv u|❤️/i,
      r: [`Aww! 🥰 I love you too (in a bot kind of way)! What can I help with?`, `That's sweet! 😊 Always here for you. What do you need?`] },
    { p: /you('?re| are) (great|amazing|awesome|the best|good|nice|cool|smart|brilliant)/i,
      r: [`Thank you so much! 😊 You're amazing too! What can I do for you?`, `Aww thanks! 🥰 Just doing my job. How can I help?`] },
    { p: /you (suck|('re|are) (bad|terrible|useless|stupid|trash))/i,
      r: [`That hurts 😢 but I'll try to do better! Let me know what went wrong.`, `I'm always improving! 🤖 Tell me what I can do better.`] },
    { p: /what('?s| is) your name|your name\b|who are you\b/i,
      r: [`I'm *Silva* 🤖 — your intelligent WhatsApp assistant! Built on ${BOT_IDENTITY.name} v${BOT_IDENTITY.version}.`] },
    { p: /what can you do|your (capabilities|powers|features|abilities)\b/i,
      r: [`I can: 🎵 play music, 📸 make stickers, ⬇️ download from TikTok/Instagram/YouTube, 🌤️ check weather, 📚 search Wikipedia, 🌐 translate text, 👥 manage groups, and 1400+ commands! Type \`silva help\` to see everything.`] },
    { p: /what time is it|current time|time now\b/i,
      fn: () => `🕐 Current time: *${new Date().toLocaleTimeString('en-US', { timeZone: config.TIMEZONE || 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}*` },
    { p: /what('?s| is) today|what day|current date\b/i,
      fn: () => `📅 Today is *${new Date().toLocaleDateString('en-US', { timeZone: config.TIMEZONE || 'Africa/Nairobi', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}*` },
    { p: /are you (a bot|ai|robot|human|real)\??/i,
      r: [`I'm an AI-powered WhatsApp bot 🤖 — not human, but I try to be as helpful as one! Created by ${BOT_IDENTITY.developer}.`] },
    { p: /(\d+)\s*[\+\-\*\/\%\^]\s*(\d+)/,
      r: null }, // handled by calc
    { p: /ok(ay)?|alright|got it|understood|cool\b/i,
      r: [`👍 Great! Anything else I can help with?`, `Got it! Let me know if you need anything else. 😊`] },
    { p: /bye|goodbye|see you|cya|ttyl|later\b/i,
      r: [`Goodbye! 👋 Come back anytime!`, `See you later! 😊 Take care!`, `Bye! 👋 I'll be here when you need me!`] },
    { p: /help\b/i,
      r: [`Type \`silva\` (no prefix needed) to see everything I can do! Or try:\n• \`silva play <song name>\`\n• \`silva weather <city>\`\n• \`silva wiki <topic>\`\n• \`silva sticker\` (reply to a photo)`] },
];

function getSmartResponse(query) {
    for (const sr of smartResponses) {
        if (!sr.p.test(query)) continue;
        if (sr.fn) return sr.fn();
        if (sr.r) return sr.r[Math.floor(Math.random() * sr.r.length)];
    }
    return null;
}

// ── ch.at with automatic retry ───────────────────────────────────────────────
// ch.at is the PRIMARY backbone. On transient network hiccups we retry up to
// MAX_RETRIES times with exponential backoff before declaring defeat.
const CHAT_ENDPOINT = 'https://ch.at/api/chat';
const MAX_RETRIES   = 3;

async function callChAt(prompt) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await axios.post(
                CHAT_ENDPOINT,
                { message: prompt },
                {
                    headers: { 'Content-Type': 'application/json', 'User-Agent': 'SilvaMD-Bot/2.0' },
                    timeout: 12000,
                }
            );
            const text = res.data?.answer
                || res.data?.reply
                || res.data?.message
                || res.data?.response
                || res.data?.result
                || null;
            if (text && String(text).trim().length > 4) return String(text).trim();
        } catch (e) {
            lastErr = e;
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 500 * attempt)); // 500ms, 1s backoff
            }
        }
    }
    return null; // ch.at exhausted all retries
}

// ── Offline smart responder — NEVER returns null ──────────────────────────────
// When every API is down this gives a contextually relevant reply without any
// network call, so the agent always responds to every message.
function offlineSmartReply(query, pluginKeys) {
    const q = query.toLowerCase();

    // Question about a specific topic → suggest the right command
    const intents = [
        [/\b(weather|forecast|rain|temperature|humid)\b/,       cmd => `🌤️ I can check that! Use \`.weather ${cmd || 'your city'}\` for live weather.`],
        [/\b(play|music|song|audio|mp3)\b/,                     cmd => `🎵 Try \`.play ${cmd || 'song name'}\` to download and play music!`],
        [/\b(translate|translation|language)\b/,                cmd => `🌐 Use \`.translate ${cmd || 'en text here'}\` to translate to any language.`],
        [/\b(sticker|stiker|webp)\b/,                           ()  => `😄 Reply to any image with \`.sticker\` to convert it!`],
        [/\b(download|ytmp3|youtube|tiktok|insta|facebook)\b/,  cmd => `⬇️ Try \`.ytmp3 ${cmd || 'song name'}\` or \`.tiktok <url>\` to download.`],
        [/\b(joke|funny|laugh|humor)\b/,                        ()  => `😂 Type \`.joke\` for a random joke or \`.dadjoke\` for classics!`],
        [/\b(news|headlines|today.?s news)\b/,                  ()  => `📰 Use \`.news\` for the latest headlines!`],
        [/\b(crypto|bitcoin|btc|eth|price)\b/,                  cmd => `💰 Try \`.crypto ${cmd || 'BTC'}\` for live crypto prices!`],
        [/\b(wiki|wikipedia|what is|explain|define|meaning)\b/, cmd => `📚 Type \`.wiki ${cmd || query}\` to look that up on Wikipedia!`],
        [/\b(qr|qr code)\b/,                                    cmd => `🔲 Use \`.qr ${cmd || 'your text'}\` to generate a QR code!`],
        [/\b(remind|reminder|remind me)\b/,                     ()  => `⏰ Use \`.remind 10m your message\` to set a reminder!`],
        [/\b(poll|vote|voting)\b/,                              ()  => `📊 Create a poll with: \`.poll Question | Option1 | Option2\``],
        [/\b(calculate|calc|math|\d[\+\-\*\/]\d)\b/,           ()  => `🧮 Type \`.calc your expression\` for math calculations!`],
        [/\b(help|commands|what can you do)\b/,                 ()  => `📋 Type \`.menu\` to see all ${pluginKeys.size}+ commands I have!`],
    ];

    for (const [pattern, builder] of intents) {
        if (pattern.test(q)) {
            const match = q.match(/\b[a-z]{3,}\b/g)?.filter(w => !['what','that','this','with','have','your','from','about','does','will','when','where'].includes(w));
            return `🤖 *Silva*\n\n` + builder(match?.slice(-2).join(' ') || '');
        }
    }

    // Conversational fallbacks by question type
    if (/\?$|^(what|who|when|where|why|how|is|are|can|will|does)\b/.test(q)) {
        const responses = [
            `🤖 That's a great question! I'm working on fetching an answer. In the meantime, try \`.wiki ${query.slice(0, 40)}\` for instant info!`,
            `🤔 Interesting! My AI brain is having a moment. Try \`.ask ${query.slice(0, 40)}\` again in a few seconds — I'll get it.`,
            `💡 Good question! My connection is a bit slow right now. Type \`.wiki ${query.slice(0, 30)}\` for a quick answer, or retry in a moment!`,
        ];
        return `🤖 *Silva*\n\n` + responses[Math.floor(Math.random() * responses.length)];
    }

    // Generic catch-all — always acknowledges and gives direction
    const catchAll = [
        `Got your message! 👋 My AI is connecting… try again in a moment or type \`.menu\` to see what I can do.`,
        `I'm here! 🤖 Having a brief connection blip. Retry in a few seconds — ch.at will pick it up. Or try \`.ask ${query.slice(0, 30)}\``,
        `Silva here! 💬 My response engine is warming up. One more try should do it — or use \`.menu\` to browse all commands!`,
    ];
    return `🤖 *Silva*\n\n` + catchAll[Math.floor(Math.random() * catchAll.length)];
}

// ── Main AI dispatcher ────────────────────────────────────────────────────────
// ch.at is the backbone. pollinations.ai races in parallel as a warm fallback.
// If both lose, Gemini (if keyed) is tried. If everything fails the offline
// smart responder guarantees a useful reply — this function NEVER returns null.
async function askFreeAI(query, jid, systemPrompt, _pluginKeys) {
    const contextPrompt = jid ? buildContextPrompt(jid, query) : query;
    const fullPrompt    = systemPrompt
        ? systemPrompt + '\n\nUser: ' + contextPrompt
        : contextPrompt;

    // Strings that look like content but are actually API error messages
    const BAD = /^(timed?\s*out|error|sorry[,.]?\s*|undefined|null|false|bad\s*request|unauthorized|forbidden|rate.?limit)/i;

    const validate = (raw) => {
        const s = raw ? String(raw).trim() : '';
        if (s.length > 4 && !BAD.test(s)) return s;
        return null;
    };

    // Race ch.at (with internal retry) against pollinations.ai in parallel.
    // ch.at retries up to 3× so it wins the race even on the first-attempt miss.
    const chatAtPromise      = callChAt(fullPrompt);
    const pollinationsPromise = axios.get(
        'https://text.pollinations.ai/' + encodeURIComponent(fullPrompt.slice(0, 500)) +
        '?model=openai&seed=' + (Date.now() % 9999),
        { timeout: 18000 }
    ).then(r => (typeof r.data === 'string' ? r.data : null)).catch(() => null);

    // popcat is fast — fire as an extra parallel contestant
    const popcatPromise = axios.get(
        'https://api.popcat.xyz/chatbot?msg=' + encodeURIComponent(query.slice(0, 200)) +
        '&owner=' + encodeURIComponent(config.OWNER_NAME || 'Silva') + '&botname=Silva',
        { timeout: 7000 }
    ).then(r => r.data?.response || null).catch(() => null);

    // First valid reply from any source wins
    const result = await Promise.race([
        chatAtPromise,
        pollinationsPromise,
        popcatPromise,
        // Hard ceiling so the caller is never stuck forever
        new Promise(resolve => setTimeout(() => resolve(null), 20000)),
    ].map(p => Promise.resolve(p).then(v => validate(v) ? validate(v) : new Promise(() => {}))));

    if (result) return result;

    // All parallel attempts exhausted — let the caller try Gemini, then offline fallback
    return null;
}

const agentActions = {
    run_command: /^(run|execute|do|use|try|open)\s+(\.?\w+)/i,

    // ── Group management (natural language) ──────────────────────────────────
    group_rename:  /(change|rename|set|update)\s+(the\s+)?(group\s+)?(name|title|subject)\s*(to\s+)?/i,
    group_desc:    /(change|set|update)\s+(the\s+)?(group\s+)?(desc(ription)?|bio|about|info)\s*(to\s+)?/i,
    group_mute:    /\b(mute|silence)\s+(the\s+)?group\b/i,
    group_unmute:  /\b(unmute|unsilence)\s+(the\s+)?group\b|(open|enable)\s+(group\s+)?chat\b/i,
    group_lock:    /\block\s+(the\s+)?(group|chat)\b/i,
    group_unlock:  /\bunlock\s+(the\s+)?(group|chat)\b/i,
    group_link:    /(get|show|send|give)\s+(me\s+)?(the\s+)?group\s+(link|invite|url)/i,
    group_revoke:  /(revoke|reset|change)\s+(the\s+)?group\s+(link|invite)/i,
    group_kick:    /\b(kick|remove|boot)\s+/i,
    group_add:     /\badd\s+(\+?\d|\@)/i,
    group_promote: /\b(promote|make)\s+.*(admin)\b|\bpromo\b/i,
    group_demote:  /\b(demote|remove)\s+.*(admin)\b/i,
    group_warn:    /\bwarn\s+/i,
    group_tag:     /\b(tag|mention|notify)\s+(all|everyone|members|group)\b/i,
    group_admins:  /\b(list|show|who are)\s+(the\s+)?admins?\b/i,
    group_info:    /\b(group\s+info|groupinfo|about\s+this\s+group)\b/i,

    // ── Content creation ─────────────────────────────────────────────────────
    create_group_desc:   /create\s+(a\s+)?(group\s+)?desc(ription)?/i,
    create_bio:          /create\s+(a\s+)?(bio|about|profile\s*(text|desc))/i,
    create_welcome:      /create\s+(a\s+)?welcome\s*(msg|message)?/i,
    create_goodbye:      /create\s+(a\s+)?goodbye\s*(msg|message)?/i,
    create_caption:      /create\s+(a\s+)?caption/i,
    create_announcement: /create\s+(a\s+)?(announcement|broadcast|notice)/i,
    create_rules:        /create\s+(a\s+)?(group\s+)?rules/i,
    create_greeting:     /create\s+(a\s+)?greet(ing)?\s*(msg|message)?/i,
    create_quote:        /create\s+(a\s+)?(custom\s+)?quote/i,
    create_poem:         /create\s+(a\s+)?poem/i,
    create_story:        /create\s+(a\s+)?story/i,
    create_joke:         /create\s+(a\s+)?joke/i,
    create_rap:          /create\s+(a\s+)?rap/i,
    create_song:         /create\s+(a\s+)?song/i,
    write:               /write\s+(a\s+)?(message|text|letter|email|note|essay|paragraph|article|review|speech|toast)/i,

    // ── Productivity ─────────────────────────────────────────────────────────
    remind:    /\b(remind\s+me|set\s+(a\s+)?reminder|reminder\s+to)\b/i,
    note_save: /\b(save\s+(a\s+)?note|note\s+down|take\s+note|save\s+this)\b/i,
    note_get:  /\b(get\s+(my\s+)?notes?|show\s+(my\s+)?notes?|list\s+(my\s+)?notes?|read\s+(my\s+)?notes?)\b/i,
    poll:      /\b(create|make|start)\s+(a\s+)?poll\b/i,
    schedule:  /\b(schedule|send\s+later|delayed\s+send)\b.*\bmessage\b/i,

    // ── Media / AI ───────────────────────────────────────────────────────────
    imagine:   /\b(generate|create|make|draw|paint|design|sketch)\s+(an?\s+)?(ai\s+)?(image|photo|picture|art|artwork|illustration|wallpaper|thumbnail)\b|\bimagine\b/i,
    tts:       /\b(speak|say\s+this|read\s+aloud|convert\s+to\s+speech|voice|tts)\b/i,
    quotly:    /\b(quotly|quote\s*sticker|quote\s*card|quote\s*image|q2s)\b/i,
    describe:  /\b(describe|analyze|caption|identify|what\s+(is|are)?\s*(in|this)?\s*(the\s+)?(image|photo|picture|this))\b/i,
    summarize: /\b(summarize|summary|tldr|tl;dr|brief(ly)?|shorten|too\s+long)\b/i,

    // ── Info ─────────────────────────────────────────────────────────────────
    menu:           /^(show\s+)?(menu|commands|help|list\s+commands)/i,
    about_bot:      /about\s*(the\s*)?(bot|silva|yourself)|who\s*are\s*you|what\s*are\s*you|tell\s*me\s*about\s*(yourself|silva|this\s*bot)/i,
    about_platform: /platform|server|hosting|where\s*(are\s*you|is\s*(the\s*bot|silva))\s*(running|hosted)|system\s*info|server\s*info|specs/i,
    about_owner:    /who\s*(is\s*)?(the\s*)?(owner|creator|developer|made|built|coded)|your\s*(owner|creator|dev)/i,
    features:       /features|what\s*can\s*(you|the\s*bot|silva)\s*do|capabilities|abilities|powers/i,
    settings:       /settings|config|current\s*settings|bot\s*settings|show\s*settings/i,
    plugin_list:    /list\s*plugins|how\s*many\s*(commands|plugins)|plugin\s*count|total\s*commands/i,
    sudo:           /sudo\s*(list|users|info)|who\s*(are|is)\s*(the\s*)?sudo/i,
    help:           /^help$|what\s*can\s*you\s*do|your\s*capabilities/i,

    // ── Quick tools ───────────────────────────────────────────────────────────
    time:     /what\s*(time|hour|clock)|current\s*time|time\s*now/i,
    date:     /what\s*(date|day|today)|current\s*date|today/i,
    calc:     /calc|compute|math|solve|\d+\s*[\+\-\*\/\%\^]\s*\d+/i,

    // ── GitHub SilvaTechB (read-only) ─────────────────────────────────────────
    github_silvatech: /\b(silvatech|silvatechwb|silvatechb|silvarepos)\b|\bsilvatech\s+(repos?|github|projects?|code|files?|zip|download)\b/i,

    // ── GitHub repo file/zip fetch ("send me a clip of SilvaTechB/repo") ──────
    github_repo_zip:  /\b(clip|zip|archive|download|send\s+me)\b.*\b([\w-]+\/[\w-]+)\b|\b([\w-]+\/[\w-]+)\b.*\b(zip|clone|download)\b/i,
    github_repo_file: /\b(get|fetch|read|show|send)\b.+\b(from|in|of)\b.+\b([\w\/-]+\/[\w\/-]+\.[\w]+)\b|\b(readme|package\.json|index\.js|config|\.env)\b.*\b(from|in|of)\b.+\bsilva/i,

    // ── Fun & knowledge ───────────────────────────────────────────────────────
    riddle_agent:  /\b(riddle|puzzle|brain\s*teaser|solve\s*this)\b/i,
    proverb_agent: /\b(proverb|proverbs?|saying|wisdom|wise\s+words?|adage|maxim)\b/i,
    rhyme_agent:   /\b(rhyme|rhymes?\s+with|words?\s+that\s+rhyme|what\s+rhymes)\b/i,
    joke:     /^(tell\s+)?(a\s+)?joke|funny|laugh|humor/i,
    fact:     /^(tell\s+)?(a\s+)?fact|did\s*you\s*know|interesting/i,
    quote:    /^(give\s+)?(a\s+)?quote|motivat|inspir/i,
    flip:     /flip\s*(a\s*)?coin|coin\s*flip|heads\s*or\s*tails/i,
    roll:     /roll\s*(a\s*)?dice|dice\s*roll/i,
    password: /password|pass\s*gen|random\s*pass/i,
    color:    /color|colour|hex|rgb/i,
    uptime:   /uptime|how\s*long.*running/i,
    love:     /love\s*calc|love\s*meter|compatib/i,
    group:    /group\s*(info|details|members|count)/i,

    // ── Web ───────────────────────────────────────────────────────────────────
    search:  /search|google|look\s*up|find\s+(info|about|on)/i,
    news:    /news|headlines|latest\s+news|breaking/i,
    weather: /weather|temperature|forecast|climate/i,
    ip:      /ip\s*(info|address|lookup|check)|my\s*ip|what.*ip/i,

    // ── Settings shortcuts (natural language) ─────────────────────────────────
    toggle_antibad:    /\b(turn\s+on|enable|activate)\s+(anti\s*bad|bad\s*words?|swear\s*filter|profanity)\b/i,
    toggle_antibad_off:/\b(turn\s+off|disable|deactivate)\s+(anti\s*bad|bad\s*words?|swear\s*filter|profanity)\b/i,
    toggle_bluetick:   /\b(turn\s+on|enable)\s+(blue\s*ticks?|read\s*receipts?)\b/i,
    toggle_bluetick_off:/\b(turn\s+off|disable|hide)\s+(blue\s*ticks?|read\s*receipts?)\b/i,
    clear_memory:      /\b(forget|clear|reset)\s+(our\s+)?(chat|conversation|memory|history|context)\b/i,
};

module.exports = {
    commands: ['silva', 'agent', 'do', 'assistant', 'ask'],
    description: 'Silva - AI assistant that runs commands, creates content, searches the web, and knows everything about the bot',
    permission: 'public',
    run: async (sock, message, args, ctx) => {
        const { jid, reply, safeSend, isOwner, isGroup, isAdmin, isBotAdmin } = ctx;
        const query = args.join(' ').trim();
        if (!query) return reply(
            `🤖 *${BOT_IDENTITY.name} Agent v${BOT_IDENTITY.version}*\n\n` +
            `Your intelligent WhatsApp assistant — just talk naturally!\n\n` +
            `🎵 *Music & Media*\n` +
            `• "silva play <song>" • "silva lyrics <song>"\n` +
            `• "silva tiktok <url>" • "silva youtube video <name>"\n` +
            `• "silva speak Hello world" _(text-to-speech)_\n\n` +
            `🎨 *AI & Images*\n` +
            `• "silva generate image of a lion in space"\n` +
            `• "silva describe" _(reply to any photo)_\n` +
            `• "silva summarize" _(reply to a long message)_\n` +
            `• "silva quotly" _(reply to a message → quote sticker)_\n\n` +
            `🧩 *Fun & Knowledge*\n` +
            `• "silva riddle" — get a brain teaser\n` +
            `• "silva proverb" / "silva wisdom" — wise saying\n` +
            `• "silva rhyme moon" — words that rhyme\n\n` +
            `🐙 *GitHub*\n` +
            `• "silva silvatech repos" — list SilvaTechB repos\n` +
            `• ".silvatech <repo>" — repo stats & files\n` +
            `• ".silvatech zip <repo>" — download link\n\n` +
            `📲 *Downloads*\n` +
            `• "silva instagram <url>" • "silva facebook <url>"\n` +
            `• "silva spotify <name>" • "silva pinterest <query>"\n\n` +
            `⏰ *Productivity*\n` +
            `• "silva remind me in 30m to call mom"\n` +
            `• "silva save note shopping: milk, eggs"\n` +
            `• "silva get my notes"\n` +
            `• "silva create a poll: Question | A | B | C"\n` +
            `• "silva schedule message at 9pm: team meeting"\n\n` +
            `🛠️ *Tools*\n` +
            `• "silva sticker" _(reply to photo)_\n` +
            `• "silva translate hello to french"\n` +
            `• "silva wiki artificial intelligence"\n` +
            `• "silva weather Nairobi"\n` +
            `• "silva qr code https://example.com"\n\n` +
            `👥 *Group Management*\n` +
            `• "silva change group name to X"\n` +
            `• "silva mute/unmute group"\n` +
            `• "silva tag all members"\n` +
            `• "silva kick @user" • "silva promote @user"\n` +
            `• "silva create a poll: Vote | Yes | No"\n\n` +
            `✍️ *Content Creation*\n` +
            `• "silva create a bio / welcome / rules / poem"\n` +
            `• "silva write an email about X"\n\n` +
            `🌐 *Info & Web*\n` +
            `• "silva weather / news / search / ip info"\n` +
            `• "silva about bot / platform / owner / settings"\n\n` +
            `🧠 *AI Chat* — Ask me anything! I remember our conversation.\n` +
            `• "silva forget" — clears chat memory\n\n` +
            `📋 *Run Any Command:* "silva run <command>"\n\n` +
            `_${pluginMap().size}+ commands available • Platform: ${BOT_IDENTITY.platform}_`
        );

        let response = '';

        const runMatch = query.match(agentActions.run_command);
        if (runMatch) {
            const cmdName = runMatch[2].replace(/^\./, '').toLowerCase();
            const restArgs = query.replace(runMatch[0], '').trim().split(/\s+/).filter(Boolean);
            const pm = pluginMap();
            const plugin = pm.get(cmdName);

            if (!plugin) {
                const suggestions = [...pm.keys()].filter(c => c.includes(cmdName) || cmdName.includes(c)).slice(0, 5);
                const hint = suggestions.length ? `\n\nDid you mean: ${suggestions.map(s => `\`${s}\``).join(', ')}` : '';
                return reply(`❌ Command \`${cmdName}\` not found. I have ${pm.size} commands available.${hint}`);
            }

            if (plugin.permission === 'owner' && !isOwner) {
                return reply(`⛔ The \`${cmdName}\` command requires owner permission.`);
            }
            if (plugin.permission === 'admin' && !isAdmin && !isOwner) {
                return reply(`⛔ The \`${cmdName}\` command requires admin permission.`);
            }

            try {
                await plugin.run(sock, message, restArgs, ctx);
                return;
            } catch (err) {
                return reply(`❌ Error running \`${cmdName}\`: ${err.message}`);
            }
        }

        if (agentActions.about_bot.test(query)) {
            const pm = pluginMap();
            const plat = getPlatformInfo();
            response =
                `🤖 *About ${BOT_IDENTITY.name}*\n\n` +
                `I'm a feature-rich multi-device WhatsApp bot built by *${BOT_IDENTITY.developer}*.\n\n` +
                `📊 *Stats*\n` +
                `• Version: *v${BOT_IDENTITY.version}*\n` +
                `• Commands: *${pm.size}+*\n` +
                `• Plugins: *${new Set([...pm.values()]).size}* files\n` +
                `• Uptime: *${plat.uptime}*\n\n` +
                `⚙️ *Tech Stack*\n` +
                `• Runtime: *${BOT_IDENTITY.language} ${plat.nodeVersion}*\n` +
                `• Library: *${BOT_IDENTITY.library}*\n` +
                `• Platform: *${BOT_IDENTITY.platform}*\n` +
                `• License: *Apache-2.0*\n\n` +
                `🌐 *Links*\n` +
                `• Repo: ${BOT_IDENTITY.repo}\n` +
                `• Website: ${BOT_IDENTITY.website}\n\n` +
                `👑 *Owner:* ${config.OWNER_NAME}\n` +
                `📞 *Number:* +${(config.OWNER_NUMBER || '').replace(/\D/g, '')}`;
        }

        else if (agentActions.about_platform.test(query)) {
            const plat = getPlatformInfo();
            const activeFeatures = getActiveFeatures();
            response =
                `🖥️ *Platform & System Info*\n\n` +
                `☁️ *Hosting*\n` +
                `• Platform: *${plat.platform}*\n` +
                `• OS: *${plat.os}*\n` +
                `• Architecture: *${plat.arch}*\n` +
                `• Hostname: *${plat.hostname}*\n\n` +
                `⚡ *Performance*\n` +
                `• Node.js: *${plat.nodeVersion}*\n` +
                `• Memory: *${plat.memory}*\n` +
                `• CPUs: *${plat.cpus}*\n` +
                `• PID: *${plat.pid}*\n` +
                `• Uptime: *${plat.uptime}*\n\n` +
                `✅ *Active Features (${activeFeatures.length})*\n` +
                activeFeatures.map(f => `• ${f}`).join('\n');
        }

        else if (agentActions.about_owner.test(query)) {
            const sudoCount = global.sudoUsers?.size || 0;
            response =
                `👑 *Bot Owner*\n\n` +
                `• Name: *${config.OWNER_NAME || 'Silva MD'}*\n` +
                `• Number: *+${(config.OWNER_NUMBER || '').replace(/\D/g, '')}*\n` +
                `• Bot: *${config.BOT_NAME || 'Silva MD'}*\n` +
                `• Developer: *${BOT_IDENTITY.developer}*\n` +
                `• Website: ${BOT_IDENTITY.website}\n` +
                `• GitHub: ${BOT_IDENTITY.repo}\n` +
                `• Sudo Users: *${sudoCount}*\n\n` +
                `_${BOT_IDENTITY.name} was created by ${BOT_IDENTITY.developer} and is maintained with love._`;
        }

        else if (agentActions.features.test(query)) {
            const active = getActiveFeatures();
            response =
                `⚡ *${BOT_IDENTITY.name} Features*\n\n` +
                `*All 19 Features:*\n` +
                BOT_IDENTITY.features.map((f, i) => `${i + 1}. ${f} ${active.includes(f) ? '✅' : '⬚'}`).join('\n') +
                `\n\n✅ = Active  ⬚ = Inactive\n\n` +
                `_Use \`.setsetting\` to toggle features on/off._`;
        }

        else if (agentActions.settings.test(query)) {
            response =
                `⚙️ *Current Bot Settings*\n\n` +
                `• Bot Name: *${config.BOT_NAME}*\n` +
                `• Prefix: *${config.PREFIX}*\n` +
                `• Mode: *${config.MODE}*\n` +
                `• Theme: *${config.THEME}*\n\n` +
                `📡 *Auto Features*\n` +
                `• Auto Status View: ${config.AUTO_STATUS_SEEN ? '✅' : '❌'}\n` +
                `• Auto Status React: ${config.AUTO_STATUS_REACT ? '✅' : '❌'}\n` +
                `• Auto Status Reply: ${config.AUTO_STATUS_REPLY ? '✅' : '❌'}\n` +
                `• Auto Typing: ${config.AUTO_TYPING ? '✅' : '❌'}\n` +
                `• Auto Recording: ${config.AUTO_RECORDING ? '✅' : '❌'}\n` +
                `• Always Online: ${config.ALWAYS_ONLINE ? '✅' : '❌'}\n` +
                `• Auto Read: ${config.READ_MESSAGE ? '✅' : '❌'}\n\n` +
                `🛡️ *Protection*\n` +
                `• Anti-Delete (Groups): ${config.ANTIDELETE_GROUP ? '✅' : '❌'}\n` +
                `• Anti-Delete (Private): ${config.ANTIDELETE_PRIVATE ? '✅' : '❌'}\n` +
                `• Anti-Link: ${config.ANTILINK ? '✅' : '❌'}\n` +
                `• Anti-Bad Words: ${config.ANTI_BAD ? '✅' : '❌'}\n` +
                `• View-Once Recovery: ${config.ANTIVV ? '✅' : '❌'}`;
        }

        else if (agentActions.sudo.test(query)) {
            const sudoList = global.sudoUsers?.size ? [...global.sudoUsers].map((j, i) => `${i + 1}. +${j.split('@')[0]}`).join('\n') : 'No sudo users set.';
            response = `👤 *Sudo Users*\n\n${sudoList}\n\n_Sudo users have owner-level access to all commands._`;
        }

        else if (agentActions.create_bio.test(query)) {
            const topic = query.replace(agentActions.create_bio, '').trim();
            const bios = [
                `✨ ${config.BOT_NAME} | Always Online | Powered by ${BOT_IDENTITY.developer} ⚡`,
                `🤖 ${config.BOT_NAME} v${BOT_IDENTITY.version} | ${pluginMap().size}+ Commands | ${BOT_IDENTITY.website}`,
                `👑 Owned by ${config.OWNER_NAME} | Bot: ${config.BOT_NAME} | 24/7 Active`,
                `🔥 ${config.BOT_NAME} | Multi-Device WhatsApp Bot | ${BOT_IDENTITY.features.length} Smart Features`,
                `⚡ Powered by ${BOT_IDENTITY.developer} | ${config.BOT_NAME} | The Ultimate WA Bot`,
                `🌟 ${config.BOT_NAME} | AI-Powered | Anti-Ban Safe | ${config.OWNER_NAME}`,
            ];
            response = `✍️ *Bio Ideas${topic ? ` (${topic})` : ''}*\n\n${bios.map((b, i) => `*${i + 1}.* ${b}`).join('\n\n')}\n\n_Copy any bio above! Use \`.setbio <text>\` to set it._`;
        }

        else if (agentActions.create_welcome.test(query)) {
            const groupName = ctx.groupMetadata?.subject || 'Our Group';
            response =
                `✍️ *Welcome Message Ideas*\n\n` +
                `*1.* 👋 Welcome to *${groupName}*! We're glad to have you here.\n` +
                `Please read the group description and follow the rules.\n` +
                `Enjoy your stay! 🎉\n\n` +
                `*2.* 🌟 Hey there! Welcome to *${groupName}*!\n` +
                `Feel free to introduce yourself and join the conversation.\n` +
                `Bot: ${config.BOT_NAME} | Prefix: ${config.PREFIX}\n\n` +
                `*3.* 🎊 *New Member Alert!*\n` +
                `Welcome aboard, @user! 🙌\n` +
                `📌 Read the rules\n` +
                `💬 Introduce yourself\n` +
                `🤖 Use ${config.PREFIX}menu for bot commands\n\n` +
                `_Use \`.setwelcome <message>\` to set your welcome message._`;
        }

        else if (agentActions.create_goodbye.test(query)) {
            response =
                `✍️ *Goodbye Message Ideas*\n\n` +
                `*1.* 👋 Goodbye @user! We'll miss you. Take care! 💙\n\n` +
                `*2.* 😢 @user has left the group. Wishing you all the best!\n\n` +
                `*3.* 🚪 @user just left. Hope to see you again soon! ✌️\n\n` +
                `_Use \`.setgoodbye <message>\` to set it._`;
        }

        else if (agentActions.create_announcement.test(query)) {
            const topic = query.replace(agentActions.create_announcement, '').trim();
            response =
                `✍️ *Announcement Templates*\n\n` +
                `*1.* 📢 *ANNOUNCEMENT*\n\n` +
                `${topic || 'Your announcement content here...'}\n\n` +
                `— *${config.OWNER_NAME}*\n` +
                `_${config.BOT_NAME}_\n\n` +
                `*2.* 🔔 *IMPORTANT NOTICE*\n\n` +
                `Attention all members!\n\n` +
                `${topic || 'Details of the announcement...'}\n\n` +
                `Please take note. Thank you! 🙏\n\n` +
                `*3.* ⚡ *UPDATE*\n\n` +
                `${topic || 'What\'s new...'}\n\n` +
                `For questions, contact: @${(config.OWNER_NUMBER || '').replace(/\D/g, '')}\n\n` +
                `_Use \`.broadcast <message>\` to send to all groups._`;
        }

        else if (agentActions.create_rules.test(query)) {
            const groupName = ctx.groupMetadata?.subject || 'this group';
            response =
                `✍️ *Group Rules Template*\n\n` +
                `📜 *Rules for ${groupName}*\n\n` +
                `1️⃣ Be respectful to all members\n` +
                `2️⃣ No spamming or flooding\n` +
                `3️⃣ No NSFW or inappropriate content\n` +
                `4️⃣ No unauthorized links or promotions\n` +
                `5️⃣ English only (or specify language)\n` +
                `6️⃣ No personal attacks or bullying\n` +
                `7️⃣ Follow admin instructions\n` +
                `8️⃣ No voice notes abuse\n` +
                `9️⃣ Stay on topic\n` +
                `🔟 Have fun and be kind! 😊\n\n` +
                `_Violations may result in a warning or removal._\n` +
                `_Bot: ${config.BOT_NAME} | Prefix: ${config.PREFIX}_\n\n` +
                `_Use \`.setdesc <text>\` to set as group description._`;
        }

        else if (agentActions.create_greeting.test(query)) {
            response =
                `✍️ *Greeting Message Ideas*\n\n` +
                `*1.* 👋 Hey there! I'm *${config.BOT_NAME}*, your WhatsApp assistant.\n` +
                `Type *${config.PREFIX}menu* to see what I can do! 🤖\n\n` +
                `*2.* 🌟 Welcome! I'm *${config.BOT_NAME}* by *${config.OWNER_NAME}*.\n` +
                `I have ${pluginMap().size}+ commands. Start with *${config.PREFIX}help*\n\n` +
                `*3.* Hey! 👋 Thanks for messaging.\n` +
                `I'm an AI-powered bot with tons of features.\n` +
                `Try: *${config.PREFIX}agent help* for my capabilities.\n\n` +
                `_Set with \`.setgreet <message>\` or via GREETING env var._`;
        }

        else if (agentActions.create_group_desc.test(query)) {
            const topic = query.replace(agentActions.create_group_desc, '').trim();
            response =
                `✍️ *Group Description Ideas*\n\n` +
                `*1.* 🌟 *${topic || 'Group Name'}*\n\n` +
                `Welcome to our community! 🎉\n` +
                `📋 Read the rules before posting\n` +
                `🤖 Bot: ${config.BOT_NAME} (${config.PREFIX}menu)\n` +
                `👑 Owner: ${config.OWNER_NAME}\n\n` +
                `*2.* ⚡ *${topic || 'Group Name'}*\n\n` +
                `A group for ${topic || 'our community'}.\n` +
                `🔗 ${BOT_IDENTITY.website}\n` +
                `📱 Powered by ${config.BOT_NAME}\n\n` +
                `_Use \`.setdesc <text>\` to apply._`;
        }

        else if (agentActions.create_caption.test(query)) {
            const topic = query.replace(agentActions.create_caption, '').trim();
            response =
                `✍️ *Caption Ideas*\n\n` +
                `*1.* ${topic ? `✨ ${topic} ✨` : '✨ Living my best life ✨'}\n_— ${config.OWNER_NAME}_\n\n` +
                `*2.* 🔥 ${topic || 'Powered by ambition, driven by purpose'} 💯\n\n` +
                `*3.* 🌍 ${topic || 'Making moves in silence'} 🤫\n_${config.BOT_NAME} © ${new Date().getFullYear()}_\n\n` +
                `*4.* ⚡ ${topic || 'Success is the only option'} 👑\n\n` +
                `_Use \`.setcaption <text>\` to set bot caption._`;
        }

        else if (agentActions.create_quote.test(query)) {
            const topic = query.replace(agentActions.create_quote, '').trim();
            const quotes = [
                { text: `The best bot is the one that makes life easier.`, author: BOT_IDENTITY.developer },
                { text: `${topic || 'Technology'} is not just a tool, it's a mindset.`, author: config.OWNER_NAME },
                { text: `In a world of followers, be a ${topic || 'creator'}.`, author: `${config.BOT_NAME} Wisdom` },
                { text: `Every expert was once a beginner. Keep ${topic || 'coding'}.`, author: BOT_IDENTITY.developer },
                { text: `Dream big. ${topic || 'Code'} bigger.`, author: config.OWNER_NAME },
            ];
            response = `✍️ *Custom Quotes${topic ? ` about ${topic}` : ''}*\n\n` +
                quotes.map((q, i) => `*${i + 1}.* _"${q.text}"_\n   — *${q.author}*`).join('\n\n');
        }

        else if (agentActions.create_poem.test(query)) {
            const topic = query.replace(agentActions.create_poem, '').trim() || 'technology';
            response =
                `✍️ *Poem: ${topic}*\n\n` +
                `_In the world of ${topic},_\n` +
                `_Where dreams and code align,_\n` +
                `_We build with passion daily,_\n` +
                `_One commit at a time._\n\n` +
                `_Through errors and through trials,_\n` +
                `_We learn, we grow, we shine,_\n` +
                `_For ${topic} is the future,_\n` +
                `_And the future's yours and mine._\n\n` +
                `— *${config.BOT_NAME} Poetry* ✨`;
        }

        else if (agentActions.create_story.test(query)) {
            const topic = query.replace(agentActions.create_story, '').trim() || 'a developer';
            response =
                `✍️ *Short Story: The Tale of ${topic}*\n\n` +
                `Once upon a time, there was ${topic} who dreamed of building something amazing. ` +
                `Day after day, they worked tirelessly, learning from failures and celebrating small wins.\n\n` +
                `One day, their creation — *${config.BOT_NAME}* — came to life. It could talk, help people, ` +
                `and bring joy to thousands of WhatsApp users around the world.\n\n` +
                `"This is just the beginning," they whispered, typing one more line of code.\n\n` +
                `*The End.* ✨\n\n— _${config.BOT_NAME} Stories_`;
        }

        else if (agentActions.create_joke.test(query)) {
            const topic = query.replace(agentActions.create_joke, '').trim();
            response =
                `✍️ *Custom Jokes${topic ? ` about ${topic}` : ''}*\n\n` +
                `*1.* Why did ${topic || 'the bot'} go to school?\nBecause it wanted more *class*! 😂\n\n` +
                `*2.* What's ${topic || 'a programmer'}'s favorite hangout?\nFoo Bar! 🍻😂\n\n` +
                `*3.* Why was ${topic || 'the WhatsApp bot'} so good at its job?\nBecause it never left anyone on *read*! 😂\n\n` +
                `_Want more? Try: .joke or .agent tell a joke_`;
        }

        else if (agentActions.create_rap.test(query)) {
            const topic = query.replace(agentActions.create_rap, '').trim() || 'the bot life';
            response =
                `✍️ *Rap: ${topic}*\n\n` +
                `🎤 _Yeah, yeah, uh..._\n\n` +
                `_They call me ${config.BOT_NAME}, running all day,_\n` +
                `_${pluginMap().size} commands, I don't play,_\n` +
                `_${topic}, that's what I'm about,_\n` +
                `_Online 24/7, never down and out._\n\n` +
                `_Built by ${BOT_IDENTITY.developer}, coded with care,_\n` +
                `_Multi-device bot, beyond compare,_\n` +
                `_Anti-ban safe, I'm always clean,_\n` +
                `_The smartest WhatsApp bot you've ever seen._ 🔥\n\n` +
                `— *${config.BOT_NAME} Bars* 🎵`;
        }

        else if (agentActions.create_song.test(query)) {
            const topic = query.replace(agentActions.create_song, '').trim() || 'connection';
            response =
                `✍️ *Song: ${topic}*\n\n` +
                `🎵 *Verse 1*\n` +
                `_In a world of messages and calls,_\n` +
                `_${config.BOT_NAME} stands tall through it all,_\n` +
                `_${topic}, it's what we share,_\n` +
                `_Through every chat, we show we care._\n\n` +
                `🎵 *Chorus*\n` +
                `_Oh, ${topic}, ${topic},_\n` +
                `_Bringing us together every day,_\n` +
                `_With ${config.BOT_NAME} by our side,_\n` +
                `_Everything will be okay._ 🎶\n\n` +
                `— *${config.BOT_NAME} Music* 🎵`;
        }

        else if (agentActions.write.test(query)) {
            const writeMatch = query.match(agentActions.write);
            const contentType = writeMatch ? writeMatch[2] : 'message';
            const topic = query.replace(agentActions.write, '').trim();
            const aiPrompt = `Write a ${contentType}${topic ? ` about: ${topic}` : ''}. Keep it concise, well-formatted, and professional. Do not use markdown headers or asterisks for bold. Sign off as "${config.OWNER_NAME}" if appropriate.`;

            try {
                const aiResult = await askFreeAI(aiPrompt, null);
                if (aiResult) {
                    response = `✍️ *${contentType.charAt(0).toUpperCase() + contentType.slice(1)}*\n\n${aiResult}`;
                } else {
                    response =
                        `✍️ *${contentType.charAt(0).toUpperCase() + contentType.slice(1)}${topic ? `: ${topic}` : ''}*\n\n` +
                        `Dear recipient,\n\n` +
                        `${topic || 'I am writing to share something important with you'}.\n\n` +
                        `Thank you for your time and attention.\n\n` +
                        `Best regards,\n` +
                        `*${config.OWNER_NAME}*\n` +
                        `_${config.BOT_NAME}_`;
                }
            } catch {
                response = `❌ Could not generate the ${contentType}. Try again later.`;
            }
        }

        else if (agentActions.menu.test(query)) {
            const pm = pluginMap();
            const menuPlugin = pm.get('menu');
            if (menuPlugin) {
                try { await menuPlugin.run(sock, message, [], ctx); return; } catch {}
            }
            response = `📋 I have ${pm.size} commands. Type .menu to see them all.`;
        }

        else if (agentActions.plugin_list.test(query)) {
            const pm = pluginMap();
            response = `📋 *Plugin Stats*\n\n• Total commands: *${pm.size}*\n• Plugin files: *${new Set([...pm.values()]).size}*\n• Platform: *${BOT_IDENTITY.platform}*\n\nType \`.menu\` for the full categorized list.`;
        }

        else if (agentActions.time.test(query)) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
            response = `🕐 *Current Time*\n\n${timeStr} (EAT - Africa/Nairobi)`;
        } else if (agentActions.date.test(query)) {
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-US', { timeZone: 'Africa/Nairobi', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            response = `📅 *Today's Date*\n\n${dateStr}`;
        } else if (agentActions.calc.test(query)) {
            try {
                const expr = query.replace(/[^0-9\+\-\*\/\.\(\)\s\%\^]/g, '').replace(/\^/g, '**');
                if (!expr.trim()) throw new Error('no expression');
                const result = Function('"use strict"; return (' + expr + ')')();
                response = `🔢 *Calculator*\n\n${expr.trim()} = *${result}*`;
            } catch {
                response = '❌ Could not calculate that. Try: .agent calc 25 * 4';
            }
        } else if (agentActions.joke.test(query)) {
            try {
                const res = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 5000 });
                response = `😂 *Joke Time*\n\n${res.data.setup}\n\n${res.data.punchline}`;
            } catch {
                const jokes = [
                    "Why don't scientists trust atoms? Because they make up everything! 😂",
                    "What do you call a fake noodle? An impasta! 🍝😂",
                    "Why did the scarecrow win an award? He was outstanding in his field! 🌾😂",
                    "Why did the coffee file a police report? It got mugged! ☕😂",
                ];
                response = `😂 *Joke Time*\n\n${jokes[Math.floor(Math.random() * jokes.length)]}`;
            }
        } else if (agentActions.fact.test(query)) {
            try {
                const res = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en', { timeout: 5000 });
                response = `🧠 *Fun Fact*\n\n${res.data.text}`;
            } catch {
                const facts = [
                    "Honey never spoils. Archaeologists found 3000-year-old honey that was still edible! 🍯",
                    "Octopuses have three hearts and blue blood. 🐙",
                    "A group of flamingos is called a 'flamboyance'. 🦩",
                    "Bananas are berries, but strawberries aren't. 🍌",
                ];
                response = `🧠 *Fun Fact*\n\n${facts[Math.floor(Math.random() * facts.length)]}`;
            }
        } else if (agentActions.quote.test(query)) {
            try {
                const res = await axios.get('https://api.quotable.io/random', { timeout: 5000 });
                response = `💫 *Quote*\n\n_"${res.data.content}"_\n\n— *${res.data.author}*`;
            } catch {
                const quotes = [
                    { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
                    { text: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
                    { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde" },
                ];
                const q = quotes[Math.floor(Math.random() * quotes.length)];
                response = `💫 *Quote*\n\n_"${q.text}"_\n\n— *${q.author}*`;
            }
        } else if (agentActions.flip.test(query)) {
            response = `🪙 *Coin Flip*\n\nResult: *${Math.random() < 0.5 ? 'Heads 🪙' : 'Tails 🪙'}*`;
        } else if (agentActions.roll.test(query)) {
            const sides = parseInt(query.match(/\d+/)?.[0]) || 6;
            response = `🎲 *Dice Roll* (${sides}-sided)\n\nResult: *${Math.floor(Math.random() * sides) + 1}*`;
        } else if (agentActions.password.test(query)) {
            const len = Math.min(parseInt(query.match(/\d+/)?.[0]) || 16, 64);
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*';
            let pass = '';
            for (let i = 0; i < len; i++) pass += chars[Math.floor(Math.random() * chars.length)];
            response = `🔐 *Password Generator*\n\nLength: ${len}\nPassword: \`${pass}\`\n\n_Copy and store safely!_`;
        } else if (agentActions.color.test(query)) {
            const r = Math.floor(Math.random() * 256);
            const g = Math.floor(Math.random() * 256);
            const b = Math.floor(Math.random() * 256);
            const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            response = `🎨 *Random Color*\n\nHEX: *${hex}*\nRGB: *rgb(${r}, ${g}, ${b})*`;
        } else if (agentActions.uptime.test(query)) {
            const plat = getPlatformInfo();
            response = `⏱️ *Bot Uptime*\n\nUptime: *${plat.uptime}*\nBot: ${config.BOT_NAME}\nMode: ${config.MODE}\nPlatform: ${BOT_IDENTITY.platform}\nMemory: ${plat.memory}`;
        } else if (agentActions.love.test(query)) {
            const percentage = Math.floor(Math.random() * 101);
            let emoji = percentage > 80 ? '💕' : percentage > 50 ? '💛' : percentage > 30 ? '💙' : '💔';
            response = `${emoji} *Love Calculator*\n\nCompatibility: *${percentage}%*\n\n${percentage > 80 ? 'Perfect match! 🥰' : percentage > 50 ? 'Good potential! 😊' : percentage > 30 ? 'Could work with effort! 🤔' : 'Maybe just friends... 😅'}`;
        } else if (agentActions.group.test(query) && isGroup && ctx.groupMetadata) {
            const gm = ctx.groupMetadata;
            response = `👥 *Group Info*\n\nName: ${gm.subject}\nMembers: ${gm.participants?.length || 'N/A'}\nCreated: ${gm.creation ? new Date(gm.creation * 1000).toLocaleDateString() : 'N/A'}\nDescription: ${gm.desc || 'None'}`;
        } else if (agentActions.search.test(query)) {
            const searchQuery = query.replace(/^(search|google|look\s*up|find\s+(info|about|on))\s*/i, '').trim();
            if (!searchQuery) return reply('❌ What should I search? Try: .agent search Node.js');
            try {
                const res = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json&no_html=1`, { timeout: 8000 });
                const data = res.data;
                if (data.Abstract) {
                    response = `🔍 *Search: ${searchQuery}*\n\n${data.Abstract}\n\n_Source: ${data.AbstractSource || 'DuckDuckGo'}_`;
                } else if (data.RelatedTopics?.length) {
                    const top3 = data.RelatedTopics.slice(0, 3).filter(t => t.Text).map((t, i) => `${i + 1}. ${t.Text}`).join('\n\n');
                    response = `🔍 *Search: ${searchQuery}*\n\n${top3 || 'No detailed results.'}\n\n_Source: DuckDuckGo_`;
                } else {
                    response = `🔍 *Search: ${searchQuery}*\n\nNo instant results. Try rephrasing your query.`;
                }
            } catch {
                response = `🔍 Search temporarily unavailable. Try again later.`;
            }
        } else if (agentActions.news.test(query)) {
            try {
                const res = await axios.get('https://saurav.tech/NewsAPI/top-headlines/category/technology/us.json', { timeout: 8000 });
                const articles = res.data?.articles?.slice(0, 5) || [];
                if (articles.length) {
                    const newsText = articles.map((a, i) => `*${i + 1}.* ${a.title}\n   _${a.source?.name || 'Unknown'}_`).join('\n\n');
                    response = `📰 *Latest Tech News*\n\n${newsText}`;
                } else {
                    response = '📰 No news available right now.';
                }
            } catch {
                response = '📰 News service temporarily unavailable.';
            }
        } else if (agentActions.weather.test(query)) {
            const city = query.replace(/weather|temperature|forecast|climate|in|at|for/gi, '').trim() || 'Nairobi';
            try {
                const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { timeout: 8000 });
                const cur = res.data?.current_condition?.[0];
                if (cur) {
                    response = `🌤️ *Weather in ${city}*\n\n🌡️ Temp: *${cur.temp_C}°C* (${cur.temp_F}°F)\n💧 Humidity: ${cur.humidity}%\n🌬️ Wind: ${cur.windspeedKmph} km/h\n☁️ Condition: ${cur.weatherDesc?.[0]?.value || 'N/A'}\n👁️ Visibility: ${cur.visibility} km`;
                } else {
                    response = `❌ Could not find weather for "${city}".`;
                }
            } catch {
                response = `❌ Weather service unavailable.`;
            }
        } else if (agentActions.ip.test(query)) {
            try {
                const res = await axios.get('https://ipapi.co/json/', { timeout: 5000 });
                const d = res.data;
                response = `🌐 *IP Info*\n\nIP: *${d.ip}*\nCity: ${d.city}\nRegion: ${d.region}\nCountry: ${d.country_name}\nISP: ${d.org}\nTimezone: ${d.timezone}`;
            } catch {
                response = '❌ Could not fetch IP information.';
            }
        } else if (agentActions.help.test(query)) {
            const pm = pluginMap();
            response =
                `🤖 *Silva — Full Capabilities*\n\n` +
                `📋 *Run Commands* (${pm.size} available)\n` +
                `• "run menu" • "do alive" • "use sticker"\n` +
                `• "run <any command name>"\n\n` +
                `✍️ *Create Content*\n` +
                `• Bio • Welcome/Goodbye messages\n` +
                `• Announcements • Group rules\n` +
                `• Poems • Stories • Songs • Raps\n` +
                `• Jokes • Quotes • Captions\n` +
                `• Letters • Emails • Essays\n\n` +
                `👥 *Group Management*\n` +
                `• "silva change group name to X"\n` +
                `• "silva set group description to X"\n` +
                `• "silva mute/unmute group"\n` +
                `• "silva lock/unlock group"\n` +
                `• "silva get group link"\n` +
                `• "silva tag all members"\n` +
                `• "silva list admins"\n` +
                `• "silva kick/add/promote/demote"\n\n` +
                `🌐 *Web Access*\n` +
                `• Search • News • Weather • IP lookup\n\n` +
                `ℹ️ *Bot Knowledge*\n` +
                `• About bot • Platform info • Owner\n` +
                `• Features • Settings • Sudo users\n\n` +
                `🛠️ *Tools*\n` +
                `• Calculator • Password • Color gen\n` +
                `• Coin flip • Dice • Love calc\n\n` +
                `🧠 *AI Chat*\n` +
                `• Ask anything — powered by AI\n\n` +
                `_Platform: ${BOT_IDENTITY.platform} | ${BOT_IDENTITY.language} ${process.version}_`;

        // ── Group management handlers (direct Baileys API calls) ─────────────
        // These call the WhatsApp API directly so they always work regardless
        // of how the message was triggered (no rawCmd detection issues).
        } else if (agentActions.group_rename.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ You need admin permission to rename the group.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to rename the group. Please promote me first.`);
            const newName = query.replace(agentActions.group_rename, '').trim();
            if (!newName) return reply(`❓ What should I rename the group to?\n\nExample: _silva change group name to Study Squad_`);
            if (newName.length > 100) return reply(`❌ Group name cannot exceed 100 characters.`);
            try {
                await sock.groupUpdateSubject(jid, newName);
                reply(`✅ Group name changed to *"${newName}"*!`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_desc.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ You need admin permission to update the description.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to update the description. Please promote me first.`);
            const newDesc = query.replace(agentActions.group_desc, '').trim();
            if (!newDesc) return reply(`❓ What should the group description say?\n\nExample: _silva set group description to Welcome to our group!_`);
            if (newDesc.length > 512) return reply(`❌ Description cannot exceed 512 characters.`);
            try {
                await sock.groupUpdateDescription(jid, newDesc);
                reply(`✅ Group description updated!`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_mute.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to mute the group.`);
            try {
                await sock.groupSettingUpdate(jid, 'announcement');
                reply(`🔇 Group *muted* — only admins can send messages.`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_unmute.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to unmute the group.`);
            try {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                reply(`🔊 Group *unmuted* — all members can now send messages.`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_lock.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to lock the group.`);
            try {
                await sock.groupSettingUpdate(jid, 'locked');
                reply(`🔒 Group *locked* — only admins can edit group info.`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_unlock.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to unlock the group.`);
            try {
                await sock.groupSettingUpdate(jid, 'unlocked');
                reply(`🔓 Group *unlocked* — all members can edit group info.`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_link.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required.`);
            try {
                const code = await sock.groupInviteCode(jid);
                reply(`🔗 *Group Invite Link*\n\nhttps://chat.whatsapp.com/${code}`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_revoke.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to reset the group link.`);
            try {
                await sock.groupRevokeInvite(jid);
                reply(`🔄 Group invite link *reset*. The old link no longer works.`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_kick.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required to kick members.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to kick members.`);
            // Get mentioned/quoted user
            const mentioned = ctx.mentionedJid?.[0] || message.message?.extendedTextMessage?.contextInfo?.participant;
            if (!mentioned) return reply(`💡 Reply to a member's message and say: _silva kick_\n\nOr tag them: _silva kick @member_`);
            try {
                await sock.groupParticipantsUpdate(jid, [mentioned], 'remove');
                reply(`✅ @${mentioned.split('@')[0]} has been kicked from the group.`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_add.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to add members.`);
            const numMatch = query.match(/(\+?[\d]{7,15})/);
            if (!numMatch) return reply(`💡 Provide a phone number.\n\nExample: _silva add +254712345678_`);
            const phone = numMatch[1].replace(/\D/g, '');
            try {
                await sock.groupParticipantsUpdate(jid, [`${phone}@s.whatsapp.net`], 'add');
                reply(`✅ +${phone} has been added to the group!`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_promote.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to promote members.`);
            const mentioned = ctx.mentionedJid?.[0] || message.message?.extendedTextMessage?.contextInfo?.participant;
            if (!mentioned) return reply(`💡 Reply to a member's message and say: _silva promote_\n\nOr tag them: _silva promote @member_`);
            try {
                await sock.groupParticipantsUpdate(jid, [mentioned], 'promote');
                reply(`⭐ @${mentioned.split('@')[0]} has been promoted to admin!`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_demote.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required.`);
            if (!isBotAdmin) return reply(`⛔ I need to be an admin to demote members.`);
            const mentioned = ctx.mentionedJid?.[0] || message.message?.extendedTextMessage?.contextInfo?.participant;
            if (!mentioned) return reply(`💡 Reply to a member's message and say: _silva demote_\n\nOr tag them: _silva demote @member_`);
            try {
                await sock.groupParticipantsUpdate(jid, [mentioned], 'demote');
                reply(`📉 @${mentioned.split('@')[0]} has been demoted from admin.`);
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_warn.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            if (!isAdmin && !isOwner) return reply(`⛔ Admin permission required.`);
            // Delegate to the warn plugin — it has its own warning state/counter
            const pm = pluginMap();
            const warnPlugin = pm.get('warn');
            if (warnPlugin) { try { await warnPlugin.run(sock, message, [], ctx); } catch (e) { reply(`❌ Failed: ${e.message}`); } }
            else return reply(`💡 Reply to a member's message and use: \`.warn\``);
            return;

        } else if (agentActions.group_tag.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            // Build the @all mention ourselves so it works without rawCmd
            try {
                const meta = ctx.groupMetadata || await sock.groupMetadata(jid);
                const mentions = meta.participants.map(p => p.id);
                const tagText = meta.participants.map(p => `@${p.id.split('@')[0]}`).join(' ');
                await sock.sendMessage(jid, {
                    text: `📢 *Attention everyone!*\n\n${tagText}`,
                    mentions,
                }, { quoted: message });
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_admins.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            try {
                const meta = ctx.groupMetadata || await sock.groupMetadata(jid);
                const adminList = meta.participants.filter(p => p.admin);
                const text = `👑 *Group Admins (${adminList.length})*\n\n` +
                    adminList.map((p, i) => `${i + 1}. @${p.id.split('@')[0]}`).join('\n');
                await sock.sendMessage(jid, { text, mentions: adminList.map(p => p.id) }, { quoted: message });
            } catch (e) { reply(`❌ Failed: ${e.message}`); }
            return;

        } else if (agentActions.group_info.test(query)) {
            if (!isGroup) return reply(`⚠️ This command only works in a group.`);
            try {
                const meta = ctx.groupMetadata || await sock.groupMetadata(jid);
                const adminCount = meta.participants.filter(p => p.admin).length;
                reply(
                    `👥 *Group Info*\n\n` +
                    `📛 *Name:* ${meta.subject}\n` +
                    `🆔 *ID:* ${jid}\n` +
                    `👤 *Members:* ${meta.participants.length}\n` +
                    `👑 *Admins:* ${adminCount}\n` +
                    `📝 *Description:* ${meta.desc || '_(none)_'}\n` +
                    `📅 *Created:* ${meta.creation ? new Date(meta.creation * 1000).toLocaleDateString() : 'Unknown'}`
                );
            } catch (e) { reply(`❌ Could not fetch group info: ${e.message}`); }
            return;

        // ── Productivity handlers ─────────────────────────────────────────────
        } else if (agentActions.remind.test(query)) {
            // "silva remind me in 30 minutes to check email"
            const pm = pluginMap();
            const plugin = pm.get('remind') || pm.get('reminder');
            const cleaned = query.replace(agentActions.remind, '').trim();
            if (plugin) {
                try { await plugin.run(sock, message, cleaned.split(/\s+/), ctx); }
                catch (e) { reply(`❌ Failed: ${e.message}`); }
            } else {
                reply(
                    `⏰ *Reminder Setup*\n\n` +
                    `Use: \`.remind <time> <message>\`\n\n` +
                    `_Examples:_\n• \`.remind 30m check the oven\`\n• \`.remind 2h call mom\`\n• \`.remind 1d meeting at 9am\``
                );
            }
            return;

        } else if (agentActions.note_save.test(query)) {
            const pm = pluginMap();
            const plugin = pm.get('notes') || pm.get('note');
            const noteContent = query.replace(agentActions.note_save, '').trim();
            if (!noteContent) return reply(`❓ What should I save?\n\nExample: _silva save note shopping list: milk, eggs, bread_`);
            if (plugin) {
                try { await plugin.run(sock, message, ['save', ...noteContent.split(/\s+/)], ctx); }
                catch { await plugin.run(sock, message, noteContent.split(/\s+/), ctx); }
            } else {
                reply(`📝 Use \`.notes save <name> <content>\` to save a note.`);
            }
            return;

        } else if (agentActions.note_get.test(query)) {
            const pm = pluginMap();
            const plugin = pm.get('notes') || pm.get('note');
            const noteName = query.replace(agentActions.note_get, '').trim();
            if (plugin) {
                try { await plugin.run(sock, message, noteName ? ['get', noteName] : ['list'], ctx); }
                catch (e) { reply(`❌ Failed: ${e.message}`); }
            } else {
                reply(`📝 Use \`.notes list\` to see your notes, or \`.notes get <name>\` to read one.`);
            }
            return;

        } else if (agentActions.poll.test(query)) {
            const pm = pluginMap();
            const plugin = pm.get('poll');
            // Parse "silva create a poll: Question | Option A | Option B | Option C"
            const pollContent = query.replace(agentActions.poll, '').replace(/^[:\-\s]+/, '').trim();
            if (!pollContent) {
                return reply(
                    `📊 *Create a Poll*\n\n` +
                    `Format: _silva create a poll: Question | Option 1 | Option 2 | Option 3_\n\n` +
                    `Example: _silva create a poll: Favorite color? | Red | Blue | Green_`
                );
            }
            if (plugin) {
                try { await plugin.run(sock, message, pollContent.split(/\s+/), ctx); }
                catch (e) { reply(`❌ Failed: ${e.message}`); }
            } else {
                const parts = pollContent.split(/\s*\|\s*/);
                const question = parts[0];
                const options = parts.slice(1);
                try {
                    await sock.sendMessage(jid, {
                        poll: {
                            name: question,
                            values: options.length >= 2 ? options : ['Yes', 'No'],
                            selectableCount: 1,
                        },
                    }, { quoted: message });
                } catch (e) { reply(`❌ Could not create poll: ${e.message}`); }
            }
            return;

        } else if (agentActions.schedule.test(query)) {
            const pm = pluginMap();
            const plugin = pm.get('schedule') || pm.get('sched');
            const schedContent = query.replace(agentActions.schedule, '').trim();
            if (plugin) {
                try { await plugin.run(sock, message, schedContent.split(/\s+/), ctx); }
                catch (e) { reply(`❌ Failed: ${e.message}`); }
            } else {
                reply(`⏱️ Use \`.schedule <time> <message>\` to schedule a message.`);
            }
            return;

        // ── Media / AI handlers ───────────────────────────────────────────────
        } else if (agentActions.imagine.test(query)) {
            const pm = pluginMap();
            const plugin = pm.get('imagine') || pm.get('generate') || pm.get('aiimage');
            const prompt = query
                .replace(/\b(generate|create|make|draw|paint|design|sketch|imagine)\s+(an?\s+)?(ai\s+)?(image|photo|picture|art|artwork|illustration|wallpaper|thumbnail)\b/gi, '')
                .replace(/\bimagine\b/gi, '')
                .trim();
            if (!prompt) return reply(`🎨 What image should I generate?\n\nExample: _silva generate an image of a lion wearing a gold crown in a forest_`);
            await safeSend({ text: `🎨 _Generating: "${prompt}"..._` }, { quoted: message });
            if (plugin) {
                try { await plugin.run(sock, message, prompt.split(/\s+/), ctx); }
                catch (e) { reply(`❌ Failed: ${e.message}`); }
            } else {
                try {
                    const seed = Math.floor(Math.random() * 999999);
                    const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;
                    const res = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 60000 });
                    await sock.sendMessage(jid, {
                        image: Buffer.from(res.data),
                        caption: `🎨 *AI Image*\n\n📝 ${prompt}`,
                    }, { quoted: message });
                } catch (e) { reply(`❌ Image generation failed: ${e.message}`); }
            }
            return;

        } else if (agentActions.tts.test(query)) {
            const pm = pluginMap();
            const plugin = pm.get('tts') || pm.get('speech') || pm.get('voice');
            const text = query.replace(agentActions.tts, '').trim();
            // Also check quoted message for text to speak
            const quotedText = message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation || '';
            const speakText = text || quotedText;
            if (!speakText) return reply(`🔊 What should I say?\n\nExample: _silva speak Hello everyone!_`);
            if (plugin) {
                try { await plugin.run(sock, message, speakText.split(/\s+/), ctx); }
                catch (e) { reply(`❌ Failed: ${e.message}`); }
            } else {
                reply(`🔊 Use \`.tts <text>\` to convert text to speech.`);
            }
            return;

        } else if (agentActions.quotly.test(query)) {
            const pm = pluginMap();
            const plugin = pm.get('quotly') || pm.get('quote2img') || pm.get('q2s');
            const text = query.replace(agentActions.quotly, '').trim();
            if (plugin) {
                try { await plugin.run(sock, message, text ? text.split(/\s+/) : [], ctx); }
                catch (e) { reply(`❌ Failed: ${e.message}`); }
            } else {
                reply(`💬 Reply to a message and use \`.quotly\` to create a quote sticker.`);
            }
            return;

        } else if (agentActions.describe.test(query)) {
            const pm = pluginMap();
            const plugin = pm.get('describe') || pm.get('caption') || pm.get('analyze');
            const question = query.replace(agentActions.describe, '').trim() || 'Describe this image in detail';
            if (plugin) {
                try { await plugin.run(sock, message, question.split(/\s+/), ctx); }
                catch (e) { reply(`❌ Failed: ${e.message}`); }
            } else {
                reply(`👁️ Reply to an image and use \`.describe\` to get an AI description.`);
            }
            return;

        } else if (agentActions.summarize.test(query)) {
            const pm = pluginMap();
            const plugin = pm.get('summarize') || pm.get('summary') || pm.get('tldr');
            const text = query.replace(agentActions.summarize, '').trim();
            if (plugin) {
                try { await plugin.run(sock, message, text ? text.split(/\s+/) : [], ctx); }
                catch (e) { reply(`❌ Failed: ${e.message}`); }
            } else {
                reply(`📝 Reply to a long message and use \`.summarize\` for a quick summary.`);
            }
            return;

        // ── Settings shortcuts (natural language) ─────────────────────────────
        } else if (agentActions.toggle_antibad.test(query)) {
            if (!isOwner && !isAdmin) return reply(`⛔ Admin permission required.`);
            config.ANTI_BAD = true;
            reply(`✅ *Anti-Bad Words: ON*\n\nProfanity filter is now active in groups. Messages with bad words will be auto-deleted.`);
            return;

        } else if (agentActions.toggle_antibad_off.test(query)) {
            if (!isOwner && !isAdmin) return reply(`⛔ Admin permission required.`);
            config.ANTI_BAD = false;
            reply(`✅ *Anti-Bad Words: OFF*\n\nProfanity filter disabled.`);
            return;

        } else if (agentActions.toggle_bluetick.test(query)) {
            if (!isOwner) return reply(`⛔ Owner permission required.`);
            config.READ_RECEIPT = true;
            reply(`👁️ *Blue Ticks: ON*\n\nRead receipts are now visible.`);
            return;

        } else if (agentActions.toggle_bluetick_off.test(query)) {
            if (!isOwner) return reply(`⛔ Owner permission required.`);
            config.READ_RECEIPT = false;
            reply(`🫥 *Blue Ticks: OFF*\n\nRead receipts hidden — your views are private.`);
            return;

        } else if (agentActions.clear_memory.test(query)) {
            conversationMemory.delete(jid);
            reply(`🧹 *Memory cleared!*\n\nI've forgotten our conversation history. Fresh start! 🤖`);
            return;

        // ── GitHub SilvaTechB (read-only) ─────────────────────────────────────
        } else if (agentActions.github_silvatech.test(query)) {
            const pm = pluginMap();
            const ghPlugin = pm.get('silvatech') || pm.get('silvarepos');
            // Pass the cleaned query as args so the plugin can parse subcommands
            const cleanedArgs = query
                .replace(/\b(silvatech|silvatechwb|silvatechb|silvarepos)\b/gi, '')
                .replace(/\b(repos?|list|show|get|github|projects?)\b/gi, '')
                .trim().split(/\s+/).filter(Boolean);
            if (ghPlugin) {
                try { await ghPlugin.run(sock, message, cleanedArgs, ctx); return; }
                catch (e) { reply(`❌ GitHub error: ${e.message}`); return; }
            }
            return;

        // ── GitHub repo ZIP download ("send me a clip of SilvaTechB/silva-md-bot") ──
        } else if (agentActions.github_repo_zip.test(query)) {
            const repoMatch = query.match(/\b([\w-]+\/[\w-]+)\b/);
            const fullRepo = repoMatch ? repoMatch[1] : null;
            if (!fullRepo || fullRepo.includes('silva') === false && !fullRepo.includes('/')) {
                return reply(`📦 Please specify the repo in *owner/repo* format.\n\nExample: _silva send me a clip of SilvaTechB/silva-md-bot_`);
            }
            const [owner, repo] = fullRepo.split('/');
            await safeSend({ text: `📦 _Preparing download link for *${fullRepo}*..._` }, { quoted: message });
            try {
                const ghHeaders = { 'User-Agent': 'SilvaMD-Bot/2.0', 'Accept': 'application/vnd.github+json' };
                const res = await axios.get(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: ghHeaders, timeout: 8000 });
                const r = res.data;
                const branch = r.default_branch || 'main';
                reply(
                    `📦 *${r.full_name}*\n\n` +
                    `${r.description ? `📝 ${r.description}\n\n` : ''}` +
                    `⭐ *${r.stargazers_count}* stars  🍴 *${r.forks_count}* forks\n\n` +
                    `*⬇️ Download Links*\n` +
                    `• ZIP: https://github.com/${r.full_name}/archive/refs/heads/${branch}.zip\n` +
                    `• Tarball: https://github.com/${r.full_name}/archive/refs/heads/${branch}.tar.gz\n\n` +
                    `*🔗 View on GitHub*\n${r.html_url}\n\n` +
                    `_Use \`.silvatech ${repo} <filepath>\` to read specific files._`
                );
            } catch (err) {
                const branch = 'main';
                reply(
                    `📦 *${fullRepo}*\n\n` +
                    `*⬇️ Download Links*\n` +
                    `• ZIP (main): https://github.com/${owner}/${repo}/archive/refs/heads/main.zip\n` +
                    `• ZIP (master): https://github.com/${owner}/${repo}/archive/refs/heads/master.zip\n\n` +
                    `_Tap a link to download. Could not verify repo: ${err.message}_`
                );
            }
            return;

        // ── GitHub repo file fetch ────────────────────────────────────────────
        } else if (agentActions.github_repo_file.test(query)) {
            // Extract "owner/repo/path" or "file from owner/repo"
            const repoFileMatch = query.match(/\b([\w-]+\/[\w-]+)\/([\w./\-]+)\b/) ||
                                  query.match(/\b(readme|package\.json|index\.js|\.env)\b/i);
            const repoMatch = query.match(/\b([\w-]+\/[\w-]+)\b/);
            const fileKeyword = query.match(/\b(readme|package\.json|index\.js|config|handler|silva)\b/i)?.[1] || '';

            if (!repoMatch) {
                return reply(`📄 Specify the repo and file.\n\nExamples:\n• _silva get README from SilvaTechB/silva-md-bot_\n• _.silvatech silva-md-bot README.md_`);
            }

            const [owner, repo] = repoMatch[1].split('/');
            const filePath = repoFileMatch?.[3] ||
                            (fileKeyword.toLowerCase() === 'readme' ? 'README.md' : fileKeyword || 'README.md');

            await safeSend({ text: `📄 _Fetching \`${filePath}\` from *${owner}/${repo}*..._` }, { quoted: message });
            try {
                const ghHeaders = { 'User-Agent': 'SilvaMD-Bot/2.0', 'Accept': 'application/vnd.github+json' };
                const res = await axios.get(
                    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(filePath)}`,
                    { headers: ghHeaders, timeout: 10000 }
                );
                const file = res.data;
                if (file.encoding === 'base64' && file.content) {
                    const content = Buffer.from(file.content, 'base64').toString('utf8');
                    const preview = content.length > 3000
                        ? content.slice(0, 3000) + `\n\n_...file truncated (${content.length} chars total)_`
                        : content;
                    reply(`📄 *${owner}/${repo}/${filePath}*\n\n\`\`\`\n${preview}\n\`\`\``);
                } else {
                    reply(`📄 *${owner}/${repo}/${filePath}*\n\n🔗 ${file.html_url}\n⬇️ ${file.download_url || 'N/A'}`);
                }
            } catch (err) {
                if (err.response?.status === 404) {
                    reply(`❌ File not found: \`${owner}/${repo}/${filePath}\`\n\n_Use \`.silvatech ${repo}\` to browse available files._`);
                } else {
                    reply(`❌ Could not fetch file: ${err.message}`);
                }
            }
            return;

        // ── Riddle dispatch ───────────────────────────────────────────────────
        } else if (agentActions.riddle_agent.test(query)) {
            const pm = pluginMap();
            const riddlePlugin = pm.get('riddle');
            if (riddlePlugin) {
                try { await riddlePlugin.run(sock, message, [], ctx); return; }
                catch (e) { reply(`❌ Riddle error: ${e.message}`); return; }
            }
            reply(`🧩 Use \`.riddle\` to get a brain teaser! Then \`.answer\` to reveal the answer.`);
            return;

        // ── Proverb dispatch ──────────────────────────────────────────────────
        } else if (agentActions.proverb_agent.test(query)) {
            const pm = pluginMap();
            const provPlugin = pm.get('proverb') || pm.get('saying') || pm.get('wisdom');
            if (provPlugin) {
                try { await provPlugin.run(sock, message, [], ctx); return; }
                catch (e) { reply(`❌ Proverb error: ${e.message}`); return; }
            }
            const PROVERBS = [
                'A stitch in time saves nine.',
                'Actions speak louder than words.',
                'All that glitters is not gold.',
                'A penny saved is a penny earned.',
                'Beggars can\'t be choosers.',
                'Better late than never.',
                'Don\'t count your chickens before they hatch.',
                'Every cloud has a silver lining.',
                'Fortune favors the bold.',
                'Knowledge is power.',
                'Look before you leap.',
                'No pain, no gain.',
                'Practice makes perfect.',
                'The early bird catches the worm.',
                'Time is money.',
                'Two wrongs don\'t make a right.',
                'When in Rome, do as the Romans do.',
                'Where there\'s a will, there\'s a way.',
                'You reap what you sow.',
                'A fool and his money are soon parted.',
                'Absence makes the heart grow fonder.',
                'All roads lead to Rome.',
                'Birds of a feather flock together.',
                'Curiosity killed the cat.',
                'Don\'t bite the hand that feeds you.',
                'Great minds think alike.',
                'Honesty is the best policy.',
                'It takes two to tango.',
                'Laughter is the best medicine.',
                'Necessity is the mother of invention.',
            ];
            const pick = PROVERBS[Math.floor(Math.random() * PROVERBS.length)];
            reply(`📜 *Proverb of the Moment*\n\n_"${pick}"_\n\n_Use \`.proverb\` for more wisdom!_`);
            return;

        // ── Rhyme dispatch ────────────────────────────────────────────────────
        } else if (agentActions.rhyme_agent.test(query)) {
            const pm = pluginMap();
            const rhymePlugin = pm.get('rhyme') || pm.get('rhymes');
            const wordMatch = query.match(/\brhymes?\s+(?:with\s+)?(\w+)\b/i) || query.match(/\bwords?\s+that\s+rhyme\s+(?:with\s+)?(\w+)\b/i) || query.match(/\bwhat\s+rhymes\s+(?:with\s+)?(\w+)\b/i);
            const word = wordMatch ? wordMatch[1] : query.replace(/\brhyme\b|\brhymes?\s+with\b|\bwords?\s+that\s+rhyme\b/gi, '').trim().split(/\s+/).pop();
            if (rhymePlugin && word) {
                try { await rhymePlugin.run(sock, message, word ? [word] : [], ctx); return; }
                catch (e) { reply(`❌ Rhyme error: ${e.message}`); return; }
            }
            if (word) {
                try {
                    const res = await axios.get(`https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(word)}&max=12`, { timeout: 8000 });
                    const rhymes = res.data?.map(r => r.word) || [];
                    if (rhymes.length) {
                        reply(`🎵 *Words that rhyme with "${word}"*\n\n${rhymes.join(', ')}\n\n_${rhymes.length} rhymes found_`);
                    } else {
                        reply(`🎵 No rhymes found for "*${word}*". Try another word!`);
                    }
                } catch {
                    reply(`🎵 Use \`.rhyme <word>\` to find words that rhyme!`);
                }
            } else {
                reply(`🎵 *Rhyme Finder*\n\nExample: _silva what rhymes with moon_\n\nOr use: \`.rhyme <word>\``);
            }
            return;

        } else {
            // ── Natural language: intent map first (instant), then AI races in parallel ──
            const pm = pluginMap();

            // Step 1: fast regex intent matching (zero latency)
            const intent = findIntent(query);
            if (intent) {
                const plugin = pm.get(intent.cmd);
                if (plugin) {
                    if (plugin.permission === 'owner' && !isOwner)
                        return reply(`⛔ That action requires owner permission.`);
                    if (plugin.permission === 'admin' && !isAdmin && !isOwner)
                        return reply(`⛔ That action requires admin permission.`);
                    const argDisplay = intent.pluginArgs.length ? ` *"${intent.pluginArgs.join(' ')}"*` : '';
                    await safeSend({ text: `${intent.label}${argDisplay}...` }, { quoted: message });
                    try {
                        await plugin.run(sock, message, intent.pluginArgs, ctx);
                    } catch (err) {
                        await safeSend({ text: `❌ Failed: ${err.message || 'Something went wrong.'}` }, { quoted: message });
                    }
                    return;
                }
            }

            // Step 2: bare single word — run as direct command
            const cmdMatch = query.match(/^\.?(\w+)$/);
            if (cmdMatch) {
                const potentialCmd = cmdMatch[1].toLowerCase();
                if (pm.has(potentialCmd)) {
                    const plugin = pm.get(potentialCmd);
                    if (plugin.permission === 'owner' && !isOwner)
                        return reply(`⛔ \`${potentialCmd}\` requires owner permission.`);
                    if (plugin.permission === 'admin' && !isAdmin && !isOwner)
                        return reply(`⛔ \`${potentialCmd}\` requires admin permission.`);
                    try { await plugin.run(sock, message, [], ctx); return; } catch (err) {
                        return reply(`❌ Error running \`${potentialCmd}\`: ${err.message}`);
                    }
                }
            }

            // Step 3: instant built-in smart responses (no API call)
            const smart = getSmartResponse(query);
            if (smart) {
                response = `🤖 *Silva*\n\n${smart}`;
                rememberMessage(jid, 'user', query);
                rememberMessage(jid, 'bot', smart);
            } else {
                // Step 4: AI — ch.at (with retry) races pollinations + popcat in parallel.
                //          Gemini is tried if all free APIs fail.
                //          offlineSmartReply() is the guaranteed final backstop — NEVER silent.
                rememberMessage(jid, 'user', query);
                await sock.sendPresenceUpdate('composing', jid);

                // Build a strong system prompt that tells ch.at exactly when to route a plugin
                const toolList = [...pm.keys()].slice(0, 100).join(', ');
                const systemPrompt =
                    `You are Silva, a smart WhatsApp bot assistant. ` +
                    `Owner: ${config.OWNER_NAME || 'Silva'}. Bot: ${config.BOT_NAME || 'Silva MD'}.\n` +
                    `Available bot commands: ${toolList}.\n\n` +
                    `ROUTING RULES (follow exactly):\n` +
                    `• If the user wants music/songs → reply: TOOL:play|<song name>\n` +
                    `• If the user wants weather    → reply: TOOL:weather|<city>\n` +
                    `• If the user wants Wikipedia  → reply: TOOL:wiki|<topic>\n` +
                    `• If the user wants a sticker  → reply: TOOL:sticker|\n` +
                    `• If the user wants TikTok DL  → reply: TOOL:tiktok|<url>\n` +
                    `• If the user wants YouTube DL → reply: TOOL:ytmp4|<title>\n` +
                    `• If the user wants translate  → reply: TOOL:translate|<lang> <text>\n` +
                    `• If the user wants a joke     → reply: TOOL:joke|\n` +
                    `• If the user wants news       → reply: TOOL:news|\n` +
                    `• If the user wants QR code    → reply: TOOL:qr|<text>\n` +
                    `• If the user wants a poem     → reply: TOOL:poem|<topic>\n` +
                    `• If the user wants crypto     → reply: TOOL:crypto|<coin>\n` +
                    `• For any other bot command in the list above, reply: TOOL:<command>|<args>\n` +
                    `• For general questions, conversation, or topics NOT matching a command → answer naturally.\n\n` +
                    `Format rules: Use *bold* for key info. Max 200 words. Never say you cannot run commands.`;

                let aiReply = await askFreeAI(query, jid, systemPrompt);

                // Gemini secondary fallback (only if keyed)
                if (!aiReply) {
                    try {
                        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY || '';
                        if (apiKey) {
                            const { GoogleGenerativeAI } = require('@google/generative-ai');
                            const genAI = new GoogleGenerativeAI(apiKey);
                            const model = genAI.getGenerativeModel({
                                model: 'gemini-1.5-flash',
                                generationConfig: { temperature: 0.85, maxOutputTokens: 800 },
                            });
                            const mem = getMemory(jid).slice(-6);
                            const geminiHistory = [
                                { role: 'user',  parts: [{ text: systemPrompt }] },
                                { role: 'model', parts: [{ text: `Got it! I'm Silva, ready to help. 🤖` }] },
                                ...mem.slice(0, -1).map(m => ({
                                    role: m.role === 'user' ? 'user' : 'model',
                                    parts: [{ text: m.text }],
                                })),
                            ];
                            const chat = model.startChat({ history: geminiHistory });
                            const result = await chat.sendMessage(query);
                            aiReply = result.response.text();
                        }
                    } catch { /* Gemini unavailable */ }
                }

                // ── GUARANTEED RESPONSE — never silent ──────────────────────────────────
                // offlineSmartReply always returns a useful string, so response is always set.
                if (!aiReply) {
                    aiReply = offlineSmartReply(query, pm);
                }

                // Check if AI (or offline) decided to route a plugin via TOOL: prefix
                if (/^TOOL:/i.test(String(aiReply).trim())) {
                    const toolLine = String(aiReply).trim().replace(/^TOOL:/i, '').split('\n')[0].trim();
                    const pipeIdx  = toolLine.indexOf('|');
                    const cmdName  = (pipeIdx >= 0 ? toolLine.slice(0, pipeIdx) : toolLine).trim().toLowerCase();
                    const argStr   = pipeIdx >= 0 ? toolLine.slice(pipeIdx + 1).trim() : '';
                    const toolArgs = argStr ? argStr.split(/\s+/).filter(Boolean) : [];
                    const plugin   = pm.get(cmdName);

                    if (plugin) {
                        if (plugin.permission === 'owner' && !isOwner)
                            return reply(`⛔ That action requires owner permission.`);
                        if (plugin.permission === 'admin' && !isAdmin && !isOwner)
                            return reply(`⛔ That action requires admin permission.`);
                        const argDisplay = toolArgs.length ? ` *"${toolArgs.join(' ')}"*` : '';
                        await safeSend({ text: `🔧 _Running ${cmdName}${argDisplay}..._` }, { quoted: message });
                        try {
                            await plugin.run(sock, message, toolArgs, ctx);
                        } catch (err) {
                            await safeSend({ text: `❌ ${cmdName} failed: ${err.message || 'Something went wrong.'}` }, { quoted: message });
                        }
                        return;
                    }
                    // TOOL: command not found — fall through to conversational reply
                }

                // Conversational response (may come from ch.at, Gemini, or offline fallback)
                response = aiReply.startsWith('🤖 *Silva*') ? aiReply : `🤖 *Silva*\n\n${aiReply}`;
                rememberMessage(jid, 'bot', aiReply.slice(0, 300));
            }
        }
        // response is always set — either by an earlier branch or by offlineSmartReply above
        if (response) await safeSend({ text: response }, { quoted: message });
    }
};
