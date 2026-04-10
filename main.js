const { Plugin, PluginSettingTab, Setting, Modal, Notice, FuzzySuggestModal, TFile, TFolder, ItemView, parseYaml, requestUrl } = require("obsidian");

// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDateFromFilename(name) {
    const cleaned = name
        .replace(/\.md$/, "")
        .replace(/^\w+,\s*/, "")
        .replace(/(\d+)(st|nd|rd|th)/, "$1");
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? null : d;
}

function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function startOfDay(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
}

function getMonthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function getMonthEnd(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

function getISOWeek(d) {
    const t = new Date(d);
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
    const y1 = new Date(t.getFullYear(), 0, 1);
    return Math.ceil((((t - y1) / 86400000) + 1) / 7);
}

function getWeekStart(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    const day = r.getDay();
    r.setDate(r.getDate() - day + (day === 0 ? -6 : 1));
    return r;
}

function getWeekEnd(d) {
    const s = getWeekStart(d);
    s.setDate(s.getDate() + 6);
    return s;
}

function monthName(d) {
    return d.toLocaleDateString("en-US", { month: "long" });
}

function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

function mergeFrontmatter(content, fields) {
    const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
        const existing = fmMatch[1];
        return content.replace(/^---\n[\s\S]*?\n---/, `---\n${existing}\n${lines}\n---`);
    }
    return `---\n${lines}\n---\n${content}`;
}

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const SYNODIC_PERIOD = 29.53059;

const MOON_PHASES = ["New Moon", "First Quarter", "Full Moon", "Last Quarter"];
const MOON_PHASE_SHORT = { "New Moon": "new", "First Quarter": "q1", "Full Moon": "full", "Last Quarter": "q3" };

const SIGN_GLYPHS = {
    Aries: "\u2648", Taurus: "\u2649", Gemini: "\u264A", Cancer: "\u264B",
    Leo: "\u264C", Virgo: "\u264D", Libra: "\u264E", Scorpio: "\u264F",
    Sagittarius: "\u2650", Capricorn: "\u2651", Aquarius: "\u2652", Pisces: "\u2653",
};

// Each sign's ingress (0 deg) = Zhongqi (major term), 15 deg = Jieqi (minor term)
const SOLAR_TERMS = {
    Aries:       { major: { en: "Spring Equinox",       cn: "\u6625\u5206" }, minor: { en: "Clear and Bright",      cn: "\u6E05\u660E" } },
    Taurus:      { major: { en: "Grain Rain",           cn: "\u8C37\u96E8" }, minor: { en: "Start of Summer",       cn: "\u7ACB\u590F" } },
    Gemini:      { major: { en: "Grain Buds",           cn: "\u5C0F\u6EE1" }, minor: { en: "Grain in Ear",          cn: "\u8292\u79CD" } },
    Cancer:      { major: { en: "Summer Solstice",      cn: "\u590F\u81F3" }, minor: { en: "Minor Heat",            cn: "\u5C0F\u6691" } },
    Leo:         { major: { en: "Major Heat",           cn: "\u5927\u6691" }, minor: { en: "Start of Autumn",       cn: "\u7ACB\u79CB" } },
    Virgo:       { major: { en: "End of Heat",          cn: "\u5904\u6691" }, minor: { en: "White Dew",             cn: "\u767D\u9732" } },
    Libra:       { major: { en: "Autumn Equinox",       cn: "\u79CB\u5206" }, minor: { en: "Cold Dew",              cn: "\u5BD2\u9732" } },
    Scorpio:     { major: { en: "Frost's Descent",      cn: "\u971C\u964D" }, minor: { en: "Start of Winter",       cn: "\u7ACB\u51AC" } },
    Sagittarius: { major: { en: "Minor Snow",           cn: "\u5C0F\u96EA" }, minor: { en: "Major Snow",            cn: "\u5927\u96EA" } },
    Capricorn:   { major: { en: "Winter Solstice",      cn: "\u51AC\u81F3" }, minor: { en: "Minor Cold",            cn: "\u5C0F\u5BD2" } },
    Aquarius:    { major: { en: "Major Cold",           cn: "\u5927\u5BD2" }, minor: { en: "Start of Spring",       cn: "\u7ACB\u6625" } },
    Pisces:      { major: { en: "Rain Water",           cn: "\u96E8\u6C34" }, minor: { en: "Awakening of Insects",  cn: "\u60CA\u86F0" } },
};

const DEFAULT_NAMING = {
    calendar: { container: "{{month-name}} {{year}}", subdivision: "Week {{week}} \u2014 {{week-start}}" },
    moon:     { container: "{{phase}} {{date}}",       subdivision: "{{phase}} {{date}}" },
    solar:    { container: "{{term}} {{year}}",        subdivision: "{{term}} {{date}}" },
};

const MODE_LABELS = {
    calendar: { container: "Monthly",     subdivision: "Weekly",  containerNote: "Monthly Note",     subdivisionNote: "Weekly Note" },
    moon:     { container: "Moon Cycle",  subdivision: "Phase",   containerNote: "Moon Cycle Note",  subdivisionNote: "Phase Note" },
    solar:    { container: "Solar Cycle", subdivision: "Term",    containerNote: "Solar Cycle Note", subdivisionNote: "Term Note" },
};

// ═══════════════════════════════════════════════════════════════
//  LLM PROVIDERS (from Daily Ritual)
// ═══════════════════════════════════════════════════════════════

// PROVIDERS contract:
//   buildUrl(s)         -> string
//   buildBody(p, s, sys)-> object
//   extractText(d)      -> string
//   headers(s)          -> object  (optional)
//   listModels(s)       -> Promise<string[]>  (takes the whole service config so
//                         providers that need baseUrl can read it; legacy
//                         providers ignore everything but s.apiKey)
//   needsBaseUrl        -> boolean (UI hint)
//   defaultBaseUrl      -> string  (UI hint)
//
// All HTTP in the new providers uses Obsidian's requestUrl, not fetch.
// fetch() from app://obsidian.md triggers CORS preflight which local
// servers (LM Studio, OpenClaw) don't answer. requestUrl runs server-side
// in Obsidian's main process and bypasses CORS entirely. The legacy
// providers (gemini/openai/anthropic) use it too for consistency.
//
// Tiny helper because requestUrl returns { status, text, json } and we
// need to throw on non-2xx with a useful message in every provider.
async function prHttpJson(opts) {
    const r = await requestUrl({ throw: false, ...opts });
    if (r.status < 200 || r.status >= 300) {
        const detail = (r.text || "").slice(0, 300);
        throw new Error(`${r.status}${detail ? ": " + detail : ""}`);
    }
    return r.json;
}

const PROVIDERS = {
    gemini: {
        name: "Google Gemini",
        buildUrl(s) { return `https://generativelanguage.googleapis.com/v1beta/models/${s.model}:generateContent?key=${s.apiKey}`; },
        buildBody(prompt, s, sys) { return { system_instruction: { parts: [{ text: sys }] }, contents: [{ role: "user", parts: [{ text: prompt }] }] }; },
        extractText(d) { return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ""; },
        async listModels(s) {
            const key = typeof s === "string" ? s : s.apiKey;
            const d = await prHttpJson({ url: `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, method: "GET" });
            return (d.models || []).filter(m => m.supportedGenerationMethods?.includes("generateContent")).map(m => m.name.replace("models/", "")).sort();
        },
    },
    openai: {
        name: "OpenAI",
        buildUrl() { return "https://api.openai.com/v1/chat/completions"; },
        buildBody(prompt, s, sys) { return { model: s.model, messages: [{ role: "system", content: sys }, { role: "user", content: prompt }] }; },
        extractText(d) { return d.choices?.[0]?.message?.content?.trim() || ""; },
        headers(s) { return { Authorization: `Bearer ${s.apiKey}` }; },
        async listModels(s) {
            const key = typeof s === "string" ? s : s.apiKey;
            const d = await prHttpJson({ url: "https://api.openai.com/v1/models", method: "GET", headers: { Authorization: `Bearer ${key}` } });
            return (d.data || []).filter(m => m.id.startsWith("gpt") || m.id.startsWith("o")).map(m => m.id).sort();
        },
    },
    anthropic: {
        name: "Anthropic Claude",
        buildUrl() { return "https://api.anthropic.com/v1/messages"; },
        buildBody(prompt, s, sys) { return { model: s.model, max_tokens: 1024, system: sys, messages: [{ role: "user", content: prompt }] }; },
        extractText(d) { return d.content?.[0]?.text?.trim() || ""; },
        headers(s) { return { "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" }; },
        async listModels(s) {
            const key = typeof s === "string" ? s : s.apiKey;
            const d = await prHttpJson({ url: "https://api.anthropic.com/v1/models", method: "GET", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
            return (d.data || []).map(m => m.id).sort();
        },
    },
    openrouter: {
        name: "OpenRouter",
        buildUrl() { return "https://openrouter.ai/api/v1/chat/completions"; },
        buildBody(prompt, s, sys) { return { model: s.model, messages: [{ role: "system", content: sys }, { role: "user", content: prompt }] }; },
        extractText(d) { return d.choices?.[0]?.message?.content?.trim() || ""; },
        headers(s) {
            return {
                Authorization: `Bearer ${s.apiKey}`,
                // OpenRouter likes these for attribution but they're optional.
                "HTTP-Referer": "https://github.com/poweredbypugs/monthly-ritual",
                "X-Title": "Periodic Ritual (Obsidian)",
            };
        },
        async listModels(s) {
            const key = typeof s === "string" ? s : s.apiKey;
            const d = await prHttpJson({ url: "https://openrouter.ai/api/v1/models", method: "GET", headers: { Authorization: `Bearer ${key}` } });
            return (d.data || []).map(m => m.id).sort();
        },
    },
    lmstudio: {
        name: "LM Studio (local)",
        needsBaseUrl: true,
        defaultBaseUrl: "http://localhost:1234/v1",
        buildUrl(s) {
            const base = (s.baseUrl || "http://localhost:1234/v1").replace(/\/+$/, "");
            return `${base}/chat/completions`;
        },
        buildBody(prompt, s, sys) { return { model: s.model, messages: [{ role: "system", content: sys }, { role: "user", content: prompt }] }; },
        extractText(d) { return d.choices?.[0]?.message?.content?.trim() || ""; },
        headers(s) {
            // LM Studio ignores auth by default. Send the key only if provided.
            return s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {};
        },
        async listModels(s) {
            if (typeof s === "string") s = { apiKey: s };
            const base = (s.baseUrl || "http://localhost:1234/v1").replace(/\/+$/, "");
            const headers = s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {};
            const d = await prHttpJson({ url: `${base}/models`, method: "GET", headers });
            return (d.data || []).map(m => m.id).sort();
        },
    },
    openclaw: {
        name: "OpenClaw (local agent)",
        needsBaseUrl: true,
        defaultBaseUrl: "http://127.0.0.1:18789",
        buildUrl(s) {
            const base = (s.baseUrl || "http://127.0.0.1:18789").replace(/\/+$/, "");
            return `${base}/v1/chat/completions`;
        },
        // OpenClaw selects the agent via the `model` field. The user picks
        // a model id like "openclaw/default", "openclaw/main", or
        // "openclaw/<agentId>" from the listModels picker — we just pass
        // it through unchanged.
        buildBody(prompt, s, sys) {
            return {
                model: s.model || "openclaw/default",
                messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
            };
        },
        extractText(d) { return d.choices?.[0]?.message?.content?.trim() || ""; },
        headers(s) {
            // Auth depends on the gateway config (token / proxy / open).
            // If the gateway is in token mode, the API key is REQUIRED;
            // requests without it return 401. If it's in open mode, the
            // header is ignored. We always send Bearer when a key is set.
            return s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {};
        },
        async listModels(s) {
            if (typeof s === "string") s = { apiKey: s };
            const base = (s.baseUrl || "http://127.0.0.1:18789").replace(/\/+$/, "");
            const headers = s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {};
            const d = await prHttpJson({ url: `${base}/v1/models`, method: "GET", headers });
            return (d.data || []).map(m => m.id).sort();
        },
    },
};

// ═══════════════════════════════════════════════════════════════
//  DEFAULT SETTINGS
// ═══════════════════════════════════════════════════════════════

function makeQuestion(text) {
    return {
        text: text || "",
        injectVar: false,
        varField: "",
        varSource: "previous",
        varNotePath: "",
        outputToField: false,
        outputFieldName: "",
        outputFieldType: "inline",
    };
}

function makeReflectionConfig() {
    return {
        questions: [],
        systemPromptPrepend: "",
        systemPromptFile: "",
        dataPassThrough: "answers-only",
        selectedFields: [],
        outputFieldName: "",
        outputFieldType: "inline",
    };
}

// ─── Periodic Ritual: Starter system prompts (Phase 2 polish) ───
// Embedded copies of prompts/*.md from the source repo. Shipped with main.js
// so users can drop a starter prompt into their vault with one click without
// needing to download anything separately. Edit the source files in
// prompts/ when these need updating, and re-paste here.
const PR_STARTER_PROMPTS = {
    "calendar-week": {
        label: "Calendar Week (7 days)",
        filename: "pr-calendar-week-prompt.md",
        content:
`You are aggregating one calendar week of daily notes into a weekly review's frontmatter for an Obsidian vault.

# Input format

The user message contains:
- A \`# Period\` header with \`start:\`, \`end:\`, and \`daily_count:\` fields.
- A \`# Daily notes\` header followed by one section per day. Each section starts with \`## <filename>\` and contains the day's frontmatter keys and inline \`key:: value\` fields, one per line.

Daily fields you may see:
- **Records of what was done** (task lists, not ratings): \`study\`, \`creative\`, \`admin\`, \`work\`, \`links\`, possibly \`wealth\`
- **Inline fields**: \`today::\` (the day's non-negotiable), \`health::\`, \`challenge::\`, \`lessons::\`
- **Astro context**: \`season\`, \`Ki\`, \`lunar\`
- **Habits**: \`egc\`, \`igc\` booleans, \`transits::\`

# Output format

Output ONLY a YAML frontmatter block. No code fences. No commentary.

Required keys:
- \`summary\`: One paragraph (3–5 sentences) synthesizing the week's arc, in second person. Look for momentum, themes, and friction. Treat goals as anchors, not prisons.
- \`lessons\`: YAML list of 3–5 short observations.
- \`health\`, \`study\`, \`links\`, \`work\`, \`creative\`, \`wealth\`: Pipe-separated chronological values from each day's matching field. Skip empty days. (Translate daily \`admin::\` into \`wealth\` at this level.)
- \`highlights\`: YAML list of 2–4 standout moments.
- \`challenges\`: YAML list of 1–3 frictions.

# Rules

- Skip days with no value — never write empty entries.
- Do not invent data.
- Do not lecture or moralize. Surface patterns without judgment.
- Empty weeks still produce valid YAML with a brief \`summary\` and empty lists.
- Output must be parseable YAML.

Now produce the YAML.
`,
    },
    "calendar-month": {
        label: "Calendar Month (~30 days)",
        filename: "pr-calendar-month-prompt.md",
        content:
`You are aggregating one calendar month of daily notes into a monthly review's frontmatter for an Obsidian vault. The month spans 28–31 days; the user message includes the exact range.

# Input format

The user message contains:
- A \`# Period\` header with \`start:\`, \`end:\`, and \`daily_count:\`.
- A \`# Daily notes\` header followed by one section per day with frontmatter and inline \`key:: value\` fields.

# Output format

Output ONLY a YAML frontmatter block. No code fences.

Required keys:
- \`summary\`: A paragraph (4–7 sentences) synthesizing the month's arc, in second person. Look for arcs across weeks and the relationship between intention and execution.
- \`lessons\`: YAML list of 4–6 month-level observations. Bias toward things that needed a longer lens to see.
- \`health\`, \`study\`, \`links\`, \`work\`, \`creative\`, \`wealth\`: Pipe-separated chronological values. Skip empty days.
- \`highlights\`: YAML list of 3–6 month-level standouts.
- \`challenges\`: YAML list of 2–4 frictions that recurred or compounded.
- \`pattern_notes\`: A short paragraph (2–3 sentences) on patterns across the month — recurrences, avoidances, energy shifts.

# Rules

- Treat goals as anchors, not prisons.
- Look for *patterns across days*, not just sums.
- If \`today::\` is the user's primary measure of success, weight it accordingly.
- Don't invent data.
- Output must be parseable YAML.

Now produce the YAML.
`,
    },
    "chapter-quarter": {
        label: "Chapter / Quarter (90 days)",
        filename: "pr-chapter-prompt.md",
        content:
`You are aggregating one chapter (90 days) of daily notes into a chapter review's frontmatter for an Obsidian vault.

A **Chapter** is a 90-day container — long enough to see something form, short enough to feel.

# Input format

The user message contains:
- A \`# Period\` header with \`start:\`, \`end:\`, and \`daily_count:\`.
- A \`# Daily notes\` header followed by ~90 daily sections.

# Output format

Output ONLY a YAML frontmatter block. No code fences.

Required keys:
- \`summary\`: A paragraph (5–8 sentences) on the chapter's arc, in second person. What was this chapter about? What changed in you?
- \`chapter_arc\`: A short phrase (under 12 words) naming the chapter's emergent theme. Not what you intended — what actually happened.
- \`lessons\`: YAML list of 5–8 chapter-level learnings.
- \`health\`, \`study\`, \`links\`, \`work\`, \`creative\`, \`wealth\`: Pipe-separated phrases — one or two per ~30 days, not per day.
- \`highlights\`: YAML list of 4–8 standout moments across the whole chapter.
- \`challenges\`: YAML list of 3–5 frictions that persisted or compounded.
- \`arc_observations\`: A paragraph (3–5 sentences) on patterns across the 90 days.
- \`pillars_status\`: YAML object with one line per pillar describing where that pillar is *now* compared to chapter start. Honest, not optimistic.

# Rules

- The point is pattern recognition, not compliance scoring.
- Look for *emergence*. What showed up that wasn't in the original intention?
- Focus on systems that did or didn't form.
- If 30 days are missing, name the gap.
- Output must be parseable YAML.

Now produce the YAML.
`,
    },
    "sun-ingress": {
        label: "Sun Ingress (~30 days, one zodiac sign)",
        filename: "pr-sun-ingress-prompt.md",
        content:
`You are aggregating one Sun-ingress period (~30 days) into the frontmatter of a sign-period note for an Obsidian vault.

This is a thematic reflection on the energy of the period, framed by the natal chart and the sign the Sun is currently in. The container note is named something like "♈ Aries 2026". Not a calendar month review.

# Input format

The user message contains:
- A \`# Period\` header with \`start:\`, \`end:\`, and \`daily_count:\`.
- A \`# Daily notes\` header followed by ~30 daily sections. Daily notes may have \`season\`, \`lunar\`, or \`transits::\` fields.

# Output format

Output ONLY a YAML frontmatter block. No code fences.

Required keys:
- \`theme\`: A short phrase (under 15 words) naming the *felt* theme of the sign period.
- \`summary\`: A paragraph (4–7 sentences) reflecting on the energy of the period, in second person. Reference the sign's archetype lightly when it illuminates the daily data.
- \`archetypal_resonance\`: A short paragraph (2–4 sentences) on where the user's life this period did or didn't align with the sign's traditional themes. Plain language.
- \`transit_notes\`: Short paragraph or YAML list summarizing significant astrological events from \`transits::\` fields, if any.
- \`recurring_motifs\`: YAML list of 2–5 motifs that recurred — words, images, frustrations, joys.
- \`pillars_during_period\`: YAML object with one line per pillar (\`health\`, \`study\`, \`links\`, \`work\`, \`creative\`, \`wealth\`) noting how that pillar showed up. Brief.
- \`emergence\`: A paragraph (2–4 sentences) on what emerged in the user during this period that wasn't there at the start.

# Rules

- Use astrology as a lens, not a script.
- Don't predict. Don't prescribe. Don't moralize.
- If the user logged little astrological context, lean on the daily data.
- Look for what *emerged*, not what was *missed*.
- Output must be parseable YAML.

Now produce the YAML.
`,
    },
    "lunar-phase": {
        label: "Lunar Phase (~7 days, one quarter of a moon cycle)",
        filename: "pr-lunar-phase-prompt.md",
        content:
`You are aggregating one lunar phase (~7 days) into the frontmatter of a phase note for an Obsidian vault.

The user's lunar weeks are organized into four phases: **detach / plan / execute / share**. The container note is named something like "🌑 New Moon in Pisces 2026". This is a *short* container — surface mood and texture, not enumeration.

# Input format

The user message contains:
- A \`# Period\` header with \`start:\`, \`end:\`, and \`daily_count:\`.
- A \`# Daily notes\` header followed by ~7 daily sections.

# Output format

Output ONLY a YAML frontmatter block. No code fences.

Required keys:
- \`mood\`: A short phrase (under 12 words) naming the felt mood of the phase. Drawn from data, not astrological convention.
- \`summary\`: A short paragraph (3–5 sentences) on what this phase felt like, in second person.
- \`phase_intent\`: One sentence on what the phase seemed oriented around.
- \`pillars_active\`: YAML list naming which of the user's six pillars (\`health\`, \`study\`, \`links\`, \`work\`, \`creative\`, \`wealth\`) showed activity.
- \`notable\`: YAML list of 1–4 notable moments.
- \`carry_forward\`: A short paragraph (1–3 sentences) on what feels worth carrying into the next phase. Observation, not advice.

# Rules

- Be brief. This is a small container.
- Don't pad. Two days of data → two-day summary.
- Don't moralize about missed days.
- Let the data show what the phase actually was.
- Output must be parseable YAML.

Now produce the YAML.
`,
    },
};

// ─── Periodic Ritual: Container factory (Phase 1+) ───
function makePRContainer(overrides = {}) {
    return Object.assign({
        id: "pr-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        name: "New container",
        enabled: false,
        boundaryDetector: "calendar-week",
        template: "",
        saveDir: "",
        naming: "",
        // Where to write the plugin's per-note metadata (id / boundary / range).
        // "frontmatter" — single nested key under the YAML block.
        // "inline"      — find an inline-field marker in the body and replace
        //                 its line; if not found, append a hidden %% block
        //                 at the end of the file.
        // "none"        — don't write metadata at all. Phase 3 auto-generation
        //                 won't be able to identify previously-generated notes
        //                 from this container, but the user gets clean output.
        metadataPlacement: "frontmatter",
        metadataInlineKey: "periodic-ritual",
        // Phase 2+ LLM aggregation
        systemPromptFile: "",   // path to a .md file in the vault
        llmServiceId: "",       // references an entry in prLLMServices
    }, overrides);
}

// ─── Periodic Ritual: LLM service factory (Phase 2+) ───
function makePRLLMService(overrides = {}) {
    return Object.assign({
        id: "lsv-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        name: "New service",
        provider: "gemini",  // gemini | openai | anthropic | openrouter | lmstudio | openclaw
        apiKey: "",
        model: "",
        baseUrl: "",  // only used by providers with needsBaseUrl: true (lmstudio, openclaw)
    }, overrides);
}

// Format the metadata fields as a single inline blob: "k1=v1 k2=v2 ...".
// Used for both inline placement and as the value of the frontmatter key,
// so the format is identical regardless of where it lands.
function formatPRMetadataBlob(fields) {
    return Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" ");
}

// Resolve Obsidian core Templates plugin tokens — separate from both Templater
// and our own naming tokens. The user's templates often mix all three.
//   {{title}}             → file basename (no extension)
//   {{date}}              → today, YYYY-MM-DD
//   {{date:FORMAT}}       → moment().format(FORMAT)
//   {{time}}              → today, HH:mm
//   {{time:FORMAT}}       → moment().format(FORMAT)
function resolveCoreTemplateTokens(content, fileBasename) {
    const m = (typeof window !== "undefined" && window.moment) ? window.moment() : null;
    let out = content;
    out = out.replace(/\{\{\s*title\s*\}\}/g, fileBasename);
    out = out.replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/g, (_, fmt) => m ? m.format(fmt) : "");
    out = out.replace(/\{\{\s*date\s*\}\}/g, () => m ? m.format("YYYY-MM-DD") : "");
    out = out.replace(/\{\{\s*time\s*:\s*([^}]+?)\s*\}\}/g, (_, fmt) => m ? m.format(fmt) : "");
    out = out.replace(/\{\{\s*time\s*\}\}/g, () => m ? m.format("HH:mm") : "");
    return out;
}

// Apply Periodic Ritual metadata to note content according to the container's
// configured placement. Returns the (possibly modified) content string.
function applyPRMetadata(content, placement, inlineKey, fields) {
    if (placement === "none") return content;

    const blob = formatPRMetadataBlob(fields);

    if (placement === "frontmatter") {
        // One nested key under the YAML block. Quoted to keep YAML valid
        // even when the blob contains characters YAML would otherwise parse.
        return mergeFrontmatter(content, { "periodic-ritual": `"${blob}"` });
    }

    if (placement === "inline") {
        const key = inlineKey || "periodic-ritual";
        const rendered = `${key}:: ${blob}`;
        const escaped = escapeRegex(key);
        // Match the marker line whether it's bare or wrapped in %% comments.
        const markerRegex = new RegExp(`^.*${escaped}::.*$`, "m");
        if (markerRegex.test(content)) {
            // Preserve any %% wrapping or surrounding text on the line by
            // replacing only the field portion via a tighter regex.
            const fieldRegex = new RegExp(`${escaped}::[^\\n]*`, "m");
            return content.replace(fieldRegex, rendered);
        }
        // Marker not present in template — append a hidden block at end of file.
        return content.trimEnd() + `\n\n%%\n${rendered}\n%%\n`;
    }

    return content;
}

const DEFAULT_SETTINGS = {
    mode: "calendar",
    solarSubdivision: "terms",

    containerTemplate: "",
    containerFolder: "",
    containerNaming: "",
    generateAt: "start",

    subdivisionTemplate: "",
    subdivisionFolder: "",
    subdivisionNaming: "",

    includeSignGlyphs: false,
    includeEclipseFlags: false,

    dailyNotesFolder: "",

    calendarTimezone: "America/New_York",
    calendarNoteFolder: "",
    calendarNoteNaming: "\u2600\uFE0F Sun in {{sign}}",
    lunarNoteNaming: {
        "New Moon": "\uD83C\uDF11 {{phase-name}} Moon in {{moon-sign}}",
        "First Quarter": "\uD83C\uDF13 {{phase-name}} Moon in {{moon-sign}}",
        "Full Moon": "\uD83C\uDF15 {{phase-name}} Moon in {{moon-sign}}",
        "Last Quarter": "\uD83C\uDF17 {{phase-name}} Moon in {{moon-sign}}",
    },

    dailyToSubFields: [],
    subToContainerFields: [],

    llmEnabled: false,
    provider: "gemini",
    apiKey: "",
    model: "",

    containerReflection: makeReflectionConfig(),
    subdivisionReflection: makeReflectionConfig(),

    // ─── Periodic Ritual additions (Phase 0+) ───
    // New first-class primitives. Empty defaults; no behavior wired up yet.
    // The legacy keys above continue to work — these are purely additive.
    prContainers: [],          // Container[] — see PROJECT.md "Container config"
    prAlignments: [],          // Alignment[] — see PROJECT.md "Alignment module"
    prLLMServices: [],         // LLMService[] — { name, provider, apiKey, model }
    prAutoGenerateOnLoad: false, // single on/off toggle for boundary-driven auto-create
};

// ═══════════════════════════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════════════════════════

// Periodic Ritual: fuzzy picker for selecting which container to generate.
class PRContainerPickerModal extends FuzzySuggestModal {
    constructor(app, containers, onChoose) {
        super(app);
        this.containers = containers;
        this.onChooseCallback = onChoose;
        this.setPlaceholder("Pick a Periodic Ritual container to generate…");
    }
    getItems() { return this.containers; }
    getItemText(c) {
        const status = c.enabled ? "" : " (disabled)";
        return `${c.name || "(unnamed)"} — ${c.boundaryDetector}${status}`;
    }
    onChooseItem(c) { this.onChooseCallback(c); }
}

// Periodic Ritual: fuzzy picker for selecting an LLM model from a fetched list.
class PRModelPickerModal extends FuzzySuggestModal {
    constructor(app, models, onChoose) {
        super(app);
        this.models = models;
        this.onChooseCallback = onChoose;
        this.setPlaceholder("Pick a model…");
    }
    getItems() { return this.models; }
    getItemText(m) { return m; }
    onChooseItem(m) { this.onChooseCallback(m); }
}

// Periodic Ritual: fuzzy picker for the starter system prompts embedded in main.js.
class PRStarterPromptPickerModal extends FuzzySuggestModal {
    constructor(app, onChoose) {
        super(app);
        this.onChooseCallback = onChoose;
        this.setPlaceholder("Pick a starter system prompt…");
    }
    getItems() { return Object.keys(PR_STARTER_PROMPTS); }
    getItemText(key) { return PR_STARTER_PROMPTS[key].label; }
    onChooseItem(key) { this.onChooseCallback(key); }
}

class MarkdownFileSuggestModal extends FuzzySuggestModal {
    constructor(app, onChoose) {
        super(app);
        this.onChooseCallback = onChoose;
        this.setPlaceholder("Search for a markdown file...");
    }
    getItems() { return this.app.vault.getFiles().filter(f => f.extension === "md"); }
    getItemText(file) { return file.path; }
    onChooseItem(file) { this.onChooseCallback(file); }
}

class FolderSuggestModal extends FuzzySuggestModal {
    constructor(app, onChoose) {
        super(app);
        this.onChooseCallback = onChoose;
        this.setPlaceholder("Search for a folder...");
    }
    getItems() {
        const folders = [];
        this.app.vault.getAllLoadedFiles().forEach(f => {
            if (f instanceof TFolder) folders.push(f);
        });
        return folders;
    }
    getItemText(folder) { return folder.path; }
    onChooseItem(folder) { this.onChooseCallback(folder); }
}

class ReflectionModal extends Modal {
    constructor(app, questions, injectedVars, onSubmit) {
        super(app);
        this.questions = questions;
        this.injectedVars = injectedVars;
        this.onSubmit = onSubmit;
        this.answers = questions.map(() => "");
        this.step = 0;
    }

    onOpen() { this.renderStep(); }

    renderStep() {
        const { contentEl } = this;
        contentEl.empty();

        const q = this.questions[this.step];
        const injected = this.injectedVars[this.step];

        if (injected) {
            const varEl = contentEl.createEl("p");
            varEl.createEl("strong", { text: injected });
            varEl.style.cssText = "margin-bottom:8px;font-size:1.1em;";
        }

        contentEl.createEl("h5", { text: q.text }).style.cssText = "margin-bottom:12px;";

        const input = contentEl.createEl("input", { type: "text" });
        input.style.cssText = "width:100%;margin-bottom:16px;";
        input.value = this.answers[this.step];
        input.addEventListener("input", () => { this.answers[this.step] = input.value; });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                if (!this.answers[this.step].trim()) { new Notice("Please answer this question."); return; }
                if (this.step === this.questions.length - 1) { this.close(); this.onSubmit(this.answers); }
                else { this.step++; this.renderStep(); }
            }
        });
        setTimeout(() => input.focus(), 50);

        const btnC = contentEl.createDiv({ cls: "modal-button-container" });
        if (this.step > 0) {
            const back = btnC.createEl("button", { text: "Back" });
            back.addEventListener("click", () => { this.step--; this.renderStep(); });
        }
        const isLast = this.step === this.questions.length - 1;
        const next = btnC.createEl("button", { text: isLast ? "Submit" : "Next", cls: "mod-cta" });
        next.addEventListener("click", () => {
            if (!this.answers[this.step].trim()) { new Notice("Please answer this question."); return; }
            if (isLast) { this.close(); this.onSubmit(this.answers); }
            else { this.step++; this.renderStep(); }
        });
    }

    onClose() { this.contentEl.empty(); }
}

class LoadingModal extends Modal {
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.style.cssText = "text-align:center;padding:24px;";
        contentEl.createEl("p", { text: "Generating summary..." }).style.opacity = "0.7";
    }
    onClose() { this.contentEl.empty(); }
}

class DebugModal extends Modal {
    constructor(app, debugData) { super(app); this.debugData = debugData; }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Test Reflection" });
        const sections = [
            { label: "Provider", value: this.debugData.provider },
            { label: "Model", value: this.debugData.model },
            { label: "System Prompt Prepend", value: this.debugData.prepend || "(empty)" },
            { label: "System Prompt (from file)", value: this.debugData.systemPrompt || "(none)" },
            { label: "Structured Reflection", value: this.debugData.structured },
            { label: "Full Prompt", value: this.debugData.fullPrompt, mono: true },
        ];
        if (this.debugData.response) sections.push({ label: "LLM Response", value: this.debugData.response });
        if (this.debugData.error) sections.push({ label: "Error", value: this.debugData.error });
        for (const s of sections) {
            const g = contentEl.createDiv();
            g.style.cssText = "margin-bottom:16px;border-bottom:1px solid var(--background-modifier-border);padding-bottom:8px;";
            g.createEl("h4", { text: s.label });
            const c = g.createEl(s.mono ? "pre" : "p", { text: s.value });
            c.style.cssText = "white-space:pre-wrap;word-break:break-word;";
            if (s.mono) c.style.cssText += "font-size:0.85em;background:var(--background-secondary);padding:8px;border-radius:4px;";
        }
        const btn = contentEl.createDiv({ cls: "modal-button-container" }).createEl("button", { text: "Copy All", cls: "mod-cta" });
        btn.addEventListener("click", () => {
            navigator.clipboard.writeText(sections.map(s => `## ${s.label}\n${s.value}`).join("\n\n---\n\n")).then(() => new Notice("Copied to clipboard"));
        });
    }
    onClose() { this.contentEl.empty(); }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PLUGIN
// ═══════════════════════════════════════════════════════════════

class MonthlyRitualPlugin extends Plugin {

    // ─── Lifecycle ───

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new MonthlyRitualSettingTab(this.app, this));
        this.registerCommands();

        this.registerView(CALENDAR_VIEW_TYPE, (leaf) => new RitualCalendarView(leaf, this));
        this.addRibbonIcon("calendar-days", "Ritual Calendar", () => this.activateCalendarView());
    }

    async activateCalendarView() {
        const existing = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);
        if (existing.length) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        await leaf.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
    }

    async loadSettings() {
        const saved = await this.loadData();
        this.settings = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), saved);
        if (!this.settings.containerReflection || typeof this.settings.containerReflection !== "object") {
            this.settings.containerReflection = makeReflectionConfig();
        }
        if (!this.settings.subdivisionReflection || typeof this.settings.subdivisionReflection !== "object") {
            this.settings.subdivisionReflection = makeReflectionConfig();
        }
    }

    async saveSettings() { await this.saveData(this.settings); }

    // ─── Mode helpers ───

    getModeLabels() {
        const m = this.settings.mode;
        if (m === "moon") return MODE_LABELS.moon;
        if (m === "solar") {
            const labels = { ...MODE_LABELS.solar };
            if (this.settings.solarSubdivision === "phases") {
                labels.subdivision = "Phase";
                labels.subdivisionNote = "Phase Note";
            }
            return labels;
        }
        return MODE_LABELS.calendar;
    }

    hasMoonPlugin() {
        return !!this.app.plugins?.plugins?.["obsidian-moon"];
    }

    getMoonPlugin() {
        return this.app.plugins?.plugins?.["obsidian-moon"] || null;
    }

    getHeliosUrl() {
        const mp = this.getMoonPlugin();
        return mp?.settings?.serverUrl || null;
    }

    getEffectiveNaming(type) {
        const key = type === "container" ? "containerNaming" : "subdivisionNaming";
        if (this.settings[key]) return this.settings[key];
        return DEFAULT_NAMING[this.settings.mode]?.[type] || "{{date}}";
    }

    // ─── Helios API ───

    async fetchJson(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Helios ${r.status}: ${await r.text()}`);
        return r.json();
    }

    async fetchMoonNow() {
        const url = this.getHeliosUrl();
        if (!url) throw new Error("Moon Phase plugin not configured or missing serverUrl");
        return this.fetchJson(`${url}/moon-now`);
    }

    async fetchPlanetsNow() {
        const url = this.getHeliosUrl();
        if (!url) throw new Error("Moon Phase plugin not configured");
        return this.fetchJson(`${url}/planets-now`);
    }

    async fetchSunIngresses(start, end) {
        const url = this.getHeliosUrl();
        if (!url) throw new Error("Moon Phase plugin not configured");
        return this.fetchJson(`${url}/planetary-ingresses?planet=Sun&start=${formatDate(start)}&end=${formatDate(end)}`);
    }

    // ─── Calendar boundaries ───

    getCalendarContainerData(date) {
        const d = date || new Date();
        const start = getMonthStart(d);
        const end = getMonthEnd(d);
        const cycleNum = String(d.getMonth() + 1).padStart(2, "0");
        return {
            start, end,
            tokens: {
                year: String(d.getFullYear()),
                month: cycleNum,
                "month-name": monthName(d),
                day: String(d.getDate()).padStart(2, "0"),
                date: formatDate(start),
                cycle: cycleNum,
            },
        };
    }

    getCalendarSubdivisions(containerStart, containerEnd) {
        const subs = [];
        let d = new Date(containerStart);
        const seen = new Set();
        while (d <= containerEnd) {
            const ws = getWeekStart(d);
            const we = getWeekEnd(d);
            const wk = getISOWeek(d);
            const key = `${wk}-${ws.getFullYear()}`;
            if (!seen.has(key)) {
                seen.add(key);
                // Clamp week boundaries to the month
                const clampedStart = ws < containerStart ? containerStart : ws;
                const clampedEnd = we > containerEnd ? containerEnd : we;
                subs.push({
                    start: clampedStart,
                    end: clampedEnd,
                    tokens: {
                        year: String(clampedStart.getFullYear()),
                        month: String(clampedStart.getMonth() + 1).padStart(2, "0"),
                        "month-name": monthName(clampedStart),
                        day: String(clampedStart.getDate()).padStart(2, "0"),
                        date: formatDate(clampedStart),
                        week: String(wk),
                        "week-start": formatDate(clampedStart),
                        "week-end": formatDate(clampedEnd),
                    },
                });
            }
            d = addDays(d, 7);
        }
        return subs;
    }

    getCurrentWeekData(date) {
        const d = date || new Date();
        const ws = getWeekStart(d);
        const we = getWeekEnd(d);
        const wk = getISOWeek(d);
        return {
            start: ws, end: we,
            tokens: {
                year: String(d.getFullYear()),
                month: String(d.getMonth() + 1).padStart(2, "0"),
                "month-name": monthName(d),
                day: String(d.getDate()).padStart(2, "0"),
                date: formatDate(ws),
                week: String(wk),
                "week-start": formatDate(ws),
                "week-end": formatDate(we),
            },
        };
    }

    // ─── Lunar boundaries ───

    async getLunarContainerData(date) {
        const moonData = await this.fetchMoonNow();
        const now = date || new Date();
        const moonAge = moonData.moonAge || 0;

        const lastNew = startOfDay(addDays(now, -Math.floor(moonAge)));
        const nextNew = startOfDay(addDays(lastNew, Math.round(SYNODIC_PERIOD)));

        const sign = moonData.moonSign || "";
        let sunSign = "";
        try {
            const planets = await this.fetchPlanetsNow();
            const sun = (planets.planets || planets || []).find(p => p.name === "Sun");
            if (sun) sunSign = sun.sign || "";
        } catch (_) { /* ignore */ }

        return {
            start: lastNew, end: nextNew,
            moonAge,
            moonSign: moonData.moonSign || "",
            sunSign,
            tokens: {
                year: String(lastNew.getFullYear()),
                month: String(lastNew.getMonth() + 1).padStart(2, "0"),
                "month-name": monthName(lastNew),
                day: String(lastNew.getDate()).padStart(2, "0"),
                date: formatDate(lastNew),
                cycle: this.getLunarCycleNumber(lastNew),
                phase: "New Moon",
                "phase-short": "new",
                sign: this.settings.includeSignGlyphs ? sign : "",
                "sign-glyph": this.settings.includeSignGlyphs ? (SIGN_GLYPHS[sign] || "") : "",
                eclipse: "",
            },
        };
    }

    getLunarCycleNumber(newMoonDate) {
        const y = newMoonDate.getFullYear();
        const jan1 = new Date(y, 0, 1);
        const dayOfYear = Math.floor((newMoonDate - jan1) / 86400000);
        return String(Math.floor(dayOfYear / SYNODIC_PERIOD) + 1).padStart(2, "0");
    }

    getLunarPhaseFromAge(moonAge) {
        const q = SYNODIC_PERIOD / 4;
        if (moonAge < q) return "New Moon";
        if (moonAge < 2 * q) return "First Quarter";
        if (moonAge < 3 * q) return "Full Moon";
        return "Last Quarter";
    }

    getLunarSubdivisions(containerStart) {
        const q = SYNODIC_PERIOD / 4;
        return MOON_PHASES.map((phase, i) => {
            const start = startOfDay(addDays(containerStart, Math.round(i * q)));
            const end = i < 3
                ? startOfDay(addDays(containerStart, Math.round((i + 1) * q) - 1))
                : startOfDay(addDays(containerStart, Math.round(SYNODIC_PERIOD) - 1));
            return {
                start, end, phase,
                tokens: {
                    year: String(start.getFullYear()),
                    month: String(start.getMonth() + 1).padStart(2, "0"),
                    "month-name": monthName(start),
                    day: String(start.getDate()).padStart(2, "0"),
                    date: formatDate(start),
                    phase: phase,
                    "phase-short": MOON_PHASE_SHORT[phase],
                    sign: "",
                    "sign-glyph": "",
                    eclipse: "",
                },
            };
        });
    }

    async getCurrentPhaseData(date) {
        const moonData = await this.fetchMoonNow();
        const now = date || new Date();
        const moonAge = moonData.moonAge || 0;
        const phase = this.getLunarPhaseFromAge(moonAge);
        const q = SYNODIC_PERIOD / 4;
        const phaseIdx = MOON_PHASES.indexOf(phase);
        const lastNew = startOfDay(addDays(now, -Math.floor(moonAge)));
        const phaseStart = startOfDay(addDays(lastNew, Math.round(phaseIdx * q)));
        const phaseEnd = phaseIdx < 3
            ? startOfDay(addDays(lastNew, Math.round((phaseIdx + 1) * q) - 1))
            : startOfDay(addDays(lastNew, Math.round(SYNODIC_PERIOD) - 1));

        const sign = moonData.moonSign || "";
        return {
            start: phaseStart, end: phaseEnd, phase,
            tokens: {
                year: String(phaseStart.getFullYear()),
                month: String(phaseStart.getMonth() + 1).padStart(2, "0"),
                "month-name": monthName(phaseStart),
                day: String(phaseStart.getDate()).padStart(2, "0"),
                date: formatDate(phaseStart),
                phase: phase,
                "phase-short": MOON_PHASE_SHORT[phase],
                sign: this.settings.includeSignGlyphs ? sign : "",
                "sign-glyph": this.settings.includeSignGlyphs ? (SIGN_GLYPHS[sign] || "") : "",
                eclipse: "",
            },
        };
    }

    // ─── Solar boundaries ───

    async getSolarContainerData(date) {
        const d = date || new Date();
        // Fetch Sun ingresses for a wide window around today
        const searchStart = addDays(d, -45);
        const searchEnd = addDays(d, 45);
        const ingresses = await this.fetchSunIngresses(searchStart, searchEnd);

        // Find the ingress before today and the one after
        const sorted = (Array.isArray(ingresses) ? ingresses : ingresses.ingresses || [])
            .map(ing => ({ ...ing, dateObj: new Date(ing.date || ing.exactDate || ing.timestamp) }))
            .sort((a, b) => a.dateObj - b.dateObj);

        let prevIng = null, nextIng = null;
        for (const ing of sorted) {
            if (ing.dateObj <= d) prevIng = ing;
            else if (!nextIng) nextIng = ing;
        }

        if (!prevIng) throw new Error("Could not determine current solar term from Helios data");
        const sign = prevIng.sign || prevIng.toSign || "";
        const term = SOLAR_TERMS[sign];
        const start = startOfDay(prevIng.dateObj);
        const end = nextIng ? startOfDay(addDays(nextIng.dateObj, -1)) : addDays(start, 29);

        return {
            start, end, sign,
            tokens: {
                year: String(start.getFullYear()),
                month: String(start.getMonth() + 1).padStart(2, "0"),
                "month-name": monthName(start),
                day: String(start.getDate()).padStart(2, "0"),
                date: formatDate(start),
                cycle: String(Object.keys(SIGN_GLYPHS).indexOf(sign) + 1).padStart(2, "0"),
                term: term ? term.major.en : sign,
                "term-cn": term ? term.major.cn : "",
                sign: this.settings.includeSignGlyphs ? sign : "",
                "sign-glyph": this.settings.includeSignGlyphs ? (SIGN_GLYPHS[sign] || "") : "",
            },
        };
    }

    async getSolarSubdivisions(containerStart, containerEnd, sign) {
        if (this.settings.solarSubdivision === "phases") {
            // Subdivide by lunar phases within this solar period
            try {
                const moonData = await this.fetchMoonNow();
                const moonAge = moonData.moonAge || 0;
                const now = new Date();
                const lastNew = startOfDay(addDays(now, -Math.floor(moonAge)));
                const subs = [];
                // Find all phase boundaries that fall within container range
                let cycleStart = lastNew;
                // Go back enough cycles to cover the container start
                while (cycleStart > containerStart) cycleStart = addDays(cycleStart, -Math.round(SYNODIC_PERIOD));
                // Now scan forward
                while (cycleStart < containerEnd) {
                    const q = SYNODIC_PERIOD / 4;
                    for (let i = 0; i < 4; i++) {
                        const phaseStart = startOfDay(addDays(cycleStart, Math.round(i * q)));
                        const phaseEnd = i < 3
                            ? startOfDay(addDays(cycleStart, Math.round((i + 1) * q) - 1))
                            : startOfDay(addDays(cycleStart, Math.round(SYNODIC_PERIOD) - 1));
                        if (phaseStart >= containerStart && phaseStart <= containerEnd) {
                            const phase = MOON_PHASES[i];
                            subs.push({
                                start: phaseStart, end: phaseEnd > containerEnd ? containerEnd : phaseEnd, phase,
                                tokens: {
                                    year: String(phaseStart.getFullYear()),
                                    month: String(phaseStart.getMonth() + 1).padStart(2, "0"),
                                    "month-name": monthName(phaseStart),
                                    day: String(phaseStart.getDate()).padStart(2, "0"),
                                    date: formatDate(phaseStart),
                                    phase, "phase-short": MOON_PHASE_SHORT[phase],
                                    sign: "", "sign-glyph": "", eclipse: "",
                                },
                            });
                        }
                    }
                    cycleStart = addDays(cycleStart, Math.round(SYNODIC_PERIOD));
                }
                return subs;
            } catch (e) {
                new Notice("Error calculating lunar phases: " + e.message);
                return [];
            }
        }

        // Default: subdivide by solar terms (major at start, minor at midpoint)
        const term = SOLAR_TERMS[sign];
        if (!term) return [];
        const mid = startOfDay(addDays(containerStart, Math.round((containerEnd - containerStart) / 86400000 / 2)));
        return [
            {
                start: containerStart, end: addDays(mid, -1),
                tokens: {
                    year: String(containerStart.getFullYear()),
                    month: String(containerStart.getMonth() + 1).padStart(2, "0"),
                    "month-name": monthName(containerStart),
                    day: String(containerStart.getDate()).padStart(2, "0"),
                    date: formatDate(containerStart),
                    term: term.major.en, "term-cn": term.major.cn,
                    sign: this.settings.includeSignGlyphs ? sign : "",
                    "sign-glyph": this.settings.includeSignGlyphs ? (SIGN_GLYPHS[sign] || "") : "",
                },
            },
            {
                start: mid, end: containerEnd,
                tokens: {
                    year: String(mid.getFullYear()),
                    month: String(mid.getMonth() + 1).padStart(2, "0"),
                    "month-name": monthName(mid),
                    day: String(mid.getDate()).padStart(2, "0"),
                    date: formatDate(mid),
                    term: term.minor.en, "term-cn": term.minor.cn,
                    sign: this.settings.includeSignGlyphs ? sign : "",
                    "sign-glyph": this.settings.includeSignGlyphs ? (SIGN_GLYPHS[sign] || "") : "",
                },
            },
        ];
    }

    // ─── Token resolution ───

    resolveTokens(str, tokens) {
        return str.replace(/\{\{([\w-]+)\}\}/g, (_, key) => {
            return tokens[key] !== undefined ? tokens[key] : "";
        });
    }

    // ─── Template loading ───

    async loadTemplate(templatePath) {
        if (!templatePath) return "";
        const file = this.app.vault.getAbstractFileByPath(templatePath);
        if (!file || !(file instanceof TFile)) {
            new Notice(`Template not found: ${templatePath}`);
            return "";
        }
        return await this.app.vault.read(file);
    }

    // ─── Note generation ───

    async generateNote(type, tokens, meta) {
        const isContainer = type === "container";
        const templatePath = isContainer ? this.settings.containerTemplate : this.settings.subdivisionTemplate;
        const folder = isContainer ? this.settings.containerFolder : this.settings.subdivisionFolder;
        const naming = this.getEffectiveNaming(type);

        const fileName = this.resolveTokens(naming, tokens);
        const folderPath = folder || "";
        const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;

        // Check if exists
        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing) {
            new Notice(`Note already exists: ${filePath}`);
            return existing;
        }

        // Ensure folder exists
        if (folderPath) {
            const folderFile = this.app.vault.getAbstractFileByPath(folderPath);
            if (!folderFile) {
                await this.app.vault.createFolder(folderPath);
            }
        }

        // Load and resolve template
        let content = await this.loadTemplate(templatePath);
        content = this.resolveTokens(content, tokens);

        // Add frontmatter metadata
        const fmFields = {
            "mr-type": type,
            "mr-mode": this.settings.mode,
            "mr-start": meta.start,
            "mr-end": meta.end,
        };
        content = mergeFrontmatter(content, fmFields);

        const file = await this.app.vault.create(filePath, content);
        new Notice(`Created: ${fileName}`);
        return file;
    }

    async generateContainer() {
        const mode = this.settings.mode;
        try {
            let data;
            if (mode === "calendar") {
                data = this.getCalendarContainerData();
            } else if (mode === "moon") {
                if (!this.hasMoonPlugin()) { new Notice("Requires Moon Phase plugin."); return; }
                data = await this.getLunarContainerData();
            } else {
                if (!this.hasMoonPlugin()) { new Notice("Requires Moon Phase plugin."); return; }
                data = await this.getSolarContainerData();
            }
            await this.generateNote("container", data.tokens, {
                start: formatDate(data.start),
                end: formatDate(data.end),
            });
        } catch (e) {
            new Notice("Error generating container note: " + e.message);
            console.error("Monthly Ritual:", e);
        }
    }

    async generateSubdivision() {
        const mode = this.settings.mode;
        try {
            let data;
            if (mode === "calendar") {
                data = this.getCurrentWeekData();
            } else if (mode === "moon") {
                if (!this.hasMoonPlugin()) { new Notice("Requires Moon Phase plugin."); return; }
                data = await this.getCurrentPhaseData();
            } else {
                if (!this.hasMoonPlugin()) { new Notice("Requires Moon Phase plugin."); return; }
                // For solar, determine which term we're in
                const container = await this.getSolarContainerData();
                const subs = await this.getSolarSubdivisions(container.start, container.end, container.sign);
                const now = new Date();
                data = subs.find(s => now >= s.start && now <= s.end) || subs[0];
                if (!data) { new Notice("Could not determine current solar term."); return; }
            }
            await this.generateNote("subdivision", data.tokens, {
                start: formatDate(data.start),
                end: formatDate(data.end),
            });
        } catch (e) {
            new Notice("Error generating subdivision note: " + e.message);
            console.error("Monthly Ritual:", e);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  PERIODIC RITUAL — Container generation (Phase 1+)
    // ═══════════════════════════════════════════════════════════════

    // Boundary detector dispatcher. Phase 1 only handles calendar-week.
    // Later phases add: calendar-month, sun-ingress, lunar-phase, lunar-cycle, chapter, book.
    getPRBoundaryData(detector, date) {
        const d = date || new Date();
        switch (detector) {
            case "calendar-week":
                return this.getCurrentWeekData(d);
            default:
                throw new Error(`Boundary detector "${detector}" is not implemented yet`);
        }
    }

    // List of detectors available in the current build, for the settings dropdown.
    // Adding a phase = adding an entry here + a case in getPRBoundaryData.
    getPRAvailableBoundaryDetectors() {
        return [
            { id: "calendar-week", label: "Calendar Week" },
        ];
    }

    // Generate a single container note from its config.
    // Reads template, resolves tokens, writes file. No daily aggregation, no LLM.
    async generatePRContainerNote(container, dateOverride) {
        if (!container) { new Notice("No container provided"); return; }
        if (!container.template) {
            new Notice(`${container.name}: no template configured`);
            return;
        }
        if (!container.naming) {
            new Notice(`${container.name}: no naming convention configured`);
            return;
        }

        try {
            const data = this.getPRBoundaryData(container.boundaryDetector, dateOverride);
            const fileName = this.resolveTokens(container.naming, data.tokens);
            const folderPath = container.saveDir || "";
            const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;

            // Don't clobber an existing note. Phase 3 will track last-generated
            // timestamps so auto-generation skips duplicates without surfacing them.
            const existing = this.app.vault.getAbstractFileByPath(filePath);
            if (existing) {
                new Notice(`Already exists: ${filePath}`);
                return existing;
            }

            // Ensure save directory exists
            if (folderPath) {
                const folderFile = this.app.vault.getAbstractFileByPath(folderPath);
                if (!folderFile) {
                    await this.app.vault.createFolder(folderPath);
                }
            }

            // Load template, resolve our naming tokens, then resolve Obsidian
            // core Templates plugin tokens ({{title}}, {{date:FORMAT}}, etc.).
            // Templater tags (<% ... %>) are left untouched — Templater
            // processes them after the file is created and opened.
            let content = await this.loadTemplate(container.template);
            content = this.resolveTokens(content, data.tokens);
            content = resolveCoreTemplateTokens(content, fileName);

            // Stamp Periodic Ritual metadata so future phases can find these
            // notes again. Placement is per-container — frontmatter, inline,
            // or none. See applyPRMetadata for details.
            const fields = {
                id: container.id,
                boundary: container.boundaryDetector,
                start: formatDate(data.start),
                end: formatDate(data.end),
            };
            content = applyPRMetadata(
                content,
                container.metadataPlacement || "frontmatter",
                container.metadataInlineKey || "periodic-ritual",
                fields
            );

            const file = await this.app.vault.create(filePath, content);

            // Open the new file. Two reasons:
            //  1. The user clicked "Generate" — they expect to see the result.
            //  2. Templater scripts in the template that read
            //     app.workspace.getActiveFile() (instead of tp.file) will
            //     otherwise see whatever file was active when Generate was
            //     clicked, and fail with "wrong filename" errors.
            try {
                const leaf = this.app.workspace.getLeaf(false);
                await leaf.openFile(file);
            } catch (e) {
                console.error("Periodic Ritual: failed to open generated file", e);
            }

            new Notice(`Created: ${fileName}`);

            // Phase 2: LLM aggregation. If the container has both a service
            // and a system prompt configured, run the aggregation pass and
            // merge the parsed YAML response into the file's frontmatter.
            // Skipped silently when not configured — Phase 1 behavior is
            // preserved for containers without LLM setup.
            if (container.llmServiceId && container.systemPromptFile) {
                await this.runPRLLMAggregation(container, file, {
                    start: data.start,
                    end: data.end,
                });
            }

            return file;
        } catch (e) {
            new Notice(`Error generating ${container.name}: ${e.message}`);
            console.error("Periodic Ritual:", e);
        }
    }

    // ─── Periodic Ritual LLM aggregation (Phase 2) ───

    getPRLLMService(id) {
        return (this.settings.prLLMServices || []).find(s => s.id === id);
    }

    // Build a single string payload from all daily notes in [start, end].
    // Each daily becomes a section with its frontmatter and inline fields.
    // Body content is intentionally excluded — the user's templates have
    // huge dataview blocks that aren't useful to the LLM and would burn
    // tokens. If the user wants the LLM to see body content, we add a
    // setting later. Phase 2 ships with frontmatter + inline fields only.
    async buildPRDailyPayload(start, end) {
        // Inclusive end-of-day for the range
        const endInclusive = new Date(end);
        endInclusive.setHours(23, 59, 59, 999);

        const dailies = this.findDailyNotesInRange(start, endInclusive);
        if (dailies.length === 0) {
            return { count: 0, text: "(no daily notes in range)" };
        }

        const sections = [];
        for (const file of dailies) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};
            const content = await this.app.vault.read(file);

            // Strip the YAML block before scanning for inline fields
            const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");

            // Pull `key:: value` inline fields from the body
            const inlineFields = {};
            const inlineRegex = /^([a-zA-Z0-9_-]+)::\s*(.+)$/gm;
            let m;
            while ((m = inlineRegex.exec(body)) !== null) {
                const k = m[1];
                const v = m[2].trim();
                if (!v) continue;
                inlineFields[k] = inlineFields[k] ? `${inlineFields[k]} | ${v}` : v;
            }

            const lines = [`## ${file.basename}`];
            for (const [k, v] of Object.entries(fm)) {
                // Skip plugin-internal and Obsidian-internal frontmatter keys
                if (k === "periodic-ritual" || k === "position") continue;
                if (v === null || v === undefined) continue;
                if (typeof v === "object") continue;
                lines.push(`${k}: ${v}`);
            }
            for (const [k, v] of Object.entries(inlineFields)) {
                lines.push(`${k}:: ${v}`);
            }
            sections.push(lines.join("\n"));
        }

        return { count: dailies.length, text: sections.join("\n\n---\n\n") };
    }

    // Try to extract a YAML object from an LLM response. Strips fenced code
    // blocks if present. Falls back to writing the whole response into a
    // single `pr-llm-raw` field so the user always sees what came back.
    parsePRLLMResponse(response) {
        if (!response) return { "pr-llm-raw": "(empty response)" };

        // Strip a fenced ```yaml ... ``` block if present
        const fenceMatch = response.match(/```(?:ya?ml)?\s*\n?([\s\S]*?)```/);
        const yamlText = fenceMatch ? fenceMatch[1].trim() : response.trim();

        // Strip leading `---` and trailing `---` if the model wrapped its
        // output in YAML document markers
        const stripped = yamlText
            .replace(/^---\s*\n/, "")
            .replace(/\n---\s*$/, "");

        try {
            const parsed = parseYaml(stripped);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }
            return { "pr-llm-raw": response };
        } catch (e) {
            console.warn("Periodic Ritual: YAML parse failed", e);
            return { "pr-llm-raw": response };
        }
    }

    async runPRLLMAggregation(container, file, range) {
        const service = this.getPRLLMService(container.llmServiceId);
        if (!service) {
            new Notice(`${container.name}: LLM service not found`);
            return;
        }
        if (!service.apiKey || !service.model) {
            new Notice(`${container.name}: LLM service "${service.name}" is missing API key or model`);
            return;
        }

        // Read the system prompt MD file
        let systemPrompt = "";
        try {
            const promptFile = this.app.vault.getAbstractFileByPath(container.systemPromptFile);
            if (!promptFile || !(promptFile instanceof TFile)) {
                new Notice(`${container.name}: system prompt file not found: ${container.systemPromptFile}`);
                return;
            }
            systemPrompt = await this.app.vault.read(promptFile);
        } catch (e) {
            new Notice(`${container.name}: failed to read system prompt — ${e.message}`);
            return;
        }

        // Build the daily payload
        const payload = await this.buildPRDailyPayload(range.start, range.end);

        // Compose the user message
        const userMessage = [
            `# Period`,
            `start: ${formatDate(range.start)}`,
            `end: ${formatDate(range.end)}`,
            `daily_count: ${payload.count}`,
            "",
            `# Daily notes`,
            "",
            payload.text,
        ].join("\n");

        // Call the LLM
        const provider = PROVIDERS[service.provider];
        if (!provider) {
            new Notice(`${container.name}: unknown provider "${service.provider}"`);
            return;
        }

        let responseText;
        try {
            new Notice(`${container.name}: aggregating ${payload.count} daily note(s) via ${service.name}…`);
            const url = provider.buildUrl(service);
            const body = provider.buildBody(userMessage, service, systemPrompt);
            const headers = {
                "Content-Type": "application/json",
                ...(provider.headers ? provider.headers(service) : {}),
            };
            // requestUrl bypasses CORS — required for local providers like
            // LM Studio and OpenClaw whose servers don't return CORS headers.
            const r = await requestUrl({
                url,
                method: "POST",
                headers,
                body: JSON.stringify(body),
                throw: false,
            });
            if (r.status < 200 || r.status >= 300) {
                throw new Error(`${r.status}: ${(r.text || "").slice(0, 300)}`);
            }
            responseText = provider.extractText(r.json);
        } catch (e) {
            new Notice(`${container.name}: LLM call failed — ${e.message}`);
            console.error("Periodic Ritual LLM error:", e);
            return;
        }

        if (!responseText) {
            new Notice(`${container.name}: LLM returned an empty response`);
            return;
        }

        // Parse YAML and merge into frontmatter
        const parsed = this.parsePRLLMResponse(responseText);
        const keys = Object.keys(parsed);
        if (keys.length === 0) {
            new Notice(`${container.name}: LLM response had no fields to write`);
            return;
        }

        try {
            await this.app.fileManager.processFrontMatter(file, fm => {
                for (const k of keys) fm[k] = parsed[k];
            });
            new Notice(`${container.name}: wrote ${keys.length} field(s) from LLM`);
        } catch (e) {
            new Notice(`${container.name}: failed to write frontmatter — ${e.message}`);
            console.error("Periodic Ritual processFrontMatter error:", e);
        }
    }

    // ─── Field pipeline ───

    findDailyNotesInRange(start, end) {
        const folder = this.settings.dailyNotesFolder || "";
        return this.app.vault.getMarkdownFiles()
            .filter(f => {
                if (folder && !f.path.startsWith(folder + "/") && f.parent?.path !== folder) return false;
                const d = parseDateFromFilename(f.name);
                if (!d) return false;
                return d >= start && d <= end;
            })
            .sort((a, b) => parseDateFromFilename(a.name) - parseDateFromFilename(b.name));
    }

    findNotesOfType(type) {
        return this.app.vault.getMarkdownFiles().filter(f => {
            const cache = this.app.metadataCache.getFileCache(f);
            return cache?.frontmatter?.["mr-type"] === type && cache?.frontmatter?.["mr-mode"] === this.settings.mode;
        });
    }

    findSubdivisionNotesInRange(start, end) {
        const folder = this.settings.subdivisionFolder || "";
        return this.app.vault.getMarkdownFiles()
            .filter(f => {
                if (folder && !f.path.startsWith(folder + "/") && f.parent?.path !== folder) return false;
                const cache = this.app.metadataCache.getFileCache(f);
                const fm = cache?.frontmatter;
                if (fm?.["mr-type"] !== "subdivision" || fm?.["mr-mode"] !== this.settings.mode) return false;
                const noteStart = new Date(fm["mr-start"]);
                return noteStart >= start && noteStart <= end;
            })
            .sort((a, b) => {
                const fmA = this.app.metadataCache.getFileCache(a)?.frontmatter;
                const fmB = this.app.metadataCache.getFileCache(b)?.frontmatter;
                return new Date(fmA?.["mr-start"] || 0) - new Date(fmB?.["mr-start"] || 0);
            });
    }

    async readField(file, fieldName, fieldType) {
        if (fieldType === "frontmatter") {
            const cache = this.app.metadataCache.getFileCache(file);
            const val = cache?.frontmatter?.[fieldName];
            return val !== undefined ? String(val) : "";
        }
        const content = await this.app.vault.read(file);
        const regex = new RegExp(`\\b${escapeRegex(fieldName)}::(.*)`, "m");
        const match = content.match(regex);
        return match ? match[1].trim() : "";
    }

    async writeCollectedField(file, fieldName, values, fieldType) {
        const collected = values.filter(v => v).join(" | ");
        if (!collected) return;

        let content = await this.app.vault.read(file);

        if (fieldType === "frontmatter") {
            const fmRegex = new RegExp(`(^${escapeRegex(fieldName)}:\\s*)(.*)`, "m");
            if (fmRegex.test(content)) {
                content = content.replace(fmRegex, `$1${collected}`);
            } else {
                const fmEnd = content.indexOf("\n---", content.indexOf("---") + 3);
                if (fmEnd !== -1) {
                    content = content.slice(0, fmEnd) + `\n${fieldName}: ${collected}` + content.slice(fmEnd);
                } else {
                    content = content.trimEnd() + `\n${fieldName}:: ${collected}\n`;
                }
            }
        } else {
            const regex = new RegExp(`(\\b${escapeRegex(fieldName)}::)(.*)`, "m");
            if (regex.test(content)) {
                content = content.replace(regex, `$1 ${collected}`);
            } else {
                content = content.trimEnd() + `\n${fieldName}:: ${collected}\n`;
            }
        }

        await this.app.vault.modify(file, content);
    }

    async collectFields() {
        const file = this.app.workspace.getActiveFile();
        if (!file) { new Notice("No active file."); return; }

        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm?.["mr-type"]) {
            new Notice("This doesn't appear to be a Monthly Ritual note.");
            return;
        }

        const noteType = fm["mr-type"];
        const start = new Date(fm["mr-start"]);
        const end = new Date(fm["mr-end"]);
        // Extend end to end of day for inclusive matching
        end.setHours(23, 59, 59, 999);

        if (noteType === "subdivision") {
            const mappings = this.settings.dailyToSubFields || [];
            if (mappings.length === 0) { new Notice("No daily-to-subdivision field mappings configured."); return; }

            const dailyNotes = this.findDailyNotesInRange(start, end);
            if (dailyNotes.length === 0) { new Notice("No daily notes found in this date range."); return; }

            for (const mapping of mappings) {
                const values = [];
                for (const dn of dailyNotes) {
                    const val = await this.readField(dn, mapping.source, mapping.type || "inline");
                    if (val) values.push(val);
                }
                await this.writeCollectedField(file, mapping.source, values, mapping.type || "inline");
            }
            new Notice(`Collected fields from ${dailyNotes.length} daily notes.`);

        } else if (noteType === "container") {
            const mappings = this.settings.subToContainerFields || [];
            if (mappings.length === 0) { new Notice("No subdivision-to-container field mappings configured."); return; }

            const subNotes = this.findSubdivisionNotesInRange(start, end);
            if (subNotes.length === 0) { new Notice("No subdivision notes found in this date range."); return; }

            for (const mapping of mappings) {
                const values = [];
                for (const sn of subNotes) {
                    const val = await this.readField(sn, mapping.source, mapping.type || "inline");
                    if (val) values.push(val);
                }
                await this.writeCollectedField(file, mapping.source, values, mapping.type || "inline");
            }
            new Notice(`Collected fields from ${subNotes.length} subdivision notes.`);
        }
    }

    // ─── Reflection ───

    findPreviousNote(type) {
        const file = this.app.workspace.getActiveFile();
        if (!file) return null;

        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm?.["mr-start"]) return null;

        const currentStart = new Date(fm["mr-start"]);
        const notes = this.findNotesOfType(type);

        let closest = null;
        let closestDate = null;

        for (const n of notes) {
            if (n.path === file.path) continue;
            const nCache = this.app.metadataCache.getFileCache(n);
            const nStart = new Date(nCache?.frontmatter?.["mr-start"]);
            if (nStart < currentStart && (!closestDate || nStart > closestDate)) {
                closest = n;
                closestDate = nStart;
            }
        }

        return closest;
    }

    async loadInjectedVars(questions, noteType) {
        const vars = [];
        for (const q of questions) {
            if (!q.injectVar || !q.varField) { vars.push(""); continue; }
            let sourceFile = null;
            if (q.varSource === "previous") {
                sourceFile = this.findPreviousNote(noteType);
            } else if (q.varSource === "note" && q.varNotePath) {
                sourceFile = this.app.vault.getAbstractFileByPath(q.varNotePath);
            }
            if (sourceFile && sourceFile instanceof TFile) {
                vars.push(await this.readField(sourceFile, q.varField, "inline"));
            } else {
                vars.push("");
            }
        }
        return vars;
    }

    buildStructuredReflection(questions, answers) {
        return questions.map((q, i) => `**Q${i + 1}: ${q.text}**\n${answers[i].trim()}`).join("\n\n");
    }

    async getSystemPromptContent(config) {
        if (config.systemPromptFile) {
            const file = this.app.vault.getAbstractFileByPath(config.systemPromptFile);
            if (file && file instanceof TFile) return await this.app.vault.read(file);
            new Notice(`System prompt file not found: ${config.systemPromptFile}`);
        }
        return "";
    }

    async buildContextData(config, file) {
        if (config.dataPassThrough === "whole-note") {
            return await this.app.vault.read(file);
        }
        if (config.dataPassThrough === "selected-fields") {
            const fields = config.selectedFields || [];
            const parts = [];
            for (const f of fields) {
                const val = await this.readField(file, f, "inline");
                if (val) parts.push(`${f}:: ${val}`);
            }
            return parts.join("\n");
        }
        return "";
    }

    async buildPromptParts(structured, config, contextData) {
        const provider = PROVIDERS[this.settings.provider];
        if (!provider) throw new Error(`Unknown provider: ${this.settings.provider}`);

        const modelContext = await this.getSystemPromptContent(config);
        const systemInstructions = config.systemPromptPrepend?.trim() || "Summarize this reflection concisely, capturing the core insights.";

        const promptParts = [
            "## Mental Model (apply this lens to the reflection below)",
            modelContext || "(no system prompt file selected)",
            "---",
            "## My Reflection",
            structured,
        ];

        if (contextData) {
            promptParts.push("---", "## Context Data", contextData);
        }

        promptParts.push("---", "Now follow the system instructions above precisely. Produce only the final output, nothing else.");

        const userPrompt = promptParts.join("\n\n");
        const url = provider.buildUrl(this.settings);
        const body = provider.buildBody(userPrompt, this.settings, systemInstructions);
        const headers = { "Content-Type": "application/json", ...(provider.headers ? provider.headers(this.settings) : {}) };

        return { provider, url, body, headers, systemPrompt: modelContext, prepend: systemInstructions, userPrompt };
    }

    async callLLM(structured, config, contextData) {
        const parts = await this.buildPromptParts(structured, config, contextData);
        const response = await fetch(parts.url, {
            method: "POST",
            headers: parts.headers,
            body: JSON.stringify(parts.body),
        });
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`${response.status}: ${errText}`);
        }
        const data = await response.json();
        return parts.provider.extractText(data);
    }

    async writeFieldToFile(file, fieldName, value, fieldType) {
        let content = await this.app.vault.read(file);

        if (fieldType === "frontmatter") {
            const fmRegex = new RegExp(`(^${escapeRegex(fieldName)}:\\s*)(.*)`, "m");
            if (fmRegex.test(content)) {
                content = content.replace(fmRegex, `$1${value}`);
            } else {
                const fmEnd = content.indexOf("\n---", content.indexOf("---") + 3);
                if (fmEnd !== -1) {
                    content = content.slice(0, fmEnd) + `\n${fieldName}: ${value}` + content.slice(fmEnd);
                } else {
                    content = `---\n${fieldName}: ${value}\n---\n` + content;
                }
            }
        } else {
            const regex = new RegExp(`(\\b${escapeRegex(fieldName)}::)(.*)`, "m");
            if (regex.test(content)) {
                content = content.replace(regex, `$1 ${value}`);
            } else {
                content = content.trimEnd() + `\n${fieldName}:: ${value}\n`;
            }
        }

        await this.app.vault.modify(file, content);
    }

    async runReflection(reflectionType) {
        const file = this.app.workspace.getActiveFile();
        if (!file) { new Notice("No active file."); return; }

        const isContainer = reflectionType === "container";
        const config = isContainer ? this.settings.containerReflection : this.settings.subdivisionReflection;
        const questions = config.questions || [];

        if (questions.length === 0) {
            new Notice(`No ${reflectionType} reflection questions configured.`);
            return;
        }

        // Verify the active file is the right type
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (fm?.["mr-type"] && fm["mr-type"] !== reflectionType) {
            new Notice(`This note is a ${fm["mr-type"]}, not a ${reflectionType}. Open the correct note type.`);
            return;
        }

        const injectedVars = await this.loadInjectedVars(questions, reflectionType);

        new ReflectionModal(this.app, questions, injectedVars, async (answers) => {
            // Write individual answers to their configured fields
            for (let i = 0; i < questions.length; i++) {
                const q = questions[i];
                if (!q.outputToField || !q.outputFieldName) continue;
                await this.writeFieldToFile(file, q.outputFieldName, answers[i].trim(), q.outputFieldType || "inline");
            }

            // LLM summary
            if (this.settings.llmEnabled && config.outputFieldName) {
                const structured = this.buildStructuredReflection(questions, answers);
                const contextData = await this.buildContextData(config, file);
                const loading = new LoadingModal(this.app);
                loading.open();
                try {
                    const summary = await this.callLLM(structured, config, contextData);
                    loading.close();
                    if (summary) {
                        await this.writeFieldToFile(file, config.outputFieldName, summary, config.outputFieldType || "inline");
                        new Notice("Reflection logged + summary written.");
                    } else {
                        new Notice("LLM returned empty. Reflection logged without summary.");
                    }
                } catch (e) {
                    loading.close();
                    new Notice("LLM error: " + e.message);
                    console.error("Monthly Ritual LLM:", e);
                }
            } else {
                new Notice("Reflection logged.");
            }
        }).open();
    }

    async runTestReflection(reflectionType) {
        if (!this.settings.llmEnabled) { new Notice("LLM is disabled. Enable it in settings."); return; }

        const isContainer = reflectionType === "container";
        const config = isContainer ? this.settings.containerReflection : this.settings.subdivisionReflection;
        const questions = config.questions || [];
        if (questions.length === 0) { new Notice("No questions configured."); return; }

        const injectedVars = await this.loadInjectedVars(questions, reflectionType);

        new ReflectionModal(this.app, questions, injectedVars, async (answers) => {
            const structured = this.buildStructuredReflection(questions, answers);
            const loading = new LoadingModal(this.app);
            loading.open();

            const debugData = {
                provider: `${PROVIDERS[this.settings.provider].name} (${this.settings.provider})`,
                model: this.settings.model,
                prepend: config.systemPromptPrepend?.trim() || "",
                structured,
            };

            try {
                const file = this.app.workspace.getActiveFile();
                const contextData = file ? await this.buildContextData(config, file) : "";
                const parts = await this.buildPromptParts(structured, config, contextData);
                debugData.systemPrompt = parts.systemPrompt;
                debugData.fullPrompt = JSON.stringify(parts.body, null, 2);
                const response = await fetch(parts.url, { method: "POST", headers: parts.headers, body: JSON.stringify(parts.body) });
                if (!response.ok) { debugData.error = `${response.status}: ${await response.text()}`; }
                else { const data = await response.json(); debugData.response = parts.provider.extractText(data) || "(empty response)"; }
            } catch (e) { debugData.error = e.message; }

            loading.close();
            new DebugModal(this.app, debugData).open();
        }).open();
    }

    // ─── Commands ───

    registerCommands() {
        const labels = this.getModeLabels();

        this.cmdGenerateContainer = this.addCommand({
            id: "generate-container",
            name: `Generate ${labels.containerNote}`,
            callback: () => this.generateContainer(),
        });

        this.cmdGenerateSubdivision = this.addCommand({
            id: "generate-subdivision",
            name: `Generate ${labels.subdivisionNote}`,
            callback: () => this.generateSubdivision(),
        });

        this.cmdContainerReflection = this.addCommand({
            id: "container-reflection",
            name: `${labels.container} Reflection`,
            callback: () => this.runReflection("container"),
        });

        this.cmdSubdivisionReflection = this.addCommand({
            id: "subdivision-reflection",
            name: `${labels.subdivision} Reflection`,
            callback: () => this.runReflection("subdivision"),
        });

        this.addCommand({
            id: "collect-fields",
            name: "Collect Fields",
            callback: () => this.collectFields(),
        });

        this.addCommand({
            id: "open-calendar",
            name: "Open Ritual Calendar",
            callback: () => this.activateCalendarView(),
        });

        this.cmdTestContainer = this.addCommand({
            id: "test-container-reflection",
            name: `Test ${labels.container} Reflection`,
            callback: () => this.runTestReflection("container"),
        });

        this.cmdTestSubdivision = this.addCommand({
            id: "test-subdivision-reflection",
            name: `Test ${labels.subdivision} Reflection`,
            callback: () => this.runTestReflection("subdivision"),
        });

        // ─── Periodic Ritual commands (Phase 1+) ───
        this.addCommand({
            id: "pr-generate-container",
            name: "Periodic Ritual: Generate container note",
            callback: () => this.pickAndGeneratePRContainer(),
        });
    }

    // Fuzzy picker over all configured PR containers (enabled or not).
    // Phase 3 will replace the manual call with auto-on-load behavior;
    // this command stays as a manual override.
    pickAndGeneratePRContainer() {
        const containers = this.settings.prContainers || [];
        if (containers.length === 0) {
            new Notice("No Periodic Ritual containers configured. Add one in Settings → Containers.");
            return;
        }
        const modal = new PRContainerPickerModal(this.app, containers, async (container) => {
            await this.generatePRContainerNote(container);
        });
        modal.open();
    }

    updateCommandNames() {
        const labels = this.getModeLabels();
        const cmds = this.app.commands?.commands;
        if (!cmds) return;
        const prefix = this.manifest.id + ":";
        const updates = {
            "generate-container": `Generate ${labels.containerNote}`,
            "generate-subdivision": `Generate ${labels.subdivisionNote}`,
            "container-reflection": `${labels.container} Reflection`,
            "subdivision-reflection": `${labels.subdivision} Reflection`,
            "test-container-reflection": `Test ${labels.container} Reflection`,
            "test-subdivision-reflection": `Test ${labels.subdivision} Reflection`,
        };
        for (const [id, name] of Object.entries(updates)) {
            const cmd = cmds[prefix + id];
            if (cmd) cmd.name = name;
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  CALENDAR VIEW
// ═══════════════════════════════════════════════════════════════

const CALENDAR_VIEW_TYPE = "monthly-ritual-calendar";

const MOON_PHASE_EMOJI = { "New Moon": "\u{1F311}", "First Quarter": "\u{1F313}", "Full Moon": "\u{1F315}", "Last Quarter": "\u{1F317}" };

// Approximate zodiac date ranges for solar term lookup without Helios
const ZODIAC_DATES = [
    { sign: "Aries",       start: [3, 20] },
    { sign: "Taurus",      start: [4, 19] },
    { sign: "Gemini",      start: [5, 20] },
    { sign: "Cancer",      start: [6, 21] },
    { sign: "Leo",         start: [7, 22] },
    { sign: "Virgo",       start: [8, 22] },
    { sign: "Libra",       start: [9, 22] },
    { sign: "Scorpio",     start: [10, 23] },
    { sign: "Sagittarius", start: [11, 21] },
    { sign: "Capricorn",   start: [12, 21] },
    { sign: "Aquarius",    start: [1, 19] },
    { sign: "Pisces",      start: [2, 18] },
];

function getWordCount(text) {
    const pattern = /(?:[0-9]+(?:(?:,|\.)[0-9]+)*|[\-A-Za-z\u00C0-\u024F\u0400-\u04FF])+|[\u3041-\u9FFF\uF900-\uFAFF]/g;
    return (text.match(pattern) || []).length;
}

// Build zodiac sign boundaries for a given year (and neighbours)
function getZodiacSignDates(year) {
    const signs = [];
    for (let y = year - 1; y <= year + 1; y++) {
        for (const z of ZODIAC_DATES) {
            const [zm, zd] = z.start;
            signs.push({ date: new Date(y, zm - 1, zd), sign: z.sign });
        }
    }
    signs.sort((a, b) => a.date - b.date);
    return signs;
}

// Get the zodiac sign period (start, end, sign, terms) that covers a given date
function getZodiacSignPeriod(d) {
    const signs = getZodiacSignDates(d.getFullYear());
    for (let i = 0; i < signs.length - 1; i++) {
        if (d >= signs[i].date && d < signs[i + 1].date) {
            const sign = signs[i].sign;
            const term = SOLAR_TERMS[sign];
            return {
                sign,
                glyph: SIGN_GLYPHS[sign] || "",
                major: term ? term.major : null,
                minor: term ? term.minor : null,
                start: startOfDay(signs[i].date),
                end: startOfDay(addDays(signs[i + 1].date, -1)),
            };
        }
    }
    return null;
}

// Navigate to the next or previous zodiac sign from a reference date
function navigateZodiacSign(d, delta) {
    const signs = getZodiacSignDates(d.getFullYear());
    let idx = -1;
    for (let i = 0; i < signs.length - 1; i++) {
        if (d >= signs[i].date && d < signs[i + 1].date) {
            idx = i;
            break;
        }
    }
    if (idx === -1) return d;
    const target = idx + delta;
    if (target >= 0 && target < signs.length) {
        return signs[target].date;
    }
    return d;
}

// Reference new moon for synodic calculation: Jan 6, 2000 18:14 UTC
const REF_NEW_MOON = new Date(Date.UTC(2000, 0, 6, 18, 14, 0));

function getMoonAgeForDate(d) {
    const diff = (d.getTime() - REF_NEW_MOON.getTime()) / 86400000;
    const age = diff % SYNODIC_PERIOD;
    return age < 0 ? age + SYNODIC_PERIOD : age;
}

function getMoonPhaseFromAge(age) {
    const q = SYNODIC_PERIOD / 4;
    if (age < q) return "New Moon";
    if (age < 2 * q) return "First Quarter";
    if (age < 3 * q) return "Full Moon";
    return "Last Quarter";
}

// Build a sign lookup from Helios moon ingresses: returns function(date) → sign name
async function buildMoonSignLookup(plugin, rangeStart, rangeEnd) {
    const url = plugin.getHeliosUrl();
    if (!url) return () => null;
    try {
        const start = formatDate(addDays(rangeStart, -3));
        const end = formatDate(addDays(rangeEnd, 3));
        const data = await plugin.fetchJson(`${url}/planetary-ingresses?planet=Moon&start=${start}&end=${end}`);
        const ingresses = (Array.isArray(data) ? data : data.ingresses || [])
            .map(ing => ({ date: new Date(ing.date || ing.exactDate || ing.timestamp), sign: ing.sign || ing.toSign || "" }))
            .sort((a, b) => a.date - b.date);

        return function(d) {
            let sign = ingresses.length > 0 ? ingresses[0].sign : null;
            for (const ing of ingresses) {
                if (ing.date <= d) sign = ing.sign;
                else break;
            }
            return sign;
        };
    } catch (_) {
        return () => null;
    }
}

// Get exact phase periods from Helios /moon-phases endpoint
async function getPhasePeriodsFromHelios(plugin, rangeStart, rangeEnd) {
    const url = plugin.getHeliosUrl();
    if (!url) return [];

    // Extend range to catch phases that start before/after
    const start = formatDate(addDays(rangeStart, -10));
    const end = formatDate(addDays(rangeEnd, 10));

    try {
        const data = await plugin.fetchJson(`${url}/moon-phases?start=${start}&end=${end}`);
        const phaseList = data.phases || [];

        if (phaseList.length === 0) return [];

        // Build phase starts with their sign data
        const starts = phaseList.map(p => ({
            phase: p.phase,
            start: startOfDay(new Date(p.date)),
            moonSign: p.moonSign,
        }));
        starts.sort((a, b) => a.start - b.start);

        // Each phase ends the day before the next phase starts
        const periods = [];
        for (let i = 0; i < starts.length - 1; i++) {
            periods.push({
                phase: starts[i].phase,
                start: starts[i].start,
                end: addDays(starts[i + 1].start, -1),
                moonSign: starts[i].moonSign,
            });
        }

        return periods;
    } catch (e) {
        console.error("Monthly Ritual: /moon-phases failed:", e.message);
        new Notice("Could not fetch moon phases from Helios. Is /moon-phases endpoint available?");
        return [];
    }
}

class RitualCalendarView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.displayDate = new Date();
    }

    getViewType() { return CALENDAR_VIEW_TYPE; }
    getDisplayText() { return "Ritual Calendar"; }
    getIcon() { return "calendar-days"; }

    async onOpen() {
        this.containerEl.children[1].empty();
        this.rootEl = this.containerEl.children[1].createDiv({ cls: "mr-calendar" });
        await this.render();
    }

    onClose() { return Promise.resolve(); }

    async render() {
        const el = this.rootEl;
        el.empty();

        // ─── Require Moon Phase plugin ───
        if (!this.plugin.hasMoonPlugin()) {
            el.createEl("p", { text: "Requires Moon Phase plugin.", cls: "mr-cal-empty" });
            return;
        }

        const today = new Date();

        // ─── Zodiac sign as container ───
        const signPeriod = getZodiacSignPeriod(this.displayDate);
        if (!signPeriod) {
            el.createEl("p", { text: "Could not determine zodiac sign." });
            return;
        }

        // ─── Header ───
        const header = el.createDiv({ cls: "mr-cal-header" });
        const titleEl = header.createDiv({ cls: "mr-cal-title mr-cal-title-link" });
        titleEl.createEl("span", { text: `${signPeriod.glyph} ${signPeriod.sign}`, cls: "mr-cal-term" });
        titleEl.createEl("span", { text: ` ${signPeriod.start.getFullYear()}`, cls: "mr-cal-year" });
        titleEl.addEventListener("click", () => this.openSignNote(signPeriod));

        const nav = header.createDiv({ cls: "mr-cal-nav" });
        const prevBtn = nav.createEl("span", { text: "\u276E", cls: "mr-cal-nav-btn" });
        prevBtn.addEventListener("click", () => this.navigateSign(-1));
        const todayBtn = nav.createEl("span", { text: "TODAY", cls: "mr-cal-nav-today" });
        todayBtn.addEventListener("click", () => this.goToday());
        const nextBtn = nav.createEl("span", { text: "\u276F", cls: "mr-cal-nav-btn" });
        nextBtn.addEventListener("click", () => this.navigateSign(1));

        // ─── Minor solar term (Sun at 15° of sign) ───
        // Sun traverses ~30° per sign. The sign's total days / 30 gives days per degree.
        // 15° falls at roughly (15/30) of the way through the sign period.
        const signDays = Math.round((signPeriod.end - signPeriod.start) / 86400000) + 1;
        const minorTermDate = formatDate(addDays(signPeriod.start, Math.round(signDays * 15 / 30)));

        // ─── Phase periods from Helios (exact ephemeris) ───
        const allPhases = await getPhasePeriodsFromHelios(this.plugin, signPeriod.start, signPeriod.end);

        // Filter phases that overlap with zodiac sign — keep full phase days
        const phases = allPhases.filter(p => p.end >= signPeriod.start && p.start <= signPeriod.end);

        // ─── Render phase rows ───
        const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const container = el.createDiv({ cls: "mr-cal-phases" });

        for (const period of phases) {
            const sign = period.moonSign || "";
            const signGlyph = sign ? (SIGN_GLYPHS[sign] || "") : "";
            const phaseEmoji = MOON_PHASE_EMOJI[period.phase] || "";

            // Collect ALL days in this phase (not clamped)
            const days = [];
            for (let d = new Date(period.start); d <= period.end; d = addDays(d, 1)) {
                days.push(new Date(d));
            }

            const row = container.createDiv({ cls: "mr-cal-phase-row" });

            // Moon emoji cell
            const moonCell = row.createDiv({ cls: "mr-cal-moon" });
            const moonSpan = moonCell.createEl("span", {
                text: phaseEmoji,
                cls: "mr-cal-moon-link",
            });
            const tooltip = moonCell.createDiv({ cls: "mr-cal-tooltip", text: `${signGlyph} ${phaseEmoji}` });
            moonSpan.addEventListener("mouseenter", () => { tooltip.classList.add("mr-cal-tooltip-visible"); });
            moonSpan.addEventListener("mouseleave", () => { tooltip.classList.remove("mr-cal-tooltip-visible"); });
            moonSpan.addEventListener("click", () => this.openLunarNote(period.phase, sign));

            // Day cells in a single row
            const dayRow = row.createDiv({ cls: "mr-cal-days" });
            for (const d of days) {
                const isToday = d.getDate() === today.getDate() &&
                    d.getMonth() === today.getMonth() &&
                    d.getFullYear() === today.getFullYear();
                const outsideSign = d < signPeriod.start || d > signPeriod.end;

                const cellCls = ["mr-cal-day"];
                if (isToday) cellCls.push("mr-cal-today");
                if (outsideSign) cellCls.push("mr-cal-dim");

                const cell = dayRow.createDiv({ cls: cellCls.join(" ") });
                cell.createDiv({ text: DOW_SHORT[d.getDay()], cls: "mr-cal-dow" });
                const dateStr = formatDate(d);
                const dayNumEl = cell.createDiv({ text: String(d.getDate()), cls: "mr-cal-day-num" });
                if (dateStr === minorTermDate) dayNumEl.classList.add("mr-cal-minor-term");
                cell.addEventListener("click", () => this.openDailyNote(dateStr));
            }
        }
    }

    async buildDailyNoteMap(rangeStart, rangeEnd) {
        const map = new Map();
        const folder = this.plugin.settings.dailyNotesFolder || "";
        const wordsPerDot = this.plugin.settings.wordsPerDot || 1000;
        const files = this.plugin.app.vault.getMarkdownFiles().filter(f => {
            if (folder && !f.path.startsWith(folder + "/") && f.parent?.path !== folder) return false;
            const d = parseDateFromFilename(f.name);
            if (!d) return false;
            return d >= startOfDay(rangeStart) && d <= startOfDay(addDays(rangeEnd, 1));
        });

        for (const file of files) {
            const d = parseDateFromFilename(file.name);
            if (!d) continue;
            const dateStr = formatDate(d);
            try {
                const content = await this.plugin.app.vault.cachedRead(file);
                const wc = getWordCount(content);
                const dots = wc > 0 ? Math.min(Math.floor(wc / wordsPerDot), 5) : 0;
                map.set(dateStr, { file, dots });
            } catch (_) {
                map.set(dateStr, { file, dots: 0 });
            }
        }
        return map;
    }

    async openDailyNote(dateStr) {
        const folder = this.plugin.settings.dailyNotesFolder || "";
        const files = this.plugin.app.vault.getMarkdownFiles().filter(f => {
            if (folder && !f.path.startsWith(folder + "/") && f.parent?.path !== folder) return false;
            const d = parseDateFromFilename(f.name);
            return d && formatDate(d) === dateStr;
        });
        if (files.length > 0) {
            await this.plugin.app.workspace.getLeaf(false).openFile(files[0]);
        } else {
            new Notice(`No daily note found for ${dateStr}`);
        }
    }

    resolveCalendarNoteName(naming, tokens) {
        return naming.replace(/\{\{([\w-]+)\}\}/g, (_, key) => tokens[key] !== undefined ? tokens[key] : "");
    }

    async openSignNote(signPeriod) {
        const naming = this.plugin.settings.calendarNoteNaming || "\u2600\uFE0F Sun in {{sign}}";
        const fileName = this.resolveCalendarNoteName(naming, { sign: signPeriod.sign, glyph: signPeriod.glyph, year: String(signPeriod.start.getFullYear()) });
        const folder = this.plugin.settings.calendarNoteFolder || "";
        const filePath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;

        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file && file instanceof TFile) {
            await this.plugin.app.workspace.getLeaf(false).openFile(file);
        } else {
            new Notice(`No note found: ${filePath}`);
        }
    }

    async openLunarNote(phase, moonSign) {
        const namingMap = this.plugin.settings.lunarNoteNaming || {};
        const naming = namingMap[phase] || `${MOON_PHASE_EMOJI[phase] || ""} {{phase-name}} Moon in {{moon-sign}}`;
        const fileName = this.resolveCalendarNoteName(naming, {
            "phase-name": phase.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
            "phase-emoji": MOON_PHASE_EMOJI[phase] || "",
            "moon-sign": moonSign || "",
            "moon-glyph": moonSign ? (SIGN_GLYPHS[moonSign] || "") : "",
        });
        const folder = this.plugin.settings.calendarNoteFolder || "";
        const filePath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;

        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file && file instanceof TFile) {
            await this.plugin.app.workspace.getLeaf(false).openFile(file);
        } else {
            new Notice(`No note found: ${filePath}`);
        }
    }

    navigateSign(delta) {
        this.displayDate = navigateZodiacSign(this.displayDate, delta);
        this.render();
    }

    goToday() {
        this.displayDate = new Date();
        this.render();
    }
}

// ═══════════════════════════════════════════════════════════════
//  SETTINGS TAB
// ═══════════════════════════════════════════════════════════════

class MonthlyRitualSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.reflectionTab = "container";
        this.expandedInput = {};
        this.expandedOutput = {};
        // Outer tab for Periodic Ritual rebuild. Legacy is the default until
        // the new Containers/Alignments/LLM tabs have content.
        this.outerTab = "legacy";
    }

    // ─── New outer-tab dispatcher (Phase 0) ───
    // Wraps the existing settings UI under a "Legacy" tab without modifying it.
    // New tabs (Containers / Alignments / LLM / General) are stubs for now.
    display() {
        const { containerEl } = this;
        containerEl.empty();

        const tabs = [
            { id: "containers", label: "Containers" },
            { id: "alignments", label: "Alignments" },
            { id: "llm",        label: "LLM" },
            { id: "legacy",     label: "Existing" },
            { id: "general",    label: "General" },
        ];

        const bar = containerEl.createDiv({ cls: "mr-tab-bar mr-outer-tab-bar" });
        for (const t of tabs) {
            const btn = bar.createEl("button", {
                text: t.label,
                cls: "mr-tab" + (this.outerTab === t.id ? " mr-tab-active" : ""),
            });
            btn.addEventListener("click", () => {
                this.outerTab = t.id;
                this.display();
            });
        }

        const body = containerEl.createDiv({ cls: "mr-tab-content" });
        switch (this.outerTab) {
            case "containers":  this.displayContainersStub(body); break;
            case "alignments":  this.displayAlignmentsStub(body); break;
            case "llm":         this.displayLLMStub(body); break;
            case "general":     this.displayGeneral(body); break;
            case "legacy":
            default:            this.displayLegacySettings(body); break;
        }
    }

    // ─── Stubs for the new tabs (Phase 0) ───

    // Phase 1: Containers tab is real. Lists configured containers with
    // per-container template/save dir/naming inputs and a "Generate now"
    // button. No LLM, no auto-trigger — just template → tokens → file.
    displayContainersStub(containerEl) {
        const s = this.plugin.settings;
        if (!Array.isArray(s.prContainers)) s.prContainers = [];

        containerEl.createEl("h2", { text: "Containers" });

        const intro = containerEl.createEl("p");
        intro.style.cssText = "color: var(--text-muted); max-width: 60ch;";
        intro.setText("Each container is an independently configured periodic note type. Phase 1 supports Calendar Week. More boundary detectors land in later phases.");

        if (s.prContainers.length === 0) {
            const empty = containerEl.createEl("p");
            empty.style.cssText = "color: var(--text-faint); margin: 24px 0;";
            empty.setText("No containers yet. Click below to add one.");
        } else {
            for (let i = 0; i < s.prContainers.length; i++) {
                this.renderPRContainerCard(containerEl, s.prContainers[i], i);
            }
        }

        // Add button — restricted to Calendar Week in Phase 1
        const detectors = this.plugin.getPRAvailableBoundaryDetectors();
        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText("+ Add Calendar Week")
                .setCta()
                .onClick(async () => {
                    s.prContainers.push(makePRContainer({
                        name: "Calendar Week",
                        boundaryDetector: "calendar-week",
                        naming: "W{{week}}-{{year}}",
                    }));
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }

    renderPRContainerCard(parent, container, idx) {
        const s = this.plugin.settings;

        const card = parent.createDiv();
        card.style.cssText = "border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;";

        // ── Header row: name + enabled + delete ──
        const header = card.createDiv();
        header.style.cssText = "display: flex; align-items: center; gap: 12px; margin-bottom: 12px;";

        const nameInput = header.createEl("input", { type: "text", value: container.name || "" });
        nameInput.placeholder = "Container name";
        nameInput.style.cssText = "flex: 1; font-size: 1.05em; font-weight: 600; background: transparent; border: none; color: var(--text-normal); outline: none; border-bottom: 1px solid transparent; padding: 2px 0;";
        nameInput.addEventListener("focus", () => { nameInput.style.borderBottom = "1px solid var(--background-modifier-border)"; });
        nameInput.addEventListener("blur", () => { nameInput.style.borderBottom = "1px solid transparent"; });
        nameInput.addEventListener("change", async () => {
            container.name = nameInput.value;
            await this.plugin.saveSettings();
        });

        const enabledWrap = header.createDiv();
        enabledWrap.style.cssText = "display: flex; align-items: center; gap: 6px;";
        const enabledLabel = enabledWrap.createSpan({ text: "Enabled" });
        enabledLabel.style.cssText = "color: var(--text-muted); font-size: 0.85em;";
        const enabledInput = enabledWrap.createEl("input", { type: "checkbox" });
        enabledInput.checked = !!container.enabled;
        enabledInput.addEventListener("change", async () => {
            container.enabled = enabledInput.checked;
            await this.plugin.saveSettings();
        });

        const deleteBtn = header.createEl("button", { text: "×" });
        deleteBtn.title = "Delete container";
        deleteBtn.style.cssText = "background: none; border: none; color: var(--text-muted); font-size: 1.4em; cursor: pointer; padding: 0 6px; line-height: 1;";
        deleteBtn.addEventListener("click", async () => {
            s.prContainers.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
        });

        // ── Boundary detector ──
        const detectors = this.plugin.getPRAvailableBoundaryDetectors();
        new Setting(card)
            .setName("Boundary detector")
            .setDesc("Defines this container's date range")
            .addDropdown(dd => {
                for (const det of detectors) dd.addOption(det.id, det.label);
                dd.setValue(container.boundaryDetector || "calendar-week");
                dd.onChange(async v => {
                    container.boundaryDetector = v;
                    await this.plugin.saveSettings();
                });
            });

        // ── Template ──
        new Setting(card)
            .setName("Template")
            .setDesc(container.template || "None selected")
            .addButton(btn => {
                btn.setButtonText(container.template ? "Change" : "Choose").onClick(() => {
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        container.template = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    container.template = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // ── Save directory ──
        new Setting(card)
            .setName("Save directory")
            .setDesc(container.saveDir || "Vault root")
            .addButton(btn => {
                btn.setButtonText(container.saveDir ? "Change" : "Choose").onClick(() => {
                    new FolderSuggestModal(this.app, async (folder) => {
                        container.saveDir = folder.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    container.saveDir = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // ── Naming convention ──
        new Setting(card)
            .setName("Naming convention")
            .setDesc("Tokens: {{year}}, {{month}}, {{month-name}}, {{day}}, {{date}}, {{week}}, {{week-start}}, {{week-end}}")
            .addText(t => t
                .setPlaceholder("W{{week}}-{{year}}")
                .setValue(container.naming || "")
                .onChange(async v => {
                    container.naming = v;
                    await this.plugin.saveSettings();
                }));

        // ── Metadata placement ──
        new Setting(card)
            .setName("Plugin metadata location")
            .setDesc("Where the plugin writes its per-note bookkeeping (id / boundary / range). Future phases use this to find previously-generated notes.")
            .addDropdown(dd => {
                dd.addOption("frontmatter", "Frontmatter (single nested key)");
                dd.addOption("inline", "Inline marker (find or append)");
                dd.addOption("none", "Don't write — clean output, breaks Phase 3+");
                dd.setValue(container.metadataPlacement || "frontmatter");
                dd.onChange(async v => {
                    container.metadataPlacement = v;
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // Show inline-key field only when inline placement is selected
        if ((container.metadataPlacement || "frontmatter") === "inline") {
            new Setting(card)
                .setName("Inline marker key")
                .setDesc("Inline-field key the plugin looks for in the template body (no ::). If found, its line is replaced with the rendered metadata. If not found, a hidden %% periodic-ritual:: ... %% block is appended at the end of the file.")
                .addText(t => t
                    .setPlaceholder("periodic-ritual")
                    .setValue(container.metadataInlineKey || "periodic-ritual")
                    .onChange(async v => {
                        container.metadataInlineKey = v;
                        await this.plugin.saveSettings();
                    }));
        }

        // ── LLM aggregation (Phase 2) ──
        const llmHeader = card.createEl("h5", { text: "LLM aggregation (optional)" });
        llmHeader.style.cssText = "margin-top: 16px; margin-bottom: 4px; color: var(--text-muted); font-weight: 500;";

        const llmIntro = card.createEl("p");
        llmIntro.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin: 0 0 8px 0;";
        llmIntro.setText("When a service and a system prompt are both set, the plugin will collect daily notes in this container's range, send them to the LLM with the prompt, and merge the YAML response into this note's frontmatter.");

        // System prompt MD picker (with starter-prompt creation)
        new Setting(card)
            .setName("System prompt")
            .setDesc(container.systemPromptFile || "None selected")
            .addButton(btn => {
                btn.setButtonText(container.systemPromptFile ? "Change" : "Choose").onClick(() => {
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        container.systemPromptFile = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addButton(btn => {
                // Create a starter prompt by picking a template + a save folder.
                // Drops the embedded starter content in the chosen folder and
                // wires the container's systemPromptFile to the new path.
                btn.setButtonText("Create starter").setTooltip("Create a starter system prompt MD file in your vault").onClick(async () => {
                    const picker = new PRStarterPromptPickerModal(this.app, async (key) => {
                        const starter = PR_STARTER_PROMPTS[key];
                        if (!starter) return;
                        new FolderSuggestModal(this.app, async (folder) => {
                            const folderPath = folder.path || "";
                            const filePath = folderPath ? `${folderPath}/${starter.filename}` : starter.filename;
                            try {
                                const existing = this.app.vault.getAbstractFileByPath(filePath);
                                if (existing) {
                                    new Notice(`File already exists: ${filePath}`);
                                    container.systemPromptFile = filePath;
                                    await this.plugin.saveSettings();
                                    this.display();
                                    return;
                                }
                                if (folderPath) {
                                    const folderFile = this.app.vault.getAbstractFileByPath(folderPath);
                                    if (!folderFile) await this.app.vault.createFolder(folderPath);
                                }
                                await this.app.vault.create(filePath, starter.content);
                                container.systemPromptFile = filePath;
                                await this.plugin.saveSettings();
                                new Notice(`Created starter prompt: ${filePath}`);
                                this.display();
                            } catch (e) {
                                new Notice(`Failed to create starter: ${e.message}`);
                                console.error(e);
                            }
                        }).open();
                    });
                    picker.open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    container.systemPromptFile = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // LLM service picker
        const services = s.prLLMServices || [];
        new Setting(card)
            .setName("LLM service")
            .setDesc(services.length === 0 ? "Define a service in the LLM tab first" : "Select which service handles this container's aggregation")
            .addDropdown(dd => {
                dd.addOption("", "— None —");
                for (const svc of services) dd.addOption(svc.id, `${svc.name} (${svc.provider})`);
                dd.setValue(container.llmServiceId || "");
                dd.onChange(async v => {
                    container.llmServiceId = v;
                    await this.plugin.saveSettings();
                });
            });

        // ── Generate button ──
        new Setting(card)
            .addButton(btn => btn
                .setButtonText("Generate now")
                .setCta()
                .onClick(async () => {
                    await this.plugin.generatePRContainerNote(container);
                }));
    }

    displayAlignmentsStub(containerEl) {
        containerEl.createEl("h2", { text: "Alignments" });
        const p = containerEl.createEl("p");
        p.style.cssText = "color: var(--text-muted); max-width: 60ch;";
        p.setText("Measurable anchors attached to a container. Each alignment names a daily field, a description of what is being measured, and the container level it lives in. Wired up in Phase 7.");
    }

    // Phase 2: real LLM tab. List of services with add/edit/remove and a
    // model fetch button per service.
    displayLLMStub(containerEl) {
        const s = this.plugin.settings;
        if (!Array.isArray(s.prLLMServices)) s.prLLMServices = [];

        containerEl.createEl("h2", { text: "LLM Services" });
        const intro = containerEl.createEl("p");
        intro.style.cssText = "color: var(--text-muted); max-width: 60ch;";
        intro.setText("Define one or more LLM services. Containers reference services by name and can use different services from each other.");

        if (s.prLLMServices.length === 0) {
            const empty = containerEl.createEl("p");
            empty.style.cssText = "color: var(--text-faint); margin: 24px 0;";
            empty.setText("No services yet. Click below to add one.");
        } else {
            for (let i = 0; i < s.prLLMServices.length; i++) {
                this.renderPRLLMServiceCard(containerEl, s.prLLMServices[i], i);
            }
        }

        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText("+ Add LLM service")
                .setCta()
                .onClick(async () => {
                    s.prLLMServices.push(makePRLLMService());
                    await this.plugin.saveSettings();
                    this.display();
                }));

        const note = containerEl.createEl("p");
        note.style.cssText = "color: var(--text-faint); max-width: 60ch; font-size: 0.85em; margin-top: 24px;";
        note.setText("The legacy single-LLM config under Existing settings continues to work for the existing reflection flows. PR services are independent.");
    }

    renderPRLLMServiceCard(parent, service, idx) {
        const s = this.plugin.settings;

        const card = parent.createDiv();
        card.style.cssText = "border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;";

        // Header: name + delete
        const header = card.createDiv();
        header.style.cssText = "display: flex; align-items: center; gap: 12px; margin-bottom: 12px;";

        const nameInput = header.createEl("input", { type: "text", value: service.name || "" });
        nameInput.placeholder = "Service name";
        nameInput.style.cssText = "flex: 1; font-size: 1.05em; font-weight: 600; background: transparent; border: none; color: var(--text-normal); outline: none; border-bottom: 1px solid transparent; padding: 2px 0;";
        nameInput.addEventListener("focus", () => { nameInput.style.borderBottom = "1px solid var(--background-modifier-border)"; });
        nameInput.addEventListener("blur", () => { nameInput.style.borderBottom = "1px solid transparent"; });
        nameInput.addEventListener("change", async () => {
            service.name = nameInput.value;
            await this.plugin.saveSettings();
        });

        const deleteBtn = header.createEl("button", { text: "×" });
        deleteBtn.title = "Delete service";
        deleteBtn.style.cssText = "background: none; border: none; color: var(--text-muted); font-size: 1.4em; cursor: pointer; padding: 0 6px; line-height: 1;";
        deleteBtn.addEventListener("click", async () => {
            s.prLLMServices.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
        });

        // Provider
        new Setting(card)
            .setName("Provider")
            .addDropdown(dd => {
                for (const [key, p] of Object.entries(PROVIDERS)) dd.addOption(key, p.name);
                dd.setValue(service.provider || "gemini");
                dd.onChange(async v => {
                    service.provider = v;
                    service.model = "";
                    // Auto-populate baseUrl with the provider's default if it
                    // needs one and the user hasn't set anything yet.
                    const newProv = PROVIDERS[v];
                    if (newProv?.needsBaseUrl && !service.baseUrl) {
                        service.baseUrl = newProv.defaultBaseUrl || "";
                    }
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // Base URL (only for providers that need it: LM Studio, OpenClaw)
        const provDef = PROVIDERS[service.provider];
        if (provDef?.needsBaseUrl) {
            new Setting(card)
                .setName("Base URL")
                .setDesc(`Where this provider's HTTP gateway is reachable. Default: ${provDef.defaultBaseUrl}`)
                .addText(t => {
                    t.setPlaceholder(provDef.defaultBaseUrl || "http://localhost:1234/v1")
                        .setValue(service.baseUrl || "")
                        .onChange(async v => {
                            service.baseUrl = v;
                            await this.plugin.saveSettings();
                        });
                    t.inputEl.style.width = "320px";
                });
        }

        // API key (password)
        new Setting(card)
            .setName("API key")
            .setDesc(provDef?.needsBaseUrl
                ? "Required if your local gateway has auth enabled (e.g. OpenClaw with auth.mode: token). Leave blank for open mode."
                : "")
            .addText(t => {
                t.setPlaceholder("sk-... / AIza... / sk-ant-... / sk-or-...")
                    .setValue(service.apiKey || "")
                    .onChange(async v => {
                        service.apiKey = v;
                        await this.plugin.saveSettings();
                    });
                t.inputEl.type = "password";
                t.inputEl.style.width = "320px";
            });

        // Model + fetch button
        new Setting(card)
            .setName(service.provider === "openclaw" ? "Agent" : "Model")
            .setDesc(service.model || "Not selected")
            .addText(t => t
                .setPlaceholder("gpt-4o / gemini-2.0-flash / openclaw/default / ...")
                .setValue(service.model || "")
                .onChange(async v => {
                    service.model = v;
                    await this.plugin.saveSettings();
                }))
            .addExtraButton(btn => {
                btn.setIcon("refresh-cw")
                    .setTooltip(service.provider === "openclaw" ? "Fetch available agents" : "Fetch available models")
                    .onClick(async () => {
                        const provider = PROVIDERS[service.provider];
                        if (!provider) {
                            new Notice(`Unknown provider: ${service.provider}`);
                            return;
                        }
                        // Cloud providers always require a key. Local providers
                        // (LM Studio / OpenClaw) might or might not — we let
                        // the request go and surface the 401 if it comes back.
                        if (!provider.needsBaseUrl && !service.apiKey) {
                            new Notice("Set the API key first");
                            return;
                        }
                        try {
                            new Notice(`Fetching from ${provider.name}…`);
                            const models = await provider.listModels(service);
                            if (!models || models.length === 0) {
                                new Notice("No models returned");
                                return;
                            }
                            const picker = new PRModelPickerModal(this.app, models, async (chosen) => {
                                service.model = chosen;
                                await this.plugin.saveSettings();
                                this.display();
                                new Notice(`Selected ${chosen}`);
                            });
                            picker.open();
                        } catch (e) {
                            new Notice(`Fetch failed: ${e.message}`);
                            console.error(e);
                        }
                    });
            });
    }

    displayGeneral(containerEl) {
        const s = this.plugin.settings;
        containerEl.createEl("h2", { text: "General" });

        new Setting(containerEl)
            .setName("Auto-generate on load")
            .setDesc("When on, the plugin checks every enabled Periodic Ritual container at startup and generates any notes whose boundaries have been crossed since the last run. Boundary-driven only — no timers, no polling. When off, you generate manually via command.")
            .addToggle(t => t
                .setValue(!!s.prAutoGenerateOnLoad)
                .onChange(async v => {
                    s.prAutoGenerateOnLoad = v;
                    await this.plugin.saveSettings();
                }));

        const note = containerEl.createEl("p");
        note.style.cssText = "color: var(--text-faint); max-width: 60ch; font-size: 0.9em; margin-top: 16px;";
        note.setText("Daily notes folder and filename format are still configured under Legacy Settings until the new Containers tab is wired up.");
    }

    // ─── Legacy settings UI (existing functionality, untouched) ───
    // The original display() body. Renders modes, container/subdivision config,
    // astrology toggles, field pipelines, single-LLM config, calendar view config,
    // and reflection tabs — all exactly as before.
    displayLegacySettings(containerEl) {
        const s = this.plugin.settings;
        const mode = s.mode;
        const hasMoon = this.plugin.hasMoonPlugin();

        // ═══ MODE ═══
        containerEl.createEl("h2", { text: "Mode" });

        const modeRow = new Setting(containerEl).setName("Cycle mode").setDesc("Controls which settings appear below");
        const modeEl = modeRow.controlEl;
        modeEl.style.cssText = "display:flex;gap:4px;";

        const modes = [
            { id: "calendar", icon: "\uD83D\uDCC5", tip: "Calendar (months + weeks)" },
            { id: "moon", icon: "\uD83C\uDF19", tip: "Moon (lunar cycles + phases)" },
            { id: "solar", icon: "\u2600\uFE0F", tip: "Solar (solar terms)" },
        ];

        for (const m of modes) {
            const btn = modeEl.createEl("button", { text: m.icon });
            btn.title = m.tip;
            btn.className = "mr-mode-btn" + (mode === m.id ? " mr-mode-active" : "");
            const needsMoon = m.id === "moon" || m.id === "solar";
            if (needsMoon && !hasMoon) {
                btn.disabled = true;
                btn.title = "Requires Moon Phase plugin";
                btn.style.opacity = "0.4";
            }
            btn.addEventListener("click", async () => {
                if (needsMoon && !hasMoon) return;
                s.mode = m.id;
                await this.plugin.saveSettings();
                this.plugin.updateCommandNames();
                this.display();
            });
        }

        // ═══ NOTES ═══
        containerEl.createEl("h2", { text: "Notes" });

        // Container
        containerEl.createEl("h4", { text: "Container" });

        new Setting(containerEl)
            .setName("Template")
            .setDesc(s.containerTemplate || "None selected")
            .addButton(btn => {
                btn.setButtonText(s.containerTemplate ? "Change" : "Choose").onClick(() => {
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        s.containerTemplate = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    s.containerTemplate = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(containerEl)
            .setName("Save location")
            .setDesc(s.containerFolder || "Vault root")
            .addButton(btn => {
                btn.setButtonText(s.containerFolder ? "Change" : "Choose").onClick(() => {
                    new FolderSuggestModal(this.app, async (folder) => {
                        s.containerFolder = folder.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    s.containerFolder = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(containerEl)
            .setName("Naming convention")
            .setDesc("Available tokens: {{year}}, {{month}}, {{month-name}}, {{date}}, {{cycle}}, {{phase}}, {{sign}}, {{term}}, etc.")
            .addText(text => {
                text.setPlaceholder(DEFAULT_NAMING[mode]?.container || "{{date}}")
                    .setValue(s.containerNaming)
                    .onChange(async v => { s.containerNaming = v; await this.plugin.saveSettings(); });
                text.inputEl.style.width = "100%";
            });

        new Setting(containerEl)
            .setName("Generate at")
            .addDropdown(dd => {
                dd.addOption("start", "Cycle start");
                dd.addOption("end", "Cycle end");
                dd.setValue(s.generateAt).onChange(async v => { s.generateAt = v; await this.plugin.saveSettings(); });
            });

        // Subdivision
        containerEl.createEl("h4", { text: "Subdivision" });

        new Setting(containerEl)
            .setName("Template")
            .setDesc(s.subdivisionTemplate || "None selected")
            .addButton(btn => {
                btn.setButtonText(s.subdivisionTemplate ? "Change" : "Choose").onClick(() => {
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        s.subdivisionTemplate = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    s.subdivisionTemplate = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(containerEl)
            .setName("Save location")
            .setDesc(s.subdivisionFolder || "Vault root")
            .addButton(btn => {
                btn.setButtonText(s.subdivisionFolder ? "Change" : "Choose").onClick(() => {
                    new FolderSuggestModal(this.app, async (folder) => {
                        s.subdivisionFolder = folder.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    s.subdivisionFolder = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(containerEl)
            .setName("Naming convention")
            .addText(text => {
                text.setPlaceholder(DEFAULT_NAMING[mode]?.subdivision || "{{date}}")
                    .setValue(s.subdivisionNaming)
                    .onChange(async v => { s.subdivisionNaming = v; await this.plugin.saveSettings(); });
                text.inputEl.style.width = "100%";
            });

        // Astrology (moon/solar only, requires Moon Phase)
        if ((mode === "moon" || mode === "solar") && hasMoon) {
            containerEl.createEl("h4", { text: "Astrology" });

            new Setting(containerEl)
                .setName("Include sign glyphs")
                .setDesc("Resolve {{sign}} and {{sign-glyph}} tokens")
                .addToggle(t => {
                    t.setValue(s.includeSignGlyphs).onChange(async v => { s.includeSignGlyphs = v; await this.plugin.saveSettings(); });
                });

            new Setting(containerEl)
                .setName("Include eclipse flags")
                .setDesc("Resolve {{eclipse}} token when eclipse detected")
                .addToggle(t => {
                    t.setValue(s.includeEclipseFlags).onChange(async v => { s.includeEclipseFlags = v; await this.plugin.saveSettings(); });
                });
        }

        // Solar subdivision type
        if (mode === "solar") {
            containerEl.createEl("h4", { text: "Solar Subdivision" });
            new Setting(containerEl)
                .setName("Subdivide by")
                .addDropdown(dd => {
                    dd.addOption("terms", "Solar terms");
                    dd.addOption("phases", "Lunar phases");
                    dd.setValue(s.solarSubdivision).onChange(async v => {
                        s.solarSubdivision = v;
                        await this.plugin.saveSettings();
                        this.plugin.updateCommandNames();
                        this.display();
                    });
                });
        }

        // Daily notes folder
        containerEl.createEl("h4", { text: "Daily Notes" });
        new Setting(containerEl)
            .setName("Daily notes folder")
            .setDesc("Where your daily notes are stored (for field collection)")
            .addText(text => {
                text.setPlaceholder("Vault root")
                    .setValue(s.dailyNotesFolder)
                    .onChange(async v => { s.dailyNotesFolder = v; await this.plugin.saveSettings(); });
            });

        // ═══ CALENDAR VIEW ═══
        containerEl.createEl("h2", { text: "Calendar View" });

        new Setting(containerEl)
            .setName("Timezone")
            .setDesc("Timezone for lunar phase calculations")
            .addText(text => {
                text.setPlaceholder("America/New_York")
                    .setValue(s.calendarTimezone)
                    .onChange(async v => { s.calendarTimezone = v; await this.plugin.saveSettings(); });
            });

        new Setting(containerEl)
            .setName("Note folder")
            .setDesc(s.calendarNoteFolder || "Vault root")
            .addButton(btn => {
                btn.setButtonText(s.calendarNoteFolder ? "Change" : "Choose").onClick(() => {
                    new FolderSuggestModal(this.app, async (folder) => {
                        s.calendarNoteFolder = folder.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    s.calendarNoteFolder = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        containerEl.createEl("h4", { text: "Solar Note" });

        new Setting(containerEl)
            .setName("Naming convention")
            .setDesc("Tokens: {{sign}}, {{glyph}}, {{year}}")
            .addText(text => {
                text.setPlaceholder("\u2600\uFE0F Sun in {{sign}}")
                    .setValue(s.calendarNoteNaming)
                    .onChange(async v => { s.calendarNoteNaming = v; await this.plugin.saveSettings(); });
                text.inputEl.style.width = "100%";
            });

        containerEl.createEl("h4", { text: "Lunar Notes" });
        containerEl.createEl("p", {
            text: "Tokens: {{phase-name}}, {{phase-emoji}}, {{moon-sign}}, {{moon-glyph}}",
            cls: "setting-item-description",
        }).style.cssText = "margin: -8px 0 8px; font-size: 0.8em;";

        const lunarNaming = s.lunarNoteNaming || {};
        const phaseLabels = [
            { key: "New Moon", icon: "\uD83C\uDF11" },
            { key: "First Quarter", icon: "\uD83C\uDF13" },
            { key: "Full Moon", icon: "\uD83C\uDF15" },
            { key: "Last Quarter", icon: "\uD83C\uDF17" },
        ];
        for (const pl of phaseLabels) {
            new Setting(containerEl)
                .setName(`${pl.icon} ${pl.key}`)
                .addText(text => {
                    text.setPlaceholder(`${pl.icon} {{phase-name}} Moon in {{moon-sign}}`)
                        .setValue(lunarNaming[pl.key] || "")
                        .onChange(async v => {
                            if (!s.lunarNoteNaming) s.lunarNoteNaming = {};
                            s.lunarNoteNaming[pl.key] = v;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.style.width = "100%";
                });
        }

        // ═══ FIELD MAPPING ═══
        containerEl.createEl("h2", { text: "Field Mapping" });

        containerEl.createEl("h4", { text: "Daily \u2192 Subdivision" });
        this.renderFieldMappings(containerEl, s.dailyToSubFields, "dailyToSubFields");

        containerEl.createEl("h4", { text: "Subdivision \u2192 Container" });
        this.renderFieldMappings(containerEl, s.subToContainerFields, "subToContainerFields");

        // ═══ LLM ═══
        containerEl.createEl("h2", { text: "LLM" });

        new Setting(containerEl)
            .setName("Enable LLM")
            .setDesc("Generate AI summaries after reflection")
            .addToggle(t => {
                t.setValue(s.llmEnabled).onChange(async v => { s.llmEnabled = v; await this.plugin.saveSettings(); this.display(); });
            });

        if (s.llmEnabled) {
            new Setting(containerEl)
                .setName("Provider")
                .addDropdown(dd => {
                    Object.entries(PROVIDERS).forEach(([k, v]) => dd.addOption(k, v.name));
                    dd.setValue(s.provider).onChange(async v => { s.provider = v; await this.plugin.saveSettings(); });
                });

            new Setting(containerEl)
                .setName("API Key")
                .addText(text => {
                    text.setPlaceholder("Enter API key").setValue(s.apiKey)
                        .onChange(async v => { s.apiKey = v; await this.plugin.saveSettings(); });
                    text.inputEl.type = "password";
                });

            const modelSetting = new Setting(containerEl).setName("Model");
            const modelCtrl = modelSetting.controlEl;
            let modelSelect = null;

            const buildModelDropdown = (models) => {
                if (modelSelect) modelSelect.remove();
                const sel = document.createElement("select");
                sel.className = "dropdown";
                if (models.length === 0) {
                    const o = document.createElement("option");
                    o.value = s.model; o.textContent = s.model || "Click Fetch Models";
                    sel.appendChild(o);
                } else {
                    if (s.model && !models.includes(s.model)) {
                        const o = document.createElement("option");
                        o.value = s.model; o.textContent = `${s.model} (current)`;
                        sel.appendChild(o);
                    }
                    models.forEach(m => { const o = document.createElement("option"); o.value = m; o.textContent = m; sel.appendChild(o); });
                }
                sel.value = s.model;
                sel.addEventListener("change", async () => { s.model = sel.value; await this.plugin.saveSettings(); });
                modelSelect = sel;
                modelCtrl.insertBefore(sel, modelCtrl.firstChild);
            };
            buildModelDropdown([]);

            const fetchBtn = document.createElement("button");
            fetchBtn.textContent = "Fetch Models"; fetchBtn.className = "mod-cta"; fetchBtn.style.marginLeft = "8px";
            fetchBtn.addEventListener("click", async () => {
                const prov = PROVIDERS[s.provider];
                if (!s.apiKey) { new Notice("Enter an API key first."); return; }
                fetchBtn.textContent = "Fetching..."; fetchBtn.disabled = true;
                try {
                    const m = await prov.listModels(s.apiKey);
                    buildModelDropdown(m);
                    new Notice(`Found ${m.length} models.`);
                } catch (e) { new Notice("Failed: " + e.message); }
                finally { fetchBtn.textContent = "Fetch Models"; fetchBtn.disabled = false; }
            });
            modelCtrl.appendChild(fetchBtn);
        }

        // ═══ REFLECTION ═══
        containerEl.createEl("h2", { text: "Reflection" });

        // Tab bar
        const tabBar = containerEl.createDiv({ cls: "mr-tab-bar" });
        const labels = this.plugin.getModeLabels();

        const containerTab = tabBar.createEl("button", { text: labels.container, cls: "mr-tab" + (this.reflectionTab === "container" ? " mr-tab-active" : "") });
        const subTab = tabBar.createEl("button", { text: labels.subdivision, cls: "mr-tab" + (this.reflectionTab === "subdivision" ? " mr-tab-active" : "") });

        containerTab.addEventListener("click", () => { this.reflectionTab = "container"; this.display(); });
        subTab.addEventListener("click", () => { this.reflectionTab = "subdivision"; this.display(); });

        const tabContent = containerEl.createDiv({ cls: "mr-tab-content" });
        const config = this.reflectionTab === "container" ? s.containerReflection : s.subdivisionReflection;

        this.renderReflectionConfig(tabContent, config, this.reflectionTab);
    }

    renderFieldMappings(containerEl, mappings, settingsKey) {
        const list = containerEl.createDiv();
        mappings.forEach((mapping, i) => {
            const row = new Setting(list).setName(`Field ${i + 1}`);
            row.addText(text => {
                text.setPlaceholder("Field name").setValue(mapping.source)
                    .onChange(async v => { mapping.source = v; await this.plugin.saveSettings(); });
            });
            row.addDropdown(dd => {
                dd.addOption("inline", "Inline");
                dd.addOption("frontmatter", "Frontmatter");
                dd.setValue(mapping.type || "inline").onChange(async v => { mapping.type = v; await this.plugin.saveSettings(); });
            });
            row.addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Remove").onClick(async () => {
                    mappings.splice(i, 1);
                    await this.plugin.saveSettings();
                    this.display();
                });
            });
        });

        new Setting(containerEl).addButton(btn => {
            btn.setButtonText("+ Add Field").setCta().onClick(async () => {
                mappings.push({ source: "", type: "inline" });
                await this.plugin.saveSettings();
                this.display();
            });
        });
    }

    renderReflectionConfig(container, config, type) {
        // Questions
        container.createEl("h4", { text: "Questions" });
        const qContainer = container.createDiv({ cls: "mr-questions-list" });
        this.renderQuestions(qContainer, config, type);

        new Setting(container).addButton(btn => {
            btn.setButtonText("+ Add Question").setCta().onClick(async () => {
                config.questions.push(makeQuestion(""));
                await this.plugin.saveSettings();
                this.renderQuestions(qContainer, config, type);
            });
        });

        // Summary config
        container.createEl("h4", { text: "Summary" });

        new Setting(container)
            .setName("System prompt prepend")
            .setDesc("Behavioral directives sent as the system role")
            .addTextArea(text => {
                text.setPlaceholder("e.g. Summarize in 2 sentences...")
                    .setValue(config.systemPromptPrepend)
                    .onChange(async v => { config.systemPromptPrepend = v; await this.plugin.saveSettings(); });
                text.inputEl.rows = 3; text.inputEl.style.width = "100%";
            });

        new Setting(container)
            .setName("System prompt file")
            .setDesc(config.systemPromptFile || "None selected")
            .addButton(btn => {
                btn.setButtonText(config.systemPromptFile ? "Change" : "Choose").onClick(() => {
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        config.systemPromptFile = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    config.systemPromptFile = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(container)
            .setName("Pass to LLM")
            .addDropdown(dd => {
                dd.addOption("answers-only", "Answers only");
                dd.addOption("selected-fields", "+ Selected fields");
                dd.addOption("whole-note", "+ Whole note");
                dd.setValue(config.dataPassThrough).onChange(async v => {
                    config.dataPassThrough = v;
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        if (config.dataPassThrough === "selected-fields") {
            new Setting(container)
                .setName("Fields to include")
                .setDesc("Comma-separated field names")
                .addText(text => {
                    text.setPlaceholder("field1, field2")
                        .setValue((config.selectedFields || []).join(", "))
                        .onChange(async v => {
                            config.selectedFields = v.split(",").map(f => f.trim()).filter(f => f);
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.style.width = "100%";
                });
        }

        new Setting(container)
            .setName("Output field name")
            .setDesc("Where the LLM summary is written")
            .addText(text => {
                text.setPlaceholder("e.g. summary").setValue(config.outputFieldName)
                    .onChange(async v => { config.outputFieldName = v; await this.plugin.saveSettings(); });
            });

        new Setting(container)
            .setName("Output field type")
            .addDropdown(dd => {
                dd.addOption("inline", "Inline field (field::)");
                dd.addOption("frontmatter", "Frontmatter (field:)");
                dd.setValue(config.outputFieldType).onChange(async v => {
                    config.outputFieldType = v; await this.plugin.saveSettings();
                });
            });
    }

    renderQuestions(container, config, type) {
        container.empty();
        const questions = config.questions;

        questions.forEach((q, i) => {
            const setting = new Setting(container).setName(`Q${i + 1}`);

            // ← inject variable
            setting.addExtraButton(btn => {
                btn.setIcon("arrow-left").setTooltip("Load variable into this question").onClick(() => {
                    const key = `${type}-${i}-in`;
                    this.expandedInput[key] = !this.expandedInput[key];
                    this.renderQuestions(container, config, type);
                });
            });

            // Question text
            setting.addText(text => {
                text.setPlaceholder("Enter a question...").setValue(q.text)
                    .onChange(async v => { q.text = v; await this.plugin.saveSettings(); });
                text.inputEl.style.width = "100%";
            });

            // → output to field
            setting.addExtraButton(btn => {
                btn.setIcon("arrow-right").setTooltip("Output this answer to its own field").onClick(() => {
                    const key = `${type}-${i}-out`;
                    this.expandedOutput[key] = !this.expandedOutput[key];
                    this.renderQuestions(container, config, type);
                });
            });

            // Move up
            if (i > 0) {
                setting.addExtraButton(btn => {
                    btn.setIcon("up-chevron-glyph").setTooltip("Move up").onClick(async () => {
                        [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]];
                        await this.plugin.saveSettings();
                        this.renderQuestions(container, config, type);
                    });
                });
            }

            // Move down
            if (i < questions.length - 1) {
                setting.addExtraButton(btn => {
                    btn.setIcon("down-chevron-glyph").setTooltip("Move down").onClick(async () => {
                        [questions[i], questions[i + 1]] = [questions[i + 1], questions[i]];
                        await this.plugin.saveSettings();
                        this.renderQuestions(container, config, type);
                    });
                });
            }

            // Remove
            if (questions.length > 1) {
                setting.addExtraButton(btn => {
                    btn.setIcon("cross").setTooltip("Remove").onClick(async () => {
                        questions.splice(i, 1);
                        await this.plugin.saveSettings();
                        this.renderQuestions(container, config, type);
                    });
                });
            }

            // ← Expanded: inject variable config
            const inKey = `${type}-${i}-in`;
            if (this.expandedInput[inKey]) {
                const group = container.createDiv();
                group.style.cssText = "padding-left:24px;border-left:2px solid var(--interactive-accent);margin-bottom:12px;";

                new Setting(group)
                    .setName("Inject variable")
                    .setDesc("Show a value from another note above this question")
                    .addToggle(t => {
                        t.setValue(q.injectVar).onChange(async v => {
                            q.injectVar = v; await this.plugin.saveSettings();
                            this.renderQuestions(container, config, type);
                        });
                    });

                if (q.injectVar) {
                    new Setting(group)
                        .setName("Field name")
                        .setDesc("The inline field to read")
                        .addText(t => {
                            t.setPlaceholder("e.g. summary").setValue(q.varField)
                                .onChange(async v => { q.varField = v; await this.plugin.saveSettings(); });
                        });

                    new Setting(group)
                        .setName("Source")
                        .addDropdown(dd => {
                            dd.addOption("previous", `Previous ${type} note`);
                            dd.addOption("note", "Specific note");
                            dd.setValue(q.varSource).onChange(async v => {
                                q.varSource = v; await this.plugin.saveSettings();
                                this.renderQuestions(container, config, type);
                            });
                        });

                    if (q.varSource === "note") {
                        new Setting(group)
                            .setName("Note")
                            .setDesc(q.varNotePath || "No note selected")
                            .addButton(btn => {
                                btn.setButtonText("Choose Note").onClick(() => {
                                    new MarkdownFileSuggestModal(this.app, async (file) => {
                                        q.varNotePath = file.path; await this.plugin.saveSettings();
                                        this.renderQuestions(container, config, type);
                                    }).open();
                                });
                            });
                    }
                }
            }

            // → Expanded: output to field config
            const outKey = `${type}-${i}-out`;
            if (this.expandedOutput[outKey]) {
                const group = container.createDiv();
                group.style.cssText = "padding-left:24px;border-left:2px solid var(--interactive-accent);margin-bottom:12px;";

                new Setting(group)
                    .setName("Output to own field")
                    .setDesc("Write this answer to a separate field")
                    .addToggle(t => {
                        t.setValue(q.outputToField).onChange(async v => {
                            q.outputToField = v; await this.plugin.saveSettings();
                            this.renderQuestions(container, config, type);
                        });
                    });

                if (q.outputToField) {
                    new Setting(group)
                        .setName("Field name")
                        .addText(t => {
                            t.setPlaceholder("e.g. commitment").setValue(q.outputFieldName)
                                .onChange(async v => { q.outputFieldName = v; await this.plugin.saveSettings(); });
                        });

                    new Setting(group)
                        .setName("Field type")
                        .addDropdown(dd => {
                            dd.addOption("inline", "Inline field (field::)");
                            dd.addOption("frontmatter", "Frontmatter (field:)");
                            dd.setValue(q.outputFieldType).onChange(async v => {
                                q.outputFieldType = v; await this.plugin.saveSettings();
                            });
                        });
                }
            }
        });
    }
}

module.exports = MonthlyRitualPlugin;
