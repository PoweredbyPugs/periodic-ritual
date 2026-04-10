const { Plugin, PluginSettingTab, Setting, Modal, Notice, FuzzySuggestModal, TFile, TFolder, ItemView, parseYaml, requestUrl, ToggleComponent } = require("obsidian");

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
const MOON_PHASE_EMOJI = { "New Moon": "\u{1F311}", "First Quarter": "\u{1F313}", "Full Moon": "\u{1F315}", "Last Quarter": "\u{1F317}" };

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
        // "start" — create the note as soon as a new period begins.
        //           Used for arc / planning / dataview containers that need
        //           to exist throughout the cycle so the user can fill them
        //           in or so dataview tables can render.
        // "end"   — wait until the period has fully ended, then create the
        //           note. Used for aggregation containers that summarize
        //           what happened during the period — generating mid-period
        //           would be premature.
        generateAt: "start",
        template: "",
        saveDir: "",
        naming: "",
        // Where to write the plugin's per-note metadata (id / boundary / range).
        // "frontmatter" — single nested key under the YAML block.
        // "inline"      — find an inline-field marker in the body and replace
        //                 its line; if not found, append a hidden %% block
        //                 at the end of the file.
        // "none"        — don't write metadata at all. Phase 3 auto-generation
        //                 will still work via lastGeneratedEnd tracking.
        metadataPlacement: "frontmatter",
        metadataInlineKey: "periodic-ritual",
        // Phase 2+ LLM aggregation
        systemPromptFile: "",   // path to a .md file in the vault
        llmServiceId: "",       // references an entry in prLLMServices
        // Phase 3+ auto-generation tracking. End date (ISO YYYY-MM-DD) of the
        // most recent period this container has generated a note for. Used by
        // catchUpPRContainer to figure out where to resume on plugin load.
        // First-run containers have an empty string and only generate the
        // current period (no historical backfill).
        lastGeneratedEnd: "",
        // Phase 6+ reflection. Reference to a reflection profile in
        // prReflections by id. Empty string = no reflection (only auto-LLM
        // runs at boundary, no Q&A modal).
        reflectionId: "",
        // Phase 8a+ data source. Controls what the auto-LLM aggregation
        // pass reads from. Default is daily notes in the container's range
        // (current behavior). Alternative: another PR container, in which
        // case the LLM reads that container's generated notes that fall
        // inside this container's range. Enables hierarchical roll-ups
        // like Lunar Phase → Lunar Cycle → Solar Year without each level
        // re-reading the raw dailies.
        //
        // Shape: { type: "daily" } or { type: "container", containerId: "..." }
        dataSource: { type: "daily" },
    }, overrides);
}

// Periodic Ritual question factory. Same shape as Daily Ritual's question
// plus cross-container pull/push (Phase 8b):
//   - Inject a value from another note as context above the question prompt
//   - Write its answer to a specific inline or frontmatter field on the
//     active container OR on a sibling PR container's current note
function makePRQuestion(text) {
    return {
        text: text || "",
        // Variable injection — show a value from another note above the
        // question prompt before asking.
        injectVar: false,
        varField: "",                  // field name to read
        varFieldType: "inline",        // "inline" | "frontmatter"
        // Source options:
        //   "previous-period"   — previous note of the SAME container
        //   "note"              — a specific .md file by path
        //   "container-current" — current corresponding note of another container
        //   "container-previous"— previous note of another container
        varSource: "previous-period",
        varNotePath: "",               // for "note"
        varSourceContainerId: "",      // for "container-current" / "container-previous"
        // Output to field — write the answer directly to a field. Default
        // target is the active container note. Setting outputTargetContainer
        // to a PR container id pushes the answer to that container's
        // current corresponding note instead.
        outputToField: false,
        outputFieldName: "",
        outputFieldType: "inline",     // "inline" | "frontmatter"
        outputTargetContainer: "",     // empty = active container; otherwise PR container id
    };
}

// ─── Periodic Ritual: Reflection profile factory (Phase 6 rework) ───
// A Reflection is a reusable Q&A profile that containers reference by id.
// Same artifact pattern as LLM services and alignments. Lives in its own
// settings tab so questions don't crowd the container card.
function makePRReflection(overrides = {}) {
    return Object.assign({
        id: "rf-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        name: "New reflection",
        questions: [],
        // Two independent toggles control how this reflection interacts
        // with the LLM and the container's auto-aggregation:
        //
        // useLLM:
        //   false (default) — the reflection just collects answers and
        //                     writes them to each question's output field.
        //                     No LLM call from the reflection. The container's
        //                     auto-LLM at boundary may still run (controlled
        //                     by replaceAutoLLM).
        //   true            — after collecting answers, the plugin runs an
        //                     LLM call with the answers, the daily data, and
        //                     the container's system prompt + this profile's
        //                     prepend. Output is merged into the container's
        //                     frontmatter.
        //
        // replaceAutoLLM:
        //   false (default) — the container's auto-LLM at boundary still
        //                     runs as normal. The reflection is additive.
        //   true            — the container's auto-LLM at boundary is
        //                     suppressed. The user runs reflection on demand
        //                     to fill (or not fill) the note.
        //
        // The four combinations:
        //   F/F: Auto-LLM at boundary. Reflection collects manual notes
        //        as a side channel.
        //   T/F: Auto-LLM at boundary. Reflection can also call LLM later
        //        with answers + previous frontmatter as context (re-run).
        //   F/T: No LLM at all. Pure Q&A flow — questions in, answers to
        //        fields out, done.
        //   T/T: No auto. Reflection-driven LLM call when the user runs it.
        useLLM: false,
        replaceAutoLLM: false,
        // Optional markdown text prepended to the container's system prompt
        // during reflection LLM runs only. Only relevant when useLLM is true.
        promptPrepend: "",
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

// ─── Periodic Ritual: Alignment factory (Phase 7+) ───
// An Alignment is a measurable anchor attached to a specific container.
// It names a daily field to read, an optional description of what's being
// measured, and an output field on the container note where the LLM
// observation gets written. Multiple alignments per container.
function makePRAlignment(overrides = {}) {
    return Object.assign({
        id: "al-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        name: "New alignment",
        // Which container this alignment is attached to. Empty string means
        // unassigned — the alignment exists in settings but doesn't fire on
        // any container generation until you pick one.
        containerId: "",
        // Daily field to pull. e.g. "health" for inline `health::` or
        // frontmatter `health:`.
        dataField: "",
        dataFieldType: "inline",  // "inline" | "frontmatter"
        // Markdown text describing what's being measured. Sent to the LLM as
        // context for the alignment pass — e.g., "30 min mobility/cardio
        // daily, 80% sleep score average. Surface patterns of consistency
        // and avoidance, not compliance scoring."
        description: "",
        // Frontmatter key on the container note where the LLM observation
        // is written. Defaults to alignment_<sanitized-name>.
        outputField: "",
    }, overrides);
}

// ─── Periodic Ritual: Custom boundary factory (Phase 4c+) ───
function makePRCustomBoundary(overrides = {}) {
    return Object.assign({
        id: "cb-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        name: "New custom boundary",
        scriptPath: "",   // path to a .js file in the vault
        // Optional markdown text. When this boundary is used by a container
        // and the container runs LLM aggregation, this description gets
        // prepended to the system prompt as orienting context. Tells the LLM
        // what kind of period it's looking at, even when the calculation
        // happens in the user's own JS module.
        description: "",
    }, overrides);
}

// ─── Periodic Ritual: Built-in boundary info (Phase 4c) ───
// Registry of metadata for the built-in detectors. Each entry has:
//   name: display name (matches getPRAvailableBoundaryDetectors label, ish)
//   description: orienting markdown text. Used in two places:
//     1. The Boundaries tab so the user can see what each detector does.
//     2. Prepended to the LLM system prompt during aggregation when a
//        container is using this detector, so the LLM knows what kind
//        of period it's summarizing.
//   tokens: list of available token names for the naming convention
//   source: (calendar detectors only) standalone JS module source the
//     user can fork as a custom boundary if they want to modify the
//     calculation. Helios detectors are not forkable here because they
//     depend on the Moon Phase plugin's HTTP API and the plugin instance
//     context — the user would have to write their own helios client.
const BUILT_IN_BOUNDARY_INFO = {
    "calendar-week": {
        name: "Calendar Week",
        description: "ISO calendar week (Monday through Sunday by default). One period spans 7 days.",
        tokens: ["year", "month", "month-name", "day", "date", "week", "week-start", "week-end"],
        source:
`// Calendar Week boundary detector — fork of the built-in.
// Returns the ISO week containing the given date.
//
// To use: save this file in your vault, then in Settings -> Boundaries
// add a custom boundary pointing at it. The plugin will call this
// function with a Date and expects { start, end, tokens } back.

function getISOWeek(d) {
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    return 1 + Math.ceil((firstThursday - target) / 604800000);
}
function getWeekStart(d) {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.getFullYear(), d.getMonth(), diff);
}
function getWeekEnd(d) {
    const start = getWeekStart(d);
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
}
function fmt(d) {
    return d.toISOString().slice(0, 10);
}
function monthName(d) {
    return d.toLocaleString("default", { month: "long" });
}

module.exports = function(date) {
    const d = date || new Date();
    const ws = getWeekStart(d);
    const we = getWeekEnd(d);
    return {
        start: ws,
        end: we,
        tokens: {
            year: String(d.getFullYear()),
            month: String(d.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(d),
            day: String(d.getDate()).padStart(2, "0"),
            date: fmt(ws),
            week: String(getISOWeek(d)),
            "week-start": fmt(ws),
            "week-end": fmt(we),
        },
    };
};
`,
    },
    "calendar-month": {
        name: "Calendar Month",
        description: "Calendar month from the 1st through the last day. One period spans 28-31 days.",
        tokens: ["year", "month", "month-name", "day", "date", "month-start", "month-end", "cycle"],
        source:
`// Calendar Month boundary detector — fork of the built-in.

function fmt(d) { return d.toISOString().slice(0, 10); }
function monthName(d) { return d.toLocaleString("default", { month: "long" }); }

module.exports = function(date) {
    const d = date || new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return {
        start, end,
        tokens: {
            year: String(d.getFullYear()),
            month: String(d.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(d),
            day: String(d.getDate()).padStart(2, "0"),
            date: fmt(start),
            "month-start": fmt(start),
            "month-end": fmt(end),
            cycle: String(d.getMonth() + 1).padStart(2, "0"),
        },
    };
};
`,
    },
    "calendar-quarter": {
        name: "Calendar Quarter",
        description: "Calendar quarter (Q1 = Jan-Mar, Q2 = Apr-Jun, Q3 = Jul-Sep, Q4 = Oct-Dec). One period spans roughly 90 days.",
        tokens: ["year", "month", "month-name", "day", "date", "quarter", "quarter-name", "quarter-start", "quarter-end", "cycle"],
        source:
`// Calendar Quarter boundary detector — fork of the built-in.

function fmt(d) { return d.toISOString().slice(0, 10); }
function monthName(d) { return d.toLocaleString("default", { month: "long" }); }

module.exports = function(date) {
    const d = date || new Date();
    const year = d.getFullYear();
    const quarterIdx = Math.floor(d.getMonth() / 3); // 0..3
    const start = new Date(year, quarterIdx * 3, 1);
    const end = new Date(year, quarterIdx * 3 + 3, 0);
    const quarterNum = quarterIdx + 1;
    return {
        start, end,
        tokens: {
            year: String(year),
            month: String(d.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(d),
            day: String(d.getDate()).padStart(2, "0"),
            date: fmt(start),
            quarter: String(quarterNum),
            "quarter-name": "Q" + quarterNum,
            "quarter-start": fmt(start),
            "quarter-end": fmt(end),
            cycle: String(quarterNum),
        },
    };
};
`,
    },
    "calendar-year": {
        name: "Calendar Year",
        description: "Calendar year from January 1 through December 31. One period spans 365-366 days.",
        tokens: ["year", "month", "month-name", "day", "date", "year-start", "year-end", "cycle"],
        source:
`// Calendar Year boundary detector — fork of the built-in.

function fmt(d) { return d.toISOString().slice(0, 10); }
function monthName(d) { return d.toLocaleString("default", { month: "long" }); }

module.exports = function(date) {
    const d = date || new Date();
    const year = d.getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    return {
        start, end,
        tokens: {
            year: String(year),
            month: String(d.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(d),
            day: String(d.getDate()).padStart(2, "0"),
            date: fmt(start),
            "year-start": fmt(start),
            "year-end": fmt(end),
            cycle: String(year),
        },
    };
};
`,
    },
    "lunar-cycle": {
        name: "Lunar Cycle",
        description: "One synodic month — new moon to next new moon (~29.5 days). The astrological/lunisolar equivalent of a calendar month. Requires the Moon Phase plugin (Helios server).",
        tokens: ["year", "month", "month-name", "day", "date", "cycle", "phase", "phase-short", "sign", "sign-glyph"],
        source:
`// Lunar Cycle boundary detector — fork of the built-in.
//
// Reaches into the Moon Phase plugin to find the helios server URL,
// then fetches the current moon data and computes the synodic month
// containing the given date.
//
// Requires the Moon Phase plugin to be installed and its Helios server
// (default: http://baratie:3000) to be reachable.

const SYNODIC_PERIOD = 29.53059;

async function fetchMoonNow(app) {
    const moon = app.plugins.plugins["obsidian-moon"];
    if (!moon) throw new Error("Moon Phase plugin required");
    const base = (moon.settings.serverUrl || "http://baratie:3000").replace(/\\/+$/, "");
    const obsidian = require("obsidian");
    const r = await obsidian.requestUrl({ url: base + "/moon-now", method: "GET", throw: false });
    if (r.status < 200 || r.status >= 300) throw new Error("helios " + r.status);
    return r.json;
}

function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}
function fmt(d) { return d.toISOString().slice(0, 10); }
function monthName(d) { return d.toLocaleString("default", { month: "long" }); }

module.exports = async function(date, app, plugin) {
    const d = date || new Date();
    const moonData = await fetchMoonNow(app);
    const moonAge = moonData.moonAge || 0;

    const lastNew = startOfDay(addDays(d, -Math.floor(moonAge)));
    const nextNew = startOfDay(addDays(lastNew, Math.round(SYNODIC_PERIOD)));

    return {
        start: lastNew,
        end: nextNew,
        tokens: {
            year: String(lastNew.getFullYear()),
            month: String(lastNew.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(lastNew),
            day: String(lastNew.getDate()).padStart(2, "0"),
            date: fmt(lastNew),
            cycle: "01",
            phase: "New Moon",
            "phase-short": "new",
            sign: moonData.moonSign || "",
            "sign-glyph": "",
        },
    };
};
`,
    },
    "lunar-phase": {
        name: "Lunar Phase",
        description: "One quarter of a lunar cycle (~7 days). The four phases are New Moon, First Quarter, Full Moon, Last Quarter — corresponding to Atlas's detach / plan / execute / share rhythm. Requires the Moon Phase plugin.",
        tokens: ["year", "month", "month-name", "day", "date", "phase", "phase-short", "sign", "sign-glyph"],
        source:
`// Lunar Phase boundary detector — fork of the built-in.
//
// Determines which quarter of the synodic cycle (~7 days each) contains
// the given date. The four phases are New Moon, First Quarter, Full Moon,
// Last Quarter — each ~7.4 days.
//
// Requires the Moon Phase plugin and its Helios server.

const SYNODIC_PERIOD = 29.53059;
const PHASES = ["New Moon", "First Quarter", "Full Moon", "Last Quarter"];
const PHASE_SHORT = { "New Moon": "new", "First Quarter": "q1", "Full Moon": "full", "Last Quarter": "q3" };

async function fetchMoonNow(app) {
    const moon = app.plugins.plugins["obsidian-moon"];
    if (!moon) throw new Error("Moon Phase plugin required");
    const base = (moon.settings.serverUrl || "http://baratie:3000").replace(/\\/+$/, "");
    const obsidian = require("obsidian");
    const r = await obsidian.requestUrl({ url: base + "/moon-now", method: "GET", throw: false });
    if (r.status < 200 || r.status >= 300) throw new Error("helios " + r.status);
    return r.json;
}

function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}
function phaseFromAge(age) {
    const q = SYNODIC_PERIOD / 4;
    if (age < q) return "New Moon";
    if (age < 2 * q) return "First Quarter";
    if (age < 3 * q) return "Full Moon";
    return "Last Quarter";
}
function fmt(d) { return d.toISOString().slice(0, 10); }
function monthName(d) { return d.toLocaleString("default", { month: "long" }); }

module.exports = async function(date, app, plugin) {
    const d = date || new Date();
    const moonData = await fetchMoonNow(app);
    const moonAge = moonData.moonAge || 0;
    const phase = phaseFromAge(moonAge);
    const phaseIdx = PHASES.indexOf(phase);
    const q = SYNODIC_PERIOD / 4;

    const lastNew = startOfDay(addDays(d, -Math.floor(moonAge)));
    const phaseStart = startOfDay(addDays(lastNew, Math.round(phaseIdx * q)));
    const phaseEnd = phaseIdx < 3
        ? startOfDay(addDays(lastNew, Math.round((phaseIdx + 1) * q) - 1))
        : startOfDay(addDays(lastNew, Math.round(SYNODIC_PERIOD) - 1));

    return {
        start: phaseStart,
        end: phaseEnd,
        tokens: {
            year: String(phaseStart.getFullYear()),
            month: String(phaseStart.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(phaseStart),
            day: String(phaseStart.getDate()).padStart(2, "0"),
            date: fmt(phaseStart),
            phase: phase,
            "phase-short": PHASE_SHORT[phase],
            sign: moonData.moonSign || "",
            "sign-glyph": "",
        },
    };
};
`,
    },
    "solar-cycle": {
        name: "Solar Cycle",
        description: "One full tropical year — from the Spring Equinox (Sun's ingress into Aries) through all twelve zodiac signs and back to the next Aries ingress. ~365 days, but anchored on the Aries ingress rather than January 1. The astrological alternative to a calendar year. Requires the Moon Phase plugin.",
        tokens: ["year", "month", "month-name", "day", "date", "cycle", "cycle-start", "cycle-end"],
        source:
`// Solar Cycle boundary detector — fork of the built-in.
//
// Returns the tropical year containing the given date, anchored on the
// Sun's ingress into Aries. Start = most recent Aries ingress on or
// before the given date. End = day before the next Aries ingress.
//
// Requires the Moon Phase plugin and its Helios server.

async function fetchSunIngresses(app, start, end) {
    const moon = app.plugins.plugins["obsidian-moon"];
    if (!moon) throw new Error("Moon Phase plugin required");
    const base = (moon.settings.serverUrl || "http://baratie:3000").replace(/\\/+$/, "");
    const obsidian = require("obsidian");
    const url = base + "/planetary-ingresses?planet=Sun&start=" + fmt(start) + "&end=" + fmt(end);
    const r = await obsidian.requestUrl({ url, method: "GET", throw: false });
    if (r.status < 200 || r.status >= 300) throw new Error("helios " + r.status);
    return r.json;
}

function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}
function fmt(d) { return d.toISOString().slice(0, 10); }
function monthName(d) { return d.toLocaleString("default", { month: "long" }); }

module.exports = async function(date, app, plugin) {
    const d = date || new Date();
    // Search a wide window — Aries ingresses are once a year, so we need
    // ~400 days back and forward to be safe.
    const searchStart = addDays(d, -400);
    const searchEnd = addDays(d, 400);
    const raw = await fetchSunIngresses(app, searchStart, searchEnd);

    const ariesIngresses = (Array.isArray(raw) ? raw : raw.ingresses || [])
        .map(ing => Object.assign({}, ing, {
            dateObj: new Date(ing.date || ing.exactDate || ing.timestamp),
            sign: ing.sign || ing.toSign || "",
        }))
        .filter(ing => ing.sign === "Aries")
        .sort((a, b) => a.dateObj - b.dateObj);

    let prev = null, next = null;
    for (const ing of ariesIngresses) {
        if (ing.dateObj <= d) prev = ing;
        else if (!next) next = ing;
    }
    if (!prev) throw new Error("No prior Aries ingress found in 400-day window");

    const start = startOfDay(prev.dateObj);
    const end = next ? startOfDay(addDays(next.dateObj, -1)) : addDays(start, 364);
    const year = start.getFullYear();

    return {
        start, end,
        tokens: {
            year: String(year),
            month: String(start.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(start),
            day: String(start.getDate()).padStart(2, "0"),
            date: fmt(start),
            cycle: String(year),
            "cycle-start": fmt(start),
            "cycle-end": fmt(end),
        },
    };
};
`,
    },
    "sun-ingress": {
        name: "Solar Zodiac",
        description: "The period the Sun spends in one zodiac sign (~30 days). Begins at the exact moment of ingress and ends when the Sun moves into the next sign. The astrological alternative to a calendar month — themed by sign archetype rather than calendar bookkeeping. Requires the Moon Phase plugin.",
        tokens: ["year", "month", "month-name", "day", "date", "cycle", "term", "term-cn", "sign", "sign-glyph"],
        source:
`// Solar Zodiac boundary detector — fork of the built-in.
//
// Fetches Sun ingresses from helios in a window around the given date,
// finds the most recent ingress before the date and the next one after,
// and returns the period as the current zodiac sign window.
//
// Requires the Moon Phase plugin and its Helios server.

async function fetchSunIngresses(app, start, end) {
    const moon = app.plugins.plugins["obsidian-moon"];
    if (!moon) throw new Error("Moon Phase plugin required");
    const base = (moon.settings.serverUrl || "http://baratie:3000").replace(/\\/+$/, "");
    const obsidian = require("obsidian");
    const url = base + "/planetary-ingresses?planet=Sun&start=" + fmt(start) + "&end=" + fmt(end);
    const r = await obsidian.requestUrl({ url, method: "GET", throw: false });
    if (r.status < 200 || r.status >= 300) throw new Error("helios " + r.status);
    return r.json;
}

function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}
function fmt(d) { return d.toISOString().slice(0, 10); }
function monthName(d) { return d.toLocaleString("default", { month: "long" }); }

module.exports = async function(date, app, plugin) {
    const d = date || new Date();
    const searchStart = addDays(d, -45);
    const searchEnd = addDays(d, 45);
    const ingressesRaw = await fetchSunIngresses(app, searchStart, searchEnd);

    const sorted = (Array.isArray(ingressesRaw) ? ingressesRaw : ingressesRaw.ingresses || [])
        .map(ing => Object.assign({}, ing, { dateObj: new Date(ing.date || ing.exactDate || ing.timestamp) }))
        .sort((a, b) => a.dateObj - b.dateObj);

    let prevIng = null, nextIng = null;
    for (const ing of sorted) {
        if (ing.dateObj <= d) prevIng = ing;
        else if (!nextIng) nextIng = ing;
    }

    if (!prevIng) throw new Error("No prior Sun ingress found in window");
    const sign = prevIng.sign || prevIng.toSign || "";
    const start = startOfDay(prevIng.dateObj);
    const end = nextIng ? startOfDay(addDays(nextIng.dateObj, -1)) : addDays(start, 29);

    return {
        start, end,
        tokens: {
            year: String(start.getFullYear()),
            month: String(start.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(start),
            day: String(start.getDate()).padStart(2, "0"),
            date: fmt(start),
            cycle: "01",
            term: "",
            "term-cn": "",
            sign: sign,
            "sign-glyph": "",
        },
    };
};
`,
    },
};

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
    calendarNoteFolder: "",        // legacy, kept for backward compat (used as fallback)
    calendarSolarNoteFolder: "",   // where the Zodiac Calendar links solar / sign-period notes
    calendarLunarNoteFolder: "",   // where the Zodiac Calendar links lunar phase notes
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
    prAlignments: [],          // Alignment[] — measurable anchors per container
    prReflections: [],         // Reflection[] — Q&A profiles per container
    prLLMServices: [],         // LLMService[] — { name, provider, apiKey, model }
    prCustomBoundaries: [],    // CustomBoundary[] — { id, name, scriptPath, description }
    prAutoGenerateOnLoad: false, // single on/off toggle for boundary-driven auto-create
    prGraphLayout: {},         // { [nodeId]: { x, y } } — node positions in the graph view
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

// Periodic Ritual: hierarchy diagram modal. Renders a Mermaid flowchart
// of the current container chain (dataSource arrows + reflection/alignment
// attachments + LLM service references + boundary types). Read-only —
// for visualizing the structure. Editing happens in the regular tabs.
class PRHierarchyModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "Periodic Ritual — hierarchy" });

        const note = contentEl.createEl("p");
        note.style.cssText = "color: var(--text-muted); font-size: 0.9em;";
        note.setText("Read-only view of how your containers, reflections, alignments, and LLM services connect. Edit the structure in the regular settings tabs.");

        const mermaid = this.buildMermaidGraph();
        // Render as a markdown code block — Obsidian's markdown processor
        // will turn it into an actual Mermaid diagram.
        const wrap = contentEl.createDiv();
        wrap.style.cssText = "max-height: 70vh; overflow: auto; background: var(--background-secondary); padding: 12px; border-radius: 6px;";
        const md = "```mermaid\n" + mermaid + "\n```";
        // Render the markdown into the wrapper
        const MarkdownRenderer = require("obsidian").MarkdownRenderer;
        if (MarkdownRenderer && MarkdownRenderer.render) {
            MarkdownRenderer.render(this.app, md, wrap, "", this.plugin);
        } else if (MarkdownRenderer && MarkdownRenderer.renderMarkdown) {
            // Fallback for older Obsidian API
            MarkdownRenderer.renderMarkdown(md, wrap, "", this.plugin);
        } else {
            // Bare-bones fallback: show the source
            const pre = wrap.createEl("pre");
            pre.style.cssText = "user-select: text; white-space: pre-wrap;";
            pre.setText(mermaid);
        }

        // Source view button — lets the user grab the Mermaid source
        const sourceBtn = contentEl.createEl("button", { text: "Copy Mermaid source" });
        sourceBtn.style.marginTop = "12px";
        sourceBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(mermaid);
                sourceBtn.setText("Copied ✓");
                setTimeout(() => sourceBtn.setText("Copy Mermaid source"), 1500);
            } catch {
                sourceBtn.setText("Failed");
            }
        });
    }
    onClose() { this.contentEl.empty(); }

    // Generate a Mermaid flowchart string from the current settings.
    // Layout: left-to-right. Containers are rectangles, reflections are
    // rounded rects, alignments are hexagons, LLM services are stadium
    // shapes, daily notes is a special source node.
    buildMermaidGraph() {
        const s = this.plugin.settings;
        const containers = s.prContainers || [];
        const reflections = s.prReflections || [];
        const alignments = s.prAlignments || [];
        const services = s.prLLMServices || [];

        const lines = ["flowchart LR"];

        // Helper: sanitize an id for mermaid (no spaces, no special chars)
        const safe = (id) => id.replace(/[^a-zA-Z0-9_]/g, "_");
        const escapeLabel = (s) => (s || "").replace(/"/g, "&quot;").replace(/\|/g, "\\|");

        // Daily source as a single starting node — only emitted if any
        // container actually reads from daily.
        const anyDaily = containers.some(c => !c.dataSource || c.dataSource.type === "daily");
        if (anyDaily) {
            lines.push(`  daily[("Daily notes")]`);
        }

        // Containers
        for (const c of containers) {
            const id = safe(c.id);
            const name = escapeLabel(c.name || "(unnamed)");
            const detector = escapeLabel(c.boundaryDetector || "?");
            const enabledMark = c.enabled ? "" : " 🔒";
            lines.push(`  ${id}["${name}<br/><i>${detector}</i>${enabledMark}"]`);
        }

        // dataSource wires
        for (const c of containers) {
            const id = safe(c.id);
            const ds = c.dataSource || { type: "daily" };
            if (ds.type === "container" && ds.containerId) {
                lines.push(`  ${safe(ds.containerId)} -->|source| ${id}`);
            } else if (anyDaily) {
                lines.push(`  daily -->|source| ${id}`);
            }
        }

        // Reflection nodes + attachment wires
        for (const r of reflections) {
            const id = safe(r.id);
            const name = escapeLabel(r.name || "(unnamed)");
            const llmFlag = r.useLLM ? " 🤖" : "";
            const replaceFlag = r.replaceAutoLLM ? " ⏸" : "";
            lines.push(`  ${id}(("Reflection: ${name}${llmFlag}${replaceFlag}"))`);
        }
        for (const c of containers) {
            if (!c.reflectionId) continue;
            lines.push(`  ${safe(c.reflectionId)} -.->|reflection| ${safe(c.id)}`);
        }

        // Alignment nodes + attachment wires
        for (const a of alignments) {
            const id = safe(a.id);
            const name = escapeLabel(a.name || "(unnamed)");
            const field = escapeLabel(a.dataField || "?");
            lines.push(`  ${id}{{"Alignment: ${name}<br/><i>${field}</i>"}}`);
        }
        for (const a of alignments) {
            if (!a.containerId) continue;
            lines.push(`  ${safe(a.id)} -.->|alignment| ${safe(a.containerId)}`);
        }

        // LLM service nodes + attachment wires (shown only if any container references them)
        const usedServices = new Set();
        for (const c of containers) {
            if (c.llmServiceId) usedServices.add(c.llmServiceId);
        }
        for (const svc of services) {
            if (!usedServices.has(svc.id)) continue;
            const id = safe(svc.id);
            const name = escapeLabel(svc.name || "(unnamed)");
            const provider = escapeLabel(svc.provider || "?");
            lines.push(`  ${id}(["LLM: ${name}<br/><i>${provider}</i>"])`);
        }
        for (const c of containers) {
            if (!c.llmServiceId) continue;
            lines.push(`  ${safe(c.llmServiceId)} -.->|llm| ${safe(c.id)}`);
        }

        return lines.join("\n");
    }
}

// Periodic Ritual: debug modal showing the last LLM call's full payload.
// Triggered by the "Show last LLM call" command. Useful when YAML parsing
// fails or the model returns weird output — you can see exactly what went
// over the wire.
class PRDebugModal extends Modal {
    constructor(app, data) {
        super(app);
        this.data = data;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "Periodic Ritual — last LLM call" });

        if (!this.data) {
            const empty = contentEl.createEl("p");
            empty.style.cssText = "color: var(--text-muted);";
            empty.setText("No LLM call has been made since the plugin loaded.");
            return;
        }

        const meta = contentEl.createEl("div");
        meta.style.cssText = "color: var(--text-muted); font-size: 0.9em; margin-bottom: 12px;";
        meta.createEl("div", { text: `When: ${this.data.timestamp}` });
        meta.createEl("div", { text: `Container: ${this.data.container}` });
        meta.createEl("div", { text: `Service: ${this.data.service} (${this.data.provider})` });
        meta.createEl("div", { text: `Model: ${this.data.model}` });
        meta.createEl("div", { text: `Status: ${this.data.responseStatus}` });
        meta.createEl("div", { text: `URL: ${this.data.url}` });

        const sections = [
            { label: "System prompt", body: this.data.systemPrompt },
            { label: "User message", body: this.data.userMessage },
            { label: "Request body (JSON)", body: JSON.stringify(this.data.requestBody, null, 2) },
            { label: "Raw response", body: this.data.responseRaw },
        ];
        for (const s of sections) {
            const h = contentEl.createEl("h4", { text: s.label });
            h.style.cssText = "margin: 16px 0 4px 0;";
            const wrap = contentEl.createDiv();
            wrap.style.cssText = "display: flex; gap: 8px; align-items: flex-start;";
            const pre = wrap.createEl("pre");
            pre.style.cssText = "flex: 1; background: var(--background-secondary); padding: 8px 12px; border-radius: 6px; max-height: 30vh; overflow: auto; font-size: 0.8em; user-select: text; -webkit-user-select: text; cursor: text; white-space: pre-wrap; word-break: break-word; margin: 0;";
            pre.setText(s.body || "(empty)");
            const copyBtn = wrap.createEl("button", { text: "Copy" });
            copyBtn.style.cssText = "flex-shrink: 0;";
            copyBtn.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(s.body || "");
                    copyBtn.setText("Copied ✓");
                    setTimeout(() => copyBtn.setText("Copy"), 1500);
                } catch {
                    copyBtn.setText("Failed");
                }
            });
        }
    }
    onClose() { this.contentEl.empty(); }
}

// Periodic Ritual: modal that displays a built-in boundary's source code in
// a scrollable code block. Triggered from the View source button on a
// built-in boundary card in the Boundaries tab. Selectable + copy button.
class PRBoundarySourceModal extends Modal {
    constructor(app, name, source) {
        super(app);
        this.detectorName = name;
        this.source = source || "// (no source available)";
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Header row: title + copy button on the right
        const header = contentEl.createDiv();
        header.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;";
        header.createEl("h3", { text: `${this.detectorName} — source` }).style.margin = "0";

        const copyBtn = header.createEl("button", { text: "Copy" });
        copyBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(this.source);
                copyBtn.setText("Copied ✓");
                setTimeout(() => copyBtn.setText("Copy"), 1500);
            } catch (e) {
                // Fallback: select the pre's text and let the user Cmd+C
                const range = document.createRange();
                range.selectNodeContents(pre);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                copyBtn.setText("Selected — Cmd+C");
                setTimeout(() => copyBtn.setText("Copy"), 2000);
            }
        });

        const note = contentEl.createEl("p");
        note.style.cssText = "color: var(--text-muted); font-size: 0.9em; margin-top: 0;";
        note.setText("Standalone JS module form of the built-in detector. Click Copy to grab it, or use \"Fork as custom\" on the detector card to drop a copy into your vault as a custom boundary you can edit.");

        const pre = contentEl.createEl("pre");
        pre.style.cssText = "background: var(--background-secondary); padding: 12px; border-radius: 6px; max-height: 60vh; overflow: auto; font-size: 0.85em; user-select: text; -webkit-user-select: text; cursor: text;";
        const code = pre.createEl("code");
        code.style.cssText = "user-select: text; -webkit-user-select: text;";
        code.setText(this.source);
    }
    onClose() { this.contentEl.empty(); }
}

// Periodic Ritual: fuzzy picker for .js files in the vault. Used by the
// Custom Boundary script-path picker.
class PRJSFileSuggestModal extends FuzzySuggestModal {
    constructor(app, onChoose) {
        super(app);
        this.onChooseCallback = onChoose;
        this.setPlaceholder("Pick a .js file from your vault…");
    }
    getItems() {
        return this.app.vault.getFiles().filter(f => f.extension === "js");
    }
    getItemText(file) { return file.path; }
    onChooseItem(file) { this.onChooseCallback(file); }
}

// Periodic Ritual: token reference modal. Shows the available naming
// tokens for a given boundary detector. Opens from the "Syntax reference"
// link on the container card.
class PRTokenReferenceModal extends Modal {
    constructor(app, detectorId) {
        super(app);
        this.detectorId = detectorId || "calendar-week";
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "Naming tokens" });

        const subtitle = contentEl.createEl("p");
        subtitle.style.cssText = "color: var(--text-muted); font-size: 0.9em;";
        subtitle.setText(`Tokens available for boundary detector: ${this.detectorId}`);

        // Token catalog: the union of common tokens plus per-detector extras.
        const COMMON = [
            { token: "{{year}}", desc: "4-digit year, e.g. 2026" },
            { token: "{{month}}", desc: "2-digit month, e.g. 04" },
            { token: "{{month-name}}", desc: "Full month name, e.g. April" },
            { token: "{{day}}", desc: "2-digit day, e.g. 10" },
            { token: "{{date}}", desc: "ISO date of period start, e.g. 2026-04-10" },
            { token: "{{cycle}}", desc: "Detector-specific cycle number" },
        ];
        const PER_DETECTOR = {
            "calendar-week": [
                { token: "{{week}}", desc: "ISO week number, e.g. 15" },
                { token: "{{week-start}}", desc: "ISO date of week start" },
                { token: "{{week-end}}", desc: "ISO date of week end" },
            ],
            "calendar-month": [
                { token: "{{month-start}}", desc: "ISO date of 1st of month" },
                { token: "{{month-end}}", desc: "ISO date of last day of month" },
            ],
            "calendar-quarter": [
                { token: "{{quarter}}", desc: "Quarter number 1-4" },
                { token: "{{quarter-name}}", desc: "Q1 / Q2 / Q3 / Q4" },
                { token: "{{quarter-start}}", desc: "ISO date of quarter start" },
                { token: "{{quarter-end}}", desc: "ISO date of quarter end" },
            ],
            "calendar-year": [
                { token: "{{year-start}}", desc: "ISO date of January 1" },
                { token: "{{year-end}}", desc: "ISO date of December 31" },
            ],
            "lunar-cycle": [
                { token: "{{phase}}", desc: "Phase name (always \"New Moon\" — cycle starts here)" },
                { token: "{{phase-name}}", desc: "Same as phase" },
                { token: "{{phase-short}}", desc: "Short phase id (\"new\")" },
                { token: "{{phase-emoji}}", desc: "🌑 (always — cycle starts at new moon)" },
                { token: "{{sign}}", desc: "Moon's zodiac sign at cycle start (if astrology toggle on)" },
                { token: "{{sign-glyph}}", desc: "Sign glyph (if astrology toggle on)" },
                { token: "{{moon-sign}}", desc: "Moon's zodiac sign (always, no toggle)" },
                { token: "{{moon-glyph}}", desc: "Moon's sign glyph (always, no toggle)" },
                { token: "{{sun-sign}}", desc: "Sun's zodiac sign at cycle start" },
                { token: "{{sun-glyph}}", desc: "Sun's sign glyph at cycle start" },
            ],
            "lunar-phase": [
                { token: "{{phase}}", desc: "New Moon / First Quarter / Full Moon / Last Quarter" },
                { token: "{{phase-name}}", desc: "Same as phase" },
                { token: "{{phase-short}}", desc: "new / q1 / full / q3" },
                { token: "{{phase-emoji}}", desc: "🌑 / 🌓 / 🌕 / 🌗 — varies by phase" },
                { token: "{{sign}}", desc: "Moon's zodiac sign (if astrology toggle on)" },
                { token: "{{sign-glyph}}", desc: "Sign glyph (if astrology toggle on)" },
                { token: "{{moon-sign}}", desc: "Moon's zodiac sign (always, no toggle)" },
                { token: "{{moon-glyph}}", desc: "Moon's sign glyph (always, no toggle)" },
            ],
            "solar-cycle": [
                { token: "{{cycle}}", desc: "Year of the Aries ingress, e.g. 2026" },
                { token: "{{cycle-start}}", desc: "ISO date of the Aries ingress (cycle start)" },
                { token: "{{cycle-end}}", desc: "ISO date of the day before next year's Aries ingress" },
            ],
            "sun-ingress": [
                { token: "{{sign}}", desc: "Zodiac sign of the Sun, e.g. Aries (if astrology toggle on)" },
                { token: "{{sign-glyph}}", desc: "Sign glyph, e.g. ♈" },
                { token: "{{term}}", desc: "Solar term name (English), e.g. Spring Equinox" },
                { token: "{{term-cn}}", desc: "Solar term name (Chinese), e.g. 春分" },
            ],
        };

        const all = [...COMMON, ...(PER_DETECTOR[this.detectorId] || [])];
        const list = contentEl.createEl("div");
        list.style.cssText = "display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin-top: 8px;";
        for (const t of all) {
            const tk = list.createEl("code", { text: t.token });
            tk.style.cssText = "color: var(--interactive-accent); font-weight: 600;";
            const desc = list.createEl("span", { text: t.desc });
            desc.style.color = "var(--text-muted)";
        }

        const example = contentEl.createEl("p");
        example.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin-top: 16px;";
        example.setText("Example: W{{week}}-{{year}} → W15-2026");
    }
    onClose() { this.contentEl.empty(); }
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
        this.addRibbonIcon("calendar-days", "Zodiac Calendar", () => this.activateCalendarView());

        // Phase 10: Periodic Ritual graph view
        this.registerView(PR_GRAPH_VIEW_TYPE, (leaf) => new PRGraphView(leaf, this));
        this.addRibbonIcon("git-fork", "Periodic Ritual Graph", () => this.activatePRGraphView());

        // Phase 3: auto-generation on load. Boundary-driven catch-up for any
        // enabled Periodic Ritual containers whose periods have crossed since
        // the last run. Deferred ~2 seconds so other plugins (Moon Phase /
        // Helios) finish initializing first — boundary detectors in later
        // phases will depend on them.
        if (this.settings.prAutoGenerateOnLoad) {
            setTimeout(() => {
                this.runPRAutoGenerate().catch(e => {
                    console.error("Periodic Ritual: auto-generate failed", e);
                });
            }, 2000);
        }
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

    // Phase 10: open the Periodic Ritual graph view in a new tab.
    async activatePRGraphView() {
        const existing = this.app.workspace.getLeavesOfType(PR_GRAPH_VIEW_TYPE);
        if (existing.length) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.setViewState({ type: PR_GRAPH_VIEW_TYPE, active: true });
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

    // ─── Calendar boundaries (Phase 4a) ───

    // Calendar month containing `date`. Reuses the same logic as the legacy
    // getCalendarContainerData but exposes it through the PR detector dispatch.
    getCurrentCalendarMonthData(date) {
        const d = date || new Date();
        const start = getMonthStart(d);
        const end = getMonthEnd(d);
        return {
            start, end,
            tokens: {
                year: String(d.getFullYear()),
                month: String(d.getMonth() + 1).padStart(2, "0"),
                "month-name": monthName(d),
                day: String(d.getDate()).padStart(2, "0"),
                date: formatDate(start),
                "month-start": formatDate(start),
                "month-end": formatDate(end),
                cycle: String(d.getMonth() + 1).padStart(2, "0"),
            },
        };
    }

    // Calendar quarter containing `date`. Q1 = Jan–Mar, Q2 = Apr–Jun,
    // Q3 = Jul–Sep, Q4 = Oct–Dec. The container's name is left to the user
    // (they might call this "Chapter", "Quarter", "Q1", or anything else).
    getCurrentCalendarQuarterData(date) {
        const d = date || new Date();
        const year = d.getFullYear();
        const quarterIdx = Math.floor(d.getMonth() / 3); // 0..3
        const start = new Date(year, quarterIdx * 3, 1);
        const end = new Date(year, quarterIdx * 3 + 3, 0); // last day of last month in quarter
        const quarterNum = quarterIdx + 1;
        return {
            start, end,
            tokens: {
                year: String(year),
                month: String(d.getMonth() + 1).padStart(2, "0"),
                "month-name": monthName(d),
                day: String(d.getDate()).padStart(2, "0"),
                date: formatDate(start),
                quarter: String(quarterNum),
                "quarter-name": `Q${quarterNum}`,
                "quarter-start": formatDate(start),
                "quarter-end": formatDate(end),
                cycle: String(quarterNum),
            },
        };
    }

    // Calendar year containing `date`. The container's name is left to the
    // user (they might call this "Book", "Year", or the year number).
    getCurrentCalendarYearData(date) {
        const d = date || new Date();
        const year = d.getFullYear();
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31);
        return {
            start, end,
            tokens: {
                year: String(year),
                month: String(d.getMonth() + 1).padStart(2, "0"),
                "month-name": monthName(d),
                day: String(d.getDate()).padStart(2, "0"),
                date: formatDate(start),
                "year-start": formatDate(start),
                "year-end": formatDate(end),
                cycle: String(year),
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
                "phase-name": "New Moon",
                "phase-short": "new",
                "phase-emoji": MOON_PHASE_EMOJI["New Moon"],
                sign: this.settings.includeSignGlyphs ? sign : "",
                "sign-glyph": this.settings.includeSignGlyphs ? (SIGN_GLYPHS[sign] || "") : "",
                "moon-sign": sign,
                "moon-glyph": SIGN_GLYPHS[sign] || "",
                "sun-sign": sunSign,
                "sun-glyph": SIGN_GLYPHS[sunSign] || "",
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
                "phase-name": phase,             // alias for naming clarity
                "phase-short": MOON_PHASE_SHORT[phase],
                "phase-emoji": MOON_PHASE_EMOJI[phase] || "",
                sign: this.settings.includeSignGlyphs ? sign : "",
                "sign-glyph": this.settings.includeSignGlyphs ? (SIGN_GLYPHS[sign] || "") : "",
                "moon-sign": sign,                // raw moon sign without astrology toggle
                "moon-glyph": SIGN_GLYPHS[sign] || "",
                eclipse: "",
            },
        };
    }

    // ─── Solar boundaries ───

    // Solar Cycle: one tropical year, anchored on the Aries ingress.
    // Different from Calendar Year (Jan 1 → Dec 31) — Solar Cycle starts
    // when the Sun enters Aries (Spring Equinox) and ends the day before
    // the next Aries ingress.
    async getCurrentSolarCycleData(date) {
        const d = date || new Date();
        const searchStart = addDays(d, -400);
        const searchEnd = addDays(d, 400);
        const raw = await this.fetchSunIngresses(searchStart, searchEnd);

        const ariesIngresses = (Array.isArray(raw) ? raw : raw.ingresses || [])
            .map(ing => Object.assign({}, ing, {
                dateObj: new Date(ing.date || ing.exactDate || ing.timestamp),
                sign: ing.sign || ing.toSign || "",
            }))
            .filter(ing => ing.sign === "Aries")
            .sort((a, b) => a.dateObj - b.dateObj);

        let prev = null, next = null;
        for (const ing of ariesIngresses) {
            if (ing.dateObj <= d) prev = ing;
            else if (!next) next = ing;
        }
        if (!prev) throw new Error("No prior Aries ingress found in 400-day window");

        const start = startOfDay(prev.dateObj);
        const end = next ? startOfDay(addDays(next.dateObj, -1)) : addDays(start, 364);
        const year = start.getFullYear();

        return {
            start, end,
            tokens: {
                year: String(year),
                month: String(start.getMonth() + 1).padStart(2, "0"),
                "month-name": monthName(start),
                day: String(start.getDate()).padStart(2, "0"),
                date: formatDate(start),
                cycle: String(year),
                "cycle-start": formatDate(start),
                "cycle-end": formatDate(end),
            },
        };
    }

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

    // Boundary detector dispatcher. Async because helios-backed detectors
    // (lunar / solar) hit a local server. Calendar detectors are sync but
    // returned wrapped in a resolved promise via async.
    //
    // Phase 4a: calendar week/month/quarter/year (pure date math).
    // Phase 4b: lunar-cycle, lunar-phase, sun-ingress (helios-backed).
    // Phase 4c: custom JS module backends.
    async getPRBoundaryData(detector, date) {
        const d = date || new Date();
        // Custom boundaries: id format is "custom:<custom-boundary-id>".
        // The actual calculation lives in a JS file in the user's vault.
        if (typeof detector === "string" && detector.startsWith("custom:")) {
            const cbId = detector.slice("custom:".length);
            return await this.runPRCustomBoundary(cbId, d);
        }
        switch (detector) {
            case "calendar-week":    return this.getCurrentWeekData(d);
            case "calendar-month":   return this.getCurrentCalendarMonthData(d);
            case "calendar-quarter": return this.getCurrentCalendarQuarterData(d);
            case "calendar-year":    return this.getCurrentCalendarYearData(d);
            // Helios-backed (Phase 4b). These reuse the existing legacy
            // helpers verbatim — same shape, same fields. Gating on
            // hasMoonPlugin() happens in the dropdown so the user can't
            // pick these without the dependency installed.
            case "lunar-cycle":      return await this.getLunarContainerData(d);
            case "lunar-phase":      return await this.getCurrentPhaseData(d);
            case "solar-cycle":      return await this.getCurrentSolarCycleData(d);
            case "sun-ingress":      return await this.getSolarContainerData(d);
            default:
                throw new Error(`Boundary detector "${detector}" is not implemented yet`);
        }
    }

    // Look up a custom boundary by id.
    getPRCustomBoundary(cbId) {
        return (this.settings.prCustomBoundaries || []).find(c => c.id === cbId);
    }

    // Load and execute a user-defined boundary script. Same wrapper pattern
    // Templater uses for executing user JS scripts inside the vault.
    //
    // The script must:
    //   module.exports = function(date, app, plugin) {
    //       return { start: <Date>, end: <Date>, tokens: { ... } };
    //   };
    //
    // start/end are JS Date objects, tokens is a flat string-keyed object
    // matching the same shape the built-in detectors return.
    async runPRCustomBoundary(cbId, date) {
        const cb = this.getPRCustomBoundary(cbId);
        if (!cb) throw new Error(`Custom boundary "${cbId}" not found in settings`);
        if (!cb.scriptPath) throw new Error(`Custom boundary "${cb.name}" has no script path`);

        const file = this.app.vault.getAbstractFileByPath(cb.scriptPath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`Custom boundary script not found in vault: ${cb.scriptPath}`);
        }

        const source = await this.app.vault.read(file);

        let mod;
        try {
            // Wrap as a CommonJS module: pass module/exports/require so the
            // user's script can use `module.exports = function(...)` and
            // `require("obsidian")` if it needs requestUrl etc.
            const wrapper = new Function("module", "exports", "require", source);
            const moduleObj = { exports: {} };
            wrapper(moduleObj, moduleObj.exports, require);
            mod = moduleObj.exports;
        } catch (e) {
            throw new Error(`Error in custom boundary "${cb.name}" while loading script: ${e.message}`);
        }

        if (typeof mod !== "function") {
            throw new Error(`Custom boundary "${cb.name}" script must export a function: module.exports = function(date, app, plugin) { ... }`);
        }

        let result;
        try {
            result = await mod(date, this.app, this);
        } catch (e) {
            throw new Error(`Error running custom boundary "${cb.name}": ${e.message}`);
        }

        if (!result || !(result.start instanceof Date) || !(result.end instanceof Date) || !result.tokens) {
            throw new Error(`Custom boundary "${cb.name}" must return { start: Date, end: Date, tokens: object }`);
        }
        return result;
    }

    // Resolve the orienting description for any boundary detector — built-in
    // or custom. Used by the LLM aggregation pass to prepend context about
    // the period to the system prompt.
    getPRBoundaryDescription(detector) {
        if (typeof detector === "string" && detector.startsWith("custom:")) {
            const cbId = detector.slice("custom:".length);
            const cb = this.getPRCustomBoundary(cbId);
            return cb ? (cb.description || "") : "";
        }
        const info = BUILT_IN_BOUNDARY_INFO[detector];
        return info ? (info.description || "") : "";
    }

    // List of detectors available in the current build, for the settings dropdown.
    // Adding a detector = adding an entry here + a case in getPRBoundaryData.
    // Labels are deliberately neutral — the user names containers themselves.
    // Helios-backed detectors are gated on the Moon Phase plugin being
    // installed. Custom boundaries from the Boundaries tab are appended at
    // the end with `custom:<id>` ids.
    getPRAvailableBoundaryDetectors() {
        const list = [
            { id: "calendar-week",    label: "Calendar Week" },
            { id: "calendar-month",   label: "Calendar Month" },
            { id: "calendar-quarter", label: "Calendar Quarter" },
            { id: "calendar-year",    label: "Calendar Year" },
        ];
        if (this.hasMoonPlugin()) {
            list.push(
                { id: "lunar-cycle",  label: "Lunar Cycle (new moon → new moon)" },
                { id: "lunar-phase",  label: "Lunar Phase (one quarter of a moon cycle)" },
                { id: "solar-cycle",  label: "Solar Cycle (Aries ingress → next Aries ingress)" },
                { id: "sun-ingress",  label: "Solar Zodiac (one sign of the Sun)" },
            );
        }
        // Custom boundaries defined in the Boundaries tab
        for (const cb of (this.settings.prCustomBoundaries || [])) {
            list.push({ id: `custom:${cb.id}`, label: `${cb.name || "(unnamed)"} (custom)` });
        }
        return list;
    }

    // Generate a single container note from its config.
    // Reads template, resolves tokens, writes file, optionally runs LLM
    // aggregation, updates lastGeneratedEnd. Used by both manual "Generate
    // now" and the Phase 3 catch-up walker.
    //
    // opts: { silent?: boolean } — if silent, suppress per-note success
    // notices (used during multi-period catch-up to avoid notice spam).
    async generatePRContainerNote(container, dateOverride, opts = {}) {
        if (!container) { new Notice("No container provided"); return; }
        if (!container.template) {
            if (!opts.silent) new Notice(`${container.name}: no template configured`);
            return;
        }
        if (!container.naming) {
            if (!opts.silent) new Notice(`${container.name}: no naming convention configured`);
            return;
        }

        try {
            const data = await this.getPRBoundaryData(container.boundaryDetector, dateOverride);
            const fileName = this.resolveTokens(container.naming, data.tokens);
            const folderPath = container.saveDir || "";
            const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;

            // If a note for this period already exists, treat it as already
            // generated for the purpose of auto-catch-up: update
            // lastGeneratedEnd so subsequent runs skip past it.
            const existing = this.app.vault.getAbstractFileByPath(filePath);
            if (existing) {
                if (!opts.silent) new Notice(`Already exists: ${filePath}`);
                container.lastGeneratedEnd = formatDate(data.end);
                await this.saveSettings();
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

            // Update lastGeneratedEnd before any further work — the file
            // exists, that's the durable state. If the LLM call below fails,
            // catch-up next run won't try to recreate this file.
            container.lastGeneratedEnd = formatDate(data.end);
            await this.saveSettings();

            // Open the new file. Two reasons:
            //  1. The user clicked "Generate" — they expect to see the result.
            //  2. Templater scripts in the template that read
            //     app.workspace.getActiveFile() (instead of tp.file) will
            //     otherwise see whatever file was active when Generate was
            //     clicked, and fail with "wrong filename" errors.
            // During silent catch-up runs we still open the file briefly so
            // templater scripts can run; the user can navigate away after.
            try {
                const leaf = this.app.workspace.getLeaf(false);
                await leaf.openFile(file);
            } catch (e) {
                console.error("Periodic Ritual: failed to open generated file", e);
            }

            if (!opts.silent) new Notice(`Created: ${fileName}`);

            // Phase 2: LLM aggregation. If the container has both a service
            // and a system prompt configured, run the aggregation pass and
            // merge the parsed YAML response into the file's frontmatter.
            // Skipped silently when not configured.
            //
            // Phase 6 (rework): also skipped when the attached reflection
            // profile has replaceAutoLLM=true — in that case the user runs
            // reflection on demand instead. No attached reflection or
            // replaceAutoLLM=false = auto-LLM still runs here.
            const reflection = this.getPRReflectionForContainer(container);
            const skipAutoLLM = !!(reflection && reflection.replaceAutoLLM);
            const range = { start: data.start, end: data.end };
            if (container.llmServiceId && container.systemPromptFile && !skipAutoLLM) {
                await this.runPRLLMAggregation(container, file, range, opts);
            }

            // Phase 7: alignment passes. Run after main aggregation so the
            // alignment writes don't get clobbered. Skipped when the attached
            // reflection replaces auto-LLM — runPRContainerReflection runs
            // them then so the user still gets alignment output.
            if (!skipAutoLLM) {
                await this.runPRAlignmentsForContainer(container, file, range, opts);
            }

            return file;
        } catch (e) {
            if (!opts.silent) new Notice(`Error generating ${container.name}: ${e.message}`);
            console.error("Periodic Ritual:", e);
        }
    }

    // ─── Periodic Ritual LLM aggregation (Phase 2) ───

    getPRLLMService(id) {
        return (this.settings.prLLMServices || []).find(s => s.id === id);
    }

    // ─── Source payload (Phase 8a) ───
    //
    // Build a single string payload from a container's source notes in
    // [start, end]. Each source becomes a section with its frontmatter
    // and inline fields. Body content is intentionally excluded — the
    // user's templates have huge dataview blocks that aren't useful to
    // the LLM and would burn tokens.
    //
    // Source is determined by container.dataSource:
    //   { type: "daily" } (default) — daily notes folder
    //   { type: "container", containerId: "..." } — another PR container's
    //     notes whose pr-start falls in [start, end]
    async buildPRSourcePayload(container, start, end) {
        const ds = container?.dataSource || { type: "daily" };

        let sourceFiles = [];
        let sourceLabel = "daily notes";
        if (ds.type === "container" && ds.containerId) {
            const sourceContainer = (this.settings.prContainers || []).find(c => c.id === ds.containerId);
            if (sourceContainer) {
                sourceFiles = await this.findPRContainerNotesInRange(sourceContainer, start, end);
                sourceLabel = `${sourceContainer.name || "container"} notes`;
            }
        } else {
            const endInclusive = new Date(end);
            endInclusive.setHours(23, 59, 59, 999);
            sourceFiles = this.findDailyNotesInRange(start, endInclusive);
        }

        if (sourceFiles.length === 0) {
            return { count: 0, text: `(no ${sourceLabel} in range)`, label: sourceLabel };
        }

        const sections = [];
        for (const file of sourceFiles) {
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

        return { count: sourceFiles.length, text: sections.join("\n\n---\n\n"), label: sourceLabel };
    }

    // Parse a Periodic Ritual metadata blob like
    //   "id=pr-xxx boundary=calendar-week start=2026-04-06 end=2026-04-12"
    // into { id, boundary, start, end }. Returns null if the input doesn't
    // look like a PR blob.
    parsePRMetadataBlob(blob) {
        if (!blob || typeof blob !== "string") return null;
        const stripped = blob.replace(/^["']|["']$/g, "").trim();
        const result = {};
        for (const part of stripped.split(/\s+/)) {
            const idx = part.indexOf("=");
            if (idx > 0) result[part.slice(0, idx)] = part.slice(idx + 1);
        }
        return result.id || result.start ? result : null;
    }

    // Read PR metadata from a file regardless of placement (frontmatter or
    // inline marker). Returns { id, boundary, start, end } or null.
    async readPRMetadataFromFile(file, sourceContainer) {
        const placement = sourceContainer?.metadataPlacement || "frontmatter";
        if (placement === "frontmatter") {
            const cache = this.app.metadataCache.getFileCache(file);
            const blob = cache?.frontmatter?.["periodic-ritual"];
            return this.parsePRMetadataBlob(blob);
        }
        if (placement === "inline") {
            const key = sourceContainer?.metadataInlineKey || "periodic-ritual";
            try {
                const content = await this.app.vault.read(file);
                const re = new RegExp(`(?:^|\\s)${escapeRegex(key)}::\\s*([^\\n]+)`, "m");
                const m = content.match(re);
                return m ? this.parsePRMetadataBlob(m[1]) : null;
            } catch (e) {
                return null;
            }
        }
        // placement === "none" — no metadata to read
        return null;
    }

    // Find all notes from a given source container whose pr-start falls
    // inside [start, end]. Returns sorted by pr-start ascending.
    async findPRContainerNotesInRange(sourceContainer, start, end) {
        if (!sourceContainer || !sourceContainer.saveDir) return [];
        const dirPath = sourceContainer.saveDir;
        const files = this.app.vault.getMarkdownFiles().filter(f =>
            f.path === dirPath || f.path.startsWith(dirPath + "/") || f.parent?.path === dirPath
        );

        const matches = [];
        for (const file of files) {
            const meta = await this.readPRMetadataFromFile(file, sourceContainer);
            if (!meta || !meta.start || !meta.id) continue;
            // Filter by container id so we don't grab notes from other
            // containers that happen to live in the same folder.
            if (meta.id !== sourceContainer.id) continue;
            const noteStart = new Date(meta.start);
            if (isNaN(noteStart.getTime())) continue;
            if (noteStart >= start && noteStart <= end) {
                matches.push({ file, sortKey: noteStart });
            }
        }
        matches.sort((a, b) => a.sortKey - b.sortKey);
        return matches.map(m => m.file);
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

    // Capture the last LLM call (system prompt + user message + raw response)
    // for the Debug modal. Updated by runPRLLMAggregation on every call.
    recordPRLastLLMCall(payload) {
        this.lastPRLLMCall = payload;
    }

    async runPRLLMAggregation(container, file, range, opts = {}) {
        const service = this.getPRLLMService(container.llmServiceId);
        if (!service) {
            if (!opts.silent) new Notice(`${container.name}: LLM service not found`);
            return;
        }
        if (!service.model) {
            if (!opts.silent) new Notice(`${container.name}: LLM service "${service.name}" has no model selected`);
            return;
        }

        // Read the system prompt MD file
        let systemPrompt = "";
        try {
            const promptFile = this.app.vault.getAbstractFileByPath(container.systemPromptFile);
            if (!promptFile || !(promptFile instanceof TFile)) {
                if (!opts.silent) new Notice(`${container.name}: system prompt file not found: ${container.systemPromptFile}`);
                return;
            }
            systemPrompt = await this.app.vault.read(promptFile);
        } catch (e) {
            if (!opts.silent) new Notice(`${container.name}: failed to read system prompt — ${e.message}`);
            return;
        }

        // Phase 4c: prepend the boundary description to the system prompt.
        // Built-in detectors have a baked description; custom boundaries
        // get whatever the user typed in the Boundaries tab. The prepend
        // gives the LLM orienting context about WHAT KIND of period it's
        // looking at — useful for non-obvious boundaries (Ki cycles, lunar
        // phases, custom arcs) where the calculation is opaque to the LLM.
        const boundaryDesc = this.getPRBoundaryDescription(container.boundaryDetector);
        if (boundaryDesc && boundaryDesc.trim()) {
            systemPrompt = `# Period type\n${boundaryDesc.trim()}\n\n---\n\n${systemPrompt}`;
        }

        // Phase 6 (rework): if a reflection profile is in play and it has
        // a promptPrepend, layer it on top during reflection runs only.
        if (opts.reflection && opts.reflection.promptPrepend && opts.reflection.promptPrepend.trim()) {
            systemPrompt = `# Reflection guidance\n${opts.reflection.promptPrepend.trim()}\n\n---\n\n${systemPrompt}`;
        }

        // Build the source payload (daily notes by default, or another
        // PR container's notes when dataSource is set to container).
        const payload = await this.buildPRSourcePayload(container, range.start, range.end);

        // Compose the user message. Three optional sections beyond the
        // standard period header + daily notes:
        //   1. Reflection answers (Phase 6) — when opts.answers is provided
        //      from the manual reflection modal.
        //   2. Previous frontmatter (Phase 6) — when opts.includePreviousFrontmatter
        //      is set, used in "both" mode re-runs so the LLM sees what was
        //      auto-aggregated before and can build on it instead of starting
        //      from scratch.
        //   3. (none yet) — Phase 7 will add alignment context.
        const parts = [
            `# Period`,
            `start: ${formatDate(range.start)}`,
            `end: ${formatDate(range.end)}`,
            `source: ${payload.label || "daily notes"}`,
            `count: ${payload.count}`,
            "",
        ];

        // Reflection answers section. The questions live on the reflection
        // profile (passed in via opts.reflection) since Phase 6 rework moved
        // them out of the container. When opts.injectedVars is present, the
        // resolved context that was shown to the user in the modal also
        // gets sent to the LLM as a > blockquote line under each question,
        // so the model sees what the user was responding to.
        const reflectionQuestions = opts.reflection?.questions || [];
        const injected = Array.isArray(opts.injectedVars) ? opts.injectedVars : [];
        if (Array.isArray(opts.answers) && opts.answers.length > 0 && reflectionQuestions.length > 0) {
            parts.push("# Reflection answers", "");
            for (let i = 0; i < reflectionQuestions.length; i++) {
                const ans = (opts.answers[i] || "").trim();
                if (!ans) continue;
                parts.push(`**Q: ${reflectionQuestions[i].text}**`);
                const ctx = (injected[i] || "").trim();
                if (ctx) {
                    // Render multi-line context as multiple > lines
                    for (const line of ctx.split("\n")) parts.push(`> ${line}`);
                }
                parts.push(`A: ${ans}`);
                parts.push("");
            }
            parts.push("");
        }

        if (opts.includePreviousFrontmatter && file) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};
            const lines = [];
            for (const [k, v] of Object.entries(fm)) {
                if (k === "periodic-ritual" || k === "position") continue;
                if (k.startsWith("pr-")) continue;
                if (v === null || v === undefined) continue;
                if (typeof v === "object") {
                    lines.push(`${k}: ${JSON.stringify(v)}`);
                } else {
                    lines.push(`${k}: ${v}`);
                }
            }
            if (lines.length > 0) {
                parts.push("# Previous frontmatter (from earlier auto-aggregation)", "", ...lines, "");
            }
        }

        parts.push(`# Source notes (${payload.label || "daily notes"})`, "", payload.text);

        const userMessage = parts.join("\n");

        // Call the LLM
        const provider = PROVIDERS[service.provider];
        if (!provider) {
            new Notice(`${container.name}: unknown provider "${service.provider}"`);
            return;
        }

        let responseText;
        let responseStatus = 0;
        let responseRawText = "";
        try {
            if (!opts.silent) new Notice(`${container.name}: aggregating ${payload.count} daily note(s) via ${service.name}…`);
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
            responseStatus = r.status;
            responseRawText = r.text || "";
            // Capture for the debug modal regardless of success/failure
            this.recordPRLastLLMCall({
                timestamp: new Date().toISOString(),
                container: container.name,
                service: service.name,
                provider: service.provider,
                model: service.model,
                url,
                requestHeaders: headers,
                requestBody: body,
                responseStatus,
                responseRaw: responseRawText,
                systemPrompt,
                userMessage,
            });
            if (r.status < 200 || r.status >= 300) {
                throw new Error(`${r.status}: ${(r.text || "").slice(0, 300)}`);
            }
            responseText = provider.extractText(r.json);
        } catch (e) {
            // Always surface LLM errors, even during silent catch-up — the
            // user needs to know if their key expired or rate limit hit.
            new Notice(`${container.name}: LLM call failed — ${e.message}`);
            console.error("Periodic Ritual LLM error:", e);
            return;
        }

        if (!responseText) {
            if (!opts.silent) new Notice(`${container.name}: LLM returned an empty response`);
            return;
        }

        // Parse YAML and merge into frontmatter
        const parsed = this.parsePRLLMResponse(responseText);
        const keys = Object.keys(parsed);
        if (keys.length === 0) {
            if (!opts.silent) new Notice(`${container.name}: LLM response had no fields to write`);
            return;
        }

        try {
            await this.app.fileManager.processFrontMatter(file, fm => {
                for (const k of keys) fm[k] = parsed[k];
            });
            if (!opts.silent) new Notice(`${container.name}: wrote ${keys.length} field(s) from LLM`);
        } catch (e) {
            if (!opts.silent) new Notice(`${container.name}: failed to write frontmatter — ${e.message}`);
            console.error("Periodic Ritual processFrontMatter error:", e);
        }
    }

    // ─── Periodic Ritual reflection (Phase 6) ───

    // Find the most recently generated note for a container by walking back
    // from lastGeneratedEnd through the boundary detector to recover the
    // period that produced the file, then resolving the naming convention
    // against that period's tokens.
    async findMostRecentPRContainerNote(container) {
        if (!container || !container.lastGeneratedEnd || !container.naming) return null;
        const periodEndDate = new Date(container.lastGeneratedEnd);
        if (isNaN(periodEndDate.getTime())) return null;
        try {
            const data = await this.getPRBoundaryData(container.boundaryDetector, periodEndDate);
            const fileName = this.resolveTokens(container.naming, data.tokens);
            const folderPath = container.saveDir || "";
            const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
            const file = this.app.vault.getAbstractFileByPath(filePath);
            return (file && file instanceof TFile) ? file : null;
        } catch (e) {
            console.error("Periodic Ritual: findMostRecentPRContainerNote failed", e);
            return null;
        }
    }

    // Find the container's PREVIOUS note (one period before the most recent one).
    // Used by question variable injection when varSource = "previous-period".
    async findPreviousPRContainerNote(container) {
        if (!container || !container.lastGeneratedEnd || !container.naming) return null;
        const recentEndDate = new Date(container.lastGeneratedEnd);
        if (isNaN(recentEndDate.getTime())) return null;
        try {
            // Step into the period before lastGeneratedEnd by going one day
            // earlier than the start of the most recent period.
            const recentRange = await this.getPRBoundaryData(container.boundaryDetector, recentEndDate);
            const dayBeforeRecentStart = addDays(recentRange.start, -1);
            const previousRange = await this.getPRBoundaryData(container.boundaryDetector, dayBeforeRecentStart);
            const fileName = this.resolveTokens(container.naming, previousRange.tokens);
            const folderPath = container.saveDir || "";
            const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
            const file = this.app.vault.getAbstractFileByPath(filePath);
            return (file && file instanceof TFile) ? file : null;
        } catch (e) {
            console.error("Periodic Ritual: findPreviousPRContainerNote failed", e);
            return null;
        }
    }

    // Resolve a single question's variable injection. Returns the string to
    // show above the question, or empty string if no injection or if the
    // referenced field/note doesn't exist.
    //
    // Source resolution (Phase 8b):
    //   "previous-period"   — previous note of the SAME container
    //   "note"              — a specific .md file by path
    //   "container-current" — current corresponding note of another container
    //                         (uses findMostRecentPRContainerNote on that container)
    //   "container-previous"— previous note of another container
    async resolvePRInjectedVar(question, container) {
        if (!question || !question.injectVar || !question.varField) return "";
        let sourceFile = null;
        const src = question.varSource || "previous-period";
        if (src === "note" && question.varNotePath) {
            const f = this.app.vault.getAbstractFileByPath(question.varNotePath);
            if (f && f instanceof TFile) sourceFile = f;
        } else if (src === "container-current" && question.varSourceContainerId) {
            const otherContainer = (this.settings.prContainers || []).find(c => c.id === question.varSourceContainerId);
            if (otherContainer) sourceFile = await this.findMostRecentPRContainerNote(otherContainer);
        } else if (src === "container-previous" && question.varSourceContainerId) {
            const otherContainer = (this.settings.prContainers || []).find(c => c.id === question.varSourceContainerId);
            if (otherContainer) sourceFile = await this.findPreviousPRContainerNote(otherContainer);
        } else {
            // Default: previous-period of THIS container
            sourceFile = await this.findPreviousPRContainerNote(container);
        }
        if (!sourceFile) return "";
        try {
            if ((question.varFieldType || "inline") === "frontmatter") {
                const cache = this.app.metadataCache.getFileCache(sourceFile);
                const v = cache?.frontmatter?.[question.varField];
                return (v === null || v === undefined) ? "" : String(v);
            }
            // Inline field — read body and regex match
            const content = await this.app.vault.read(sourceFile);
            const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
            const re = new RegExp(`^${escapeRegex(question.varField)}::\\s*(.+)$`, "m");
            const m = body.match(re);
            return m ? m[1].trim() : "";
        } catch (e) {
            console.error("Periodic Ritual: resolvePRInjectedVar failed", e);
            return "";
        }
    }

    // Find today's daily note based on the configured Daily notes folder
    // and the standard Daily Ritual filename format. Used for cross-plugin
    // output targets ("today's daily note") so PR reflection answers can
    // land on the user's daily note instead of (or in addition to) PR
    // container notes.
    findTodaysDailyNote() {
        const folder = this.settings.dailyNotesFolder || "";
        const today = new Date();
        // Daily Ritual / Templater convention: "Friday, April 10th 2026"
        const files = this.app.vault.getMarkdownFiles().filter(f => {
            if (folder && !f.path.startsWith(folder + "/") && f.parent?.path !== folder) return false;
            const d = parseDateFromFilename(f.name);
            if (!d) return false;
            return d.getFullYear() === today.getFullYear()
                && d.getMonth() === today.getMonth()
                && d.getDate() === today.getDate();
        });
        return files[0] || null;
    }

    // Write a single answer to its configured output field. Default target
    // is the active container's file. When question.outputTargetContainer
    // is set, the answer goes to the corresponding current note of that
    // other PR container, OR to today's daily note when the special value
    // "daily-today" is used (cross-plugin Daily Ritual integration).
    // Inline fields go in the body; frontmatter fields go via
    // processFrontMatter so we don't hand-edit YAML.
    async writePRAnswerToField(activeFile, question, answer) {
        if (!question || !question.outputToField || !question.outputFieldName) return;
        const ans = (answer || "").trim();
        if (!ans) return;

        // Resolve target file: active container by default, or another
        // container's current note, or today's daily note.
        let file = activeFile;
        if (question.outputTargetContainer === "daily-today") {
            const dailyFile = this.findTodaysDailyNote();
            if (dailyFile) {
                file = dailyFile;
            } else {
                new Notice(`Question "${question.text}": no daily note for today found in ${this.settings.dailyNotesFolder || "vault root"}. Skipping output.`);
                return;
            }
        } else if (question.outputTargetContainer) {
            const targetContainer = (this.settings.prContainers || []).find(c => c.id === question.outputTargetContainer);
            if (targetContainer) {
                const targetFile = await this.findMostRecentPRContainerNote(targetContainer);
                if (targetFile) {
                    file = targetFile;
                } else {
                    new Notice(`Question "${question.text}": target container "${targetContainer.name}" has no recent note. Skipping output.`);
                    return;
                }
            }
        }
        if (!file) return;

        const fieldName = question.outputFieldName;
        const fieldType = question.outputFieldType || "inline";
        try {
            if (fieldType === "frontmatter") {
                await this.app.fileManager.processFrontMatter(file, fm => {
                    fm[fieldName] = ans;
                });
                return;
            }
            // Inline: replace existing `key:: ...` if present, else append
            let content = await this.app.vault.read(file);
            const re = new RegExp(`^(${escapeRegex(fieldName)}::).*$`, "m");
            if (re.test(content)) {
                content = content.replace(re, `$1 ${ans}`);
            } else {
                content = content.trimEnd() + `\n${fieldName}:: ${ans}\n`;
            }
            await this.app.vault.modify(file, content);
        } catch (e) {
            console.error(`Periodic Ritual: failed to write answer for question "${question.text}":`, e);
        }
    }

    // Look up the reflection profile attached to a container.
    getPRReflectionForContainer(container) {
        if (!container || !container.reflectionId) return null;
        return (this.settings.prReflections || []).find(r => r.id === container.reflectionId) || null;
    }

    // Open the reflection modal. On submit:
    //   1. Always: write each answer to its configured output field.
    //   2. If reflection.useLLM: run LLM aggregation with answers + injected
    //      context + (when not replacing auto) previous frontmatter.
    //   3. If reflection.replaceAutoLLM: alignments were skipped at boundary,
    //      so run them now. Otherwise they already ran in generatePRContainerNote.
    async runPRContainerReflection(container) {
        if (!container) { new Notice("No container provided"); return; }

        const reflection = this.getPRReflectionForContainer(container);
        if (!reflection) {
            new Notice(`${container.name}: no reflection profile attached. Pick one in the container settings.`);
            return;
        }
        if (!Array.isArray(reflection.questions) || reflection.questions.length === 0) {
            new Notice(`Reflection "${reflection.name}" has no questions. Add some in the Reflection tab.`);
            return;
        }
        // LLM service + system prompt are only required when this reflection
        // actually calls the LLM. Pure-Q&A reflections (useLLM=false) work
        // on containers without any LLM setup.
        if (reflection.useLLM && (!container.llmServiceId || !container.systemPromptFile)) {
            new Notice(`${container.name}: reflection with "Send answers to LLM" enabled requires both an LLM service and a system prompt on the container`);
            return;
        }

        const file = await this.findMostRecentPRContainerNote(container);
        if (!file) {
            new Notice(`${container.name}: no recent note found. Generate one first.`);
            return;
        }

        // Range is needed for the LLM call and the alignment passes. Pure
        // Q&A reflections don't need it — skip the resolution if everything
        // is going to be no-ops anyway.
        let range = null;
        if (reflection.useLLM || reflection.replaceAutoLLM) {
            try {
                range = await this.getPRBoundaryData(container.boundaryDetector, new Date(container.lastGeneratedEnd));
            } catch (e) {
                if (reflection.useLLM) {
                    new Notice(`${container.name}: could not resolve period — ${e.message}`);
                    return;
                }
                // For pure replaceAutoLLM with no LLM call, alignments will
                // be skipped silently below if range is null.
            }
        }

        // Resolve variable injection for each question before opening the
        // modal. The modal displays the resolved string above each question.
        // The same array is also sent to the LLM (when useLLM is on) so the
        // model sees the context the user was responding to.
        const injectedVars = [];
        for (const q of reflection.questions) {
            injectedVars.push(await this.resolvePRInjectedVar(q, container));
        }

        new ReflectionModal(this.app, reflection.questions, injectedVars, async (answers) => {
            // Step 1 — always: write each answer to its configured output
            // field. Persists raw answers regardless of LLM success or
            // whether the LLM is used at all.
            for (let i = 0; i < reflection.questions.length; i++) {
                await this.writePRAnswerToField(file, reflection.questions[i], answers[i]);
            }

            // Step 2 — optional LLM call. The reflection's useLLM toggle
            // controls whether this fires.
            if (reflection.useLLM) {
                await this.runPRLLMAggregation(container, file, range, {
                    answers,
                    injectedVars,
                    includePreviousFrontmatter: !reflection.replaceAutoLLM,
                    reflection,
                });
            }

            // Step 3 — alignments. Only fire here when the reflection
            // suppressed the boundary auto-aggregation; otherwise they
            // already ran in generatePRContainerNote and we'd duplicate.
            if (reflection.replaceAutoLLM && range) {
                await this.runPRAlignmentsForContainer(container, file, range, {});
            }

            new Notice(`${container.name}: reflection complete`);
        }).open();
    }

    // ─── Periodic Ritual alignments (Phase 7) ───

    // Find all alignments attached to a given container.
    getPRAlignmentsForContainer(containerId) {
        return (this.settings.prAlignments || []).filter(a => a.containerId === containerId);
    }

    // Run a single alignment pass against the container's date range.
    // Pulls the named daily field from every daily note in range, sends
    // the collected values to the LLM with the alignment description as
    // the system prompt, and writes the LLM's observation to a single
    // frontmatter key on the container note.
    //
    // Alignment passes are simpler than the main aggregation: one field,
    // one prompt (the description), one output key. The LLM gets a focused
    // task and returns a focused answer.
    async runPRAlignmentPass(alignment, container, file, range, opts = {}) {
        if (!alignment || !container || !file) return;
        if (!alignment.dataField) {
            if (!opts.silent) new Notice(`Alignment "${alignment.name}": no data field configured`);
            return;
        }
        if (!alignment.description || !alignment.description.trim()) {
            if (!opts.silent) new Notice(`Alignment "${alignment.name}": no description configured`);
            return;
        }

        const service = this.getPRLLMService(container.llmServiceId);
        if (!service || !service.model) {
            if (!opts.silent) new Notice(`Alignment "${alignment.name}": container has no usable LLM service`);
            return;
        }

        // Collect the named field from each daily note in range
        const endInclusive = new Date(range.end);
        endInclusive.setHours(23, 59, 59, 999);
        const dailies = this.findDailyNotesInRange(range.start, endInclusive);

        const entries = [];
        for (const dn of dailies) {
            let val = "";
            if (alignment.dataFieldType === "frontmatter") {
                const cache = this.app.metadataCache.getFileCache(dn);
                const v = cache?.frontmatter?.[alignment.dataField];
                val = (v === null || v === undefined) ? "" : String(v);
            } else {
                const content = await this.app.vault.read(dn);
                const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
                const re = new RegExp(`^${escapeRegex(alignment.dataField)}::\\s*(.+)$`, "m");
                const m = body.match(re);
                val = m ? m[1].trim() : "";
            }
            if (val) entries.push(`- ${dn.basename}: ${val}`);
        }

        // Compose the LLM payload
        const systemPrompt = [
            `# Alignment: ${alignment.name}`,
            "",
            alignment.description.trim(),
            "",
            "# Your task",
            "",
            `Look at the daily values below for the field "${alignment.dataField}" across the period. Surface patterns of consistency, drift, and absence — not compliance scoring. Return ONLY a single string: a short observation (1-3 sentences) on how this alignment is going. No YAML, no markdown headings, no preamble.`,
        ].join("\n");

        const userMessage = [
            `# Period`,
            `start: ${formatDate(range.start)}`,
            `end: ${formatDate(range.end)}`,
            `daily_count: ${dailies.length}`,
            `entries_with_value: ${entries.length}`,
            "",
            `# Daily values for "${alignment.dataField}"`,
            "",
            entries.length > 0 ? entries.join("\n") : "(no entries in range)",
        ].join("\n");

        const provider = PROVIDERS[service.provider];
        if (!provider) {
            if (!opts.silent) new Notice(`Alignment "${alignment.name}": unknown provider "${service.provider}"`);
            return;
        }

        let responseText;
        try {
            if (!opts.silent) new Notice(`Alignment "${alignment.name}": running…`);
            const url = provider.buildUrl(service);
            const body = provider.buildBody(userMessage, service, systemPrompt);
            const headers = {
                "Content-Type": "application/json",
                ...(provider.headers ? provider.headers(service) : {}),
            };
            const r = await requestUrl({
                url, method: "POST", headers,
                body: JSON.stringify(body),
                throw: false,
            });
            if (r.status < 200 || r.status >= 300) {
                throw new Error(`${r.status}: ${(r.text || "").slice(0, 300)}`);
            }
            responseText = provider.extractText(r.json);
        } catch (e) {
            new Notice(`Alignment "${alignment.name}" failed: ${e.message}`);
            console.error("Periodic Ritual alignment error:", e);
            return;
        }

        if (!responseText) {
            if (!opts.silent) new Notice(`Alignment "${alignment.name}": empty response`);
            return;
        }

        // Pick the output frontmatter key. Default: alignment_<sanitized-name>.
        const outputKey = (alignment.outputField || "").trim() || `alignment_${(alignment.name || "unnamed").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

        try {
            await this.app.fileManager.processFrontMatter(file, fm => {
                fm[outputKey] = responseText.trim();
            });
            if (!opts.silent) new Notice(`Alignment "${alignment.name}": wrote to ${outputKey}`);
        } catch (e) {
            new Notice(`Alignment "${alignment.name}": failed to write — ${e.message}`);
            console.error(e);
        }
    }

    // Run all alignments attached to a container after main aggregation.
    async runPRAlignmentsForContainer(container, file, range, opts = {}) {
        const alignments = this.getPRAlignmentsForContainer(container.id);
        if (alignments.length === 0) return;
        for (const a of alignments) {
            await this.runPRAlignmentPass(a, container, file, range, opts);
        }
    }

    // ─── Periodic Ritual reflection (Phase 6) ───

    // Walk all enabled containers and catch each one up to the current period.
    // Called from onload when prAutoGenerateOnLoad is true, or manually via
    // the "Catch up missed notes" command.
    //
    // Phase 8c: containers are processed in topological order based on
    // dataSource dependencies. If container A reads from container B
    // (A.dataSource = container:B), B must generate its current note
    // BEFORE A so A's auto-LLM can find the fresh source data. The sort
    // walks the dependency graph and processes leaves (sources) first.
    async runPRAutoGenerate() {
        const all = (this.settings.prContainers || []).filter(c => c.enabled);
        if (all.length === 0) {
            new Notice("Periodic Ritual: no enabled containers");
            return;
        }

        const sorted = this.toposortPRContainers(all);
        for (const container of sorted) {
            try {
                await this.catchUpPRContainer(container);
            } catch (e) {
                console.error(`Periodic Ritual: catch-up failed for ${container.name}`, e);
                new Notice(`Catch-up failed for ${container.name}: ${e.message}`);
            }
        }
    }

    // Topological sort of containers by dataSource dependencies.
    // Children (sources) come before parents (consumers). Containers with
    // no container dataSource are leaves and can be processed in any order.
    // Cycles are broken by falling back to original order with a warning.
    toposortPRContainers(containers) {
        const byId = new Map(containers.map(c => [c.id, c]));
        const visited = new Set();
        const visiting = new Set();
        const result = [];

        const visit = (c) => {
            if (visited.has(c.id)) return;
            if (visiting.has(c.id)) {
                console.warn(`Periodic Ritual: dataSource cycle detected at "${c.name}". Falling back to insertion order for cycle members.`);
                return;
            }
            visiting.add(c.id);
            const ds = c.dataSource;
            if (ds && ds.type === "container" && ds.containerId) {
                const dep = byId.get(ds.containerId);
                if (dep) visit(dep);
                // If the dep is disabled or not in the enabled set, we just
                // skip — A will read whatever is on disk for B even if B
                // wasn't generated this run.
            }
            visiting.delete(c.id);
            visited.add(c.id);
            result.push(c);
        };

        for (const c of containers) visit(c);
        return result;
    }

    // For one container: figure out which periods have been crossed since
    // lastGeneratedEnd and generate one note per missed period in chronological
    // order. Empty periods still produce a note — the existence of the note
    // is itself data.
    //
    // First-run case (lastGeneratedEnd unset): generate ONLY the current
    // period. Don't backfill the user's entire history — that's a separate
    // explicit operation, not catch-up.
    async catchUpPRContainer(container) {
        if (!container.template || !container.naming) {
            // Not yet configured — skip silently.
            return;
        }

        const now = new Date();
        const currentRange = await this.getPRBoundaryData(container.boundaryDetector, now);
        if (!currentRange) return;

        const generateAt = container.generateAt || "start";
        // In end mode, the current period only counts as "missed" once it's
        // ended. The walker uses this as the upper bound when collecting
        // periods to generate.
        const includeCurrent = generateAt === "start" || currentRange.end < now;

        // First-run case: no history.
        if (!container.lastGeneratedEnd) {
            if (generateAt === "end") {
                // First run end mode: generate the most recently ENDED period
                // (the one before today's period). Gives the user immediate
                // feedback instead of waiting an entire cycle.
                const previousPeriodDate = addDays(currentRange.start, -1);
                const previousRange = await this.getPRBoundaryData(container.boundaryDetector, previousPeriodDate);
                if (previousRange) {
                    await this.generatePRContainerNote(container, previousPeriodDate);
                }
                // If the current period has also ended (rare — only true if
                // the user installed mid-boundary), pick it up too.
                if (currentRange.end < now) {
                    await this.generatePRContainerNote(container, now);
                }
                return;
            }
            // Start mode first run: generate the current period.
            await this.generatePRContainerNote(container, now);
            return;
        }

        const lastEnd = new Date(container.lastGeneratedEnd);
        if (isNaN(lastEnd.getTime())) {
            console.warn(`Periodic Ritual: ${container.name} has invalid lastGeneratedEnd "${container.lastGeneratedEnd}", falling back to current period`);
            await this.generatePRContainerNote(container, now);
            return;
        }

        // If lastGeneratedEnd is at or past the current period's end, we're
        // up to date. Nothing to do.
        if (lastEnd >= currentRange.end) return;

        // Walk forward one period at a time, collecting period start dates.
        // In end mode, skip any period whose end is in the future.
        const periodDates = [];
        let cursor = addDays(lastEnd, 1);
        let safety = 0;
        while (cursor <= now && safety < 100) {
            safety++;
            const range = await this.getPRBoundaryData(container.boundaryDetector, cursor);
            if (!range) break;
            // End mode: skip periods that haven't fully ended yet.
            if (generateAt === "end" && range.end > now) {
                break;
            }
            periodDates.push(new Date(cursor));
            const nextCursor = addDays(range.end, 1);
            if (nextCursor <= cursor) {
                console.warn(`Periodic Ritual: ${container.name} boundary detector returned non-advancing range`, range);
                break;
            }
            cursor = nextCursor;
        }

        if (periodDates.length === 0) return;

        const multi = periodDates.length > 1;
        if (multi) {
            new Notice(`${container.name}: catching up ${periodDates.length} missed period(s)…`);
        }

        let created = 0;
        for (const periodDate of periodDates) {
            const result = await this.generatePRContainerNote(container, periodDate, { silent: multi });
            if (result) created++;
        }

        if (multi) {
            new Notice(`${container.name}: generated ${created} note(s)`);
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
        // The Zodiac Calendar command stays — the lunisolar sidebar grid is
        // independent of the legacy mode/reflection pipeline.
        this.addCommand({
            id: "open-calendar",
            name: "Open Zodiac Calendar",
            callback: () => this.activateCalendarView(),
        });

        // ─── Periodic Ritual commands (Phase 1+) ───
        this.addCommand({
            id: "pr-generate-container",
            name: "Periodic Ritual: Generate container note",
            callback: () => this.pickAndGeneratePRContainer(),
        });

        // Phase 3: manual catch-up trigger. Useful for testing and for
        // running catch-up after toggling auto-generate on without restarting.
        this.addCommand({
            id: "pr-catch-up",
            name: "Periodic Ritual: Catch up missed notes",
            callback: () => this.runPRAutoGenerate(),
        });

        // Phase 6: reflect on a container. Opens a fuzzy picker over
        // containers that have reflection enabled (mode != auto), then
        // opens the modal for the picked one.
        this.addCommand({
            id: "pr-reflect",
            name: "Periodic Ritual: Reflect on container",
            callback: () => this.pickAndReflectPRContainer(),
        });

        // Phase 9: debug — show the last LLM call's full payload.
        this.addCommand({
            id: "pr-debug-last-llm",
            name: "Periodic Ritual: Show last LLM call",
            callback: () => new PRDebugModal(this.app, this.lastPRLLMCall).open(),
        });

        // Phase 9: hierarchy diagram — show how containers / reflections /
        // alignments / LLM services connect, as a Mermaid flowchart.
        this.addCommand({
            id: "pr-hierarchy",
            name: "Periodic Ritual: Show hierarchy diagram",
            callback: () => new PRHierarchyModal(this.app, this).open(),
        });

        // Phase 10: open the node-based graph view.
        this.addCommand({
            id: "pr-graph",
            name: "Periodic Ritual: Open graph view",
            callback: () => this.activatePRGraphView(),
        });
    }

    // Phase 9: try to detect which container the active file belongs to
    // before falling back to the picker. The plugin stamps each generated
    // note with its container id (frontmatter or inline marker), so this is
    // a direct lookup against settings.prContainers.
    async detectPRContainerFromActiveFile() {
        const file = this.app.workspace.getActiveFile();
        if (!file) return null;
        const containers = this.settings.prContainers || [];

        // Try frontmatter first — fastest, no file read needed
        const cache = this.app.metadataCache.getFileCache(file);
        const fmBlob = cache?.frontmatter?.["periodic-ritual"];
        if (fmBlob) {
            const meta = this.parsePRMetadataBlob(fmBlob);
            if (meta?.id) {
                const c = containers.find(c => c.id === meta.id);
                if (c) return c;
            }
        }

        // Inline marker fallback — search the file body for any PR marker
        // matching any container's configured key
        const seenKeys = new Set();
        for (const c of containers) {
            if ((c.metadataPlacement || "frontmatter") !== "inline") continue;
            const key = c.metadataInlineKey || "periodic-ritual";
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
        }
        if (seenKeys.size > 0) {
            try {
                const content = await this.app.vault.read(file);
                for (const key of seenKeys) {
                    const re = new RegExp(`(?:^|\\s)${escapeRegex(key)}::\\s*([^\\n]+)`, "m");
                    const m = content.match(re);
                    if (m) {
                        const meta = this.parsePRMetadataBlob(m[1]);
                        if (meta?.id) {
                            const c = containers.find(c => c.id === meta.id);
                            if (c) return c;
                        }
                    }
                }
            } catch (_) { /* ignore */ }
        }
        return null;
    }

    pickAndReflectPRContainer() {
        // Phase 9: if the active file belongs to a PR container with a
        // reflection profile attached, run reflection on it directly
        // instead of opening the picker. The picker is the fallback.
        this.detectPRContainerFromActiveFile().then(detected => {
            if (detected && detected.reflectionId) {
                this.runPRContainerReflection(detected);
                return;
            }
            const containers = (this.settings.prContainers || []).filter(c => !!c.reflectionId);
            if (containers.length === 0) {
                new Notice("No Periodic Ritual containers have a reflection profile attached. Define one in the Reflection tab and pick it on a container in the Containers tab.");
                return;
            }
            const modal = new PRContainerPickerModal(this.app, containers, async (container) => {
                await this.runPRContainerReflection(container);
            });
            modal.setPlaceholder("Pick a container to reflect on…");
            modal.open();
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
// MOON_PHASE_EMOJI is defined at the top of the file alongside MOON_PHASES.

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

// ═══════════════════════════════════════════════════════════════
//  PERIODIC RITUAL — Graph view (Phase 10a)
// ═══════════════════════════════════════════════════════════════
//
// Node-based visual representation of the current PR configuration.
// Containers, reflections, alignments, LLM services, and boundaries
// are nodes; dataSource and attachment relationships are wires.
//
// v1 (10a-1): static rendering. Auto-layout if no saved positions.
//             Nodes display their key info; wires connect via beziers.
// v1 (10a-2): pan/zoom + drag nodes + persist positions.
// v1 (10a-3): click a node to open the settings tab to that primitive.
//
// DOM nodes inside an absolutely-positioned viewport, SVG layer
// behind for the wires. Both scale together via a CSS transform on
// the viewport. No third-party library — fully custom for PR.

const PR_GRAPH_VIEW_TYPE = "pr-graph-view";

class PRGraphView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.nodes = [];      // built from settings on render
        this.wires = [];      // built from settings on render
    }

    getViewType() { return PR_GRAPH_VIEW_TYPE; }
    getDisplayText() { return "Periodic Ritual Graph"; }
    getIcon() { return "git-fork"; }

    async onOpen() {
        this.render();
    }

    // ─── Build the model from settings ───

    buildGraphModel() {
        const s = this.plugin.settings;
        const containers = s.prContainers || [];
        const reflections = s.prReflections || [];
        const alignments = s.prAlignments || [];
        const services = s.prLLMServices || [];
        const customBoundaries = s.prCustomBoundaries || [];

        const nodes = [];
        const wires = [];

        // Track which boundaries / reflections / services / alignments are
        // actually referenced — only show used ones to keep the graph clean.
        const usedBoundaries = new Set();
        const usedServices = new Set();
        const usedReflections = new Set();
        let anyDaily = false;

        for (const c of containers) {
            const ds = c.dataSource || { type: "daily" };
            if (ds.type === "daily") anyDaily = true;
            if (c.boundaryDetector) usedBoundaries.add(c.boundaryDetector);
            if (c.llmServiceId) usedServices.add(c.llmServiceId);
            if (c.reflectionId) usedReflections.add(c.reflectionId);
        }

        // ── Daily source node ──
        if (anyDaily) {
            nodes.push({
                id: "daily",
                kind: "daily",
                title: "Daily notes",
                subtitle: s.dailyNotesFolder || "(vault root)",
            });
        }

        // ── Boundary nodes (one per used detector) ──
        for (const detId of usedBoundaries) {
            if (detId.startsWith("custom:")) {
                const cbId = detId.slice("custom:".length);
                const cb = customBoundaries.find(c => c.id === cbId);
                nodes.push({
                    id: `boundary-custom-${cbId}`,
                    kind: "boundary",
                    title: cb?.name || "(custom)",
                    subtitle: "Custom JS",
                    refKey: detId,
                    primitiveTab: "boundaries",
                });
            } else {
                const info = BUILT_IN_BOUNDARY_INFO[detId];
                nodes.push({
                    id: `boundary-${detId}`,
                    kind: "boundary",
                    title: info?.name || detId,
                    subtitle: detId,
                    refKey: detId,
                    primitiveTab: "boundaries",
                });
            }
        }

        // ── Container nodes ──
        for (const c of containers) {
            const detector = c.boundaryDetector || "?";
            nodes.push({
                id: `container-${c.id}`,
                kind: "container",
                title: c.name || "(unnamed)",
                subtitle: c.enabled ? detector : `${detector} (disabled)`,
                primitive: c,
                primitiveTab: "containers",
            });
        }

        // ── LLM service nodes (only used ones) ──
        for (const svc of services) {
            if (!usedServices.has(svc.id)) continue;
            nodes.push({
                id: `llm-${svc.id}`,
                kind: "llm",
                title: svc.name || "(unnamed)",
                subtitle: `${svc.provider}${svc.model ? " / " + svc.model.replace(new RegExp(`^${svc.provider}/`, "i"), "") : ""}`,
                primitive: svc,
                primitiveTab: "llm",
            });
        }

        // ── Reflection nodes (only used ones) ──
        for (const r of reflections) {
            if (!usedReflections.has(r.id)) continue;
            const flags = [];
            if (r.useLLM) flags.push("LLM");
            if (r.replaceAutoLLM) flags.push("replace");
            nodes.push({
                id: `reflection-${r.id}`,
                kind: "reflection",
                title: r.name || "(unnamed)",
                subtitle: flags.length > 0 ? flags.join(" + ") : "Q&A only",
                primitive: r,
                primitiveTab: "reflection",
            });
        }

        // ── Alignment nodes (only those with a containerId) ──
        for (const a of alignments) {
            if (!a.containerId) continue;
            nodes.push({
                id: `alignment-${a.id}`,
                kind: "alignment",
                title: a.name || "(unnamed)",
                subtitle: a.dataField || "(no field)",
                primitive: a,
                primitiveTab: "alignments",
            });
        }

        // ── Wires ──

        // dataSource wires
        for (const c of containers) {
            const ds = c.dataSource || { type: "daily" };
            if (ds.type === "container" && ds.containerId) {
                wires.push({
                    from: `container-${ds.containerId}`,
                    to: `container-${c.id}`,
                    fromSocket: "out",
                    toSocket: "in-data",
                    kind: "data-source",
                });
            } else if (anyDaily) {
                wires.push({
                    from: "daily",
                    to: `container-${c.id}`,
                    fromSocket: "out",
                    toSocket: "in-data",
                    kind: "data-source",
                });
            }
        }

        // boundary wires
        for (const c of containers) {
            if (!c.boundaryDetector) continue;
            const fromId = c.boundaryDetector.startsWith("custom:")
                ? `boundary-custom-${c.boundaryDetector.slice("custom:".length)}`
                : `boundary-${c.boundaryDetector}`;
            wires.push({
                from: fromId,
                to: `container-${c.id}`,
                fromSocket: "out",
                toSocket: "in-boundary",
                kind: "boundary",
            });
        }

        // llm service wires
        for (const c of containers) {
            if (!c.llmServiceId) continue;
            wires.push({
                from: `llm-${c.llmServiceId}`,
                to: `container-${c.id}`,
                fromSocket: "out",
                toSocket: "in-llm",
                kind: "llm",
            });
        }

        // reflection wires
        for (const c of containers) {
            if (!c.reflectionId) continue;
            wires.push({
                from: `reflection-${c.reflectionId}`,
                to: `container-${c.id}`,
                fromSocket: "out",
                toSocket: "in-reflection",
                kind: "reflection",
            });
        }

        // alignment wires
        for (const a of alignments) {
            if (!a.containerId) continue;
            wires.push({
                from: `alignment-${a.id}`,
                to: `container-${a.containerId}`,
                fromSocket: "out",
                toSocket: "in-alignment",
                kind: "alignment",
            });
        }

        return { nodes, wires };
    }

    // ─── Auto-layout ───
    // Simple grid by kind. Saved positions in prGraphLayout override.
    layoutNodes(nodes) {
        const COLS = {
            daily: 0,
            boundary: 1,
            llm: 2,
            container: 3,
            reflection: 4,
            alignment: 5,
        };
        const COL_X = 280;
        const ROW_Y = 140;
        const PAD_X = 60;
        const PAD_Y = 60;

        const counters = { daily: 0, boundary: 0, llm: 0, container: 0, reflection: 0, alignment: 0 };
        const saved = this.plugin.settings.prGraphLayout || {};

        for (const node of nodes) {
            if (saved[node.id] && typeof saved[node.id].x === "number" && typeof saved[node.id].y === "number") {
                node.x = saved[node.id].x;
                node.y = saved[node.id].y;
                continue;
            }
            const col = COLS[node.kind] ?? 0;
            const row = counters[node.kind]++;
            node.x = PAD_X + col * COL_X;
            node.y = PAD_Y + row * ROW_Y;
        }
    }

    // ─── Render ───

    render() {
        const container = this.containerEl.children[1];
        container.empty();
        container.classList.add("pr-graph-host");

        // Build model
        const { nodes, wires } = this.buildGraphModel();
        this.layoutNodes(nodes);
        this.nodes = nodes;
        this.wires = wires;

        if (nodes.length === 0) {
            const empty = container.createEl("div", { cls: "pr-graph-empty" });
            empty.createEl("h3", { text: "No Periodic Ritual graph yet" });
            empty.createEl("p", { text: "Add a container in Settings → Periodic Ritual → Containers, then come back here to see it." });
            return;
        }

        // Toolbar
        const toolbar = container.createEl("div", { cls: "pr-graph-toolbar" });
        const refreshBtn = toolbar.createEl("button", { text: "↻ Refresh" });
        refreshBtn.addEventListener("click", () => this.render());
        const fitBtn = toolbar.createEl("button", { text: "Fit" });
        fitBtn.addEventListener("click", () => { this.zoom = 1; this.panX = 0; this.panY = 0; this.applyTransform(); });
        const resetLayoutBtn = toolbar.createEl("button", { text: "Reset layout" });
        resetLayoutBtn.addEventListener("click", async () => {
            this.plugin.settings.prGraphLayout = {};
            await this.plugin.saveSettings();
            this.render();
        });
        const help = toolbar.createEl("span", { cls: "pr-graph-help" });
        help.setText("Drag empty space to pan • Scroll to zoom • Drag nodes to move • Click a node to edit");

        // Canvas (the scrollable / zoomable area)
        const canvas = container.createEl("div", { cls: "pr-graph-canvas" });
        this.canvasEl = canvas;
        const viewport = canvas.createEl("div", { cls: "pr-graph-viewport" });
        this.viewportEl = viewport;

        // SVG wire layer
        const SVG_NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", "pr-graph-wires");
        svg.setAttribute("width", "4000");
        svg.setAttribute("height", "3000");
        viewport.appendChild(svg);
        this.wireSvg = svg;

        // Render nodes
        for (const node of nodes) {
            this.renderNode(viewport, node);
        }

        // Render wires (after nodes so socket positions are known)
        this.renderWires();

        // Apply current pan/zoom
        this.applyTransform();

        // Pan/zoom + drag handlers (Phase 10a-2)
        this.setupPanZoom();
        this.setupNodeDrag();
        // Wire drag + wire delete (Phase 10b-1)
        this.setupWireDrag();
        this.setupWireClick();
    }

    renderNode(parent, node) {
        const el = parent.createEl("div", { cls: `pr-graph-node pr-graph-node-${node.kind}` });
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        el.dataset.nodeId = node.id;
        node.el = el;

        // Header (title)
        const header = el.createEl("div", { cls: "pr-graph-node-header" });
        header.createEl("span", { cls: "pr-graph-node-title", text: node.title });

        // Body (subtitle)
        const body = el.createEl("div", { cls: "pr-graph-node-body" });
        body.createEl("div", { cls: "pr-graph-node-subtitle", text: node.subtitle });

        // Sockets — input on left, output on right.
        // Containers have multiple inputs stacked vertically; everything else
        // has a single output.
        if (node.kind === "container") {
            const inputs = el.createEl("div", { cls: "pr-graph-sockets pr-graph-sockets-in" });
            const inDefs = [
                { id: "in-data",       cls: "data-source", label: "data" },
                { id: "in-boundary",   cls: "boundary",    label: "boundary" },
                { id: "in-llm",        cls: "llm",         label: "llm" },
                { id: "in-reflection", cls: "reflection",  label: "reflection" },
                { id: "in-alignment",  cls: "alignment",   label: "alignment" },
            ];
            for (const def of inDefs) {
                const socket = inputs.createEl("div", { cls: `pr-graph-socket pr-graph-socket-in pr-graph-socket-${def.cls}` });
                socket.dataset.socketId = def.id;
                socket.title = def.label;
            }
            const outputs = el.createEl("div", { cls: "pr-graph-sockets pr-graph-sockets-out" });
            const outSocket = outputs.createEl("div", { cls: "pr-graph-socket pr-graph-socket-out pr-graph-socket-data-source" });
            outSocket.dataset.socketId = "out";
        } else {
            const outputs = el.createEl("div", { cls: "pr-graph-sockets pr-graph-sockets-out" });
            const outSocket = outputs.createEl("div", { cls: `pr-graph-socket pr-graph-socket-out pr-graph-socket-${node.kind}` });
            outSocket.dataset.socketId = "out";
        }
    }

    // Compute the screen position of a socket within the viewport's
    // coordinate system (NOT the document — viewport coords).
    socketPos(nodeId, socketId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node || !node.el) return { x: 0, y: 0 };
        const socket = node.el.querySelector(`[data-socket-id="${socketId}"]`);
        if (!socket) return { x: node.x, y: node.y };
        // Read the socket's offset relative to the node, then add the node's
        // x/y position. We use offsetLeft/offsetTop relative to the node.
        const sx = socket.offsetLeft + socket.offsetWidth / 2;
        const sy = socket.offsetTop + socket.offsetHeight / 2;
        // Walk up to the node element to accumulate offsets correctly
        let acc = { x: 0, y: 0 };
        let cur = socket.offsetParent;
        while (cur && cur !== node.el) {
            acc.x += cur.offsetLeft;
            acc.y += cur.offsetTop;
            cur = cur.offsetParent;
        }
        return {
            x: node.x + acc.x + sx,
            y: node.y + acc.y + sy,
        };
    }

    renderWires() {
        const SVG_NS = "http://www.w3.org/2000/svg";
        // Clear existing wires
        while (this.wireSvg.firstChild) this.wireSvg.removeChild(this.wireSvg.firstChild);

        for (const wire of this.wires) {
            const a = this.socketPos(wire.from, wire.fromSocket);
            const b = this.socketPos(wire.to, wire.toSocket);
            const dx = Math.max(60, Math.abs(b.x - a.x) * 0.4);
            const path = document.createElementNS(SVG_NS, "path");
            const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
            path.setAttribute("d", d);
            path.setAttribute("class", `pr-graph-wire pr-graph-wire-${wire.kind}`);
            path.setAttribute("fill", "none");
            this.wireSvg.appendChild(path);
        }
    }

    applyTransform() {
        if (!this.viewportEl) return;
        this.viewportEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }

    // ─── Drag-to-wire (Phase 10b-1) ───
    //
    // Mousedown on an output socket starts a wire-drag. A floating ghost
    // wire follows the cursor. On mouseup over a compatible input socket,
    // the corresponding setting field gets written; otherwise the drag
    // is cancelled.
    //
    // Compatibility: input/output sockets are typed by their CSS class
    // (data-source / boundary / llm / reflection / alignment). A wire can
    // only land on a socket whose type matches its source.

    // Map a node kind to the socket TYPE it outputs.
    nodeOutputType(kind) {
        switch (kind) {
            case "container":  return "data-source";  // containers feed other containers' data input
            case "daily":      return "data-source";
            case "boundary":   return "boundary";
            case "llm":        return "llm";
            case "reflection": return "reflection";
            case "alignment":  return "alignment";
        }
        return null;
    }

    // Compatible drop check: source output type must equal target input type,
    // and the target node must be a container (only containers have inputs).
    canConnect(fromNode, toNode, toSocketId) {
        if (!fromNode || !toNode) return false;
        if (toNode.kind !== "container") return false;
        const outType = this.nodeOutputType(fromNode.kind);
        if (!outType) return false;
        const expectedSocket = `in-${outType}`;
        return toSocketId === expectedSocket;
    }

    // Apply a new connection — write the corresponding settings field.
    async applyConnection(fromNode, toNode, fromSocket, toSocket) {
        const containers = this.plugin.settings.prContainers || [];
        if (toNode.kind !== "container") return;
        const target = containers.find(c => `container-${c.id}` === toNode.id);
        if (!target) return;

        if (toSocket === "in-data") {
            if (fromNode.id === "daily") {
                target.dataSource = { type: "daily" };
            } else if (fromNode.kind === "container") {
                const sourceId = fromNode.id.replace(/^container-/, "");
                if (sourceId === target.id) return; // can't self-reference
                target.dataSource = { type: "container", containerId: sourceId };
            }
        } else if (toSocket === "in-boundary") {
            if (fromNode.kind === "boundary") {
                if (fromNode.id.startsWith("boundary-custom-")) {
                    target.boundaryDetector = `custom:${fromNode.id.replace(/^boundary-custom-/, "")}`;
                } else {
                    target.boundaryDetector = fromNode.id.replace(/^boundary-/, "");
                }
            }
        } else if (toSocket === "in-llm") {
            if (fromNode.kind === "llm") {
                target.llmServiceId = fromNode.id.replace(/^llm-/, "");
            }
        } else if (toSocket === "in-reflection") {
            if (fromNode.kind === "reflection") {
                target.reflectionId = fromNode.id.replace(/^reflection-/, "");
            }
        } else if (toSocket === "in-alignment") {
            // Alignments attach via their own containerId field, so the
            // wire writes the alignment's containerId, not the container's.
            if (fromNode.kind === "alignment") {
                const alignmentId = fromNode.id.replace(/^alignment-/, "");
                const al = (this.plugin.settings.prAlignments || []).find(a => a.id === alignmentId);
                if (al) al.containerId = target.id;
            }
        }

        await this.plugin.saveSettings();
        this.render();
    }

    setupWireDrag() {
        if (!this.viewportEl || !this.wireSvg) return;
        const SVG_NS = "http://www.w3.org/2000/svg";

        let active = null;       // { fromNode, fromSocketId, ghost: SVGPathElement }

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            const socket = e.target.closest(".pr-graph-socket-out");
            if (!socket) return;
            const nodeEl = socket.closest(".pr-graph-node");
            if (!nodeEl) return;
            const node = this.nodes.find(n => n.id === nodeEl.dataset.nodeId);
            if (!node) return;

            const ghost = document.createElementNS(SVG_NS, "path");
            ghost.setAttribute("class", `pr-graph-wire pr-graph-wire-${this.nodeOutputType(node.kind)} pr-graph-wire-ghost`);
            ghost.setAttribute("fill", "none");
            this.wireSvg.appendChild(ghost);

            active = {
                fromNode: node,
                fromSocketId: socket.dataset.socketId || "out",
                ghost,
            };
            e.preventDefault();
            e.stopPropagation();
        };

        const onMouseMove = (e) => {
            if (!active) return;
            // Convert mouse position from screen to viewport coordinates
            const rect = this.canvasEl.getBoundingClientRect();
            const mx = (e.clientX - rect.left - this.panX) / this.zoom;
            const my = (e.clientY - rect.top - this.panY) / this.zoom;

            const a = this.socketPos(active.fromNode.id, active.fromSocketId);
            const dx = Math.max(60, Math.abs(mx - a.x) * 0.4);
            const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${mx - dx} ${my}, ${mx} ${my}`;
            active.ghost.setAttribute("d", d);
        };

        const onMouseUp = async (e) => {
            if (!active) return;
            const ghost = active.ghost;
            const fromNode = active.fromNode;
            const fromSocketId = active.fromSocketId;
            active = null;
            // Always remove the ghost
            if (ghost.parentNode) ghost.parentNode.removeChild(ghost);

            // Did we drop on an input socket?
            const target = document.elementFromPoint(e.clientX, e.clientY);
            if (!target) return;
            const socket = target.closest(".pr-graph-socket-in");
            if (!socket) return;
            const nodeEl = socket.closest(".pr-graph-node");
            if (!nodeEl) return;
            const toNode = this.nodes.find(n => n.id === nodeEl.dataset.nodeId);
            if (!toNode) return;
            const toSocketId = socket.dataset.socketId;

            if (!this.canConnect(fromNode, toNode, toSocketId)) {
                new Notice(`Can't connect ${fromNode.kind} → ${toSocketId}`);
                return;
            }
            await this.applyConnection(fromNode, toNode, fromSocketId, toSocketId);
        };

        this.viewportEl.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        this._wireDragCleanup = () => {
            this.viewportEl?.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }

    // ─── Wire click to delete (Phase 10b-1) ───
    setupWireClick() {
        if (!this.wireSvg) return;
        // Wires are inside the SVG which has pointer-events: none in CSS.
        // Re-enable pointer events on individual paths via SVG attribute.
        for (const path of this.wireSvg.querySelectorAll("path.pr-graph-wire")) {
            path.style.pointerEvents = "stroke";
            path.style.cursor = "pointer";
        }
        this.wireSvg.style.pointerEvents = "none";  // SVG container stays transparent
        // Click handler — delegated on the svg element
        const onClick = async (e) => {
            const path = e.target.closest("path.pr-graph-wire");
            if (!path || path.classList.contains("pr-graph-wire-ghost")) return;
            // Find the wire model that owns this path. Wires render in order
            // so we can match by index against the model.
            const paths = Array.from(this.wireSvg.querySelectorAll("path.pr-graph-wire:not(.pr-graph-wire-ghost)"));
            const idx = paths.indexOf(path);
            if (idx < 0 || !this.wires[idx]) return;
            const wire = this.wires[idx];
            await this.deleteWire(wire);
        };
        this.wireSvg.addEventListener("click", onClick);
        this._wireClickCleanup = () => this.wireSvg?.removeEventListener("click", onClick);
    }

    // Clear the relationship that this wire represents.
    async deleteWire(wire) {
        const containers = this.plugin.settings.prContainers || [];
        const targetContainerId = wire.to.replace(/^container-/, "");
        const target = containers.find(c => c.id === targetContainerId);

        switch (wire.kind) {
            case "data-source":
                if (target) target.dataSource = { type: "daily" };
                break;
            case "boundary":
                // Don't allow disconnecting the boundary — every container needs one.
                new Notice("Every container needs a boundary. Pick a different one in settings instead of deleting this wire.");
                return;
            case "llm":
                if (target) target.llmServiceId = "";
                break;
            case "reflection":
                if (target) target.reflectionId = "";
                break;
            case "alignment":
                {
                    const alignmentId = wire.from.replace(/^alignment-/, "");
                    const al = (this.plugin.settings.prAlignments || []).find(a => a.id === alignmentId);
                    if (al) al.containerId = "";
                }
                break;
        }
        await this.plugin.saveSettings();
        this.render();
    }

    // ─── Click to edit (Phase 10a-3) ───
    //
    // Clicking a node opens Obsidian's settings modal scrolled to the
    // Periodic Ritual plugin tab and switches the outer tab to the one
    // that owns that primitive's edit card. The user is dropped exactly
    // where they need to be to edit the thing they clicked.
    onNodeClick(node) {
        if (!node || !node.primitiveTab) {
            // Daily / built-in boundary nodes have no primitive to edit
            return;
        }
        const tab = node.primitiveTab;
        const setting = this.app.setting;
        if (!setting) {
            new Notice("Could not open settings — Obsidian setting API missing");
            return;
        }
        try {
            setting.open();
            setting.openTabById("monthly-ritual");
        } catch (e) {
            console.error("Periodic Ritual: failed to open settings", e);
            return;
        }
        // Find the active settings tab instance and switch its outer tab.
        // Obsidian doesn't expose this directly, but we can find our tab
        // through the plugin's setting tab list.
        const settingTabs = setting.settingTabs || [];
        const ourTab = settingTabs.find(t => t.id === "monthly-ritual" || t.plugin === this.plugin);
        if (ourTab && typeof ourTab.display === "function") {
            ourTab.outerTab = tab;
            ourTab.display();
        }
    }

    // ─── Pan, zoom, drag (Phase 10a-2) ───

    setupPanZoom() {
        if (!this.canvasEl) return;
        const canvas = this.canvasEl;

        // Wheel zoom — zoom toward the cursor position
        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            // Mouse position in viewport (pre-zoom) coordinates
            const vx = (mx - this.panX) / this.zoom;
            const vy = (my - this.panY) / this.zoom;

            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const newZoom = Math.max(0.25, Math.min(3, this.zoom * factor));
            this.zoom = newZoom;
            // Recompute pan so the cursor stays over the same viewport point
            this.panX = mx - vx * this.zoom;
            this.panY = my - vy * this.zoom;
            this.applyTransform();
        }, { passive: false });

        // Drag to pan — only when starting on empty canvas (not on a node)
        let panning = false;
        let panStartX = 0;
        let panStartY = 0;
        let panOriginX = 0;
        let panOriginY = 0;

        canvas.addEventListener("mousedown", (e) => {
            // If the target is a node or inside one, let node-drag handle it
            if (e.target.closest(".pr-graph-node")) return;
            if (e.button !== 0 && e.button !== 1) return; // left or middle only
            panning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panOriginX = this.panX;
            panOriginY = this.panY;
            canvas.style.cursor = "grabbing";
            e.preventDefault();
        });

        const onMouseMove = (e) => {
            if (!panning) return;
            this.panX = panOriginX + (e.clientX - panStartX);
            this.panY = panOriginY + (e.clientY - panStartY);
            this.applyTransform();
        };
        const onMouseUp = () => {
            if (panning) {
                panning = false;
                canvas.style.cursor = "";
            }
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        // Track for cleanup
        this._panZoomCleanup = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }

    setupNodeDrag() {
        if (!this.viewportEl) return;
        const viewport = this.viewportEl;

        let dragging = null;       // the node being dragged
        let dragStartX = 0;        // mouse start x (screen)
        let dragStartY = 0;        // mouse start y (screen)
        let nodeStartX = 0;        // node original x (viewport)
        let nodeStartY = 0;        // node original y (viewport)
        let moved = false;         // distinguish click from drag

        const onMouseDown = (e) => {
            if (e.button !== 0) return; // left only
            // Sockets get their own drag handler (setupWireDrag) — bail
            if (e.target.closest(".pr-graph-socket")) return;
            const nodeEl = e.target.closest(".pr-graph-node");
            if (!nodeEl) return;

            const id = nodeEl.dataset.nodeId;
            const node = this.nodes.find(n => n.id === id);
            if (!node) return;

            dragging = node;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            nodeStartX = node.x;
            nodeStartY = node.y;
            moved = false;
            nodeEl.style.zIndex = "10";
            e.preventDefault();
            e.stopPropagation();
        };

        const onMouseMove = (e) => {
            if (!dragging) return;
            const dx = (e.clientX - dragStartX) / this.zoom;
            const dy = (e.clientY - dragStartY) / this.zoom;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
            dragging.x = nodeStartX + dx;
            dragging.y = nodeStartY + dy;
            dragging.el.style.left = `${dragging.x}px`;
            dragging.el.style.top = `${dragging.y}px`;
            this.renderWires();
        };

        const onMouseUp = async (e) => {
            if (!dragging) return;
            const node = dragging;
            dragging = null;
            node.el.style.zIndex = "";
            if (moved) {
                // Persist the new position
                if (!this.plugin.settings.prGraphLayout) this.plugin.settings.prGraphLayout = {};
                this.plugin.settings.prGraphLayout[node.id] = { x: node.x, y: node.y };
                await this.plugin.saveSettings();
            }
            // If not moved, treat as a click — Phase 10a-3 wires this up
            if (!moved && this.onNodeClick) {
                this.onNodeClick(node);
            }
        };

        viewport.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        this._nodeDragCleanup = () => {
            viewport.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }

    async onClose() {
        if (this._panZoomCleanup) this._panZoomCleanup();
        if (this._nodeDragCleanup) this._nodeDragCleanup();
        if (this._wireDragCleanup) this._wireDragCleanup();
        if (this._wireClickCleanup) this._wireClickCleanup();
    }
}

class RitualCalendarView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.displayDate = new Date();
    }

    getViewType() { return CALENDAR_VIEW_TYPE; }
    getDisplayText() { return "Zodiac Calendar"; }
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
        // Solar folder first; fall back to the legacy unified folder for users
        // who haven't split their config yet.
        const folder = this.plugin.settings.calendarSolarNoteFolder
            || this.plugin.settings.calendarNoteFolder
            || "";
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
        // Lunar folder first; fall back to the legacy unified folder.
        const folder = this.plugin.settings.calendarLunarNoteFolder
            || this.plugin.settings.calendarNoteFolder
            || "";
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
        // Outer tab default. The legacy "Existing" tab has been removed; new
        // and existing installs land on Containers.
        this.outerTab = "containers";
        // Per-id expanded state for collapsible PR cards. Not persisted —
        // resets to expanded (true) on every fresh display() call for ids
        // that haven't been seen yet.
        this.prExpandedContainers = {};
        this.prExpandedServices = {};
    }

    // ─── New outer-tab dispatcher (Phase 0) ───
    // Wraps the existing settings UI under a "Legacy" tab without modifying it.
    // New tabs (Containers / Alignments / LLM / General) are stubs for now.
    display() {
        const { containerEl } = this;
        containerEl.empty();

        const tabs = [
            { id: "containers", label: "Containers" },
            { id: "boundaries", label: "Boundaries" },
            { id: "reflection", label: "Reflection" },
            { id: "alignments", label: "Alignment" },
            { id: "llm",        label: "LLM" },
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
            case "boundaries":  this.displayBoundaries(body); break;
            case "reflection":  this.displayReflections(body); break;
            case "alignments":  this.displayAlignmentsStub(body); break;
            case "llm":         this.displayLLMStub(body); break;
            case "general":     this.displayGeneral(body); break;
            default:            this.displayContainersStub(body); break;
        }
    }

    // ─── Stubs for the new tabs (Phase 0) ───

    // Phase 1: Containers tab is real. Lists configured containers with
    // per-container template/save dir/naming inputs and a "Generate now"
    // button. No LLM, no auto-trigger — just template → tokens → file.
    displayContainersStub(containerEl) {
        const s = this.plugin.settings;
        if (!Array.isArray(s.prContainers)) s.prContainers = [];

        // Header row: title on the left, "Open graph view" button on the right
        const headerRow = containerEl.createDiv();
        headerRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 12px;";
        headerRow.createEl("h2", { text: "Containers" }).style.margin = "0";
        const graphBtn = headerRow.createEl("button", { text: "↗ Open graph view" });
        graphBtn.style.cssText = "background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 0.9em;";
        graphBtn.addEventListener("click", () => {
            this.plugin.activatePRGraphView();
        });

        const intro = containerEl.createEl("p");
        intro.style.cssText = "color: var(--text-muted); max-width: 60ch;";
        intro.setText("Each container is an independently configured periodic note type. Pick a boundary (calendar, lunar, solar, or your own custom JS module), point at a template and save folder, optionally attach an LLM service + system prompt, reflection profile, and alignments. Containers can also read from each other for hierarchical roll-up — see the Boundaries tab and the Data source field on each card.");

        if (s.prContainers.length === 0) {
            const empty = containerEl.createEl("p");
            empty.style.cssText = "color: var(--text-faint); margin: 24px 0;";
            empty.setText("No containers yet. Click below to add one.");
        } else {
            for (let i = 0; i < s.prContainers.length; i++) {
                this.renderPRContainerCard(containerEl, s.prContainers[i], i);
            }
        }

        // Add a generic container. The user picks the boundary detector and
        // edits the rest. Phase 1 only ships calendar-week as a detector;
        // Phases 4–5 will add more, and they'll automatically appear in the
        // dropdown without changes here.
        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText("+ Add container")
                .setCta()
                .onClick(async () => {
                    s.prContainers.push(makePRContainer({
                        name: "New container",
                        boundaryDetector: "calendar-week",
                        naming: "W{{week}}-{{year}}",
                    }));
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }

    renderPRContainerCard(parent, container, idx) {
        const s = this.plugin.settings;

        // Default to expanded for any id we haven't seen yet
        if (this.prExpandedContainers[container.id] === undefined) {
            this.prExpandedContainers[container.id] = true;
        }
        const expanded = this.prExpandedContainers[container.id];

        // `card` is `let` because once we know we're expanded we re-bind it
        // to the inner body wrapper so subsequent `new Setting(card)` calls
        // append to the right place.
        let card = parent.createDiv({ cls: "mr-pr-card" });

        // ── Header row: chevron + name + enabled toggle + delete ──
        const header = card.createDiv({ cls: "mr-pr-card-header" });

        const chevron = header.createSpan({ cls: "mr-pr-chevron", text: expanded ? "▼" : "▶" });
        chevron.addEventListener("click", () => {
            this.prExpandedContainers[container.id] = !expanded;
            this.display();
        });

        const nameInput = header.createEl("input", { type: "text", value: container.name || "", cls: "mr-pr-name-input" });
        nameInput.placeholder = "Container name";
        nameInput.addEventListener("change", async () => {
            container.name = nameInput.value;
            await this.plugin.saveSettings();
        });
        // Clicking the name itself shouldn't toggle collapse
        nameInput.addEventListener("click", e => e.stopPropagation());

        // Enabled toggle (Obsidian's pill style)
        const toggleWrap = header.createDiv({ cls: "mr-pr-toggle-wrap" });
        new ToggleComponent(toggleWrap)
            .setValue(!!container.enabled)
            .onChange(async (v) => {
                container.enabled = v;
                await this.plugin.saveSettings();
            });

        const deleteBtn = header.createEl("button", { text: "×", cls: "mr-pr-delete-btn" });
        deleteBtn.title = "Delete container";
        deleteBtn.addEventListener("click", async () => {
            s.prContainers.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
        });

        // Collapsed: stop here, only the header shows.
        if (!expanded) return;

        // Body wrapper. Re-bind `card` to point at the body so the rest of
        // this method's `new Setting(card)` calls append inside the body.
        card = card.createDiv({ cls: "mr-pr-card-body" });

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

        // ── Generate at (start vs end of period) ──
        new Setting(card)
            .setName("Generate at")
            .setDesc("Start: create the note as soon as a new period begins (good for arc / planning / dataview containers that need to exist throughout the cycle). End: wait until the period has fully ended (good for aggregation containers that summarize what happened).")
            .addDropdown(dd => {
                dd.addOption("start", "Start of period");
                dd.addOption("end", "End of period");
                dd.setValue(container.generateAt || "start");
                dd.onChange(async v => {
                    container.generateAt = v;
                    await this.plugin.saveSettings();
                });
            });

        // ── Data source (Phase 8a) ──
        // What the auto-LLM aggregation reads from. Default: daily notes
        // in the container's range. Alternative: another PR container's
        // notes whose pr-start falls in this container's range. Enables
        // hierarchical roll-ups (Lunar Phase → Lunar Cycle → Solar Year).
        const ds = container.dataSource || { type: "daily" };
        const currentDsValue = ds.type === "container" && ds.containerId
            ? `container:${ds.containerId}`
            : "daily";
        new Setting(card)
            .setName("Data source")
            .setDesc("What this container's auto-LLM reads from. Default is daily notes. Picking another container makes this one read its notes instead — used for roll-up chains like Lunar Phase → Lunar Cycle → Solar Year.")
            .addDropdown(dd => {
                dd.addOption("daily", "Daily notes (default)");
                for (const c of (s.prContainers || [])) {
                    if (c.id === container.id) continue; // can't reference self
                    dd.addOption(`container:${c.id}`, `${c.name || "(unnamed)"} (container)`);
                }
                dd.setValue(currentDsValue);
                dd.onChange(async v => {
                    if (v === "daily") {
                        container.dataSource = { type: "daily" };
                    } else if (v.startsWith("container:")) {
                        container.dataSource = { type: "container", containerId: v.slice("container:".length) };
                    }
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
        const namingSetting = new Setting(card)
            .setName("Naming convention")
            .addText(t => t
                .setPlaceholder("W{{week}}-{{year}}")
                .setValue(container.naming || "")
                .onChange(async v => {
                    container.naming = v;
                    await this.plugin.saveSettings();
                    this.display();
                }));
        // Replace the default desc with a custom node containing a clickable
        // syntax reference link and a live preview line.
        namingSetting.descEl.empty();
        const refLink = namingSetting.descEl.createEl("a", { text: "Syntax reference", cls: "mr-pr-link" });
        refLink.addEventListener("click", e => {
            e.preventDefault();
            new PRTokenReferenceModal(this.app, container.boundaryDetector || "calendar-week").open();
        });
        namingSetting.descEl.createEl("br");
        const previewLabel = namingSetting.descEl.createSpan({ text: "Currently looks like: " });
        previewLabel.style.color = "var(--text-faint)";
        // Async preview: start with a placeholder, resolve in the background.
        // getPRBoundaryData is async because helios-backed detectors hit a
        // local server. The preview span gets updated when the promise resolves.
        const previewVal = namingSetting.descEl.createSpan({ text: "…", cls: "mr-pr-preview" });
        this.plugin.getPRBoundaryData(container.boundaryDetector, new Date())
            .then(previewData => {
                previewVal.setText(container.naming
                    ? this.plugin.resolveTokens(container.naming, previewData.tokens)
                    : "(empty)");
            })
            .catch(() => {
                previewVal.setText("(unable to compute preview)");
            });

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
        // No section heading on purpose — the LLM service and System prompt
        // rows just continue the same Setting list as Template / Save dir /
        // Naming so the visual rhythm stays uniform. When both are set the
        // plugin collects daily notes in range, sends them to the LLM with
        // the prompt, and merges the YAML response into the note's frontmatter.

        // LLM service picker
        const services = s.prLLMServices || [];
        new Setting(card)
            .setName("LLM service")
            .setDesc(services.length === 0 ? "Define a service in the LLM tab first" : "Select which service handles this container's aggregation")
            .addDropdown(dd => {
                dd.addOption("", "— None —");
                for (const svc of services) {
                    // Strip parenthetical suffixes like "(local agent)" / "(local)"
                    // from the provider's display name to keep the dropdown short.
                    const rawName = PROVIDERS[svc.provider]?.name || svc.provider;
                    const provName = rawName.replace(/\s*\([^)]*\)\s*$/, "");
                    // Strip a leading "<provider>/" prefix from the model id so
                    // OpenClaw shows "OpenClaw (mei)" instead of the redundant
                    // "OpenClaw (local agent) (openclaw/mei)".
                    const rawModel = svc.model || "no model selected";
                    const modelLabel = rawModel.replace(new RegExp(`^${svc.provider}/`, "i"), "");
                    dd.addOption(svc.id, `${provName} (${modelLabel})`);
                }
                dd.setValue(container.llmServiceId || "");
                dd.onChange(async v => {
                    container.llmServiceId = v;
                    await this.plugin.saveSettings();
                });
            });

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

        // ── Reflection picker (Phase 6 rework) ──
        // Single dropdown referencing a reflection profile from the
        // Reflection tab. None = no reflection (auto-LLM only). Picking a
        // profile activates Q&A; the profile's toggles (useLLM,
        // replaceAutoLLM) control how it interacts with the LLM.
        const reflections = s.prReflections || [];
        new Setting(card)
            .setName("Reflection")
            .setDesc(reflections.length === 0 ? "Define a reflection profile in the Reflection tab to enable Q&A flows." : "Pick a reflection profile to attach to this container. Profiles are defined in the Reflection tab.")
            .addDropdown(dd => {
                dd.addOption("", "— None —");
                for (const r of reflections) {
                    dd.addOption(r.id, r.name || "(unnamed)");
                }
                dd.setValue(container.reflectionId || "");
                dd.onChange(async v => {
                    container.reflectionId = v;
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // ── Generate / Reflect buttons ──
        const hasReflection = !!container.reflectionId && reflections.some(r => r.id === container.reflectionId);
        const actions = new Setting(card)
            .addButton(btn => btn
                .setButtonText("Generate now")
                .setCta()
                .onClick(async () => {
                    await this.plugin.generatePRContainerNote(container);
                }));
        if (hasReflection) {
            actions.addButton(btn => btn
                .setButtonText("Reflect now")
                .onClick(async () => {
                    await this.plugin.runPRContainerReflection(container);
                }));
        }
    }

    // Phase 6 (rework): Reflection tab. List of reusable reflection profiles
    // that containers reference by id. Same artifact pattern as LLM services
    // and alignments. Lives here so questions don't crowd container cards.
    displayReflections(containerEl) {
        const s = this.plugin.settings;
        if (!Array.isArray(s.prReflections)) s.prReflections = [];

        containerEl.createEl("h2", { text: "Reflection" });
        const intro = containerEl.createEl("p");
        intro.style.cssText = "color: var(--text-muted); max-width: 60ch;";
        intro.setText("Reflection profiles are reusable Q&A flows. Define one here, then attach it to a container in the Containers tab. When you run reflection on that container, the questions are asked one at a time (same modal Daily Ritual uses) and the answers are sent to the LLM along with the daily data.");

        const purpose = containerEl.createEl("p");
        purpose.style.cssText = "color: var(--text-faint); max-width: 60ch; font-size: 0.9em;";
        purpose.setText("Reflection is bottom-up: your answers feed the summary. Alignments are top-down: your goals measure the data. Both fire after the container's main aggregation.");

        if (s.prReflections.length === 0) {
            const empty = containerEl.createEl("p");
            empty.style.cssText = "color: var(--text-faint); margin: 16px 0;";
            empty.setText("No reflection profiles yet. Click below to add one.");
        } else {
            for (let i = 0; i < s.prReflections.length; i++) {
                this.renderPRReflectionCard(containerEl, s.prReflections[i], i);
            }
        }

        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText("+ Add reflection")
                .setCta()
                .onClick(async () => {
                    s.prReflections.push(makePRReflection());
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }

    renderPRReflectionCard(parent, reflection, idx) {
        const s = this.plugin.settings;

        const card = parent.createDiv({ cls: "mr-pr-card" });

        // Header: name input + delete
        const header = card.createDiv({ cls: "mr-pr-card-header" });
        const nameInput = header.createEl("input", { type: "text", value: reflection.name || "", cls: "mr-pr-name-input" });
        nameInput.placeholder = "Reflection name";
        nameInput.addEventListener("change", async () => {
            reflection.name = nameInput.value;
            await this.plugin.saveSettings();
        });

        const deleteBtn = header.createEl("button", { text: "×", cls: "mr-pr-delete-btn" });
        deleteBtn.title = "Delete reflection";
        deleteBtn.addEventListener("click", async () => {
            s.prReflections.splice(idx, 1);
            // Also clear references on any container that pointed at this reflection
            for (const c of (s.prContainers || [])) {
                if (c.reflectionId === reflection.id) c.reflectionId = "";
            }
            await this.plugin.saveSettings();
            this.display();
        });

        const body = card.createDiv({ cls: "mr-pr-card-body" });

        // Send answers to LLM toggle
        new Setting(body)
            .setName("Send answers to LLM")
            .setDesc("When on, after the user submits answers the plugin runs an LLM call with the answers, the daily data, and the container's system prompt. The LLM output is merged into the container's frontmatter. When off, the reflection just writes each answer to its configured output field and stops — no LLM call.")
            .addToggle(t => t
                .setValue(!!reflection.useLLM)
                .onChange(async v => {
                    reflection.useLLM = v;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // Replace auto-LLM toggle
        new Setting(body)
            .setName("Replace container's auto-LLM at boundary")
            .setDesc("When on, the container's auto-LLM aggregation at boundary is suppressed — the note is created from the template only, and you run reflection later to fill it. When off, the container's auto-LLM still runs at boundary as normal, and reflection is additive (you can run it any time).")
            .addToggle(t => t
                .setValue(!!reflection.replaceAutoLLM)
                .onChange(async v => {
                    reflection.replaceAutoLLM = v;
                    await this.plugin.saveSettings();
                }));

        // Prompt prepend — only meaningful when useLLM is on
        if (reflection.useLLM) {
            new Setting(body)
                .setName("Prompt prepend (optional)")
                .setDesc("Markdown text layered on top of the container's system prompt during reflection LLM runs only. Use it to weight answers heavier than the daily data, override the output format, etc.")
                .addTextArea(t => {
                    t.setValue(reflection.promptPrepend || "")
                        .onChange(async v => {
                            reflection.promptPrepend = v;
                            await this.plugin.saveSettings();
                        });
                    t.inputEl.rows = 3;
                    t.inputEl.style.width = "100%";
                });
        }

        // Questions list
        const qHeader = new Setting(body)
            .setName("Questions")
            .setDesc("Asked one at a time when you run reflection. Answers are sent to the LLM along with the daily data and the container's system prompt.");
        qHeader.addButton(btn => btn
            .setButtonText("+ Add")
            .onClick(async () => {
                if (!Array.isArray(reflection.questions)) reflection.questions = [];
                reflection.questions.push(makePRQuestion(""));
                await this.plugin.saveSettings();
                this.display();
            }));

        // Per-question expand state for the inject/output panels.
        if (!this.prExpandedQInject) this.prExpandedQInject = {};
        if (!this.prExpandedQOutput) this.prExpandedQOutput = {};

        const questions = Array.isArray(reflection.questions) ? reflection.questions : [];
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const qKey = `${reflection.id}-${i}`;
            const expandedIn = !!this.prExpandedQInject[qKey];
            const expandedOut = !!this.prExpandedQOutput[qKey];

            // Question row: ← inject toggle, text input, → output toggle, ↑↓×
            const row = new Setting(body)
                .addExtraButton(btn => {
                    btn.setIcon(expandedIn ? "chevrons-left" : "chevron-left")
                        .setTooltip(q.injectVar ? "Inject is enabled — click to configure" : "Configure variable injection")
                        .onClick(() => {
                            this.prExpandedQInject[qKey] = !expandedIn;
                            this.display();
                        });
                })
                .addText(t => {
                    t.setPlaceholder(`Question ${i + 1}`)
                        .setValue(q.text || "")
                        .onChange(async v => {
                            q.text = v;
                            await this.plugin.saveSettings();
                        });
                    t.inputEl.style.width = "100%";
                })
                .addExtraButton(btn => {
                    btn.setIcon(expandedOut ? "chevrons-right" : "chevron-right")
                        .setTooltip(q.outputToField ? "Output is enabled — click to configure" : "Configure output to field")
                        .onClick(() => {
                            this.prExpandedQOutput[qKey] = !expandedOut;
                            this.display();
                        });
                })
                .addExtraButton(btn => {
                    btn.setIcon("up-chevron-glyph").setTooltip("Move up").onClick(async () => {
                        if (i === 0) return;
                        [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]];
                        await this.plugin.saveSettings();
                        this.display();
                    });
                })
                .addExtraButton(btn => {
                    btn.setIcon("down-chevron-glyph").setTooltip("Move down").onClick(async () => {
                        if (i === questions.length - 1) return;
                        [questions[i + 1], questions[i]] = [questions[i], questions[i + 1]];
                        await this.plugin.saveSettings();
                        this.display();
                    });
                })
                .addExtraButton(btn => {
                    btn.setIcon("cross").setTooltip("Remove").onClick(async () => {
                        questions.splice(i, 1);
                        delete this.prExpandedQInject[qKey];
                        delete this.prExpandedQOutput[qKey];
                        await this.plugin.saveSettings();
                        this.display();
                    });
                });
            row.infoEl.style.display = "none";
            // Mark the row visually if inject/output are enabled
            if (q.injectVar) row.settingEl.style.borderLeft = "2px solid var(--interactive-accent)";
            if (q.outputToField) row.settingEl.style.borderRight = "2px solid var(--interactive-accent)";

            // ── Inject panel (when expanded) ──
            if (expandedIn) {
                const panel = body.createDiv();
                panel.style.cssText = "padding: 8px 12px 12px 32px; border-left: 2px solid var(--interactive-accent); margin: 0 0 8px 0; background: var(--background-secondary-alt);";

                new Setting(panel)
                    .setName("Enable variable injection")
                    .setDesc("Show a value from another note above this question.")
                    .addToggle(t => t
                        .setValue(!!q.injectVar)
                        .onChange(async v => {
                            q.injectVar = v;
                            await this.plugin.saveSettings();
                            this.display();
                        }));

                if (q.injectVar) {
                    const allContainers = s.prContainers || [];
                    new Setting(panel)
                        .setName("Source")
                        .addDropdown(dd => {
                            dd.addOption("previous-period", "Previous period of THIS container");
                            dd.addOption("note", "A specific note");
                            dd.addOption("container-current", "Current note of ANOTHER container");
                            dd.addOption("container-previous", "Previous note of ANOTHER container");
                            dd.setValue(q.varSource || "previous-period");
                            dd.onChange(async v => {
                                q.varSource = v;
                                await this.plugin.saveSettings();
                                this.display();
                            });
                        });

                    const src = q.varSource || "previous-period";
                    if (src === "note") {
                        new Setting(panel)
                            .setName("Source note")
                            .setDesc(q.varNotePath || "None selected")
                            .addButton(btn => {
                                btn.setButtonText(q.varNotePath ? "Change" : "Choose").onClick(() => {
                                    new MarkdownFileSuggestModal(this.app, async (file) => {
                                        q.varNotePath = file.path;
                                        await this.plugin.saveSettings();
                                        this.display();
                                    }).open();
                                });
                            });
                    } else if (src === "container-current" || src === "container-previous") {
                        new Setting(panel)
                            .setName("Source container")
                            .setDesc(allContainers.length === 0 ? "No containers defined yet" : "Which container to read from")
                            .addDropdown(dd => {
                                dd.addOption("", "— Pick one —");
                                for (const c of allContainers) dd.addOption(c.id, c.name || "(unnamed)");
                                dd.setValue(q.varSourceContainerId || "");
                                dd.onChange(async v => {
                                    q.varSourceContainerId = v;
                                    await this.plugin.saveSettings();
                                });
                            });
                    }

                    new Setting(panel)
                        .setName("Field name")
                        .setDesc("Field on the source note to read")
                        .addText(t => t
                            .setPlaceholder("today")
                            .setValue(q.varField || "")
                            .onChange(async v => {
                                q.varField = v;
                                await this.plugin.saveSettings();
                            }));

                    new Setting(panel)
                        .setName("Field type")
                        .addDropdown(dd => {
                            dd.addOption("inline", "Inline (key:: value)");
                            dd.addOption("frontmatter", "Frontmatter (key: value)");
                            dd.setValue(q.varFieldType || "inline");
                            dd.onChange(async v => {
                                q.varFieldType = v;
                                await this.plugin.saveSettings();
                            });
                        });
                }
            }

            // ── Output panel (when expanded) ──
            if (expandedOut) {
                const panel = body.createDiv();
                panel.style.cssText = "padding: 8px 12px 12px 32px; border-right: 2px solid var(--interactive-accent); margin: 0 0 8px 0; background: var(--background-secondary-alt); text-align: right;";

                new Setting(panel)
                    .setName("Write answer to field")
                    .setDesc("Save the answer directly to a field on the container note (in addition to feeding it to the LLM).")
                    .addToggle(t => t
                        .setValue(!!q.outputToField)
                        .onChange(async v => {
                            q.outputToField = v;
                            await this.plugin.saveSettings();
                            this.display();
                        }));

                if (q.outputToField) {
                    new Setting(panel)
                        .setName("Target")
                        .setDesc("Where to write the answer. Default is the active container's note. Picking another container pushes the answer to that container's current corresponding note. Picking 'Today's daily note' pushes to today's daily note (uses the Daily notes folder from General settings).")
                        .addDropdown(dd => {
                            dd.addOption("", "Active container (default)");
                            dd.addOption("daily-today", "Today's daily note");
                            for (const c of (s.prContainers || [])) dd.addOption(c.id, c.name || "(unnamed)");
                            dd.setValue(q.outputTargetContainer || "");
                            dd.onChange(async v => {
                                q.outputTargetContainer = v;
                                await this.plugin.saveSettings();
                            });
                        });

                    new Setting(panel)
                        .setName("Field name")
                        .addText(t => t
                            .setPlaceholder("non_negotiable")
                            .setValue(q.outputFieldName || "")
                            .onChange(async v => {
                                q.outputFieldName = v;
                                await this.plugin.saveSettings();
                            }));

                    new Setting(panel)
                        .setName("Field type")
                        .addDropdown(dd => {
                            dd.addOption("inline", "Inline (key:: value)");
                            dd.addOption("frontmatter", "Frontmatter (key: value)");
                            dd.setValue(q.outputFieldType || "inline");
                            dd.onChange(async v => {
                                q.outputFieldType = v;
                                await this.plugin.saveSettings();
                            });
                        });
                }
            }
        }

        // Where this reflection is currently attached
        const attachedContainers = (s.prContainers || []).filter(c => c.reflectionId === reflection.id);
        if (attachedContainers.length > 0) {
            const attached = body.createEl("p");
            attached.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin-top: 8px;";
            attached.setText(`Attached to: ${attachedContainers.map(c => c.name || "(unnamed)").join(", ")}`);
        } else {
            const unattached = body.createEl("p");
            unattached.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin-top: 8px; font-style: italic;";
            unattached.setText("Not attached to any container yet. Pick this reflection in a container's Reflection dropdown to use it.");
        }
    }

    // Phase 7: real Alignment tab. List of alignments with full edit UI.
    displayAlignmentsStub(containerEl) {
        const s = this.plugin.settings;
        if (!Array.isArray(s.prAlignments)) s.prAlignments = [];

        containerEl.createEl("h2", { text: "Alignment" });
        const intro = containerEl.createEl("p");
        intro.style.cssText = "color: var(--text-muted); max-width: 60ch;";
        intro.setText("Measurable anchors attached to a container. Each alignment names a daily field to read, a description of what is being measured, and an output frontmatter key. The plugin runs an LLM pass per alignment after the main aggregation, surfacing patterns of consistency, drift, and absence — not compliance scoring.");

        const containers = s.prContainers || [];
        if (containers.length === 0) {
            const empty = containerEl.createEl("p");
            empty.style.cssText = "color: var(--text-faint); margin: 16px 0;";
            empty.setText("Add at least one container in the Containers tab before creating alignments.");
            return;
        }

        if (s.prAlignments.length === 0) {
            const empty = containerEl.createEl("p");
            empty.style.cssText = "color: var(--text-faint); margin: 16px 0;";
            empty.setText("No alignments yet. Click below to add one.");
        } else {
            for (let i = 0; i < s.prAlignments.length; i++) {
                this.renderPRAlignmentCard(containerEl, s.prAlignments[i], i);
            }
        }

        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText("+ Add alignment")
                .setCta()
                .onClick(async () => {
                    s.prAlignments.push(makePRAlignment());
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }

    renderPRAlignmentCard(parent, alignment, idx) {
        const s = this.plugin.settings;

        const card = parent.createDiv({ cls: "mr-pr-card" });

        // Header: name input + delete
        const header = card.createDiv({ cls: "mr-pr-card-header" });
        const nameInput = header.createEl("input", { type: "text", value: alignment.name || "", cls: "mr-pr-name-input" });
        nameInput.placeholder = "Alignment name";
        nameInput.addEventListener("change", async () => {
            alignment.name = nameInput.value;
            await this.plugin.saveSettings();
        });

        const deleteBtn = header.createEl("button", { text: "×", cls: "mr-pr-delete-btn" });
        deleteBtn.title = "Delete alignment";
        deleteBtn.addEventListener("click", async () => {
            s.prAlignments.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
        });

        const body = card.createDiv({ cls: "mr-pr-card-body" });

        // Container picker
        new Setting(body)
            .setName("Container")
            .setDesc("Which container this alignment is attached to. The alignment runs after the container's main aggregation.")
            .addDropdown(dd => {
                dd.addOption("", "— None —");
                for (const c of (s.prContainers || [])) {
                    dd.addOption(c.id, c.name || "(unnamed)");
                }
                dd.setValue(alignment.containerId || "");
                dd.onChange(async v => {
                    alignment.containerId = v;
                    await this.plugin.saveSettings();
                });
            });

        // Data field
        new Setting(body)
            .setName("Data field")
            .setDesc("Daily field to pull values from. e.g. \"health\" reads inline health:: from each daily note in the container's range.")
            .addText(t => t
                .setPlaceholder("health")
                .setValue(alignment.dataField || "")
                .onChange(async v => {
                    alignment.dataField = v;
                    await this.plugin.saveSettings();
                }));

        // Data field type
        new Setting(body)
            .setName("Field type")
            .addDropdown(dd => {
                dd.addOption("inline", "Inline (key:: value)");
                dd.addOption("frontmatter", "Frontmatter (key: value)");
                dd.setValue(alignment.dataFieldType || "inline");
                dd.onChange(async v => {
                    alignment.dataFieldType = v;
                    await this.plugin.saveSettings();
                });
            });

        // Description
        new Setting(body)
            .setName("Description")
            .setDesc("What you're measuring and how the LLM should think about it. Sent as the system prompt for this alignment's LLM pass. Example: \"30 min mobility/cardio daily, 80% sleep score average. Surface patterns of consistency and avoidance, not compliance.\"")
            .addTextArea(t => {
                t.setValue(alignment.description || "")
                    .onChange(async v => {
                        alignment.description = v;
                        await this.plugin.saveSettings();
                    });
                t.inputEl.rows = 4;
                t.inputEl.style.width = "100%";
            });

        // Output field
        new Setting(body)
            .setName("Output frontmatter key")
            .setDesc("Frontmatter key on the container note where the LLM observation gets written. Leave blank to default to alignment_<sanitized-name>.")
            .addText(t => t
                .setPlaceholder("alignment_morning_mobility")
                .setValue(alignment.outputField || "")
                .onChange(async v => {
                    alignment.outputField = v;
                    await this.plugin.saveSettings();
                }));
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

    // Phase 4c: Boundaries tab. Lists built-in detectors (read-only with
    // View source / Fork as custom buttons) and custom user-defined boundaries
    // (editable cards with script picker + description textarea).
    displayBoundaries(containerEl) {
        const s = this.plugin.settings;
        if (!Array.isArray(s.prCustomBoundaries)) s.prCustomBoundaries = [];

        containerEl.createEl("h2", { text: "Boundaries" });
        const intro = containerEl.createEl("p");
        intro.style.cssText = "color: var(--text-muted); max-width: 60ch;";
        intro.setText("Boundaries define the date range of a container's period. The plugin ships with several built-in detectors. You can also write your own as a JS module in your vault for boundaries the plugin doesn't natively understand.");

        // ── Built-in section ──
        const builtInHeader = containerEl.createEl("h3", { text: "Built-in" });
        builtInHeader.style.cssText = "margin-top: 24px;";

        // Calendar detectors fork to pure-math standalone modules; helios
        // detectors fork to modules that talk to the Moon Phase plugin's
        // Helios server via requestUrl. Both are runnable as custom JS.
        const FORKABLE = new Set(["calendar-week", "calendar-month", "calendar-quarter", "calendar-year", "lunar-cycle", "lunar-phase", "solar-cycle", "sun-ingress"]);

        const builtInIds = [
            "calendar-week", "calendar-month", "calendar-quarter", "calendar-year",
            "lunar-cycle", "lunar-phase", "solar-cycle", "sun-ingress",
        ];
        for (const id of builtInIds) {
            const info = BUILT_IN_BOUNDARY_INFO[id];
            if (!info) continue;
            this.renderPRBuiltInBoundaryCard(containerEl, id, info, FORKABLE.has(id));
        }

        // ── Custom section ──
        const customHeader = containerEl.createEl("h3", { text: "Custom" });
        customHeader.style.cssText = "margin-top: 32px;";

        const customIntro = containerEl.createEl("p");
        customIntro.style.cssText = "color: var(--text-muted); max-width: 60ch; font-size: 0.9em;";
        customIntro.setText("Write a JS file in your vault that exports a function returning { start, end, tokens } for a given date. The plugin loads and runs it whenever a container uses this boundary.");

        if (s.prCustomBoundaries.length === 0) {
            const empty = containerEl.createEl("p");
            empty.style.cssText = "color: var(--text-faint); margin: 16px 0;";
            empty.setText("No custom boundaries yet.");
        } else {
            for (let i = 0; i < s.prCustomBoundaries.length; i++) {
                this.renderPRCustomBoundaryCard(containerEl, s.prCustomBoundaries[i], i);
            }
        }

        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText("+ Add custom boundary")
                .setCta()
                .onClick(async () => {
                    s.prCustomBoundaries.push(makePRCustomBoundary());
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }

    renderPRBuiltInBoundaryCard(parent, id, info, forkable) {
        const card = parent.createDiv({ cls: "mr-pr-card" });

        const header = card.createDiv({ cls: "mr-pr-card-header" });
        const title = header.createSpan({ text: info.name });
        title.style.cssText = "flex: 1; font-size: 1.05em; font-weight: 600;";
        const idBadge = header.createSpan({ text: id });
        idBadge.style.cssText = "color: var(--text-faint); font-family: var(--font-monospace); font-size: 0.85em;";

        const body = card.createDiv({ cls: "mr-pr-card-body" });

        const desc = body.createEl("p");
        desc.style.cssText = "color: var(--text-muted); margin: 0 0 8px 0;";
        desc.setText(info.description || "");

        const tokenLine = body.createEl("p");
        tokenLine.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin: 0 0 12px 0;";
        const tokenLabel = tokenLine.createSpan({ text: "Tokens: " });
        for (let i = 0; i < info.tokens.length; i++) {
            if (i > 0) tokenLine.createSpan({ text: " " });
            const tk = tokenLine.createEl("code", { text: `{{${info.tokens[i]}}}` });
            tk.style.cssText = "color: var(--interactive-accent); font-size: 0.95em;";
        }

        const actions = body.createDiv();
        actions.style.cssText = "display: flex; gap: 8px; margin-top: 8px;";

        if (info.source) {
            const viewBtn = actions.createEl("button", { text: "View source" });
            viewBtn.addEventListener("click", () => {
                new PRBoundarySourceModal(this.app, info.name, info.source).open();
            });
        }

        if (forkable && info.source) {
            const forkBtn = actions.createEl("button", { text: "Fork as custom" });
            forkBtn.addEventListener("click", async () => {
                // Drop the source into a folder the user picks, then create
                // a custom boundary entry pointing at it.
                new FolderSuggestModal(this.app, async (folder) => {
                    const folderPath = folder.path || "";
                    const filename = `pr-${id}-fork.js`;
                    const filePath = folderPath ? `${folderPath}/${filename}` : filename;
                    try {
                        const existing = this.app.vault.getAbstractFileByPath(filePath);
                        if (existing) {
                            new Notice(`File already exists: ${filePath}`);
                            return;
                        }
                        if (folderPath) {
                            const folderFile = this.app.vault.getAbstractFileByPath(folderPath);
                            if (!folderFile) await this.app.vault.createFolder(folderPath);
                        }
                        await this.app.vault.create(filePath, info.source);
                        // Create the custom boundary entry
                        const s = this.plugin.settings;
                        if (!Array.isArray(s.prCustomBoundaries)) s.prCustomBoundaries = [];
                        s.prCustomBoundaries.push(makePRCustomBoundary({
                            name: `${info.name} (fork)`,
                            scriptPath: filePath,
                            description: info.description,
                        }));
                        await this.plugin.saveSettings();
                        new Notice(`Forked: ${filePath}`);
                        this.display();
                    } catch (e) {
                        new Notice(`Failed to fork: ${e.message}`);
                        console.error(e);
                    }
                }).open();
            });
        }
    }

    renderPRCustomBoundaryCard(parent, cb, idx) {
        const s = this.plugin.settings;

        const card = parent.createDiv({ cls: "mr-pr-card" });

        // Header: name input + delete
        const header = card.createDiv({ cls: "mr-pr-card-header" });
        const nameInput = header.createEl("input", { type: "text", value: cb.name || "", cls: "mr-pr-name-input" });
        nameInput.placeholder = "Custom boundary name";
        nameInput.addEventListener("change", async () => {
            cb.name = nameInput.value;
            await this.plugin.saveSettings();
        });

        const deleteBtn = header.createEl("button", { text: "×", cls: "mr-pr-delete-btn" });
        deleteBtn.title = "Delete custom boundary";
        deleteBtn.addEventListener("click", async () => {
            s.prCustomBoundaries.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
        });

        const body = card.createDiv({ cls: "mr-pr-card-body" });

        // Script path picker
        new Setting(body)
            .setName("Script path")
            .setDesc(cb.scriptPath || "None selected")
            .addButton(btn => {
                btn.setButtonText(cb.scriptPath ? "Change" : "Choose").onClick(() => {
                    new PRJSFileSuggestModal(this.app, async (file) => {
                        cb.scriptPath = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    cb.scriptPath = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // Description (markdown text area)
        new Setting(body)
            .setName("Description")
            .setDesc("Markdown text prepended to the LLM system prompt as orienting context whenever a container uses this boundary. Tells the LLM what kind of period this is (e.g., \"One Ki cycle (~9 days). Each cycle has a corresponding Ki number 1–9 that influences the energetic quality of the period.\")")
            .addTextArea(t => {
                t.setValue(cb.description || "")
                    .onChange(async v => {
                        cb.description = v;
                        await this.plugin.saveSettings();
                    });
                t.inputEl.rows = 4;
                t.inputEl.style.width = "100%";
            });

        // Test button — runs the script against today and shows the result
        new Setting(body)
            .addButton(btn => btn
                .setButtonText("Test against today")
                .onClick(async () => {
                    if (!cb.scriptPath) {
                        new Notice("No script path set");
                        return;
                    }
                    try {
                        const result = await this.plugin.runPRCustomBoundary(cb.id, new Date());
                        const summary = `start: ${formatDate(result.start)}, end: ${formatDate(result.end)}, tokens: ${Object.keys(result.tokens).join(", ")}`;
                        new Notice(`OK: ${summary}`, 8000);
                        console.log("Periodic Ritual custom boundary test result:", result);
                    } catch (e) {
                        new Notice(`Error: ${e.message}`, 10000);
                        console.error(e);
                    }
                }));
    }

    displayGeneral(containerEl) {
        const s = this.plugin.settings;
        containerEl.createEl("h2", { text: "General" });

        // ── Periodic Ritual behavior ──
        new Setting(containerEl)
            .setName("Auto-generate on load")
            .setDesc("When on, the plugin checks every enabled Periodic Ritual container at startup and generates any notes whose boundaries have been crossed since the last run. Boundary-driven only — no timers, no polling. When off, you generate manually via command.")
            .addToggle(t => t
                .setValue(!!s.prAutoGenerateOnLoad)
                .onChange(async v => {
                    s.prAutoGenerateOnLoad = v;
                    await this.plugin.saveSettings();
                }));

        // ── Daily notes ──
        containerEl.createEl("h3", { text: "Daily notes" }).style.marginTop = "24px";
        new Setting(containerEl)
            .setName("Daily notes folder")
            .setDesc("Where the plugin looks for daily notes when a container's data source is set to 'Daily notes'. Defaults to vault root.")
            .addButton(btn => {
                btn.setButtonText(s.dailyNotesFolder ? "Change" : "Choose").onClick(() => {
                    new FolderSuggestModal(this.app, async (folder) => {
                        s.dailyNotesFolder = folder.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    s.dailyNotesFolder = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });
        const dailyNote = containerEl.createEl("p");
        dailyNote.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin: 4px 0 0 0;";
        dailyNote.setText(`Currently: ${s.dailyNotesFolder || "(vault root)"}`);

        // ── Astrology toggles ──
        containerEl.createEl("h3", { text: "Astrology" }).style.marginTop = "24px";
        new Setting(containerEl)
            .setName("Include sign glyphs")
            .setDesc("When on, lunar and solar boundary detectors resolve {{sign}} and {{sign-glyph}} tokens. The {{moon-sign}} / {{moon-glyph}} tokens are always available regardless of this toggle.")
            .addToggle(t => t
                .setValue(!!s.includeSignGlyphs)
                .onChange(async v => {
                    s.includeSignGlyphs = v;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName("Include eclipse flags")
            .setDesc("When on, the {{eclipse}} token resolves on lunar phase notes during eclipse seasons.")
            .addToggle(t => t
                .setValue(!!s.includeEclipseFlags)
                .onChange(async v => {
                    s.includeEclipseFlags = v;
                    await this.plugin.saveSettings();
                }));

        // ── Zodiac Calendar (sidebar lunisolar grid) ──
        containerEl.createEl("h3", { text: "Zodiac Calendar" }).style.marginTop = "24px";
        const calIntro = containerEl.createEl("p");
        calIntro.style.cssText = "color: var(--text-muted); font-size: 0.9em; max-width: 60ch;";
        calIntro.setText("Sidebar view showing the current zodiac sign with lunar phase rows. Open it via the ribbon or the 'Open Zodiac Calendar' command.");

        new Setting(containerEl)
            .setName("Timezone")
            .setDesc("Timezone for the calendar's date math")
            .addText(t => t
                .setPlaceholder("America/New_York")
                .setValue(s.calendarTimezone || "America/New_York")
                .onChange(async v => {
                    s.calendarTimezone = v;
                    await this.plugin.saveSettings();
                }));

        // Solar / sign-period notes folder
        new Setting(containerEl)
            .setName("Solar note folder")
            .setDesc("Where the calendar links to sign-period (solar) notes. Click the calendar header to open one.")
            .addButton(btn => {
                btn.setButtonText(s.calendarSolarNoteFolder ? "Change" : "Choose").onClick(() => {
                    new FolderSuggestModal(this.app, async (folder) => {
                        s.calendarSolarNoteFolder = folder.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    s.calendarSolarNoteFolder = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });
        const solarFolderNote = containerEl.createEl("p");
        solarFolderNote.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin: 4px 0 0 0;";
        solarFolderNote.setText(`Currently: ${s.calendarSolarNoteFolder || s.calendarNoteFolder || "(none)"}`);

        // Lunar phase notes folder
        new Setting(containerEl)
            .setName("Lunar note folder")
            .setDesc("Where the calendar links to lunar phase notes. Click a moon emoji in the calendar to open one. Can be the same folder as solar notes if you want.")
            .addButton(btn => {
                btn.setButtonText(s.calendarLunarNoteFolder ? "Change" : "Choose").onClick(() => {
                    new FolderSuggestModal(this.app, async (folder) => {
                        s.calendarLunarNoteFolder = folder.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    s.calendarLunarNoteFolder = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });
        const lunarFolderNote = containerEl.createEl("p");
        lunarFolderNote.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin: 4px 0 0 0;";
        lunarFolderNote.setText(`Currently: ${s.calendarLunarNoteFolder || s.calendarNoteFolder || "(none)"}`);

        new Setting(containerEl)
            .setName("Solar note naming")
            .setDesc("Naming template for the sign-period note the calendar header links to. Tokens: {{sign}}, {{glyph}}, {{year}}.")
            .addText(t => t
                .setPlaceholder("☀️ Sun in {{sign}}")
                .setValue(s.calendarNoteNaming || "")
                .onChange(async v => {
                    s.calendarNoteNaming = v;
                    await this.plugin.saveSettings();
                }));

        // Lunar note naming is a per-phase object, surface as 4 text inputs
        if (!s.lunarNoteNaming || typeof s.lunarNoteNaming !== "object") {
            s.lunarNoteNaming = {
                "New Moon": "🌑 {{phase-name}} Moon in {{moon-sign}}",
                "First Quarter": "🌓 {{phase-name}} Moon in {{moon-sign}}",
                "Full Moon": "🌕 {{phase-name}} Moon in {{moon-sign}}",
                "Last Quarter": "🌗 {{phase-name}} Moon in {{moon-sign}}",
            };
        }
        const lunarHeader = new Setting(containerEl)
            .setName("Lunar note naming")
            .setDesc("Per-phase naming templates for the lunar phase notes the calendar moon icons link to. Tokens: {{phase-name}}, {{phase-emoji}}, {{moon-sign}}, {{moon-glyph}}.");
        for (const phase of MOON_PHASES) {
            new Setting(containerEl)
                .setName(phase)
                .addText(t => t
                    .setPlaceholder(`${MOON_PHASE_EMOJI[phase]} {{phase-name}} Moon in {{moon-sign}}`)
                    .setValue(s.lunarNoteNaming[phase] || "")
                    .onChange(async v => {
                        s.lunarNoteNaming[phase] = v;
                        await this.plugin.saveSettings();
                    }));
        }
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
