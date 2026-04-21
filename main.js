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

// Normalize a container's dataSource into the array form, regardless of
// whether it was saved in the legacy single-source shape or the multi-
// source shape. Helper used by every place that reads dataSource so the
// rest of the code can assume an array.
//
// Legacy shapes auto-default to daily; an explicitly-set empty array
// stays empty (the user can have a container with no sources, in which
// case auto-LLM aggregation runs against an empty payload).
//
// Legacy shapes:
//   { type: "daily" }
//   { type: "container", containerId: "..." }
// New shape:
//   { sources: [{ type: "daily" }, { type: "container", containerId }, ...] }
function getContainerDataSources(container) {
    const ds = container?.dataSource;
    if (!ds) return [{ type: "daily" }];        // legacy default for unconfigured
    if (Array.isArray(ds.sources)) return ds.sources;  // honor empty arrays
    if (ds.type === "daily") return [{ type: "daily" }];
    if (ds.type === "container" && ds.containerId) {
        return [{ type: "container", containerId: ds.containerId }];
    }
    return [{ type: "daily" }];
}

// Stable string identity for a single source — used to dedupe and to
// match wires against sources.
function dataSourceKey(source) {
    if (!source || source.type === "daily") return "daily";
    if (source.type === "container") return `container:${source.containerId || ""}`;
    if (source.type === "dataSource") return `dataSource:${source.dataSourceId || ""}`;
    return `unknown`;
}

// ─── Periodic Ritual: Container factory (Phase 1+) ───
function makePRContainer(overrides = {}) {
    return Object.assign({
        id: "pr-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        name: "New container",
        enabled: false,
        // Local feature toggles — respect the global master in General.
        // When off, the corresponding piece is skipped even if the global
        // master is on. When global is off, these are forced off regardless.
        useSystemPrompt: true,
        useFramework: true,
        // Framework reinforcement — short markdown snippet injected into
        // the user message right before the YAML output instructions.
        // Much higher attention slot than the system prompt, so frameworks
        // and procedural thinking guidance survive long source payloads.
        framework: "",
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
        // Write-back: run alignments + LLM on the EXISTING note at a
        // second boundary point. Empty = no write-back. "end" = write
        // when the period ends. "start" = write when the next period
        // starts (unusual but valid). The note must already exist.
        writeBackAt: "",
        // When in the lifecycle the main LLM aggregation fires.
        //   "generate"  — only at note creation (generateAt time)
        //   "writeback" — only at write-back (writeBackAt time)
        //   "both"      — at both passes (default)
        runLLMAt: "both",
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
        // pass reads from. Default is daily notes in the container's range.
        // Multiple sources can be combined — e.g., daily + a sibling
        // container's notes — to feed everything into one LLM call.
        //
        // Shape: { sources: [{ type: "daily" }, { type: "container", containerId }, ...] }
        // Legacy shapes (single { type, containerId }) are accepted via
        // getContainerDataSources() and normalized on next save.
        dataSource: { sources: [{ type: "daily" }] },
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
        // Output to field — write the answer directly to a field. Target
        // options mirror the inject/source options exactly:
        //   "current"           — active container's current note (default)
        //   "previous-period"   — previous note of the SAME container
        //   "note"              — a specific .md file by path
        //   "container-current" — current note of another container
        //   "container-previous"— previous note of another container
        outputToField: false,
        outputFieldName: "",
        outputFieldType: "inline",         // "inline" | "frontmatter"
        outputTarget: "current",
        outputNotePath: "",                // for "note"
        outputTargetContainerId: "",       // for "container-current" / "container-previous"
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
        // When true, alignments attached to the container fire BEFORE the
        // reflection LLM call (not after, the default), AND a dedicated
        // "# Alignment outputs" section is appended to the user message
        // listing every alignment_* frontmatter key on the container note.
        // Lets the reflection LLM see measurement context from alignments
        // alongside the daily payload and reflection answers.
        includeAlignmentContext: false,
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
        containerId: "",
        // Daily field to pull. e.g. "health" for inline `health::` or
        // frontmatter `health:`.
        dataField: "",
        dataFieldType: "inline",  // "inline" | "frontmatter"
        // Markdown text describing what's being measured. Used as the inline
        // system prompt when no systemPromptFile is set. Also doubles as the
        // guideline text for the {guideline} template token in prepend mode.
        description: "",
        // Namespace prefix for auto-composing the output key. When outputField
        // is empty, the result lands on `{prefix}_{sanitized-name}`. When
        // outputField is explicitly set, it takes precedence over the prefix.
        prefix: "alignment",
        // Explicit output key override. When non-empty, overrides prefix+name.
        outputField: "",
        // Output shape — same three modes as alignment groups.
        //   "separate" — LLM narrative to own key (default, legacy behavior)
        //   "rewrite"  — LLM concise string replaces target key
        //   "prepend"  — template splice with {guideline}, {entries}, {existing}, {name}
        mode: "separate",
        template: "",    // for prepend mode; default: "**{guideline}** — {entries}"
        // Own LLM service — empty = fall back to the container's llmServiceId.
        llmServiceId: "",
        // File-based system prompt — empty = fall back to description as
        // the inline system prompt (legacy behavior).
        systemPromptFile: "",
        // Framework reinforcement file — injected at highest-attention slot.
        framework: "",
        // Local toggles — respects global masters in General.
        useSystemPrompt: true,
        useFramework: true,
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

// Periodic Ritual: Alignment Group primitive.
//
// An alignment group is a graph-wired gap-analysis pass that runs after a
// container's main LLM aggregation. It reads guidelines from a source note
// (via a DataSource or a container wire), compares them against the
// container's actuals (the subdivision payload + optionally the freshly-
// aggregated summary frontmatter), and writes gap analysis back to the
// container's note as `{prefix}_{name}` frontmatter keys.
//
// Individual alignments inside the group are auto-discovered from the
// source note's frontmatter/inline fields by prefix — if the group's
// prefix is "alignment", every source-note field starting with
// "alignment_" becomes an input guideline, and the LLM is asked to return
// the same key names with the gap analysis as values. No per-alignment
// configuration needed — the source note IS the config.
//
// Wiring:
//   - in-source   (from a data-source node OR a container node)
//   - in-llm      (from an llm-service node)
//   - out         (wires into a container's in-alignment socket; that
//                  container becomes the write target)
function makePRAlignmentGroup(overrides = {}) {
    return Object.assign({
        id: "ag-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        name: "New alignment group",
        prefix: "alignment",
        // Wire-driven relationships
        containerId: "",              // target container — set by wire to in-alignment
        sourceKind: "",               // "data-source" | "container"
        sourceId: "",                 // id of the source primitive
        llmServiceId: "",             // LLM service used for the gap-analysis call
        // Config
        systemPromptFile: "",
        // Local feature toggles (respect General master)
        useSystemPrompt: true,
        useFramework: true,
        framework: "",
        includeAggregatedSummary: true,  // feed the container's fresh frontmatter as extra context
        // When in the lifecycle this group fires.
        //   "generate"  — only at note creation (generateAt time)
        //   "writeback" — only at write-back (writeBackAt time)
        //   "both"      — at both passes (default)
        runAt: "both",
        // Where the output gets written on the container note.
        //   "frontmatter" — processFrontMatter (default)
        //   "inline"      — body inline fields (key:: value)
        //   "body"        — body markers ({{pr:key}})
        writeTo: "frontmatter",
        // Per-alignment output shape.
        //   defaultMode:
        //     - "separate" → LLM writes narrative to {prefix}_{name} key
        //     - "rewrite"  → LLM writes concise string to target key (replaces it)
        //     - "prepend"  → pure string splice: target = template(guideline,existing)
        //     - "append"   → pure string splice, reverse order
        //   defaultTarget is a template string with {prefix} and {name} tokens.
        //   overrides is a map keyed by the full alignment key (e.g.
        //   "alignment_health") → { mode, target, template }.
        //
        // Source-note meta keys take highest priority (alignment_health_mode,
        // alignment_health_target, alignment_health_template); group overrides
        // come next; group defaults are the fallback.
        defaultMode: "separate",
        defaultTarget: "{prefix}_{name}",
        defaultTemplate: "",
        overrides: {},
        // When combined is true, all discovered alignments feed into ONE
        // LLM call that returns a single unified narrative. Individual
        // per-alignment modes are ignored. The result is written to
        // combinedOutputKey (defaults to {prefix}_combined).
        combined: false,
        combinedOutputKey: "",
        combinedMaxSentences: 10,
    }, overrides);
}

// Periodic Ritual: Data source primitive.
//
// A named, reusable reference to a note or folder of notes that can be wired
// into containers (as a source payload section) and alignment groups (as a
// guidelines source). Two modes:
//   - static:  references one specific note — read that file's frontmatter
//              and inline fields every generation, regardless of period
//   - dynamic: references a folder of notes — the consumer determines what
//              "the right notes" means. Containers filter by their own period
//              window (using pr-start/pr-end frontmatter if present, falling
//              back to file mtime). Alignment groups ignore period and take
//              the single latest note in the folder.
function makePRDataSource(overrides = {}) {
    return Object.assign({
        id: "ds-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        name: "New data source",
        mode: "static",        // "static" | "dynamic"
        notePath: "",          // used when mode === "static"
        folderPath: "",        // used when mode === "dynamic"
    }, overrides);
}

// Periodic Ritual: Show-output node.
// A terminal graph-only primitive. Has one "any" input that accepts a wire
// from any other node's output. The Dry Run button probes the upstream node
// and renders a snapshot of what would flow through that wire at runtime.
// Purely a debugging/inspection tool — doesn't affect generation.
function makePRShowNode(overrides = {}) {
    return Object.assign({
        id: "sh-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        name: "Show output",
        sourceNodeId: "",  // graph node id of the upstream node being probed
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
    prDataSources: [],         // DataSource[] — named static/dynamic note/folder references
    prAlignmentGroups: [],     // AlignmentGroup[] — graph-wired gap-analysis groups
    prShowNodes: [],           // ShowNode[] — graph-only dry-run probes
    // Global master switches — when off, no container/group sends the
    // corresponding piece even if its local toggle is on.
    prSystemPromptsGlobalEnabled: true,
    prFrameworksGlobalEnabled: true,
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

        // dataSource wires (one per source)
        for (const c of containers) {
            const id = safe(c.id);
            const sources = getContainerDataSources(c);
            for (const src of sources) {
                if (src.type === "container" && src.containerId) {
                    lines.push(`  ${safe(src.containerId)} -->|source| ${id}`);
                } else {
                    lines.push(`  daily -->|source| ${id}`);
                }
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

// Periodic Ritual: per-node inspect modal. Right-click → "Inspect output".
// Shows kind-specific information about what a node currently has or
// would produce.
//
//   Container: most-recently generated note path + filtered frontmatter
//              + data sources + alignment outputs found on the note
//   Boundary:  current period range computed by the detector + tokens
//   Reflection: questions, mode flags, prompt prepend
//   Alignment: which container, data field, last observation if any
//   LLM:       provider, model, base URL, key status
//   Daily:     daily folder + count of recent files
class PRNodeInspectModal extends Modal {
    constructor(app, plugin, node) {
        super(app);
        this.plugin = plugin;
        this.node = node;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: `Inspect: ${this.node.title || this.node.id}` });

        const meta = contentEl.createEl("p");
        meta.style.cssText = "color: var(--text-muted); font-size: 0.85em; margin-bottom: 12px;";
        meta.setText(`Kind: ${this.node.kind}`);

        // Dispatch to per-kind renderer
        switch (this.node.kind) {
            case "container":  this.renderContainerInspect(contentEl); break;
            case "boundary":   this.renderBoundaryInspect(contentEl); break;
            case "reflection": this.renderReflectionInspect(contentEl); break;
            case "alignment":  this.renderAlignmentInspect(contentEl); break;
            case "llm":        this.renderLLMInspect(contentEl); break;
            case "daily":      this.renderDailyInspect(contentEl); break;
        }
    }
    onClose() { this.contentEl.empty(); }

    section(parent, label) {
        const h = parent.createEl("h4", { text: label });
        h.style.cssText = "margin: 14px 0 4px 0; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em;";
        return h;
    }

    keyValueBlock(parent, obj, opts = {}) {
        const filter = opts.filter || (() => true);
        const block = parent.createEl("div");
        block.style.cssText = "background: var(--background-secondary); padding: 8px 12px; border-radius: 6px; font-family: var(--font-monospace); font-size: 0.82em; max-height: 240px; overflow: auto; user-select: text;";
        let any = false;
        for (const [k, v] of Object.entries(obj || {})) {
            if (!filter(k, v)) continue;
            any = true;
            const row = block.createEl("div");
            row.style.cssText = "padding: 2px 0;";
            const keyEl = row.createEl("span", { text: `${k}: ` });
            keyEl.style.color = "var(--interactive-accent)";
            const valStr = (v === null || v === undefined) ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v));
            row.createEl("span", { text: valStr });
        }
        if (!any) {
            const empty = block.createEl("div");
            empty.style.color = "var(--text-faint)";
            empty.setText("(empty)");
        }
        return block;
    }

    async renderContainerInspect(contentEl) {
        const c = this.node.primitive;
        if (!c) return;

        // Data sources
        this.section(contentEl, "Data sources");
        const sources = getContainerDataSources(c);
        const srcBlock = contentEl.createEl("div");
        srcBlock.style.cssText = "background: var(--background-secondary); padding: 8px 12px; border-radius: 6px; font-family: var(--font-monospace); font-size: 0.82em;";
        for (const src of sources) {
            const row = srcBlock.createEl("div");
            if (src.type === "daily") row.setText("• Daily notes");
            else if (src.type === "container") {
                const target = (this.plugin.settings.prContainers || []).find(x => x.id === src.containerId);
                row.setText(`• ${target?.name || "(missing)"} (container)`);
            }
        }

        // Current period
        this.section(contentEl, "Current period");
        try {
            const data = await this.plugin.getPRBoundaryData(c.boundaryDetector, new Date());
            const p = contentEl.createEl("div");
            p.style.cssText = "font-family: var(--font-monospace); font-size: 0.82em; color: var(--text-muted);";
            p.setText(`${formatDate(data.start)} → ${formatDate(data.end)}`);
        } catch (e) {
            const p = contentEl.createEl("div");
            p.style.color = "var(--text-error, #e26a6a)";
            p.setText(`Could not resolve: ${e.message}`);
        }

        // Most recent generated note
        this.section(contentEl, "Most recent note");
        const file = await this.plugin.findMostRecentPRContainerNote(c);
        const filePathEl = contentEl.createEl("div");
        filePathEl.style.cssText = "font-family: var(--font-monospace); font-size: 0.82em; color: var(--text-muted); user-select: text;";
        if (!file) {
            filePathEl.setText("(none generated yet — click Generate now to create one)");
            return;
        }
        filePathEl.setText(file.path);

        const openBtn = contentEl.createEl("button", { text: "Open note" });
        openBtn.style.cssText = "margin: 8px 0; background: var(--interactive-normal); border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer;";
        openBtn.addEventListener("click", () => {
            this.app.workspace.getLeaf(false).openFile(file);
            this.close();
        });

        // Frontmatter
        this.section(contentEl, "Frontmatter (LLM-aggregated + alignments)");
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter || {};
        this.keyValueBlock(contentEl, fm, {
            filter: (k) => k !== "periodic-ritual" && k !== "position" && !k.startsWith("pr-"),
        });

        // Alignment outputs called out separately
        const alignmentKeys = Object.keys(fm).filter(k => k.startsWith("alignment_"));
        if (alignmentKeys.length > 0) {
            this.section(contentEl, "Alignment outputs");
            const alBlock = contentEl.createEl("div");
            alBlock.style.cssText = "background: var(--background-secondary); padding: 8px 12px; border-radius: 6px; font-family: var(--font-monospace); font-size: 0.82em; user-select: text;";
            for (const k of alignmentKeys) {
                const row = alBlock.createEl("div");
                row.style.cssText = "padding: 4px 0; border-bottom: 1px dashed var(--background-modifier-border);";
                const name = row.createEl("div");
                name.style.color = "#f0a04b";
                name.setText(k);
                const val = row.createEl("div");
                val.style.color = "var(--text-normal)";
                val.style.marginTop = "2px";
                val.setText(String(fm[k]));
            }
        }
    }

    async renderBoundaryInspect(contentEl) {
        const id = this.node.refKey || this.node.id.replace(/^boundary-/, "").replace(/^custom-/, "custom:");
        this.section(contentEl, "Description");
        const desc = contentEl.createEl("p");
        desc.style.cssText = "color: var(--text-muted); font-size: 0.9em;";
        desc.setText(this.plugin.getPRBoundaryDescription(id) || "(no description)");

        this.section(contentEl, "Current period (from today)");
        try {
            const data = await this.plugin.getPRBoundaryData(id, new Date());
            const p = contentEl.createEl("div");
            p.style.cssText = "font-family: var(--font-monospace); font-size: 0.85em; color: var(--text-normal);";
            p.setText(`${formatDate(data.start)} → ${formatDate(data.end)}`);

            this.section(contentEl, "Tokens");
            this.keyValueBlock(contentEl, data.tokens || {});
        } catch (e) {
            const p = contentEl.createEl("div");
            p.style.color = "var(--text-error, #e26a6a)";
            p.setText(`Could not resolve: ${e.message}`);
        }
    }

    renderReflectionInspect(contentEl) {
        const r = this.node.primitive;
        if (!r) return;
        this.section(contentEl, "Mode");
        const mode = contentEl.createEl("p");
        mode.style.cssText = "color: var(--text-muted); font-size: 0.85em;";
        const flags = [];
        if (r.useLLM) flags.push("Send answers to LLM");
        if (r.replaceAutoLLM) flags.push("Replace auto-LLM");
        if (r.includeAlignmentContext) flags.push("Include alignment outputs");
        mode.setText(flags.length > 0 ? flags.join(" • ") : "Pure Q&A (no LLM, additive)");

        if (r.promptPrepend) {
            this.section(contentEl, "Prompt prepend");
            const pre = contentEl.createEl("pre");
            pre.style.cssText = "background: var(--background-secondary); padding: 8px 12px; border-radius: 6px; font-size: 0.8em; max-height: 160px; overflow: auto; user-select: text; white-space: pre-wrap;";
            pre.setText(r.promptPrepend);
        }

        this.section(contentEl, `Questions (${(r.questions || []).length})`);
        const list = contentEl.createEl("ol");
        list.style.cssText = "color: var(--text-normal); font-size: 0.85em; padding-left: 20px;";
        for (const q of (r.questions || [])) {
            const li = list.createEl("li");
            li.setText(q.text || "(empty)");
            if (q.injectVar || q.outputToField) {
                const tags = li.createEl("span");
                tags.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin-left: 6px;";
                const tagList = [];
                if (q.injectVar) tagList.push(`inject:${q.varField || "?"}`);
                if (q.outputToField) tagList.push(`output:${q.outputFieldName || "?"}`);
                tags.setText(`[${tagList.join(", ")}]`);
            }
        }
    }

    renderAlignmentInspect(contentEl) {
        const a = this.node.primitive;
        if (!a) return;
        this.section(contentEl, "Wired to");
        const target = (this.plugin.settings.prContainers || []).find(c => c.id === a.containerId);
        const wired = contentEl.createEl("p");
        wired.style.cssText = "font-family: var(--font-monospace); font-size: 0.85em; color: var(--text-muted);";
        wired.setText(target ? target.name : "(unattached)");

        this.section(contentEl, "Reads field");
        const field = contentEl.createEl("p");
        field.style.cssText = "font-family: var(--font-monospace); font-size: 0.85em; color: var(--text-muted);";
        field.setText(`${a.dataField || "(none)"} (${a.dataFieldType || "inline"})`);

        this.section(contentEl, "Writes to");
        const out = contentEl.createEl("p");
        out.style.cssText = "font-family: var(--font-monospace); font-size: 0.85em; color: var(--text-muted);";
        const outKey = (a.outputField || "").trim() || `alignment_${(a.name || "unnamed").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
        out.setText(`${outKey} (frontmatter on ${target?.name || "(unattached)"})`);

        if (a.description) {
            this.section(contentEl, "Description (system prompt)");
            const pre = contentEl.createEl("pre");
            pre.style.cssText = "background: var(--background-secondary); padding: 8px 12px; border-radius: 6px; font-size: 0.8em; max-height: 160px; overflow: auto; user-select: text; white-space: pre-wrap;";
            pre.setText(a.description);
        }
    }

    renderLLMInspect(contentEl) {
        const svc = this.node.primitive;
        if (!svc) return;
        this.section(contentEl, "Configuration");
        this.keyValueBlock(contentEl, {
            provider: svc.provider,
            model: svc.model || "(none)",
            baseUrl: svc.baseUrl || "(default)",
            "API key": svc.apiKey ? `set (${svc.apiKey.length} chars)` : "(not set)",
        });
    }

    renderDailyInspect(contentEl) {
        const folder = this.plugin.settings.dailyNotesFolder || "(vault root)";
        this.section(contentEl, "Daily folder");
        const f = contentEl.createEl("p");
        f.style.cssText = "font-family: var(--font-monospace); font-size: 0.85em; color: var(--text-muted);";
        f.setText(folder);

        this.section(contentEl, "Recent count");
        const today = new Date();
        const monthAgo = new Date(today);
        monthAgo.setDate(today.getDate() - 30);
        const recent = this.plugin.findDailyNotesInRange(monthAgo, today);
        const c = contentEl.createEl("p");
        c.style.cssText = "color: var(--text-muted); font-size: 0.85em;";
        c.setText(`${recent.length} daily notes in the last 30 days`);
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
        // Capture the settings tab instance so the graph view can talk to it
        // directly (set outerTab + scroll to a card on double-click).
        this.settingTab = new MonthlyRitualSettingTab(this.app, this);
        this.addSettingTab(this.settingTab);
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
            // Also poll every 10 minutes so boundaries crossed while Obsidian
            // stays open (e.g. midnight into a new week) still trigger catch-up.
            this.registerInterval(window.setInterval(() => {
                this.runPRAutoGenerate().catch(e => {
                    console.error("Periodic Ritual: interval auto-generate failed", e);
                });
            }, 10 * 60 * 1000));
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
        // One-time migration: old reflection questions used a single
        // `outputTargetContainer` dropdown that mixed ""/"daily-today"/<id>.
        // New shape mirrors the inject source options via `outputTarget`
        // + `outputNotePath` + `outputTargetContainerId`.
        for (const rf of (this.settings.prReflections || [])) {
            for (const q of (rf.questions || [])) {
                if (q.outputTarget) continue; // already migrated
                const legacy = q.outputTargetContainer;
                if (legacy === undefined || legacy === null || legacy === "") {
                    q.outputTarget = "current";
                } else if (legacy === "daily-today") {
                    console.warn("Periodic Ritual: dropped legacy 'daily-today' output target on question:", q.text || "(untitled)");
                    q.outputTarget = "current";
                } else {
                    q.outputTarget = "container-current";
                    q.outputTargetContainerId = legacy;
                }
                if (q.outputNotePath === undefined) q.outputNotePath = "";
                if (q.outputTargetContainerId === undefined) q.outputTargetContainerId = "";
                delete q.outputTargetContainer;
            }
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

            // If a note for this period already exists:
            //   - If this is a write-back pass (opts.writeBack), run the
            //     full alignment + LLM pipeline against the existing note
            //     and write results to frontmatter, inline fields, and
            //     body markers.
            //   - Otherwise, treat it as already generated and skip.
            const existing = this.app.vault.getAbstractFileByPath(filePath);
            if (existing) {
                if (opts.writeBack && existing instanceof TFile) {
                    return await this.writeBackToPRContainerNote(container, existing, data, opts);
                }
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

            // Phase 11: alignment-group passes run BEFORE the main LLM call
            // so the main summary can reference alignment outputs. The main
            // call is then given includePreviousFrontmatter so it sees the
            // group results the groups just wrote.
            //
            // Each primitive checks opts.phase against its own runAt /
            // runLLMAt setting. Phase "generate" is the note-creation pass;
            // "writeback" is the second pass on an existing note.
            const phase = opts.phase || "generate";
            if (!skipAutoLLM) {
                await this.runPRAlignmentGroupsForContainer(container, file, range, { ...opts, phase });
            }

            const runLLMAt = container.runLLMAt || "both";
            const shouldRunLLM = runLLMAt === "both" || runLLMAt === phase;
            if (container.llmServiceId && container.systemPromptFile && !skipAutoLLM && shouldRunLLM) {
                await this.runPRLLMAggregation(container, file, range, {
                    ...opts,
                    includePreviousFrontmatter: true,
                });
            }

            // Legacy single alignments still run AFTER main aggregation so
            // existing flows are unaffected.
            if (!skipAutoLLM) {
                await this.runPRAlignmentsForContainer(container, file, range, opts);
            }

            // Propagate frontmatter values to body (inline fields + markers)
            // so {{pr:key}} and key:: lines are updated after every pass,
            // not just during write-back.
            await this.propagatePRFrontmatterToBody(file);

            return file;
        } catch (e) {
            if (!opts.silent) new Notice(`Error generating ${container.name}: ${e.message}`);
            console.error("Periodic Ritual:", e);
        }
    }

    // ─── Write-back: run the full pipeline on an existing note ───
    //
    // Called when a container has writeBackAt set and the note already
    // exists. Runs the same alignment-group → main-LLM → legacy-alignment
    // pipeline as generatePRContainerNote, but skips note creation. After
    // the frontmatter is written, also scans the note body for:
    //   - Inline fields (`key:: old`) → replaced with `key:: new`
    //   - Body markers (`{{pr:key}}`) → replaced with the value
    async writeBackToPRContainerNote(container, file, data, opts = {}) {
        if (!opts.silent) new Notice(`${container.name}: writing back to ${file.path}…`);

        const reflection = this.getPRReflectionForContainer(container);
        const skipAutoLLM = !!(reflection && reflection.replaceAutoLLM);
        const range = { start: data.start, end: data.end };
        const phase = "writeback";

        // Same pipeline order as generatePRContainerNote, but phase =
        // "writeback" so only primitives with runAt matching fire.
        // 1. Alignment groups first
        if (!skipAutoLLM) {
            await this.runPRAlignmentGroupsForContainer(container, file, range, { ...opts, phase });
        }
        // 2. Main LLM aggregation (respects container.runLLMAt)
        const runLLMAt = container.runLLMAt || "both";
        const shouldRunLLM = runLLMAt === "both" || runLLMAt === phase;
        if (container.llmServiceId && container.systemPromptFile && !skipAutoLLM && shouldRunLLM) {
            await this.runPRLLMAggregation(container, file, range, {
                ...opts,
                includePreviousFrontmatter: true,
            });
        }
        // 3. Legacy single alignments
        if (!skipAutoLLM) {
            await this.runPRAlignmentsForContainer(container, file, range, opts);
        }

        // After all frontmatter writes are done, read the final state and
        // propagate values into the note body (inline fields + markers).
        await this.propagatePRFrontmatterToBody(file);

        // Track when write-back last ran so the catch-up check won't re-fire
        // it every reload. Note: do NOT touch lastGeneratedEnd here — this
        // pass runs on a PREVIOUS period and would regress the high-water
        // mark used by the forward-walking catch-up logic.
        container.lastWriteBackEnd = formatDate(data.end);
        await this.saveSettings();

        // Also stamp the note's periodic-ritual blob with `writeback=true`.
        // data.json doesn't sync across devices; the vault does. A second
        // device seeing this marker will skip its own write-back even when
        // its local lastWriteBackEnd is stale.
        await this.updatePRMetadataOnFile(file, container, { writeback: "true" });

        if (!opts.silent) new Notice(`${container.name}: write-back complete`);
        return file;
    }

    // Merge patchFields into the existing periodic-ritual metadata blob on
    // the file, preserving placement (frontmatter vs inline marker). Unknown
    // keys in the blob survive because parsePRMetadataBlob/formatPRMetadataBlob
    // round-trip any string key=value. Caller passes only the fields to add
    // or overwrite; existing fields (id, boundary, start, end) are untouched.
    async updatePRMetadataOnFile(file, container, patchFields) {
        const placement = container?.metadataPlacement || "frontmatter";
        if (placement === "none") return;

        const current = (await this.readPRMetadataFromFile(file, container)) || {};
        const merged = { ...current, ...patchFields };
        const blob = formatPRMetadataBlob(merged);

        if (placement === "frontmatter") {
            try {
                await this.app.fileManager.processFrontMatter(file, (fm) => {
                    fm["periodic-ritual"] = blob;
                });
            } catch (e) {
                console.error(`Periodic Ritual: failed to update PR frontmatter blob on ${file.path}`, e);
            }
            return;
        }

        if (placement === "inline") {
            const key = container.metadataInlineKey || "periodic-ritual";
            try {
                const content = await this.app.vault.read(file);
                const escaped = escapeRegex(key);
                const fieldRegex = new RegExp(`${escaped}::[ \\t]*[^\\n]*`, "m");
                const next = fieldRegex.test(content)
                    ? content.replace(fieldRegex, `${key}:: ${blob}`)
                    : content.trimEnd() + `\n\n%%\n${key}:: ${blob}\n%%\n`;
                await this.app.vault.modify(file, next);
            } catch (e) {
                console.error(`Periodic Ritual: failed to update inline PR blob on ${file.path}`, e);
            }
        }
    }

    // Scan the note body for two kinds of replaceable tokens and update
    // them with the current frontmatter values:
    //
    //   1. Inline fields: `key:: old value` → `key:: new value`
    //      Only replaces keys that exist in frontmatter so we don't clobber
    //      user-managed inline fields that have no frontmatter counterpart.
    //
    //   2. Body markers: `{{pr:key}}` → the frontmatter value as plain text.
    //      These are one-shot: once replaced, the marker is gone. If you
    //      want it back, re-add it manually or re-create the note.
    async propagatePRFrontmatterToBody(file) {
        if (!file) return;
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter || {};
        const keys = Object.keys(fm).filter(k =>
            k !== "periodic-ritual" && k !== "position" && !k.startsWith("pr-")
        );
        if (keys.length === 0) return;

        let content = await this.app.vault.read(file);
        let changed = false;

        for (const k of keys) {
            const v = fm[k];
            if (v === null || v === undefined) continue;
            const valStr = typeof v === "object" ? JSON.stringify(v) : String(v);

            // 1. Inline field replacement: `key:: old` → `key:: new`
            const inlineRe = new RegExp(`^(${escapeRegex(k)}::)[ \\t]*(.*)$`, "m");
            if (inlineRe.test(content)) {
                content = content.replace(inlineRe, `$1 ${valStr}`);
                changed = true;
            }

            // 2. Body marker replacement: {{pr:key}} → value
            const marker = `{{pr:${k}}}`;
            if (content.includes(marker)) {
                content = content.split(marker).join(valStr);
                changed = true;
            }
        }

        if (changed) {
            await this.app.vault.modify(file, content);
        }
    }

    // Write a key-value map to a container note using the specified target.
    // Called by alignment group passes instead of raw processFrontMatter so
    // each group can choose where its output lands.
    async writePRKeysToNote(file, writes, writeTo) {
        if (!file || Object.keys(writes).length === 0) return;
        const target = writeTo || "frontmatter";

        if (target === "frontmatter") {
            await this.app.fileManager.processFrontMatter(file, fm => {
                for (const [k, v] of Object.entries(writes)) fm[k] = v;
            });
            return;
        }

        let content = await this.app.vault.read(file);
        let changed = false;

        for (const [k, v] of Object.entries(writes)) {
            const valStr = (v === null || v === undefined) ? "" :
                (typeof v === "object" ? JSON.stringify(v) : String(v));

            if (target === "inline") {
                // Replace existing inline field, or append if not found
                const re = new RegExp(`^(${escapeRegex(k)}::)[ \\t]*(.*)$`, "m");
                if (re.test(content)) {
                    content = content.replace(re, `$1 ${valStr}`);
                } else {
                    // Append as a new inline field at the end of the body
                    content = content.trimEnd() + `\n${k}:: ${valStr}\n`;
                }
                changed = true;
            } else if (target === "body") {
                const marker = `{{pr:${k}}}`;
                if (content.includes(marker)) {
                    content = content.split(marker).join(valStr);
                    changed = true;
                }
            }
        }

        if (changed) {
            await this.app.vault.modify(file, content);
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
        const sources = getContainerDataSources(container);

        // Empty data sources is a valid state — the container has no
        // configured sources. Aggregation runs against an empty payload.
        if (sources.length === 0) {
            return { count: 0, text: "(no data sources configured)", label: "no sources" };
        }

        // Walk every configured source. Files are deduped by path so two
        // sources that happen to overlap don't duplicate sections.
        const sourceFiles = [];
        const seenPaths = new Set();
        const labelParts = [];
        for (const source of sources) {
            let theseFiles = [];
            if (source.type === "container" && source.containerId) {
                const sourceContainer = (this.settings.prContainers || []).find(c => c.id === source.containerId);
                if (sourceContainer) {
                    theseFiles = await this.findPRContainerNotesInRange(sourceContainer, start, end);
                    labelParts.push(`${sourceContainer.name || "container"} notes`);
                }
            } else if (source.type === "dataSource" && source.dataSourceId) {
                // DataSource primitive — resolve by id, then delegate to the
                // shared resolver which applies period filtering for dynamic
                // folder sources and reads the single file for static ones.
                const ds = (this.settings.prDataSources || []).find(x => x.id === source.dataSourceId);
                if (ds) {
                    theseFiles = await this.resolveDataSourceForContainer(ds, start, end);
                    labelParts.push(ds.name || "data source");
                }
            } else {
                const endInclusive = new Date(end);
                endInclusive.setHours(23, 59, 59, 999);
                theseFiles = this.findDailyNotesInRange(start, endInclusive);
                labelParts.push("daily notes");
            }
            for (const f of theseFiles) {
                if (seenPaths.has(f.path)) continue;
                seenPaths.add(f.path);
                sourceFiles.push(f);
            }
        }
        const sourceLabel = labelParts.length > 0 ? labelParts.join(" + ") : "daily notes";

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
            // `[ \t]*` (not `\s*`) so empty inline fields don't consume the
// newline and pick up the next line's value.
const inlineRegex = /^([a-zA-Z0-9_-]+)::[ \t]*(.+)$/gm;
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
                const re = new RegExp(`^${escapeRegex(key)}::[ \\t]*([^\\n]+)`, "m");
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
    // ─── Periodic Ritual: DataSource resolvers ───
    //
    // DataSources are dumb — they just point at a note or a folder. The
    // resolvers below turn them into the right set of TFiles for whichever
    // consumer is asking.

    // Container consumer: static → [that one file]; dynamic → folder scan
    // filtered by the container's period window. Matching logic:
    //   1. If the note has pr-start / pr-end frontmatter (PR-generated),
    //      use that to decide overlap with [start, end].
    //   2. Otherwise fall back to file.stat.mtime in the same window.
    async resolveDataSourceForContainer(dataSource, start, end) {
        if (!dataSource) return [];

        if (dataSource.mode === "static") {
            const file = this.app.vault.getAbstractFileByPath(dataSource.notePath);
            if (file && file instanceof TFile) return [file];
            return [];
        }

        if (dataSource.mode === "dynamic") {
            const folder = dataSource.folderPath || "";
            if (!folder) return [];
            const files = this.app.vault.getMarkdownFiles().filter(f =>
                f.path === folder || f.path.startsWith(folder + "/") || f.parent?.path === folder
            );
            const startMs = start.getTime();
            const endMs = end.getTime();
            const matches = [];
            for (const file of files) {
                // Prefer PR metadata when present — more precise than mtime
                // and what the user expects for the PR container chain.
                const fmCache = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
                const prBlock = fmCache["periodic-ritual"];
                let noteStart = null;
                if (prBlock && typeof prBlock === "object" && prBlock.start) {
                    const d = new Date(prBlock.start);
                    if (!isNaN(d.getTime())) noteStart = d;
                } else if (fmCache["pr-start"]) {
                    const d = new Date(fmCache["pr-start"]);
                    if (!isNaN(d.getTime())) noteStart = d;
                }
                const effectiveMs = noteStart ? noteStart.getTime() : (file.stat?.mtime || 0);
                if (effectiveMs >= startMs && effectiveMs <= endMs) {
                    matches.push({ file, sortKey: effectiveMs });
                }
            }
            matches.sort((a, b) => a.sortKey - b.sortKey);
            return matches.map(m => m.file);
        }

        return [];
    }

    // Alignment-group consumer: static → that one file; dynamic → single
    // latest note in the folder (by mtime). Period is irrelevant here —
    // alignments read the current milestone, whatever that is.
    resolveDataSourceLatest(dataSource) {
        if (!dataSource) return null;

        if (dataSource.mode === "static") {
            const file = this.app.vault.getAbstractFileByPath(dataSource.notePath);
            return (file && file instanceof TFile) ? file : null;
        }

        if (dataSource.mode === "dynamic") {
            const folder = dataSource.folderPath || "";
            if (!folder) return null;
            const files = this.app.vault.getMarkdownFiles().filter(f =>
                f.path === folder || f.path.startsWith(folder + "/") || f.parent?.path === folder
            );
            if (files.length === 0) return null;
            files.sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0));
            return files[0];
        }

        return null;
    }

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

        // Sanitize top-level `key: value` lines that contain ambiguous
        // characters (colons inside values, leading #, etc.) before parsing.
        // LLMs sometimes return `health: 3 of 5: missed Friday` which most
        // YAML parsers misread. We wrap the value in single quotes at parse
        // time; those quotes are stripped when the parser produces the final
        // object, so the user sees a clean string in their frontmatter.
        const sanitized = this.sanitizePRYamlForParse(stripped);

        try {
            const parsed = parseYaml(sanitized);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }
            return { "pr-llm-raw": response };
        } catch (e) {
            console.warn("Periodic Ritual: YAML parse failed", e);
            return { "pr-llm-raw": response };
        }
    }

    // Best-effort YAML rescue. Looks for top-level `key: value` lines whose
    // value would break the parser (unquoted colon inside, leading # or |>)
    // and wraps those values in single quotes so parseYaml sees them as a
    // single scalar string. Already-quoted, list, or map values pass through
    // untouched. Non-top-level indented lines are left alone.
    sanitizePRYamlForParse(text) {
        const lines = text.split("\n");
        const out = [];
        for (const line of lines) {
            // Only touch top-level scalar assignments. Indented lines are
            // part of a structure the user might actually want, so skip.
            const m = line.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s+(.+?)\s*$/);
            if (!m) { out.push(line); continue; }
            const key = m[1];
            const value = m[2];

            // Already wrapped? Leave alone.
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                out.push(line);
                continue;
            }
            // Value starts with a YAML-significant char — list, map, folded,
            // anchor, merge, tag. User presumably meant structure; leave it.
            if (/^[-?\[{>|!*&]/.test(value)) {
                out.push(line);
                continue;
            }
            // Ambiguous payload: contains a "colon + space" sequence (looks
            // like a nested key), a leading #, or embedded newlines.
            const ambiguous = /:\s/.test(value) || value.startsWith("#") || value.includes("\t");
            if (!ambiguous) {
                out.push(line);
                continue;
            }
            // Wrap in single quotes, doubling any existing single quotes
            // to preserve them per YAML rules.
            const escaped = value.replace(/'/g, "''");
            out.push(`${key}: '${escaped}'`);
        }
        return out.join("\n");
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

        // Read the system prompt MD file — unless system prompts are
        // disabled globally or locally on this container. Disabling
        // system prompts is a valid config: the container still runs,
        // but the model sees an empty system role and relies entirely
        // on the user message structure.
        const globalSP = this.settings.prSystemPromptsGlobalEnabled !== false;
        const useSP = globalSP && container.useSystemPrompt !== false;
        let systemPrompt = "";
        if (useSP) {
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

        // Dedicated alignment-outputs section. When opts.includeAlignmentContext
        // is on, we explicitly call out the alignment_* frontmatter keys so
        // the LLM treats them as measurements rather than generic context.
        if (opts.includeAlignmentContext && file) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};
            const alignmentLines = [];
            for (const [k, v] of Object.entries(fm)) {
                if (!k.startsWith("alignment_")) continue;
                if (v === null || v === undefined) continue;
                const display = typeof v === "object" ? JSON.stringify(v) : String(v);
                alignmentLines.push(`**${k.replace(/^alignment_/, "")}**: ${display}`);
            }
            if (alignmentLines.length > 0) {
                parts.push("# Alignment outputs (measurements from this period)", "", ...alignmentLines, "");
            }
        }

        parts.push(`# Source notes (${payload.label || "daily notes"})`, "", payload.text);

        // Framework reinforcement — reads the markdown file at
        // container.framework and injects its contents at the highest-
        // attention slot (right before the output instructions). Much
        // more reliable for procedural thinking guidance than the system
        // prompt. Respects the global Frameworks master in General and
        // the container's local useFramework toggle.
        const globalFW = this.settings.prFrameworksGlobalEnabled !== false;
        const useFW = globalFW && container.useFramework !== false && container.framework;
        if (useFW) {
            try {
                const frameworkText = await this.loadTemplate(container.framework);
                if (frameworkText && frameworkText.trim()) {
                    parts.push("");
                    parts.push("# Framework reinforcement");
                    parts.push("");
                    parts.push(frameworkText.trim());
                }
            } catch (_) { /* skip silently on read failure */ }
        }

        // Universal YAML hygiene tail — applies to EVERY LLM call the plugin
        // makes, so a sloppy system prompt can't produce unparseable YAML.
        // Non-prescriptive: only tells the model what would break the parser,
        // not how to style the content.
        parts.push("");
        parts.push("# YAML formatting requirements");
        parts.push("- Use plain, unquoted string values. Commas, semicolons, periods, and internal punctuation are fine as plain text.");
        parts.push("- Do NOT place a colon followed by a space (`: `) inside an unquoted value — the parser will misread it as a new key. Rephrase instead.");
        parts.push("- Do NOT start a value with `-`, `#`, `[`, or `{` unless you genuinely intend to produce a YAML list or map.");
        parts.push("- Do NOT wrap values in quotes. Plain strings only.");
        parts.push("- Do NOT return YAML document markers (`---`) around the block.");

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
            return opts.dryRun ? { parsed: {}, responseText: "", empty: true } : undefined;
        }

        // Parse YAML and merge into frontmatter
        const parsed = this.parsePRLLMResponse(responseText);
        const keys = Object.keys(parsed);
        if (keys.length === 0) {
            if (!opts.silent) new Notice(`${container.name}: LLM response had no fields to write`);
            return opts.dryRun ? { parsed: {}, responseText, empty: true } : undefined;
        }

        // Dry-run: do not mutate the file. Return the parsed keys so the
        // caller (the show-output node) can display what WOULD be written
        // and how it would interact with the note's current frontmatter.
        if (opts.dryRun) {
            return { parsed, responseText, systemPrompt, userMessage };
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
    async resolvePRInjectedVar(question, container, currentFile) {
        if (!question || !question.injectVar || !question.varField) return "";
        let sourceFile = null;
        const src = question.varSource || "previous-period";
        if (src === "current" && currentFile) {
            // Current note — the note being reflected on (last boundary
            // crossed in this container). Already has frontmatter from
            // the main aggregation + alignments by the time reflection runs.
            sourceFile = currentFile;
        } else if (src === "note" && question.varNotePath) {
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
            // `[ \t]*` keeps the match on one line; otherwise empty inline
// fields absorb the newline and pick up the next line's content.
const re = new RegExp(`^${escapeRegex(question.varField)}::[ \\t]*(.+)$`, "m");
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

    // Write a single answer to its configured output field. Target options
    // mirror the inject source options exactly:
    //   current            — active container's current note (default)
    //   previous-period    — previous note of the active container
    //   note               — a specific .md file by path
    //   container-current  — current note of another PR container
    //   container-previous — previous note of another PR container
    // Inline fields go in the body; frontmatter fields go via
    // processFrontMatter so we don't hand-edit YAML.
    async writePRAnswerToField(activeFile, activeContainer, question, answer) {
        if (!question || !question.outputToField || !question.outputFieldName) return;
        const ans = (answer || "").trim();
        if (!ans) return;

        const target = question.outputTarget || "current";
        let file = null;

        if (target === "current") {
            file = activeFile;
        } else if (target === "previous-period") {
            if (!activeContainer) {
                new Notice(`Question "${question.text}": no active container to resolve previous-period target.`);
                return;
            }
            file = await this.findPreviousPRContainerNote(activeContainer);
            if (!file) {
                new Notice(`Question "${question.text}": no previous-period note found for "${activeContainer.name}". Skipping output.`);
                return;
            }
        } else if (target === "note") {
            if (!question.outputNotePath) {
                new Notice(`Question "${question.text}": output target is "note" but no path is set. Skipping.`);
                return;
            }
            const f = this.app.vault.getAbstractFileByPath(question.outputNotePath);
            if (!(f instanceof TFile)) {
                new Notice(`Question "${question.text}": output note ${question.outputNotePath} not found. Skipping.`);
                return;
            }
            file = f;
        } else if (target === "container-current" || target === "container-previous") {
            const otherId = question.outputTargetContainerId;
            if (!otherId) {
                new Notice(`Question "${question.text}": output target is "${target}" but no container is picked. Skipping.`);
                return;
            }
            const otherContainer = (this.settings.prContainers || []).find(c => c.id === otherId);
            if (!otherContainer) {
                new Notice(`Question "${question.text}": output target container not found. Skipping.`);
                return;
            }
            file = target === "container-current"
                ? await this.findMostRecentPRContainerNote(otherContainer)
                : await this.findPreviousPRContainerNote(otherContainer);
            if (!file) {
                new Notice(`Question "${question.text}": "${otherContainer.name}" has no ${target === "container-current" ? "current" : "previous"} note. Skipping output.`);
                return;
            }
        } else {
            file = activeFile;
        }
        if (!file) return;

        // Sanitize the configured field name — strip any trailing `::` or
        // `:` that a user may have included by accident (so "notes:" becomes
        // "notes" instead of creating a literal key called "notes:").
        const fieldName = (question.outputFieldName || "").replace(/::?$/, "").trim();
        if (!fieldName) return;
        const fieldType = question.outputFieldType || "inline";

        try {
            // Update-in-place regardless of the configured type: if the
            // field already exists as frontmatter OR as an inline field,
            // write back to wherever it lives. Only fall through to
            // creating a new field (at the configured type) if neither
            // location has it.
            let content = await this.app.vault.read(file);
            const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
            const fmBlock = fmMatch ? fmMatch[1] : "";
            const body = fmMatch ? content.slice(fmMatch[0].length) : content;

            // Frontmatter key detection: `^key:` inside the block (not `::`).
            const fmKeyRe = new RegExp(`^${escapeRegex(fieldName)}\\s*:(?!:)`, "m");
            const hasFm = fmKeyRe.test(fmBlock);

            // Inline key detection: `^key::` in the body.
            const inlineRe = new RegExp(`^(${escapeRegex(fieldName)}::)[ \\t]*(.*)$`, "m");
            const hasInline = inlineRe.test(body);

            if (hasFm) {
                await this.app.fileManager.processFrontMatter(file, fm => {
                    fm[fieldName] = ans;
                });
                return;
            }
            if (hasInline) {
                const newBody = body.replace(inlineRe, `$1 ${ans}`);
                const rebuilt = fmMatch ? content.slice(0, fmMatch[0].length) + newBody : newBody;
                await this.app.vault.modify(file, rebuilt);
                return;
            }

            // Neither exists — create at the configured location.
            if (fieldType === "frontmatter") {
                await this.app.fileManager.processFrontMatter(file, fm => {
                    fm[fieldName] = ans;
                });
                return;
            }
            const rebuilt = (fmMatch ? content.slice(0, fmMatch[0].length) : "")
                + body.trimEnd() + `\n${fieldName}:: ${ans}\n`;
            await this.app.vault.modify(file, rebuilt);
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
            injectedVars.push(await this.resolvePRInjectedVar(q, container, file));
        }

        new ReflectionModal(this.app, reflection.questions, injectedVars, async (answers) => {
            // Step 1 — always: write each answer to its configured output
            // field. Persists raw answers regardless of LLM success or
            // whether the LLM is used at all.
            for (let i = 0; i < reflection.questions.length; i++) {
                await this.writePRAnswerToField(file, container, reflection.questions[i], answers[i]);
            }

            // Step 2 — alignments fire EARLY when includeAlignmentContext
            // is on. Otherwise they fire after the LLM call (or already ran
            // at boundary in non-replace mode). The early-fire path lets
            // the reflection LLM see alignment outputs in the same call.
            const earlyAlignments = reflection.includeAlignmentContext && reflection.replaceAutoLLM && range;
            if (earlyAlignments) {
                await this.runPRAlignmentsForContainer(container, file, range, {});
                await this.runPRAlignmentGroupsForContainer(container, file, range, {});
            }

            // Step 3 — optional LLM call. The reflection's useLLM toggle
            // controls whether this fires.
            if (reflection.useLLM) {
                await this.runPRLLMAggregation(container, file, range, {
                    answers,
                    injectedVars,
                    // Force previous-frontmatter inclusion when alignment
                    // context is requested so the LLM sees the alignment
                    // keys we just wrote.
                    includePreviousFrontmatter: !reflection.replaceAutoLLM || reflection.includeAlignmentContext,
                    includeAlignmentContext: reflection.includeAlignmentContext,
                    reflection,
                });
            }

            // Step 4 — alignments fire late when they didn't fire early.
            // Skip when they already ran (either at boundary or earlier in
            // this same reflection call).
            if (reflection.replaceAutoLLM && range && !earlyAlignments) {
                await this.runPRAlignmentsForContainer(container, file, range, {});
                await this.runPRAlignmentGroupsForContainer(container, file, range, {});
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

        const mode = alignment.mode || "separate";
        const prefix = (alignment.prefix || "alignment").trim();
        const shortName = (alignment.name || "unnamed").toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const outputKey = (alignment.outputField || "").trim() || `${prefix}_${shortName}`;

        // ── Collect subdivision entries for the tracked field ──
        const entriesStr = await this.collectPRFieldFromSubdivisions(
            container, range.start, range.end, alignment.dataField
        );

        // ── Prepend mode: pure template splice, no LLM ──
        if (mode === "prepend") {
            const currentFm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
            const existing = currentFm[outputKey] ?? "";
            const existingStr = typeof existing === "object" ? JSON.stringify(existing) : String(existing);
            const defaultTemplate = "**{guideline}** — {entries}";
            const tmpl = (alignment.template || "").trim() || defaultTemplate;
            const spliced = this.applyPRAlignmentTemplate(tmpl, {
                guideline: alignment.description || "",
                entries:   entriesStr,
                existing:  existingStr,
                name:      shortName,
            });
            try {
                await this.app.fileManager.processFrontMatter(file, fm => {
                    fm[outputKey] = spliced;
                });
                if (!opts.silent) new Notice(`Alignment "${alignment.name}": wrote to ${outputKey} (prepend)`);
            } catch (e) {
                new Notice(`Alignment "${alignment.name}": failed to write — ${e.message}`);
            }
            return;
        }

        // ── LLM modes: separate or rewrite ──

        // Resolve LLM service — own service overrides container's
        const serviceId = alignment.llmServiceId || container.llmServiceId;
        const service = this.getPRLLMService(serviceId);
        if (!service || !service.model) {
            if (!opts.silent) new Notice(`Alignment "${alignment.name}": no usable LLM service`);
            return;
        }

        // Build system prompt — file-based if set, otherwise inline description
        let systemPrompt = "";
        const globalSP = this.settings.prSystemPromptsGlobalEnabled !== false;
        const useSP = globalSP && alignment.useSystemPrompt !== false;
        if (useSP && alignment.systemPromptFile) {
            try { systemPrompt = await this.loadTemplate(alignment.systemPromptFile); } catch (_) {}
        }
        if (!systemPrompt && alignment.description && alignment.description.trim()) {
            // Fall back to description as inline system prompt (legacy behavior)
            systemPrompt = [
                `# Alignment: ${alignment.name}`,
                "",
                alignment.description.trim(),
                "",
                "# Your task",
                "",
                mode === "rewrite"
                    ? `Look at the daily values below for "${alignment.dataField}". Return ONLY a concise string (5-20 words) capturing how close the actuals are to this alignment. No YAML, no headings.`
                    : `Look at the daily values below for "${alignment.dataField}". Surface patterns of consistency, drift, and absence — not compliance scoring. Return ONLY a short observation (1-3 sentences). No YAML, no headings, no preamble.`,
            ].join("\n");
        }

        // Collect per-day field values for the user message (list format)
        const endInclusive = new Date(range.end);
        endInclusive.setHours(23, 59, 59, 999);
        const dailies = this.findDailyNotesInRange(range.start, endInclusive);
        const entryLines = [];
        for (const dn of dailies) {
            let val = "";
            if (alignment.dataFieldType === "frontmatter") {
                const cache = this.app.metadataCache.getFileCache(dn);
                const v = cache?.frontmatter?.[alignment.dataField];
                val = (v === null || v === undefined) ? "" : String(v);
            } else {
                const content = await this.app.vault.read(dn);
                const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
                const re = new RegExp(`^${escapeRegex(alignment.dataField)}::[ \\t]*(.+)$`, "m");
                const m = body.match(re);
                val = m ? m[1].trim() : "";
            }
            if (val) entryLines.push(`- ${dn.basename}: ${val}`);
        }

        const parts = [
            `# Period`,
            `start: ${formatDate(range.start)}`,
            `end: ${formatDate(range.end)}`,
            `daily_count: ${dailies.length}`,
            `entries_with_value: ${entryLines.length}`,
            "",
            `# Daily values for "${alignment.dataField}"`,
            "",
            entryLines.length > 0 ? entryLines.join("\n") : "(no entries in range)",
        ];

        // Framework reinforcement
        const globalFW = this.settings.prFrameworksGlobalEnabled !== false;
        const useFW = globalFW && alignment.useFramework !== false && alignment.framework;
        if (useFW) {
            try {
                const fwText = await this.loadTemplate(alignment.framework);
                if (fwText && fwText.trim()) {
                    parts.push("", "# Framework reinforcement", "", fwText.trim());
                }
            } catch (_) {}
        }

        // YAML hygiene tail
        parts.push("");
        parts.push("# Output format");
        if (mode === "rewrite") {
            parts.push(`Return ONLY a concise string (5-20 words) for the key \`${outputKey}\`. No YAML block, no headings. Plain text only.`);
        } else {
            parts.push(`Return ONLY a short observation (1-3 sentences) for the key \`${outputKey}\`. No YAML block, no headings. Plain text only.`);
        }

        const userMessage = parts.join("\n");

        const provider = PROVIDERS[service.provider];
        if (!provider) {
            if (!opts.silent) new Notice(`Alignment "${alignment.name}": unknown provider "${service.provider}"`);
            return;
        }

        let responseText;
        try {
            if (!opts.silent) new Notice(`Alignment "${alignment.name}": running…`);
            const url = provider.buildUrl(service);
            const bodyJson = provider.buildBody(userMessage, service, systemPrompt);
            const headers = {
                "Content-Type": "application/json",
                ...(provider.headers ? provider.headers(service) : {}),
            };
            const r = await requestUrl({ url, method: "POST", headers, body: JSON.stringify(bodyJson), throw: false });
            this.recordPRLastLLMCall({
                timestamp: new Date().toISOString(),
                container: `${container.name} → ${alignment.name}`,
                service: service.name,
                provider: service.provider,
                model: service.model,
                url,
                requestHeaders: headers,
                requestBody: bodyJson,
                responseStatus: r.status,
                responseRaw: r.text || "",
                systemPrompt,
                userMessage,
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

    // ─── Periodic Ritual: Alignment Group pass ───
    //
    // Runs after the main container aggregation, before on-demand reflection.
    // For each group attached to this container, resolves the guidelines
    // source, extracts {prefix}_* fields, and sends one LLM call with:
    //   - the group's system prompt
    //   - the container's period + subdivision payload (actuals)
    //   - optionally the freshly-aggregated frontmatter (compressed actuals)
    //   - the extracted guidelines
    // Then parses the YAML response and merges keys into the container note.
    async runPRAlignmentGroupsForContainer(container, file, range, opts = {}) {
        const phase = opts.phase || "generate";
        const groups = (this.settings.prAlignmentGroups || []).filter(g => {
            if (g.containerId !== container.id) return false;
            const runAt = g.runAt || "both";
            return runAt === "both" || runAt === phase;
        });
        if (groups.length === 0) return;
        for (const g of groups) {
            await this.runPRAlignmentGroupPass(g, container, file, range, opts);
        }
    }

    // ─── Alignment group helpers ───

    // Load the guidelines source for a group into a structured object:
    //   {
    //     sourceFile,
    //     sourceLabel,
    //     sourceFm,           // { key: value } frontmatter from source
    //     sourceInline,       // { key: value } inline `key:: value` fields from source body
    //     guidelines,         // { alignmentKey: value } — filtered to prefix, meta keys excluded
    //   }
    // Returns null if the source can't be resolved.
    async resolvePRAlignmentGroupSource(group) {
        let sourceFile = null;
        let sourceLabel = "(no source)";
        if (group.sourceKind === "data-source" && group.sourceId) {
            const ds = (this.settings.prDataSources || []).find(x => x.id === group.sourceId);
            if (ds) {
                sourceFile = this.resolveDataSourceLatest(ds);
                sourceLabel = ds.name || "data source";
            }
        } else if (group.sourceKind === "container" && group.sourceId) {
            const srcContainer = (this.settings.prContainers || []).find(x => x.id === group.sourceId);
            if (srcContainer) {
                sourceFile = await this.findMostRecentPRContainerNote(srcContainer);
                sourceLabel = srcContainer.name || "container";
            }
        }
        if (!sourceFile) return null;

        const prefix = (group.prefix || "alignment").trim();
        if (!prefix) return null;

        const sourceFm = this.app.metadataCache.getFileCache(sourceFile)?.frontmatter || {};
        const sourceInline = {};
        try {
            const raw = await this.app.vault.read(sourceFile);
            const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
            // `[ \t]*` (not `\s*`) so empty inline fields don't consume the
// newline and pick up the next line's value.
const inlineRegex = /^([a-zA-Z0-9_-]+)::[ \t]*(.+)$/gm;
            let m;
            while ((m = inlineRegex.exec(body)) !== null) {
                sourceInline[m[1]] = m[2].trim();
            }
        } catch (_) { /* ignore */ }

        // A base alignment key: starts with `{prefix}_`, doesn't end with
        // one of the meta suffixes. `alignment_health` is a guideline,
        // `alignment_health_target` is a meta override.
        const META_SUFFIXES = ["_target", "_mode", "_template"];
        const isBase = (k) => {
            if (!k.startsWith(prefix + "_")) return false;
            for (const suffix of META_SUFFIXES) {
                if (k.endsWith(suffix)) return false;
            }
            return true;
        };

        const guidelines = {};
        // Frontmatter first
        for (const [k, v] of Object.entries(sourceFm)) {
            if (!isBase(k)) continue;
            if (v === null || v === undefined) continue;
            guidelines[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
        }
        // Inline second — doesn't overwrite frontmatter
        for (const [k, v] of Object.entries(sourceInline)) {
            if (!isBase(k)) continue;
            if (guidelines[k]) continue;
            guidelines[k] = v;
        }

        return { sourceFile, sourceLabel, sourceFm, sourceInline, guidelines };
    }

    // Resolve the full config (mode, target, template) for a single
    // discovered alignment. Precedence: source meta keys > group overrides
    // > group defaults.
    resolvePRAlignmentConfig(group, alignmentKey, sourceFm, sourceInline) {
        const getMeta = (suffix) => {
            const k = `${alignmentKey}${suffix}`;
            if (sourceFm && sourceFm[k] !== undefined && sourceFm[k] !== null) {
                return typeof sourceFm[k] === "object" ? JSON.stringify(sourceFm[k]) : String(sourceFm[k]);
            }
            if (sourceInline && sourceInline[k] !== undefined) return sourceInline[k];
            return null;
        };

        const prefix = (group.prefix || "alignment").trim();
        const name = alignmentKey.startsWith(prefix + "_")
            ? alignmentKey.slice(prefix.length + 1)
            : alignmentKey;

        const groupOverride = (group.overrides || {})[alignmentKey] || {};

        let mode = getMeta("_mode") || groupOverride.mode || group.defaultMode || "separate";
        // `append` was an earlier mode; it's now collapsed into `prepend`
        // since the same result is achievable with a custom template. Any
        // lingering append config silently coerces to prepend.
        if (mode === "append") mode = "prepend";

        // Target pattern: can have {prefix} and {name} tokens
        const targetPattern = getMeta("_target") || groupOverride.target || group.defaultTarget || "{prefix}_{name}";
        const target = targetPattern
            .replace(/\{prefix\}/g, prefix)
            .replace(/\{name\}/g, name);

        const defaultTemplates = {
            prepend: "**{guideline}** — {entries}",
        };
        const template = getMeta("_template") || groupOverride.template || group.defaultTemplate || defaultTemplates[mode] || "";

        return { mode, target, template, name, alignmentKey };
    }

    // Apply a template string to produce a splice result for prepend/append
    // modes. No LLM involvement. Available tokens:
    //   {guideline} — the source-note guideline value
    //   {existing}  — current value of the target key on the container note
    //   {entries}   — collected subdivision field values for the alignment's
    //                 short name, joined with ", "
    //   {name}      — the alignment's short name (e.g., "health")
    applyPRAlignmentTemplate(template, tokens) {
        return template
            .replace(/\{guideline\}/g, tokens.guideline || "")
            .replace(/\{existing\}/g, tokens.existing || "")
            .replace(/\{entries\}/g,  tokens.entries  || "")
            .replace(/\{name\}/g,     tokens.name     || "");
    }

    // Collect the value of a single field name across every subdivision
    // note in a container's current period. Reads the same sources that
    // buildPRSourcePayload would walk (daily / container / dataSource) but
    // extracts only the one field. Returns a joined ", "-separated string
    // of non-empty values. Empty string if nothing matches.
    async collectPRFieldFromSubdivisions(container, start, end, fieldName) {
        if (!container || !fieldName) return "";
        const sources = getContainerDataSources(container);
        if (sources.length === 0) return "";

        const results = [];
        const seen = new Set();

        for (const source of sources) {
            let files = [];
            if (source.type === "container" && source.containerId) {
                const sc = (this.settings.prContainers || []).find(c => c.id === source.containerId);
                if (sc) files = await this.findPRContainerNotesInRange(sc, start, end);
            } else if (source.type === "dataSource" && source.dataSourceId) {
                const ds = (this.settings.prDataSources || []).find(x => x.id === source.dataSourceId);
                if (ds) files = await this.resolveDataSourceForContainer(ds, start, end);
            } else {
                const endInclusive = new Date(end);
                endInclusive.setHours(23, 59, 59, 999);
                files = this.findDailyNotesInRange(start, endInclusive);
            }
            for (const f of files) {
                if (seen.has(f.path)) continue;
                seen.add(f.path);
                const val = await this.readPRFieldValue(f, fieldName);
                if (val !== null && val !== undefined && String(val).trim() !== "") {
                    results.push(String(val).trim());
                }
            }
        }

        return results.join(", ");
    }

    // Read a single field value from a file, checking frontmatter first,
    // then inline `key:: value` markers in the body. Returns null if absent.
    async readPRFieldValue(file, fieldName) {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        if (fm[fieldName] !== undefined && fm[fieldName] !== null) {
            if (typeof fm[fieldName] === "object") return JSON.stringify(fm[fieldName]);
            return String(fm[fieldName]);
        }
        try {
            const raw = await this.app.vault.read(file);
            const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
            const re = new RegExp(`^${escapeRegex(fieldName)}::[ \\t]*(.+)$`, "m");
            const m = body.match(re);
            if (m) return m[1].trim();
        } catch (_) { /* ignore */ }
        return null;
    }

    async runPRAlignmentGroupPass(group, container, file, range, opts = {}) {
        // 1. Resolve source → guidelines + raw source frontmatter / inline
        const src = await this.resolvePRAlignmentGroupSource(group);
        if (!src) {
            if (!opts.silent) new Notice(`${group.name}: guidelines source has no note to read`);
            return;
        }
        const { sourceFile, sourceLabel, sourceFm, sourceInline, guidelines } = src;
        if (Object.keys(guidelines).length === 0) {
            if (!opts.silent) new Notice(`${group.name}: no ${group.prefix}_* fields found in ${sourceFile.path}`);
            return;
        }

        // ── Combined mode: all alignments → one unified narrative ──
        if (group.combined || (group.defaultMode || "separate") === "combined") {
            return await this._runPRAlignmentGroupCombined(group, container, file, range, src, opts);
        }

        // 2. Resolve per-alignment config — split into splice-only vs LLM-required
        const resolved = [];
        for (const alignmentKey of Object.keys(guidelines)) {
            const config = this.resolvePRAlignmentConfig(group, alignmentKey, sourceFm, sourceInline);
            resolved.push({ ...config, guideline: guidelines[alignmentKey] });
        }
        const spliceAlignments = resolved.filter(r => r.mode === "prepend");
        const llmAlignments    = resolved.filter(r => r.mode === "separate" || r.mode === "rewrite");

        // 3. Splice writes run immediately — no LLM, no network. For each
        //    splice alignment: collect subdivision entries for the alignment's
        //    short name, read the current target value from the note, apply
        //    the template, stage for a single processFrontMatter write at
        //    the end.
        const writes = {};   // { key: value } to write in order
        const writeOrder = []; // track sequential prepends for same key
        const currentFm = file ? (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) : {};
        for (const r of spliceAlignments) {
            // Pull subdivision entries for this alignment's short name
            // (e.g. `health`). Empty string if nothing matches the field
            // across the period's source notes.
            const entries = await this.collectPRFieldFromSubdivisions(container, range.start, range.end, r.name);

            // Existing = whatever we've already staged, OR the current note
            // value. Sequential prepends against the same target key chain
            // through this.
            const staged = writes[r.target];
            const existing = staged !== undefined ? staged : (currentFm[r.target] ?? "");
            const existingStr = existing === null || existing === undefined ? "" :
                (typeof existing === "object" ? JSON.stringify(existing) : String(existing));

            const spliced = this.applyPRAlignmentTemplate(r.template, {
                guideline: r.guideline,
                existing:  existingStr,
                entries,
                name:      r.name,
            });
            writes[r.target] = spliced;
            writeOrder.push(r.target);
        }

        // 4. If any alignments need the LLM, bundle them into ONE call
        let llmResult = null;
        let systemPrompt = "";
        let userMessage = "";
        if (llmAlignments.length > 0) {
            const service = this.getPRLLMService(group.llmServiceId);
            if (!service || !service.model) {
                if (!opts.silent) new Notice(`${group.name}: LLM service missing or has no model (needed for ${llmAlignments.length} alignment(s))`);
                // Splice writes still land — the LLM ones are skipped.
            } else {
                // Load the group's own system prompt — unless system prompts
                // are disabled globally or locally on this group. When off,
                // the call runs with an empty system role.
                const globalSPG = this.settings.prSystemPromptsGlobalEnabled !== false;
                const useSPG = globalSPG && group.useSystemPrompt !== false;
                if (useSPG && group.systemPromptFile) {
                    try { systemPrompt = await this.loadTemplate(group.systemPromptFile); } catch (_) {}
                }

                // Build the source payload
                const payload = await this.buildPRSourcePayload(container, range.start, range.end);

                const parts = [
                    "# Period",
                    `start: ${formatDate(range.start)}`,
                    `end: ${formatDate(range.end)}`,
                    `source: ${payload.label || "daily notes"}`,
                    `count: ${payload.count}`,
                    "",
                ];

                if (group.includeAggregatedSummary !== false && file) {
                    const cache = this.app.metadataCache.getFileCache(file);
                    const aggregated = cache?.frontmatter || {};
                    const lines = [];
                    const prefix = (group.prefix || "alignment").trim();
                    for (const [k, v] of Object.entries(aggregated)) {
                        if (k === "periodic-ritual" || k === "position") continue;
                        if (k.startsWith("pr-")) continue;
                        if (k.startsWith(prefix + "_")) continue;  // skip previous gap results
                        if (v === null || v === undefined) continue;
                        if (typeof v === "object") lines.push(`${k}: ${JSON.stringify(v)}`);
                        else lines.push(`${k}: ${v}`);
                    }
                    if (lines.length > 0) {
                        parts.push("# Aggregated container summary", "", ...lines, "");
                    }
                }

                parts.push(`# Guidelines (from ${sourceLabel} — ${sourceFile.path})`, "");
                for (const r of llmAlignments) {
                    parts.push(`- **${r.alignmentKey}** → return under key \`${r.target}\`: ${r.guideline}`);
                }
                parts.push("");

                // Framework reinforcement — reads the markdown file at
                // group.framework and injects its contents at the highest-
                // attention slot right before the output instructions.
                // Respects both the global Frameworks master and the local
                // useFramework toggle.
                const globalFWG = this.settings.prFrameworksGlobalEnabled !== false;
                const useFWG = globalFWG && group.useFramework !== false && group.framework;
                if (useFWG) {
                    try {
                        const fwText = await this.loadTemplate(group.framework);
                        if (fwText && fwText.trim()) {
                            parts.push("# Framework reinforcement", "");
                            parts.push(fwText.trim());
                            parts.push("");
                        }
                    } catch (_) { /* skip silently on read failure */ }
                }

                parts.push("# Instructions", "");
                parts.push("Return a YAML block with exactly the keys listed below. Use the exact key names as given.");
                parts.push("");
                parts.push("**Isolation requirement — read carefully.** Treat each alignment as an INDEPENDENT analysis. Do not correlate, cross-reference, or merge concepts across alignments. Each alignment's value must reason ONLY about its own guideline and NO other. The reasoning, evidence, and framing for one alignment must not contaminate another. If a guideline asks about something that isn't present in the source activity below, say so explicitly rather than borrowing evidence from a neighboring dimension.");
                parts.push("");
                parts.push("**YAML formatting requirements:**");
                parts.push("- Use plain, unquoted string values. Commas, semicolons, periods, and internal punctuation are fine as plain text.");
                parts.push("- Do NOT place a colon followed by a space (`: `) inside an unquoted value — the parser will misread it as a new key. Rephrase instead.");
                parts.push("- Do NOT start a value with `-`, `#`, `[`, or `{` unless you genuinely intend to produce a YAML list or map.");
                parts.push("- Do NOT wrap values in quotes. Plain strings only.");
                parts.push("- Do NOT return YAML document markers (`---`) around the block.");
                parts.push("");
                parts.push("Produce the value type indicated by each alignment's mode:");
                parts.push("");
                for (const r of llmAlignments) {
                    if (r.mode === "separate") {
                        parts.push(`- \`${r.target}\`: long-form narrative gap analysis comparing the actuals below against this guideline, and only this guideline — ${r.guideline}`);
                    } else if (r.mode === "rewrite") {
                        parts.push(`- \`${r.target}\`: a concise string (5-20 words) that captures how close the actuals below were to this guideline, and only this guideline — ${r.guideline}`);
                    }
                }
                parts.push("");
                parts.push(`# Source activity (${payload.label || "daily notes"})`, "", payload.text);

                userMessage = parts.join("\n");

                const provider = PROVIDERS[service.provider];
                if (!provider) {
                    if (!opts.silent) new Notice(`${group.name}: unknown provider "${service.provider}"`);
                } else {
                    try {
                        if (!opts.silent) new Notice(`${group.name}: gap analysis via ${service.name}…`);
                        const url = provider.buildUrl(service);
                        const bodyJson = provider.buildBody(userMessage, service, systemPrompt);
                        const headers = {
                            "Content-Type": "application/json",
                            ...(provider.headers ? provider.headers(service) : {}),
                        };
                        const r = await requestUrl({ url, method: "POST", headers, body: JSON.stringify(bodyJson), throw: false });
                        const responseStatus = r.status;
                        const responseRaw = r.text || "";
                        this.recordPRLastLLMCall({
                            timestamp: new Date().toISOString(),
                            container: `${container.name} → ${group.name}`,
                            service: service.name,
                            provider: service.provider,
                            model: service.model,
                            url,
                            requestHeaders: headers,
                            requestBody: bodyJson,
                            responseStatus,
                            responseRaw,
                            systemPrompt,
                            userMessage,
                        });
                        if (r.status < 200 || r.status >= 300) {
                            throw new Error(`${r.status}: ${(r.text || "").slice(0, 300)}`);
                        }
                        const responseText = provider.extractText(r.json);
                        if (responseText) {
                            const parsed = this.parsePRLLMResponse(responseText);
                            llmResult = { parsed, responseText };
                            // Stage the LLM-returned values into our writes map
                            for (const r of llmAlignments) {
                                if (parsed[r.target] !== undefined) {
                                    writes[r.target] = parsed[r.target];
                                }
                            }
                        }
                    } catch (e) {
                        if (!opts.silent) new Notice(`${group.name}: LLM call failed — ${e.message}`);
                        console.error("Periodic Ritual alignment-group error:", e);
                    }
                }
            }
        }

        const writeKeys = Object.keys(writes);

        // 5. Dry-run: return everything for preview, don't touch the file.
        if (opts.dryRun) {
            return {
                parsed: writes,
                writes,
                resolved,
                spliceAlignments,
                llmAlignments,
                guidelines,
                systemPrompt,
                userMessage,
                sourceFile,
                sourceLabel,
                empty: writeKeys.length === 0,
            };
        }

        // 6. Write all staged keys using the group's configured target
        if (!file || writeKeys.length === 0) return;
        try {
            await this.writePRKeysToNote(file, writes, group.writeTo || "frontmatter");
            if (!opts.silent) new Notice(`${group.name}: wrote ${writeKeys.length} alignment(s) to ${group.writeTo || "frontmatter"}`);
        } catch (e) {
            if (!opts.silent) new Notice(`${group.name}: failed to write — ${e.message}`);
        }
    }

    // Combined-mode alignment group: all discovered alignments → one
    // unified LLM call → one output key. The model sees every guideline
    // together and returns a single holistic narrative instead of per-key
    // YAML. Written to `combinedOutputKey` (default `{prefix}_combined`).
    async _runPRAlignmentGroupCombined(group, container, file, range, src, opts = {}) {
        const { sourceFile, sourceLabel, guidelines } = src;
        const prefix = (group.prefix || "alignment").trim();
        const outputKey = (group.combinedOutputKey || "").trim() || `${prefix}_combined`;

        const service = this.getPRLLMService(group.llmServiceId);
        if (!service || !service.model) {
            if (!opts.silent) new Notice(`${group.name}: no usable LLM service for combined mode`);
            return;
        }

        let systemPrompt = "";
        const globalSP = this.settings.prSystemPromptsGlobalEnabled !== false;
        const useSP = globalSP && group.useSystemPrompt !== false;
        if (useSP && group.systemPromptFile) {
            try { systemPrompt = await this.loadTemplate(group.systemPromptFile); } catch (_) {}
        }

        const payload = await this.buildPRSourcePayload(container, range.start, range.end);

        const parts = [
            "# Period",
            `start: ${formatDate(range.start)}`,
            `end: ${formatDate(range.end)}`,
            `source: ${payload.label || "daily notes"}`,
            `count: ${payload.count}`,
            "",
        ];

        if (group.includeAggregatedSummary !== false && file) {
            const cache = this.app.metadataCache.getFileCache(file);
            const aggregated = cache?.frontmatter || {};
            const lines = [];
            for (const [k, v] of Object.entries(aggregated)) {
                if (k === "periodic-ritual" || k === "position" || k.startsWith("pr-")) continue;
                if (k.startsWith(prefix + "_")) continue;
                if (v === null || v === undefined) continue;
                if (typeof v === "object") lines.push(`${k}: ${JSON.stringify(v)}`);
                else lines.push(`${k}: ${v}`);
            }
            if (lines.length > 0) {
                parts.push("# Aggregated container summary", "", ...lines, "");
            }
        }

        parts.push(`# Guidelines (from ${sourceLabel} — ${sourceFile.path})`, "");
        for (const [k, v] of Object.entries(guidelines)) {
            parts.push(`- **${k}**: ${v}`);
        }
        parts.push("");

        const globalFW = this.settings.prFrameworksGlobalEnabled !== false;
        const useFW = globalFW && group.useFramework !== false && group.framework;
        if (useFW) {
            try {
                const fwText = await this.loadTemplate(group.framework);
                if (fwText && fwText.trim()) {
                    parts.push("# Framework reinforcement", "", fwText.trim(), "");
                }
            } catch (_) {}
        }

        parts.push("# Instructions", "");
        parts.push(`Return a YAML block with exactly one key: \`${outputKey}\`.`);
        parts.push("");
        const maxSentences = group.combinedMaxSentences || 10;
        parts.push(`The value must be a single unified narrative (up to ${maxSentences} sentences) that addresses ALL of the guidelines above together. Weave connections between dimensions where they exist. Be concise and specific — cite numbers, counts, and patterns, not vague generalities.`);
        parts.push("");
        parts.push("**YAML formatting requirements:**");
        parts.push("- Use plain, unquoted string values. Commas, semicolons, periods, and internal punctuation are fine.");
        parts.push("- Do NOT place a colon followed by a space (`: `) inside the value — rephrase instead.");
        parts.push("- Do NOT start the value with `-`, `#`, `[`, or `{`.");
        parts.push("- Do NOT wrap the value in quotes.");
        parts.push("- Do NOT return YAML document markers (`---`).");
        parts.push("- Keep it to ONE short paragraph. No line breaks inside the value.");
        parts.push("");
        parts.push(`# Source activity (${payload.label || "daily notes"})`, "", payload.text);

        const userMessage = parts.join("\n");

        const provider = PROVIDERS[service.provider];
        if (!provider) {
            if (!opts.silent) new Notice(`${group.name}: unknown provider`);
            return;
        }

        let responseText;
        try {
            if (!opts.silent) new Notice(`${group.name}: combined analysis via ${service.name}…`);
            const url = provider.buildUrl(service);
            const bodyJson = provider.buildBody(userMessage, service, systemPrompt);
            const headers = {
                "Content-Type": "application/json",
                ...(provider.headers ? provider.headers(service) : {}),
            };
            const r = await requestUrl({ url, method: "POST", headers, body: JSON.stringify(bodyJson), throw: false });
            this.recordPRLastLLMCall({
                timestamp: new Date().toISOString(),
                container: `${container.name} → ${group.name} (combined)`,
                service: service.name, provider: service.provider, model: service.model,
                url, requestHeaders: headers, requestBody: bodyJson,
                responseStatus: r.status, responseRaw: r.text || "",
                systemPrompt, userMessage,
            });
            if (r.status < 200 || r.status >= 300) {
                throw new Error(`${r.status}: ${(r.text || "").slice(0, 300)}`);
            }
            responseText = provider.extractText(r.json);
        } catch (e) {
            if (!opts.silent) new Notice(`${group.name}: LLM call failed — ${e.message}`);
            console.error("Periodic Ritual alignment-group combined error:", e);
            return;
        }

        if (!responseText) {
            if (!opts.silent) new Notice(`${group.name}: empty response`);
            return opts.dryRun ? { parsed: { [outputKey]: "" }, writes: {}, guidelines, systemPrompt, userMessage, empty: true, combined: true } : undefined;
        }

        // Parse through the standard YAML pipeline (fence stripping +
        // sanitizer) so the combined response gets the same safety
        // treatment as every other LLM output.
        const parsed = this.parsePRLLMResponse(responseText);
        const value = parsed[outputKey] || responseText.trim();
        const writes = { [outputKey]: value };

        if (opts.dryRun) {
            return { parsed: writes, writes, guidelines, systemPrompt, userMessage, combined: true, outputKey };
        }

        if (!file) return;
        try {
            await this.writePRKeysToNote(file, writes, group.writeTo || "frontmatter");
            if (!opts.silent) new Notice(`${group.name}: wrote combined analysis to ${outputKey} (${group.writeTo || "frontmatter"})`);
        } catch (e) {
            if (!opts.silent) new Notice(`${group.name}: failed to write — ${e.message}`);
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
            // Multi-source: walk every container source. Daily sources have
            // no dependency to wait for.
            const sources = getContainerDataSources(c);
            for (const source of sources) {
                if (source.type === "container" && source.containerId) {
                    const dep = byId.get(source.containerId);
                    if (dep) visit(dep);
                }
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

        // Write-back pass: if the container has writeBackAt set, check if
        // there's an existing note for a period whose boundary has been
        // crossed on the write-back side. For example, generateAt=start
        // + writeBackAt=end means: when the period ENDS, re-run the
        // pipeline on the already-existing note.
        const writeBackAt = container.writeBackAt || "";
        if (writeBackAt) {
            // Find the most recently ENDED period that has an existing note
            // but may not have been written back to yet. We use a simple
            // heuristic: if the current period has ended (or is the one we
            // just generated), check if its note exists and run the write-back.
            try {
                // Check the previous period (just ended)
                const prevDate = addDays(currentRange.start, -1);
                const prevRange = await this.getPRBoundaryData(container.boundaryDetector, prevDate);
                if (prevRange && prevRange.end < now) {
                    const prevEndStr = formatDate(prevRange.end);
                    const prevFileName = this.resolveTokens(container.naming, prevRange.tokens);
                    const prevFolder = container.saveDir || "";
                    const prevPath = prevFolder ? `${prevFolder}/${prevFileName}.md` : `${prevFileName}.md`;
                    const prevFile = this.app.vault.getAbstractFileByPath(prevPath);

                    if (prevFile && prevFile instanceof TFile) {
                        // Two-source guard: local lastWriteBackEnd (in data.json)
                        // AND the note's own writeback=true marker (in the vault).
                        // Either is sufficient to treat the period as done. This
                        // matters on multi-device setups — data.json doesn't
                        // sync across devices reliably, so without the note-side
                        // marker a second device would re-fire write-back and
                        // overwrite whatever the first device produced.
                        const noteMeta = await this.readPRMetadataFromFile(prevFile, container);
                        const noteSaysDone = noteMeta?.writeback === "true";
                        const localSaysDone = container.lastWriteBackEnd === prevEndStr;

                        if (localSaysDone || noteSaysDone) {
                            // If the note says done but our local state is
                            // stale (another device ran it), catch local up so
                            // we don't re-enter this branch on every reload.
                            if (noteSaysDone && !localSaysDone) {
                                container.lastWriteBackEnd = prevEndStr;
                                await this.saveSettings();
                            }
                        } else {
                            const shouldWriteBack = (writeBackAt === "end" && prevRange.end < now)
                                || (writeBackAt === "start" && prevRange.start <= now);
                            if (shouldWriteBack) {
                                await this.writeBackToPRContainerNote(container, prevFile, prevRange, { silent: false });
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(`Periodic Ritual: write-back check failed for ${container.name}`, e);
            }
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
        // Command names omit the "Periodic Ritual:" prefix — Obsidian auto-
        // prefixes palette entries with the plugin's display name, so
        // including it here would render "Periodic Ritual: Periodic Ritual: …".
        this.addCommand({
            id: "pr-generate-container",
            name: "Generate container note",
            callback: () => this.pickAndGeneratePRContainer(),
        });

        this.addCommand({
            id: "pr-catch-up",
            name: "Catch up missed notes",
            callback: () => this.runPRAutoGenerate(),
        });

        this.addCommand({
            id: "pr-reflect",
            name: "Reflect",
            callback: () => this.pickAndReflectPRContainer(),
        });

        this.addCommand({
            id: "pr-debug-last-llm",
            name: "Show last LLM call",
            callback: () => new PRDebugModal(this.app, this.lastPRLLMCall).open(),
        });

        this.addCommand({
            id: "pr-hierarchy",
            name: "Show hierarchy diagram",
            callback: () => new PRHierarchyModal(this.app, this).open(),
        });

        this.addCommand({
            id: "pr-graph",
            name: "Open graph view",
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
                    const re = new RegExp(`^${escapeRegex(key)}::[ \\t]*([^\\n]+)`, "m");
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

    async pickAndReflectPRContainer() {
        // Collect containers that have a reflection attached AND have a
        // generated note for the current period (boundary crossed). Only
        // these appear in the picker — there's nothing to reflect on if
        // the note hasn't been generated yet.
        const candidates = [];
        const withReflection = (this.settings.prContainers || []).filter(c => !!c.reflectionId);
        if (withReflection.length === 0) {
            new Notice("No containers have a reflection profile attached. Attach one in Settings → Containers.");
            return;
        }
        for (const c of withReflection) {
            const file = await this.findMostRecentPRContainerNote(c);
            if (file) candidates.push(c);
        }
        if (candidates.length === 0) {
            new Notice("No containers with reflections have a generated note for the current period. Generate one first.");
            return;
        }
        if (candidates.length === 1) {
            // Only one eligible — skip the picker and go straight to Q&A.
            await this.runPRContainerReflection(candidates[0]);
            return;
        }
        const modal = new PRContainerPickerModal(this.app, candidates, async (container) => {
            await this.runPRContainerReflection(container);
        });
        modal.setPlaceholder("Pick a container to reflect on…");
        modal.open();
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
        // Phase 10c-3 view filters — in-memory only, reset on view close.
        this.filters = {
            hiddenKinds: new Set(),
            focusContainerId: "",
            enabledOnly: false,
        };
        // Multi-select state — Set of node ids. Reset on view close.
        this.selection = new Set();
        // In-memory clipboard for copy/paste of primitives
        this.clipboard = null;
    }

    getViewType() { return PR_GRAPH_VIEW_TYPE; }
    getDisplayText() { return "Periodic Ritual Graph"; }
    getIcon() { return "git-fork"; }

    // Shared color identity per node kind. Used everywhere the UI needs a
    // minimal visual marker (pipes, dots, highlights) without showing the
    // full node. Kept in sync with the CSS kind pill + header stripe colors.
    colorForKind(kind) {
        switch (kind) {
            case "container":       return "var(--interactive-accent)";
            case "boundary":        return "#4a90e2";
            case "llm":             return "#5cb85c";
            case "reflection":      return "#a06cd5";
            case "alignment":       return "#f0a04b";
            case "alignment-group": return "#e08a3c";
            case "data-source":     return "#3db8a6";
            case "show":            return "var(--text-muted)";
            case "daily":           return "var(--text-faint)";
            default:                return "var(--text-muted)";
        }
    }

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
        const dataSources = s.prDataSources || [];
        const alignmentGroups = s.prAlignmentGroups || [];
        const showNodes = s.prShowNodes || [];

        const nodes = [];
        const wires = [];

        // Track which boundaries are actually referenced — only built-in
        // boundaries get this filter (otherwise we'd show all 7 detectors
        // even when only one is used). Reflections / alignments / LLM
        // services / custom boundaries always show, even when unattached,
        // so newly created primitives are visible immediately.
        const usedBoundaries = new Set();
        let anyDaily = false;

        for (const c of containers) {
            const sources = getContainerDataSources(c);
            for (const src of sources) {
                if (src.type === "daily") anyDaily = true;
            }
            if (c.boundaryDetector) usedBoundaries.add(c.boundaryDetector);
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

        // ── Boundary nodes ──
        // Built-in boundaries: only those referenced by a container.
        // Custom boundaries: always shown so newly created ones are visible
        // even before they're wired up.
        const customBoundaryIdsRendered = new Set();
        for (const detId of usedBoundaries) {
            if (detId.startsWith("custom:")) {
                const cbId = detId.slice("custom:".length);
                const cb = customBoundaries.find(c => c.id === cbId);
                customBoundaryIdsRendered.add(cbId);
                nodes.push({
                    id: `boundary-custom-${cbId}`,
                    kind: "boundary",
                    title: cb?.name || "(custom)",
                    subtitle: "Custom JS",
                    refKey: detId,
                    primitive: cb,
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
        // Unattached custom boundaries (none of the containers reference them yet)
        for (const cb of customBoundaries) {
            if (customBoundaryIdsRendered.has(cb.id)) continue;
            nodes.push({
                id: `boundary-custom-${cb.id}`,
                kind: "boundary",
                title: cb.name || "(custom)",
                subtitle: "Custom JS",
                primitive: cb,
                primitiveTab: "boundaries",
            });
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

        // ── LLM service nodes (always shown, attached or not) ──
        for (const svc of services) {
            nodes.push({
                id: `llm-${svc.id}`,
                kind: "llm",
                title: svc.name || "(unnamed)",
                subtitle: `${svc.provider}${svc.model ? " / " + svc.model.replace(new RegExp(`^${svc.provider}/`, "i"), "") : ""}`,
                primitive: svc,
                primitiveTab: "llm",
            });
        }

        // ── Reflection nodes (always shown, attached or not) ──
        for (const r of reflections) {
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

        // ── Legacy alignment nodes — only rendered if prAlignments has entries.
        // New alignments are created as alignment groups (which also handle
        // single-alignment use cases). This block exists purely for backward
        // compat so old data still shows nodes.
        for (const a of alignments) {
            nodes.push({
                id: `alignment-${a.id}`,
                kind: "alignment",
                title: a.name || "(unnamed)",
                subtitle: a.dataField || "(no field)",
                primitive: a,
                primitiveTab: "alignments",
            });
        }

        // ── Data source nodes (always shown — reusable note/folder refs) ──
        for (const ds of dataSources) {
            let subtitle;
            if (ds.mode === "static") {
                subtitle = ds.notePath ? ds.notePath.split("/").pop() : "(no note selected)";
            } else {
                subtitle = ds.folderPath ? `${ds.folderPath}/ (dynamic)` : "(no folder selected)";
            }
            nodes.push({
                id: `datasource-${ds.id}`,
                kind: "data-source",
                title: ds.name || "(unnamed)",
                subtitle,
                primitive: ds,
                primitiveTab: "data-sources",
            });
        }

        // ── Alignment group nodes (always shown) ──
        for (const g of alignmentGroups) {
            const targetLabel = g.containerId
                ? ((containers.find(c => c.id === g.containerId)?.name) || "(missing)")
                : "(unattached)";
            nodes.push({
                id: `alignmentgroup-${g.id}`,
                kind: "alignment-group",
                title: g.name || "(unnamed)",
                subtitle: `prefix: ${g.prefix || "?"} → ${targetLabel}`,
                primitive: g,
                primitiveTab: "alignments",
            });
        }

        // ── Show-output probe nodes (graph-only, no settings tab) ──
        for (const sh of showNodes) {
            let subtitle = "(drag any output here)";
            if (sh.sourceNodeId) {
                // Resolve the source node's title for a clearer subtitle —
                // "← Daily notes", "← Weekly", etc. Falls back to the raw
                // id when the source no longer exists.
                const src =
                    containers.find(x => `container-${x.id}` === sh.sourceNodeId) ||
                    reflections.find(x => `reflection-${x.id}` === sh.sourceNodeId) ||
                    alignments.find(x => `alignment-${x.id}` === sh.sourceNodeId) ||
                    services.find(x => `llm-${x.id}` === sh.sourceNodeId);
                if (src) subtitle = `← ${src.name || "(unnamed)"}`;
                else if (sh.sourceNodeId === "daily") subtitle = "← Daily notes";
                else if (sh.sourceNodeId.startsWith("boundary-")) subtitle = `← ${sh.sourceNodeId.replace(/^boundary-(custom-)?/, "")}`;
                else subtitle = "← (source missing)";
            }
            nodes.push({
                id: `show-${sh.id}`,
                kind: "show",
                title: sh.name || "Show output",
                subtitle,
                primitive: sh,
                primitiveTab: null,  // graph-only, no settings tab
            });
        }

        // ── Wires ──

        // dataSource wires — one per configured source so multi-source
        // containers show all their feeds.
        for (const c of containers) {
            const sources = getContainerDataSources(c);
            for (const src of sources) {
                if (src.type === "container" && src.containerId) {
                    wires.push({
                        from: `container-${src.containerId}`,
                        to: `container-${c.id}`,
                        fromSocket: "out",
                        toSocket: "in-data",
                        kind: "data-source",
                    });
                } else if (src.type === "dataSource" && src.dataSourceId) {
                    wires.push({
                        from: `datasource-${src.dataSourceId}`,
                        to: `container-${c.id}`,
                        fromSocket: "out",
                        toSocket: "in-data",
                        kind: "data-source",
                    });
                } else {
                    wires.push({
                        from: "daily",
                        to: `container-${c.id}`,
                        fromSocket: "out",
                        toSocket: "in-data",
                        kind: "data-source",
                    });
                }
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

        // alignment-group wires — three per group (source, llm, target)
        for (const g of alignmentGroups) {
            if (g.containerId) {
                wires.push({
                    from: `alignmentgroup-${g.id}`,
                    to: `container-${g.containerId}`,
                    fromSocket: "out",
                    toSocket: "in-alignment",
                    kind: "alignment",
                });
            }
            if (g.sourceKind === "data-source" && g.sourceId) {
                wires.push({
                    from: `datasource-${g.sourceId}`,
                    to: `alignmentgroup-${g.id}`,
                    fromSocket: "out",
                    toSocket: "in-source",
                    kind: "data-source",
                });
            } else if (g.sourceKind === "container" && g.sourceId) {
                wires.push({
                    from: `container-${g.sourceId}`,
                    to: `alignmentgroup-${g.id}`,
                    fromSocket: "out",
                    toSocket: "in-source",
                    kind: "data-source",
                });
            }
            if (g.llmServiceId) {
                wires.push({
                    from: `llm-${g.llmServiceId}`,
                    to: `alignmentgroup-${g.id}`,
                    fromSocket: "out",
                    toSocket: "in-llm",
                    kind: "llm",
                });
            }
        }

        // show-node probe wires — one per show node that has a live source
        const nodeIds = new Set(nodes.map(n => n.id));
        for (const sh of showNodes) {
            if (!sh.sourceNodeId || !nodeIds.has(sh.sourceNodeId)) continue;
            wires.push({
                from: sh.sourceNodeId,
                to: `show-${sh.id}`,
                fromSocket: "out",
                toSocket: "in-any",
                kind: "show",
            });
        }

        return this.applyFilters(nodes, wires);
    }

    // Apply view filters to a built graph. Removes nodes by kind, removes
    // disabled containers when enabledOnly is on, and reduces to a single
    // container's dependency graph (both upstream and downstream) when
    // focusContainerId is set. Wires connecting to filtered-out nodes are
    // also dropped.
    applyFilters(nodes, wires) {
        const f = this.filters;
        let keptNodes = nodes;
        let keptWires = wires;

        // 1. Hidden kinds
        if (f.hiddenKinds.size > 0) {
            keptNodes = keptNodes.filter(n => !f.hiddenKinds.has(n.kind));
        }

        // 2. Enabled-only filter for containers
        if (f.enabledOnly) {
            keptNodes = keptNodes.filter(n => {
                if (n.kind !== "container") return true;
                return !!n.primitive?.enabled;
            });
        }

        // 3. Container focus — keep only nodes connected to the focused
        //    container (upstream sources + downstream consumers, recursively)
        //    plus any reflections / alignments / llm services / boundaries
        //    attached to any of those containers.
        if (f.focusContainerId) {
            const focusNodeId = `container-${f.focusContainerId}`;
            const containerOnlyWires = wires.filter(w => w.kind === "data-source");

            // Walk upstream
            const upstream = new Set([focusNodeId]);
            const stackUp = [focusNodeId];
            while (stackUp.length) {
                const cur = stackUp.pop();
                for (const w of containerOnlyWires) {
                    if (w.to === cur && !upstream.has(w.from)) {
                        upstream.add(w.from);
                        stackUp.push(w.from);
                    }
                }
            }

            // Walk downstream
            const downstream = new Set([focusNodeId]);
            const stackDown = [focusNodeId];
            while (stackDown.length) {
                const cur = stackDown.pop();
                for (const w of containerOnlyWires) {
                    if (w.from === cur && !downstream.has(w.to)) {
                        downstream.add(w.to);
                        stackDown.push(w.to);
                    }
                }
            }

            const visibleContainerIds = new Set([...upstream, ...downstream]);
            // Always keep daily if any visible container reads from daily
            for (const w of wires) {
                if (w.kind === "data-source" && w.from === "daily" && visibleContainerIds.has(w.to)) {
                    visibleContainerIds.add("daily");
                }
            }
            // Keep attached reflections, alignments, llm services, and
            // boundaries connected to any visible container
            for (const w of wires) {
                if (visibleContainerIds.has(w.to) && w.kind !== "data-source") {
                    visibleContainerIds.add(w.from);
                }
            }
            keptNodes = keptNodes.filter(n => visibleContainerIds.has(n.id));
        }

        // Drop wires whose endpoints aren't in the kept set
        const keptIds = new Set(keptNodes.map(n => n.id));
        keptWires = keptWires.filter(w => keptIds.has(w.from) && keptIds.has(w.to));

        return { nodes: keptNodes, wires: keptWires };
    }

    // ─── Auto-layout ───
    // Simple grid by kind. Saved positions in prGraphLayout override.
    layoutNodes(nodes) {
        const COLS = {
            daily: 0,
            "data-source": 0,
            boundary: 1,
            llm: 2,
            container: 3,
            reflection: 4,
            alignment: 5,
            "alignment-group": 5,
            show: 6,
        };
        const COL_X = 280;
        const ROW_Y = 140;
        const PAD_X = 60;
        const PAD_Y = 60;

        const counters = { daily: 0, "data-source": 0, boundary: 0, llm: 0, container: 0, reflection: 0, alignment: 0, "alignment-group": 0, show: 0 };
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

        // Filter button — count active filters in the label so the user
        // sees at a glance whether anything is filtered
        const filterCount = this.filters.hiddenKinds.size + (this.filters.focusContainerId ? 1 : 0) + (this.filters.enabledOnly ? 1 : 0);
        const filterBtn = toolbar.createEl("button", { text: filterCount > 0 ? `🔍 Filter (${filterCount})` : "🔍 Filter" });
        if (filterCount > 0) filterBtn.classList.add("pr-graph-filter-active");
        filterBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openFilterPopover(e.clientX, e.clientY);
        });

        const help = toolbar.createEl("span", { cls: "pr-graph-help" });
        help.setText("Drag to pan • Scroll to zoom • Click node to edit • Double-click empty for menu");

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

        // Empty-state hint overlay — sits over the canvas when there are
        // no nodes yet so the user knows the canvas is interactive.
        if (nodes.length === 0) {
            const overlay = canvas.createEl("div", { cls: "pr-graph-empty-overlay" });
            overlay.createEl("div", { cls: "pr-graph-empty-title", text: "Blank graph" });
            const hint = overlay.createEl("div", { cls: "pr-graph-empty-hint" });
            hint.setText("Right-click or double-click anywhere to add a container, reflection, alignment, LLM service, or custom boundary.");
        }

        // Apply current pan/zoom
        this.applyTransform();

        // Pan/zoom + drag handlers (Phase 10a-2)
        this.setupPanZoom();
        this.setupNodeResize();
        this.setupNodeDrag();
        // Wire drag + wire delete (Phase 10b-1)
        this.setupWireDrag();
        this.setupWireClick();
        // Right-click context menus (Phase 10b-2)
        this.setupContextMenus();
        // Double-click: empty canvas → add menu, node → toggle expand (Phase 10c-1)
        this.setupDoubleClick();
        // Multi-select keyboard shortcuts (Delete, Cmd+C, Cmd+V)
        this.setupKeyboard();
    }

    // Per-node expanded state lives in prGraphLayout[id].expanded so it
    // persists across reloads next to the node's saved position.
    isNodeExpanded(node) {
        const layout = this.plugin.settings.prGraphLayout || {};
        return !!(layout[node.id] && layout[node.id].expanded);
    }

    async setNodeExpanded(node, expanded) {
        if (!this.plugin.settings.prGraphLayout) this.plugin.settings.prGraphLayout = {};
        const cur = this.plugin.settings.prGraphLayout[node.id] || {};
        cur.expanded = !!expanded;
        if (typeof cur.x !== "number") cur.x = node.x;
        if (typeof cur.y !== "number") cur.y = node.y;
        this.plugin.settings.prGraphLayout[node.id] = cur;
        await this.plugin.saveSettings();
    }

    nodeIsPrimitive(node) {
        return node.primitive && (
            node.kind === "container" || node.kind === "reflection" ||
            node.kind === "alignment" || node.kind === "alignment-group" ||
            node.kind === "llm" ||
            node.kind === "show" || node.kind === "data-source" ||
            (node.kind === "boundary" && node.id.startsWith("boundary-custom-"))
        );
    }

    // Short, human-readable kind labels for the type badge above each node.
    nodeKindLabel(node) {
        if (node.kind === "boundary") {
            if (node.id.startsWith("boundary-custom-")) return "custom boundary";
            return "boundary";
        }
        return {
            container:         "container",
            reflection:        "reflection",
            alignment:         "alignment",
            "alignment-group": "alignment",
            llm:               "llm service",
            daily:             "source",
            show:              "show output",
            "data-source":     "data source",
        }[node.kind] || node.kind;
    }

    renderNode(parent, node) {
        const expanded = this.isNodeExpanded(node);
        const selected = this.selection.has(node.id);
        const cls = `pr-graph-node pr-graph-node-${node.kind}${expanded ? " pr-graph-node-expanded" : ""}${selected ? " pr-graph-node-selected" : ""}`;
        const el = parent.createEl("div", { cls });
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        el.dataset.nodeId = node.id;
        node.el = el;

        // Apply saved manual size for the CURRENT state (collapsed or
        // expanded). Each state has its own saved w/h, so chevron toggle
        // swaps between two distinct sizes — a normalized collapsed size
        // and a full expanded size that shows all options. When no size
        // is saved for the current state, CSS defaults drive the layout
        // (220×110 collapsed, 320×auto expanded).
        const savedLayout = this.plugin.settings.prGraphLayout?.[node.id];
        const stateKey = expanded ? "expanded" : "collapsed";
        const stateSize = savedLayout?.[stateKey];
        if (stateSize && typeof stateSize.w === "number") {
            el.style.width = `${stateSize.w}px`;
        }
        if (stateSize && typeof stateSize.h === "number") {
            el.style.height = `${stateSize.h}px`;
            el.classList.add("pr-graph-node-sized");
        }

        // Header — chevron (if primitive), kind pill, title (editable for
        // primitives). Daily / built-in boundary nodes get a static span and
        // no chevron (no body to expand).
        const header = el.createEl("div", { cls: "pr-graph-node-header" });
        const isPrimitive = this.nodeIsPrimitive(node);

        // Kind pill — visible inside the header so the user always knows at
        // a glance what kind of node they're looking at.
        header.createEl("span", {
            cls: `pr-graph-node-kind-pill pr-graph-node-kind-${node.kind}`,
            text: this.nodeKindLabel(node),
        });

        if (isPrimitive) {
            const chev = header.createEl("span", { cls: "pr-graph-node-chev", text: expanded ? "▼" : "▶" });
            chev.addEventListener("mousedown", (e) => { e.stopPropagation(); e.preventDefault(); });
            chev.addEventListener("click", async (e) => {
                e.stopPropagation();
                await this.setNodeExpanded(node, !expanded);
                this.render();
            });

            const titleInput = header.createEl("input", { type: "text", value: node.primitive.name || "" });
            titleInput.className = "pr-graph-node-title pr-graph-node-title-editable";
            titleInput.addEventListener("mousedown", (e) => e.stopPropagation());
            titleInput.addEventListener("change", async () => {
                node.primitive.name = titleInput.value;
                await this.plugin.saveSettings();
                node.title = titleInput.value;
            });
        } else {
            header.createEl("span", { cls: "pr-graph-node-title", text: node.title });
        }

        // Body. Collapsed = just the title shown in the header above, nothing
        // else. Expanded = full per-kind editor form.
        const body = el.createEl("div", { cls: "pr-graph-node-body" });
        if (expanded) {
            const expandedBody = body.createEl("div", { cls: "pr-graph-node-expanded-body" });
            this.renderNodeExpandedBody(expandedBody, node);
        }

        // Sockets — input on left, output on right.
        // Containers have multiple inputs stacked vertically; everything else
        // has a single output.
        if (node.kind === "container") {
            const inputs = el.createEl("div", { cls: "pr-graph-sockets pr-graph-sockets-in" });
            const inDefs = [
                { id: "in-data",       cls: "data-source", label: "data source" },
                { id: "in-boundary",   cls: "boundary",    label: "boundary" },
                { id: "in-llm",        cls: "llm",         label: "llm service" },
                { id: "in-reflection", cls: "reflection",  label: "reflection" },
                { id: "in-alignment",  cls: "alignment",   label: "alignment" },
            ];
            for (const def of inDefs) {
                const socket = inputs.createEl("div", { cls: `pr-graph-socket pr-graph-socket-in pr-graph-socket-${def.cls}` });
                socket.dataset.socketId = def.id;
                socket.dataset.label = def.label;
            }
            const outputs = el.createEl("div", { cls: "pr-graph-sockets pr-graph-sockets-out" });
            const outSocket = outputs.createEl("div", { cls: "pr-graph-socket pr-graph-socket-out pr-graph-socket-data-source" });
            outSocket.dataset.socketId = "out";
            outSocket.dataset.label = "feeds another container";
        } else if (node.kind === "show") {
            // Show-output probe: one universal input, no output (terminal).
            const inputs = el.createEl("div", { cls: "pr-graph-sockets pr-graph-sockets-in" });
            const socket = inputs.createEl("div", { cls: "pr-graph-socket pr-graph-socket-in pr-graph-socket-any" });
            socket.dataset.socketId = "in-any";
            socket.dataset.label = "any output";
        } else if (node.kind === "alignment-group") {
            const inputs = el.createEl("div", { cls: "pr-graph-sockets pr-graph-sockets-in" });
            const inDefs = [
                { id: "in-source", cls: "data-source", label: "guidelines source" },
                { id: "in-llm",    cls: "llm",         label: "llm service" },
            ];
            for (const def of inDefs) {
                const socket = inputs.createEl("div", { cls: `pr-graph-socket pr-graph-socket-in pr-graph-socket-${def.cls}` });
                socket.dataset.socketId = def.id;
                socket.dataset.label = def.label;
            }
            const outputs = el.createEl("div", { cls: "pr-graph-sockets pr-graph-sockets-out" });
            const outSocket = outputs.createEl("div", { cls: "pr-graph-socket pr-graph-socket-out pr-graph-socket-alignment" });
            outSocket.dataset.socketId = "out";
            outSocket.dataset.label = "→ container in-alignment";
        } else {
            const outputs = el.createEl("div", { cls: "pr-graph-sockets pr-graph-sockets-out" });
            const socketClass = node.kind === "data-source" ? "data-source" : node.kind;
            const outSocket = outputs.createEl("div", { cls: `pr-graph-socket pr-graph-socket-out pr-graph-socket-${socketClass}` });
            outSocket.dataset.socketId = "out";
            outSocket.dataset.label = {
                daily:          "feeds containers",
                "data-source":  "feeds containers",
                boundary:       "boundary out",
                llm:            "llm service out",
                reflection:     "reflection out",
                alignment:      "alignment out",
            }[node.kind] || node.kind;
        }

        // Bottom-right resize grip — drag to set manual width/height, which
        // persists in prGraphLayout. Double-click clears the override.
        const grip = el.createEl("div", { cls: "pr-graph-node-resize" });
        grip.dataset.resizeHandle = "1";
        grip.title = "Drag to resize • double-click to reset";
    }

    // ─── Inline parameter widgets (Phase 10b-3) ───
    //
    // Each node body grows a small set of widgets matching its kind. The
    // emphasis is on the controls a user reaches for most often — toggles,
    // simple text fields. Heavier config (template paths, system prompts,
    // questions, etc.) still lives in the regular settings tabs and is
    // reached via click-to-edit.
    renderNodeWidgets(body, node) {
        if (!node.primitive) return;

        const stop = (el) => el.addEventListener("mousedown", (e) => e.stopPropagation());

        const addToggle = (label, get, set) => {
            const row = body.createEl("div", { cls: "pr-graph-widget-row" });
            const labelEl = row.createEl("span", { text: label, cls: "pr-graph-widget-label" });
            const wrap = row.createEl("label", { cls: "pr-graph-widget-toggle" });
            const input = wrap.createEl("input", { type: "checkbox" });
            input.checked = !!get();
            stop(input);
            input.addEventListener("change", async () => {
                set(input.checked);
                await this.plugin.saveSettings();
                this.render();
            });
            wrap.createEl("span", { cls: "pr-graph-widget-toggle-track" });
            return row;
        };

        const addText = (label, placeholder, get, set) => {
            const row = body.createEl("div", { cls: "pr-graph-widget-row" });
            row.createEl("span", { text: label, cls: "pr-graph-widget-label" });
            const input = row.createEl("input", { type: "text", value: get() || "", cls: "pr-graph-widget-text" });
            input.placeholder = placeholder || "";
            stop(input);
            input.addEventListener("change", async () => {
                set(input.value);
                await this.plugin.saveSettings();
                this.render();
            });
            return row;
        };

        if (node.kind === "container") {
            const c = node.primitive;
            addToggle("Enabled", () => c.enabled, (v) => { c.enabled = v; });

            // Compact file picker for the core pipeline fields — template
            // and system prompt. These are critical enough that the user
            // should see and change them without expanding the node.
            const addFilePickerRow = (label, getPath, setPath) => {
                const row = body.createEl("div", { cls: "pr-graph-widget-row" });
                row.createEl("span", { text: label, cls: "pr-graph-widget-label" });
                const valueEl = row.createEl("span", { cls: "pr-graph-widget-picker-value" });
                const cur = getPath();
                valueEl.setText(cur ? cur.split("/").pop() : "(none)");
                valueEl.title = cur || "";
                const btn = row.createEl("button", { text: cur ? "Change" : "Choose", cls: "pr-graph-widget-picker-btn" });
                stop(btn);
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        setPath(file.path);
                        await this.plugin.saveSettings();
                        this.render();
                    }).open();
                });
                if (cur) {
                    const clearBtn = row.createEl("button", { text: "×", cls: "pr-graph-widget-picker-btn" });
                    stop(clearBtn);
                    clearBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        setPath("");
                        await this.plugin.saveSettings();
                        this.render();
                    });
                }
            };
            addFilePickerRow("Template", () => c.template, (v) => { c.template = v; });
            addFilePickerRow("System prompt", () => c.systemPromptFile, (v) => { c.systemPromptFile = v; });
        } else if (node.kind === "reflection") {
            const r = node.primitive;
            addToggle("Send to LLM", () => r.useLLM, (v) => { r.useLLM = v; });
            addToggle("Replace auto", () => r.replaceAutoLLM, (v) => { r.replaceAutoLLM = v; });
            addToggle("Inc. alignments", () => r.includeAlignmentContext, (v) => { r.includeAlignmentContext = v; });
        } else if (node.kind === "alignment") {
            const a = node.primitive;
            addText("Field", "health", () => a.dataField, (v) => { a.dataField = v; });
        } else if (node.kind === "show") {
            const sh = node.primitive;
            const row = body.createEl("div", { cls: "pr-graph-widget-row" });
            const btn = row.createEl("button", { text: "Dry run", cls: "pr-graph-form-button mod-cta" });
            stop(btn);
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!sh.sourceNodeId) {
                    new Notice("Connect a node's output to this show node first.");
                    return;
                }
                await this.setNodeExpanded(node, true);
                this.render();
            });
            const srcNode = sh.sourceNodeId ? this.nodes.find(n => n.id === sh.sourceNodeId) : null;
            const sub = body.createEl("div", { cls: "pr-graph-widget-row" });
            sub.createEl("span", { text: srcNode ? `← ${srcNode.title}` : "(no source)", cls: "pr-graph-widget-label" });
        }
        // LLM service and custom boundary nodes only get the editable name in
        // the header — model selection and script paths are too complex for
        // inline widgets and live in the settings tabs via click-to-edit.
    }

    // Per-kind full inline editor (Phase 10c-2). Equivalent to the
    // settings tab card, but laid out compactly for the node body.
    renderNodeExpandedBody(body, node) {
        const stop = (el) => el.addEventListener("mousedown", (e) => e.stopPropagation());
        const reRender = () => this.render();
        const save = async () => { await this.plugin.saveSettings(); };

        // ── Generic helpers (compact versions of the settings widgets) ──

        const addRow = (label) => {
            const row = body.createEl("div", { cls: "pr-graph-form-row" });
            if (label) row.createEl("div", { cls: "pr-graph-form-label", text: label });
            return row;
        };
        const addLabeledText = (label, placeholder, get, set, opts = {}) => {
            const row = addRow(label);
            const input = row.createEl("input", { type: opts.type || "text", value: get() || "", cls: "pr-graph-form-text" });
            input.placeholder = placeholder || "";
            stop(input);
            input.addEventListener("change", async () => { set(input.value); await save(); if (opts.rerender !== false) reRender(); });
            return input;
        };
        const addLabeledTextArea = (label, placeholder, get, set, rows = 3) => {
            const row = addRow(label);
            const ta = row.createEl("textarea", { cls: "pr-graph-form-textarea" });
            ta.value = get() || "";
            ta.placeholder = placeholder || "";
            ta.rows = rows;
            stop(ta);
            ta.addEventListener("change", async () => { set(ta.value); await save(); });
            return ta;
        };
        const addLabeledDropdown = (label, options, get, set, opts = {}) => {
            const row = addRow(label);
            const sel = row.createEl("select", { cls: "pr-graph-form-select" });
            for (const opt of options) {
                const o = sel.createEl("option", { text: opt.label, value: opt.value });
                if (opt.value === get()) o.selected = true;
            }
            stop(sel);
            sel.addEventListener("change", async () => { set(sel.value); await save(); if (opts.rerender !== false) reRender(); });
            return sel;
        };
        const addLabeledToggle = (label, get, set) => {
            const row = addRow(label);
            row.style.justifyContent = "space-between";
            const wrap = row.createEl("label", { cls: "pr-graph-widget-toggle" });
            const input = wrap.createEl("input", { type: "checkbox" });
            input.checked = !!get();
            stop(input);
            input.addEventListener("change", async () => { set(input.checked); await save(); reRender(); });
            wrap.createEl("span", { cls: "pr-graph-widget-toggle-track" });
            return input;
        };
        const addPicker = (label, currentValue, placeholder, openPickerFn, clearFn) => {
            const row = addRow(label);
            const value = row.createEl("div", { cls: "pr-graph-form-picker-value", text: currentValue || placeholder });
            const btnRow = row.createEl("div", { cls: "pr-graph-form-picker-buttons" });
            const chooseBtn = btnRow.createEl("button", { text: currentValue ? "Change" : "Choose" });
            stop(chooseBtn);
            chooseBtn.addEventListener("click", (e) => { e.stopPropagation(); openPickerFn(); });
            if (currentValue && clearFn) {
                const clearBtn = btnRow.createEl("button", { text: "×" });
                stop(clearBtn);
                clearBtn.addEventListener("click", async (e) => { e.stopPropagation(); await clearFn(); });
            }
            return row;
        };
        const addButton = (label, onClick, opts = {}) => {
            const row = body.createEl("div", { cls: "pr-graph-form-row" });
            const btn = row.createEl("button", { text: label, cls: opts.cta ? "pr-graph-form-button mod-cta" : "pr-graph-form-button" });
            stop(btn);
            btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
            return btn;
        };

        // ── Per-kind forms ──

        if (node.kind === "container") this.renderContainerExpanded(body, node, { addRow, addLabeledText, addLabeledTextArea, addLabeledDropdown, addLabeledToggle, addPicker, addButton, stop, save, reRender });
        else if (node.kind === "reflection") this.renderReflectionExpanded(body, node, { addRow, addLabeledText, addLabeledTextArea, addLabeledDropdown, addLabeledToggle, addPicker, addButton, stop, save, reRender });
        else if (node.kind === "alignment") this.renderAlignmentExpanded(body, node, { addRow, addLabeledText, addLabeledTextArea, addLabeledDropdown, addLabeledToggle, addPicker, addButton, stop, save, reRender });
        else if (node.kind === "alignment-group") this.renderAlignmentGroupExpanded(body, node, { addRow, addLabeledText, addLabeledTextArea, addLabeledDropdown, addLabeledToggle, addPicker, addButton, stop, save, reRender });
        else if (node.kind === "llm") this.renderLLMExpanded(body, node, { addRow, addLabeledText, addLabeledTextArea, addLabeledDropdown, addLabeledToggle, addPicker, addButton, stop, save, reRender });
        else if (node.kind === "show") this.renderShowExpanded(body, node, { addRow, addLabeledText, addLabeledTextArea, addLabeledDropdown, addLabeledToggle, addPicker, addButton, stop, save, reRender });
        else if (node.kind === "data-source") this.renderDataSourceExpanded(body, node, { addRow, addLabeledText, addLabeledTextArea, addLabeledDropdown, addLabeledToggle, addPicker, addButton, stop, save, reRender });
        else if (node.kind === "boundary" && node.id.startsWith("boundary-custom-")) this.renderCustomBoundaryExpanded(body, node, { addRow, addLabeledText, addLabeledTextArea, addLabeledDropdown, addLabeledToggle, addPicker, addButton, stop, save, reRender });
    }

    renderContainerExpanded(body, node, h) {
        const c = node.primitive;
        const s = this.plugin.settings;

        // Enabled toggle — at the top so it's the first thing the user
        // sees. Also re-renders on change so the node subtitle updates.
        h.addLabeledToggle("Enabled", () => c.enabled, (v) => { c.enabled = v; });

        // Boundary detector
        const detectors = this.plugin.getPRAvailableBoundaryDetectors();
        h.addLabeledDropdown(
            "Boundary",
            detectors.map(d => ({ value: d.id, label: d.label })),
            () => c.boundaryDetector || "calendar-week",
            (v) => { c.boundaryDetector = v; }
        );

        // Generate at
        h.addLabeledDropdown(
            "Generate at",
            [
                { value: "start", label: "Start of period" },
                { value: "end",   label: "End of period" },
            ],
            () => c.generateAt || "start",
            (v) => { c.generateAt = v; }
        );

        // Run LLM at
        h.addLabeledDropdown(
            "Run LLM at",
            [
                { value: "both",      label: "Both passes" },
                { value: "generate",  label: "Generate only" },
                { value: "writeback", label: "Write-back only" },
            ],
            () => c.runLLMAt || "both",
            (v) => { c.runLLMAt = v; }
        );

        // Write back at
        h.addLabeledDropdown(
            "Write back at",
            [
                { value: "",      label: "None (single pass)" },
                { value: "end",   label: "End of period" },
                { value: "start", label: "Start of next period" },
            ],
            () => c.writeBackAt || "",
            (v) => { c.writeBackAt = v; }
        );

        // Template picker
        h.addPicker("Template", c.template, "(none)",
            () => new MarkdownFileSuggestModal(this.app, async (file) => {
                c.template = file.path;
                await this.plugin.saveSettings();
                this.render();
            }).open(),
            async () => { c.template = ""; await this.plugin.saveSettings(); this.render(); }
        );

        // Save dir picker
        h.addPicker("Save dir", c.saveDir, "(vault root)",
            () => new FolderSuggestModal(this.app, async (folder) => {
                c.saveDir = folder.path;
                await this.plugin.saveSettings();
                this.render();
            }).open(),
            async () => { c.saveDir = ""; await this.plugin.saveSettings(); this.render(); }
        );

        // Naming convention with live preview
        const namingInput = h.addLabeledText("Naming", "W{{week}}-{{year}}",
            () => c.naming,
            (v) => { c.naming = v; },
            { rerender: false }
        );
        // Live preview line
        const preview = body.createEl("div", { cls: "pr-graph-form-preview", text: "…" });
        this.plugin.getPRBoundaryData(c.boundaryDetector || "calendar-week", new Date())
            .then(data => {
                preview.setText(c.naming
                    ? `→ ${this.plugin.resolveTokens(c.naming, data.tokens)}`
                    : "(empty)");
            })
            .catch(() => preview.setText("(unable to preview)"));
        namingInput.addEventListener("input", async () => {
            try {
                const data = await this.plugin.getPRBoundaryData(c.boundaryDetector || "calendar-week", new Date());
                preview.setText(namingInput.value
                    ? `→ ${this.plugin.resolveTokens(namingInput.value, data.tokens)}`
                    : "(empty)");
            } catch (_) {}
        });

        // Metadata placement
        h.addLabeledDropdown(
            "Metadata",
            [
                { value: "frontmatter", label: "Frontmatter" },
                { value: "inline",      label: "Inline marker" },
                { value: "none",        label: "Don't write" },
            ],
            () => c.metadataPlacement || "frontmatter",
            (v) => { c.metadataPlacement = v; }
        );
        if ((c.metadataPlacement || "frontmatter") === "inline") {
            h.addLabeledText("Inline key", "periodic-ritual",
                () => c.metadataInlineKey,
                (v) => { c.metadataInlineKey = v; },
                { rerender: false }
            );
        }

        // Data sources (multi-source) — list with add/remove
        const dsList = body.createEl("div", { cls: "pr-graph-form-row" });
        dsList.createEl("div", { cls: "pr-graph-form-label", text: "Data sources" });
        const sourceList = getContainerDataSources(c);
        for (let i = 0; i < sourceList.length; i++) {
            const source = sourceList[i];
            const row = dsList.createEl("div");
            row.style.cssText = "display: flex; gap: 4px; margin-top: 4px;";
            const sel = row.createEl("select", { cls: "pr-graph-form-select" });
            sel.createEl("option", { value: "daily", text: "Daily notes" });
            for (const other of (s.prContainers || [])) {
                if (other.id === c.id) continue;
                sel.createEl("option", { value: `container:${other.id}`, text: other.name || "(unnamed)" });
            }
            sel.value = dataSourceKey(source);
            sel.addEventListener("mousedown", (e) => e.stopPropagation());
            sel.addEventListener("change", async () => {
                const sources = getContainerDataSources(c);
                const v = sel.value;
                if (v === "daily") sources[i] = { type: "daily" };
                else if (v.startsWith("container:")) sources[i] = { type: "container", containerId: v.slice("container:".length) };
                c.dataSource = { sources };
                await this.plugin.saveSettings();
                this.render();
            });
            const remBtn = row.createEl("button", { text: "×", cls: "pr-graph-form-qdel" });
            remBtn.addEventListener("mousedown", (e) => e.stopPropagation());
            remBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const sources = getContainerDataSources(c);
                sources.splice(i, 1);
                c.dataSource = { sources };
                await this.plugin.saveSettings();
                this.render();
            });
        }
        const dsAddBtn = dsList.createEl("button", { text: "+ Add source", cls: "pr-graph-form-button" });
        dsAddBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        dsAddBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const sources = getContainerDataSources(c);
            sources.push({ type: "daily" });
            c.dataSource = { sources };
            await this.plugin.saveSettings();
            this.render();
        });

        // LLM service
        const llmOpts = [{ value: "", label: "— None —" }];
        for (const svc of (s.prLLMServices || [])) {
            llmOpts.push({ value: svc.id, label: svc.name || "(unnamed)" });
        }
        h.addLabeledDropdown("LLM service", llmOpts,
            () => c.llmServiceId || "",
            (v) => { c.llmServiceId = v; }
        );

        // System prompt picker
        h.addPicker("System prompt", c.systemPromptFile, "(none)",
            () => new MarkdownFileSuggestModal(this.app, async (file) => {
                c.systemPromptFile = file.path;
                await this.plugin.saveSettings();
                this.render();
            }).open(),
            async () => { c.systemPromptFile = ""; await this.plugin.saveSettings(); this.render(); }
        );

        // Framework picker — same pattern as system prompt: markdown file
        // selected from the vault. Its contents get injected at runtime.
        h.addPicker("Framework", c.framework, "(none)",
            () => new MarkdownFileSuggestModal(this.app, async (file) => {
                c.framework = file.path;
                await this.plugin.saveSettings();
                this.render();
            }).open(),
            async () => { c.framework = ""; await this.plugin.saveSettings(); this.render(); }
        );

        // Reflection
        const refOpts = [{ value: "", label: "— None —" }];
        for (const r of (s.prReflections || [])) {
            refOpts.push({ value: r.id, label: r.name || "(unnamed)" });
        }
        h.addLabeledDropdown("Reflection", refOpts,
            () => c.reflectionId || "",
            (v) => { c.reflectionId = v; }
        );

        // Generate now button
        h.addButton("Generate now", () => this.plugin.generatePRContainerNote(c), { cta: true });
    }

    renderReflectionExpanded(body, node, h) {
        const r = node.primitive;
        const stop = (el) => el.addEventListener("mousedown", (e) => e.stopPropagation());

        // useLLM / replaceAutoLLM toggles already render in the collapsed
        // widgets via renderNodeWidgets. Skip the duplicates here.

        h.addLabeledTextArea("Prompt prepend",
            "Optional markdown layered on top of the container's system prompt during reflection runs.",
            () => r.promptPrepend,
            (v) => { r.promptPrepend = v; },
            3
        );

        // ── Questions ──
        if (!Array.isArray(r.questions)) r.questions = [];
        if (!this.prGraphQExpanded) this.prGraphQExpanded = {};

        const qSection = body.createEl("div", { cls: "pr-graph-form-row" });
        qSection.createEl("div", { cls: "pr-graph-form-label", text: `Questions (${r.questions.length})` });
        const qList = qSection.createEl("div", { cls: "pr-graph-q-list" });

        for (let i = 0; i < r.questions.length; i++) {
            const q = r.questions[i];
            const qKey = `${r.id}-${i}`;
            const qExpanded = !!this.prGraphQExpanded[qKey];

            const qWrap = qList.createEl("div", { cls: "pr-graph-q-wrap" });

            // Question header row: chevron + text input + delete
            const qHeader = qWrap.createEl("div", { cls: "pr-graph-q-header" });
            const chev = qHeader.createEl("span", { cls: "pr-graph-q-chev", text: qExpanded ? "▼" : "▶" });
            stop(chev);
            chev.addEventListener("click", (e) => {
                e.stopPropagation();
                this.prGraphQExpanded[qKey] = !qExpanded;
                this.render();
            });

            const qInput = qHeader.createEl("input", { type: "text", value: q.text || "", cls: "pr-graph-form-text" });
            qInput.placeholder = `Question ${i + 1}`;
            stop(qInput);
            qInput.addEventListener("change", async () => { q.text = qInput.value; await this.plugin.saveSettings(); });

            const upBtn = qHeader.createEl("button", { text: "↑", cls: "pr-graph-q-arrow" });
            stop(upBtn);
            upBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (i === 0) return;
                [r.questions[i - 1], r.questions[i]] = [r.questions[i], r.questions[i - 1]];
                await this.plugin.saveSettings();
                this.render();
            });
            const downBtn = qHeader.createEl("button", { text: "↓", cls: "pr-graph-q-arrow" });
            stop(downBtn);
            downBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (i === r.questions.length - 1) return;
                [r.questions[i + 1], r.questions[i]] = [r.questions[i], r.questions[i + 1]];
                await this.plugin.saveSettings();
                this.render();
            });
            const delBtn = qHeader.createEl("button", { text: "×", cls: "pr-graph-form-qdel" });
            stop(delBtn);
            delBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                r.questions.splice(i, 1);
                delete this.prGraphQExpanded[qKey];
                await this.plugin.saveSettings();
                this.render();
            });

            // Mark wrap when inject/output enabled so the user sees at a glance
            if (q.injectVar) qWrap.classList.add("pr-graph-q-has-inject");
            if (q.outputToField) qWrap.classList.add("pr-graph-q-has-output");

            // Question detail panel — only when chevron expanded
            if (qExpanded) {
                this.renderQuestionDetail(qWrap, r, q);
            }
        }

        // + Add question
        const addBtn = qSection.createEl("button", { text: "+ Question", cls: "pr-graph-form-button" });
        stop(addBtn);
        addBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            r.questions.push(makePRQuestion(""));
            await this.plugin.saveSettings();
            this.render();
        });
    }

    // Per-question detail panel: inject + output config, same fields as the
    // settings tab card but rendered compactly for the node body.
    renderQuestionDetail(parent, reflection, q) {
        const s = this.plugin.settings;
        const stop = (el) => el.addEventListener("mousedown", (e) => e.stopPropagation());
        const reRender = () => this.render();
        const save = async () => { await this.plugin.saveSettings(); };

        const detail = parent.createEl("div", { cls: "pr-graph-q-detail" });

        const addToggleRow = (label, get, set) => {
            const row = detail.createEl("label", { cls: "pr-graph-q-row" });
            const input = row.createEl("input", { type: "checkbox" });
            input.checked = !!get();
            stop(input);
            input.addEventListener("change", async () => { set(input.checked); await save(); reRender(); });
            row.createEl("span", { text: label });
        };

        const addLabeledText = (label, placeholder, get, set) => {
            const row = detail.createEl("div", { cls: "pr-graph-q-field" });
            row.createEl("div", { cls: "pr-graph-q-flabel", text: label });
            const input = row.createEl("input", { type: "text", value: get() || "", cls: "pr-graph-form-text" });
            input.placeholder = placeholder || "";
            stop(input);
            input.addEventListener("change", async () => { set(input.value); await save(); });
        };

        const addLabeledDropdown = (label, options, get, set) => {
            const row = detail.createEl("div", { cls: "pr-graph-q-field" });
            row.createEl("div", { cls: "pr-graph-q-flabel", text: label });
            const sel = row.createEl("select", { cls: "pr-graph-form-select" });
            for (const opt of options) {
                const o = sel.createEl("option", { text: opt.label, value: opt.value });
                if (opt.value === get()) o.selected = true;
            }
            stop(sel);
            sel.addEventListener("change", async () => { set(sel.value); await save(); reRender(); });
        };

        // ── Inject panel ──
        const injectHeader = detail.createEl("div", { cls: "pr-graph-q-section-label", text: "← Inject context" });
        addToggleRow("Enable inject", () => q.injectVar, (v) => { q.injectVar = v; });

        if (q.injectVar) {
            const allContainers = s.prContainers || [];
            addLabeledDropdown("Source",
                [
                    { value: "current",            label: "Current note (last boundary crossed)" },
                    { value: "previous-period",    label: "Previous period (this container)" },
                    { value: "note",               label: "Specific note" },
                    { value: "container-current",  label: "Current note of another container" },
                    { value: "container-previous", label: "Previous note of another container" },
                ],
                () => q.varSource || "previous-period",
                (v) => { q.varSource = v; }
            );

            const src = q.varSource || "previous-period";
            if (src === "note") {
                const row = detail.createEl("div", { cls: "pr-graph-q-field" });
                row.createEl("div", { cls: "pr-graph-q-flabel", text: "Source note" });
                const value = row.createEl("div", { cls: "pr-graph-form-picker-value", text: q.varNotePath || "(none)" });
                const btn = row.createEl("button", { text: q.varNotePath ? "Change" : "Choose", cls: "pr-graph-form-button" });
                stop(btn);
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        q.varNotePath = file.path;
                        await save();
                        reRender();
                    }).open();
                });
            } else if (src === "container-current" || src === "container-previous") {
                addLabeledDropdown("Source container",
                    [{ value: "", label: "— Pick one —" }, ...allContainers.map(c => ({ value: c.id, label: c.name || "(unnamed)" }))],
                    () => q.varSourceContainerId || "",
                    (v) => { q.varSourceContainerId = v; }
                );
            }

            addLabeledText("Field name", "today", () => q.varField, (v) => { q.varField = v; });
            addLabeledDropdown("Field type",
                [
                    { value: "inline",      label: "Inline (key:: value)" },
                    { value: "frontmatter", label: "Frontmatter (key: value)" },
                ],
                () => q.varFieldType || "inline",
                (v) => { q.varFieldType = v; }
            );
        }

        // ── Output panel ──
        const outputHeader = detail.createEl("div", { cls: "pr-graph-q-section-label", text: "→ Output answer" });
        addToggleRow("Write answer to a field", () => q.outputToField, (v) => { q.outputToField = v; });

        if (q.outputToField) {
            const allContainersOut = s.prContainers || [];
            addLabeledDropdown("Target",
                [
                    { value: "current",            label: "Current note (active container)" },
                    { value: "previous-period",    label: "Previous period (this container)" },
                    { value: "note",               label: "Specific note" },
                    { value: "container-current",  label: "Current note of another container" },
                    { value: "container-previous", label: "Previous note of another container" },
                ],
                () => q.outputTarget || "current",
                (v) => { q.outputTarget = v; }
            );

            const tgt = q.outputTarget || "current";
            if (tgt === "note") {
                const row = detail.createEl("div", { cls: "pr-graph-q-field" });
                row.createEl("div", { cls: "pr-graph-q-flabel", text: "Target note" });
                row.createEl("div", { cls: "pr-graph-form-picker-value", text: q.outputNotePath || "(none)" });
                const btn = row.createEl("button", { text: q.outputNotePath ? "Change" : "Choose", cls: "pr-graph-form-button" });
                stop(btn);
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        q.outputNotePath = file.path;
                        await save();
                        reRender();
                    }).open();
                });
            } else if (tgt === "container-current" || tgt === "container-previous") {
                addLabeledDropdown("Target container",
                    [{ value: "", label: "— Pick one —" }, ...allContainersOut.map(c => ({ value: c.id, label: c.name || "(unnamed)" }))],
                    () => q.outputTargetContainerId || "",
                    (v) => { q.outputTargetContainerId = v; }
                );
            }

            addLabeledText("Field name", "non_negotiable", () => q.outputFieldName, (v) => { q.outputFieldName = v; });
            addLabeledDropdown("Field type",
                [
                    { value: "inline",      label: "Inline (key:: value)" },
                    { value: "frontmatter", label: "Frontmatter (key: value)" },
                ],
                () => q.outputFieldType || "inline",
                (v) => { q.outputFieldType = v; }
            );
        }
    }

    renderAlignmentExpanded(body, node, h) {
        const a = node.primitive;
        const s = this.plugin.settings;

        // Container picker
        const cOpts = [{ value: "", label: "— None —" }];
        for (const c of (s.prContainers || [])) {
            cOpts.push({ value: c.id, label: c.name || "(unnamed)" });
        }
        h.addLabeledDropdown("Container", cOpts,
            () => a.containerId || "",
            (v) => { a.containerId = v; }
        );

        // Field type
        h.addLabeledDropdown("Field type",
            [
                { value: "inline",      label: "Inline (key:: value)" },
                { value: "frontmatter", label: "Frontmatter (key: value)" },
            ],
            () => a.dataFieldType || "inline",
            (v) => { a.dataFieldType = v; }
        );

        // Description
        h.addLabeledTextArea("Description",
            "What you're measuring and how the LLM should think about it.",
            () => a.description,
            (v) => { a.description = v; },
            3
        );

        // Output field
        h.addLabeledText("Output key", "alignment_<name>",
            () => a.outputField,
            (v) => { a.outputField = v; },
            { rerender: false }
        );
    }

    renderLLMExpanded(body, node, h) {
        const svc = node.primitive;

        // Provider dropdown
        const providerOpts = Object.entries(PROVIDERS).map(([key, p]) => ({ value: key, label: p.name }));
        h.addLabeledDropdown("Provider", providerOpts,
            () => svc.provider || "gemini",
            (v) => {
                svc.provider = v;
                svc.model = "";
                const newProv = PROVIDERS[v];
                if (newProv?.needsBaseUrl && !svc.baseUrl) svc.baseUrl = newProv.defaultBaseUrl || "";
            }
        );

        const provDef = PROVIDERS[svc.provider];
        if (provDef?.needsBaseUrl) {
            h.addLabeledText("Base URL", provDef.defaultBaseUrl || "",
                () => svc.baseUrl,
                (v) => { svc.baseUrl = v; },
                { rerender: false }
            );
        }

        // API key
        h.addLabeledText("API key", "sk-... / AIza... / sk-or-...",
            () => svc.apiKey,
            (v) => { svc.apiKey = v; },
            { type: "password", rerender: false }
        );

        // Model + fetch
        const modelLabel = svc.provider === "openclaw" ? "Agent" : "Model";
        const modelInput = h.addLabeledText(modelLabel, "model name",
            () => svc.model,
            (v) => { svc.model = v; },
            { rerender: false }
        );
        h.addButton("Fetch models", async () => {
            const provider = PROVIDERS[svc.provider];
            if (!provider) { new Notice(`Unknown provider: ${svc.provider}`); return; }
            if (!provider.needsBaseUrl && !svc.apiKey) { new Notice("Set the API key first"); return; }
            try {
                new Notice(`Fetching from ${provider.name}…`);
                const models = await provider.listModels(svc);
                if (!models || models.length === 0) { new Notice("No models returned"); return; }
                new PRModelPickerModal(this.app, models, async (chosen) => {
                    svc.model = chosen;
                    await this.plugin.saveSettings();
                    this.render();
                }).open();
            } catch (e) {
                new Notice(`Fetch failed: ${e.message}`);
            }
        });
    }

    renderCustomBoundaryExpanded(body, node, h) {
        const cb = node.primitive;

        // Script path picker
        h.addPicker("Script", cb.scriptPath, "(none)",
            () => new PRJSFileSuggestModal(this.app, async (file) => {
                cb.scriptPath = file.path;
                await this.plugin.saveSettings();
                this.render();
            }).open(),
            async () => { cb.scriptPath = ""; await this.plugin.saveSettings(); this.render(); }
        );

        // Description
        h.addLabeledTextArea("Description",
            "Markdown text prepended to the LLM system prompt.",
            () => cb.description,
            (v) => { cb.description = v; },
            3
        );

        // Test button
        h.addButton("Test against today", async () => {
            if (!cb.scriptPath) { new Notice("No script path set"); return; }
            try {
                const result = await this.plugin.runPRCustomBoundary(cb.id, new Date());
                const summary = `start: ${formatDate(result.start)}, end: ${formatDate(result.end)}`;
                new Notice(`OK: ${summary}`, 8000);
            } catch (e) {
                new Notice(`Error: ${e.message}`, 10000);
            }
        });
    }

    // Alignment Group — prefix, system prompt, include-aggregated toggle,
    // plus interactive pickers for target container / guidelines source /
    // LLM service. All three can also be set by wiring in the graph; the
    // pickers and the wires write to the same fields, so either path works.
    renderAlignmentGroupExpanded(body, node, h) {
        const g = node.primitive;
        const s = this.plugin.settings;

        h.addLabeledText("Name", "Life alignments",
            () => g.name, (v) => { g.name = v; }
        );
        h.addLabeledText("Prefix", "alignment",
            () => g.prefix, (v) => { g.prefix = v; }
        );

        h.addLabeledDropdown("Run at",
            [
                { value: "both",      label: "Both passes" },
                { value: "generate",  label: "Generate only" },
                { value: "writeback", label: "Write-back only" },
            ],
            () => g.runAt || "both",
            (v) => { g.runAt = v; }
        );

        h.addLabeledDropdown("Write to",
            [
                { value: "frontmatter", label: "Frontmatter" },
                { value: "inline",      label: "Inline (key:: value)" },
                { value: "body",        label: "Body marker ({{pr:key}})" },
            ],
            () => g.writeTo || "frontmatter",
            (v) => { g.writeTo = v; }
        );

        // Target container picker — same field a wire to in-alignment sets.
        const targetOpts = [{ value: "", label: "— None —" }];
        for (const c of (s.prContainers || [])) {
            targetOpts.push({ value: c.id, label: c.name || "(unnamed)" });
        }
        h.addLabeledDropdown("Target container", targetOpts,
            () => g.containerId || "",
            (v) => { g.containerId = v; }
        );

        // Guidelines source picker — lists both data sources and containers
        // with a type prefix in the value so we can round-trip through the
        // same dropdown. Same fields a wire into in-source sets.
        const sourceOpts = [{ value: "", label: "— None —" }];
        for (const ds of (s.prDataSources || [])) {
            sourceOpts.push({
                value: `data-source:${ds.id}`,
                label: `${ds.name || "(unnamed)"} · data source (${ds.mode || "static"})`,
            });
        }
        for (const c of (s.prContainers || [])) {
            sourceOpts.push({
                value: `container:${c.id}`,
                label: `${c.name || "(unnamed)"} · container`,
            });
        }
        const currentSourceKey = g.sourceKind && g.sourceId ? `${g.sourceKind}:${g.sourceId}` : "";
        h.addLabeledDropdown("Guidelines source", sourceOpts,
            () => currentSourceKey,
            (v) => {
                if (!v) { g.sourceKind = ""; g.sourceId = ""; }
                else {
                    const idx = v.indexOf(":");
                    g.sourceKind = v.slice(0, idx);
                    g.sourceId = v.slice(idx + 1);
                }
            }
        );

        // LLM service picker — same field a wire into in-llm sets.
        const llmOpts = [{ value: "", label: "— None —" }];
        for (const svc of (s.prLLMServices || [])) {
            llmOpts.push({ value: svc.id, label: svc.name || "(unnamed)" });
        }
        h.addLabeledDropdown("LLM service", llmOpts,
            () => g.llmServiceId || "",
            (v) => { g.llmServiceId = v; }
        );

        // System prompt picker
        h.addPicker("System prompt", g.systemPromptFile, "(none)",
            () => new MarkdownFileSuggestModal(this.app, async (file) => {
                g.systemPromptFile = file.path;
                await this.plugin.saveSettings();
                this.render();
            }).open(),
            async () => { g.systemPromptFile = ""; await this.plugin.saveSettings(); this.render(); }
        );

        // Framework picker (markdown file)
        h.addPicker("Framework", g.framework, "(none)",
            () => new MarkdownFileSuggestModal(this.app, async (file) => {
                g.framework = file.path;
                await this.plugin.saveSettings();
                this.render();
            }).open(),
            async () => { g.framework = ""; await this.plugin.saveSettings(); this.render(); }
        );

        h.addLabeledToggle("Include container frontmatter",
            () => g.includeAggregatedSummary !== false,
            (v) => { g.includeAggregatedSummary = v; }
        );

        // Output shape defaults
        h.addLabeledDropdown("Default mode",
            [
                { value: "separate", label: "separate (LLM narrative)" },
                { value: "rewrite",  label: "rewrite (LLM concise)" },
                { value: "prepend",  label: "prepend (splice, no LLM)" },
                { value: "combined", label: "combined (one unified narrative)" },
            ],
            () => g.defaultMode || "separate",
            (v) => { g.defaultMode = v; }
        );
        const dm = g.defaultMode || "separate";
        if (dm === "combined") {
            const combinedDefault = `${(g.prefix || "alignment").trim()}_combined`;
            h.addLabeledText("Combined key", combinedDefault,
                () => g.combinedOutputKey || "",
                (v) => { g.combinedOutputKey = v; }
            );
            h.addLabeledText("Max sentences", "10",
                () => String(g.combinedMaxSentences || 10),
                (v) => { g.combinedMaxSentences = parseInt(v, 10) || 10; }
            );
        }
        if (dm !== "combined") {
            h.addLabeledText("Default target", "{prefix}_{name}",
                () => g.defaultTarget || "{prefix}_{name}",
                (v) => { g.defaultTarget = v; }
            );
        }
        if (dm === "prepend") {
            h.addLabeledText("Default template", "**{guideline}** — {entries}",
                () => g.defaultTemplate || "",
                (v) => { g.defaultTemplate = v; }
            );
        }

        // Info icon — hover or click to see override documentation
        const infoRow = body.createEl("div");
        infoRow.style.cssText = "display: flex; align-items: center; gap: 6px; margin-top: 8px;";
        const infoIcon = infoRow.createEl("span");
        infoIcon.style.cssText = "display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--text-muted); color: var(--text-muted); font-size: 0.7em; font-weight: 600; font-family: serif; cursor: help; flex-shrink: 0;";
        infoIcon.setText("i");
        infoIcon.title = "Per-alignment overrides\n\nPrecedence (highest → lowest):\n1. Source-note meta keys:\n   alignment_health_mode: rewrite\n   alignment_health_target: health\n   alignment_health_template: **{guideline}** — {entries}\n\n2. Per-alignment overrides in Settings → Alignment → Discovered alignments table\n\n3. Group defaults (Default mode / Default target / Default template above)\n\nTokens for prepend templates:\n  {guideline} — source note value\n  {entries} — subdivision field values joined with comma\n  {existing} — current target key value on container\n  {name} — alignment short name";
    }

    // Data source primitive — mode (static/dynamic) + note or folder picker.
    renderDataSourceExpanded(body, node, h) {
        const ds = node.primitive;

        h.addLabeledText("Name", "Life charter",
            () => ds.name,
            (v) => { ds.name = v; }
        );

        h.addLabeledDropdown(
            "Mode",
            [
                { value: "static",  label: "Static (single note)" },
                { value: "dynamic", label: "Dynamic (folder of notes)" },
            ],
            () => ds.mode || "static",
            (v) => { ds.mode = v; }
        );

        if ((ds.mode || "static") === "static") {
            h.addPicker("Note", ds.notePath, "(none)",
                () => new MarkdownFileSuggestModal(this.app, async (file) => {
                    ds.notePath = file.path;
                    if (!ds.name || ds.name === "New data source") ds.name = file.basename;
                    await this.plugin.saveSettings();
                    this.render();
                }).open(),
                async () => { ds.notePath = ""; await this.plugin.saveSettings(); this.render(); }
            );
        } else {
            h.addPicker("Folder", ds.folderPath, "(none)",
                () => new FolderSuggestModal(this.app, async (folder) => {
                    ds.folderPath = folder.path;
                    if (!ds.name || ds.name === "New data source") ds.name = folder.name || folder.path;
                    await this.plugin.saveSettings();
                    this.render();
                }).open(),
                async () => { ds.folderPath = ""; await this.plugin.saveSettings(); this.render(); }
            );
            const hint = body.createEl("div", { cls: "pr-graph-form-preview" });
            hint.setText("Container consumers filter this folder by their period (pr-start/end or mtime). Alignment groups read the single latest note.");
        }
    }

    // Show-output probe node — dry run panel.
    //
    // The dry run walks the upstream node in `sh.sourceNodeId` and renders a
    // compact snapshot of what would flow through the wire at runtime. This
    // is inspection-only — no files are written, no LLM calls are made.
    renderShowExpanded(body, node, h) {
        const sh = node.primitive;

        // Rename
        h.addLabeledText("Name", "Show output",
            () => sh.name,
            (v) => { sh.name = v; }
        );

        // Current source
        const srcNode = sh.sourceNodeId ? this.nodes.find(n => n.id === sh.sourceNodeId) : null;
        const srcRow = h.addRow("Source");
        const srcLabel = srcRow.createEl("div", { cls: "pr-graph-form-picker-value" });
        srcLabel.setText(srcNode ? `${srcNode.title} (${srcNode.kind})` : "(drag any output here)");

        // Result panel — grows with content so the show node expands to fit
        // whatever the dry run produces. No max-height so the node itself
        // resizes rather than scrolling inside a fixed window.
        const resultWrap = body.createEl("div", { cls: "pr-graph-form-row" });
        resultWrap.createEl("div", { cls: "pr-graph-form-label", text: "Dry run result" });
        const resultEl = resultWrap.createEl("div", { cls: "pr-graph-show-result" });
        resultEl.style.cssText = "background: var(--background-secondary); border-radius: 6px; padding: 8px 12px; font-family: var(--font-monospace); font-size: 0.78em; user-select: text; -webkit-user-select: text; cursor: text;";
        // Block mousedown bubbling so the user can select text in the result
        // without starting a node drag. Also block wheel so the canvas
        // pan/zoom doesn't steal scroll events from the scrollable children
        // (long source payloads, system prompts, etc.) inside the result.
        resultEl.addEventListener("mousedown", (e) => e.stopPropagation());
        resultEl.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
        const placeholder = () => {
            resultEl.empty();
            resultEl.createEl("div", { text: srcNode ? "Click Dry run to probe." : "Connect a source first." }).style.color = "var(--text-faint)";
        };
        placeholder();

        // Dry run button
        h.addButton("Dry run", async () => {
            if (!sh.sourceNodeId) { new Notice("No source connected"); return; }
            const live = this.nodes.find(n => n.id === sh.sourceNodeId);
            if (!live) { new Notice("Source node no longer exists"); return; }
            resultEl.empty();

            // Indeterminate progress bar while the probe runs. Shown during
            // source-payload builds, file reads, and any LLM pings that may
            // take a moment.
            const loading = resultEl.createEl("div", { cls: "pr-graph-show-loading" });
            loading.createEl("div", { cls: "pr-graph-progress-bar" });

            try {
                await this.runDryRunInto(resultEl, live);
            } catch (e) {
                resultEl.empty();
                const err = resultEl.createEl("div", { text: `Error: ${e.message}` });
                err.style.color = "var(--text-error, #e26a6a)";
            }
            // Auto-grow the show node to fit the fresh result. If the user
            // had previously resize-locked the expanded height too small,
            // drop that lock so the node expands around the new content.
            // Width is preserved.
            const layout = this.plugin.settings.prGraphLayout?.[node.id];
            if (layout && layout.expanded && typeof layout.expanded.h === "number") {
                delete layout.expanded.h;
                await this.plugin.saveSettings();
            }
            if (node.el) {
                node.el.style.height = "";
                node.el.classList.remove("pr-graph-node-sized");
            }
            // Wires need to re-draw because the node just grew.
            this.renderWires();
        }, { cta: true });

        if (srcNode) {
            h.addButton("Disconnect source", async () => {
                sh.sourceNodeId = "";
                await this.plugin.saveSettings();
                this.render();
            });
        }
    }

    // Probe an upstream node and render a compact "what would flow through
    // this wire" snapshot into `el`. Purely read-only — mirrors what the
    // runtime pipeline would see, but renders it inline in the show node.
    //
    // Output is split into two labeled bands per source kind: "▼ INPUT"
    // (what the node receives / reads) and "▲ OUTPUT" (what it produces /
    // writes), so the user can see both sides of the node at once.
    async runDryRunInto(el, sourceNode) {
        el.empty();

        // Persistent progress bar at the top of the result panel. Stays
        // visible through the entire async run (payload builds, LLM calls,
        // structured rendering) and is removed in the finally block below
        // so the user has continuous feedback while anything is in flight.
        const progressWrap = el.createEl("div", { cls: "pr-graph-show-loading" });
        progressWrap.style.cssText = "margin-bottom: 8px;";
        progressWrap.createEl("div", { cls: "pr-graph-progress-bar" });

        try {
            return await this._runDryRunIntoInner(el, sourceNode);
        } finally {
            progressWrap.remove();
        }
    }

    async _runDryRunIntoInner(el, sourceNode) {
        const section = (label) => {
            const h = el.createEl("div", { text: label });
            h.style.cssText = "color: var(--text-muted); font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; margin: 8px 0 2px 0;";
            return h;
        };
        const band = (label) => {
            const b = el.createEl("div", { text: label });
            b.style.cssText = "color: var(--interactive-accent); font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; margin: 10px 0 4px 0; padding-top: 6px; border-top: 1px solid var(--background-modifier-border);";
            return b;
        };
        const kv = (obj, filter) => {
            const block = el.createEl("div");
            block.style.cssText = "padding: 2px 0;";
            let any = false;
            for (const [k, v] of Object.entries(obj || {})) {
                if (filter && !filter(k, v)) continue;
                any = true;
                const row = block.createEl("div");
                const keyEl = row.createEl("span", { text: `${k}: ` });
                keyEl.style.color = "var(--interactive-accent)";
                const valStr = (v === null || v === undefined) ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v));
                row.createEl("span", { text: valStr });
            }
            if (!any) {
                const empty = block.createEl("div", { text: "(empty)" });
                empty.style.color = "var(--text-faint)";
            }
        };
        const line = (text, muted = false) => {
            const d = el.createEl("div", { text });
            if (muted) d.style.color = "var(--text-muted)";
            return d;
        };

        const plugin = this.plugin;
        const app = this.app;

        // ─ Header: which wire type this would travel on ─
        const wireType = this.nodeOutputType(sourceNode.kind) || "(unknown)";
        const hdr = el.createEl("div");
        hdr.style.cssText = "font-size: 0.8em; color: var(--text-muted); margin-bottom: 6px;";
        hdr.setText(`← ${sourceNode.title} • wire: ${wireType}`);

        if (sourceNode.kind === "daily") {
            band("▼ INPUT");
            section("Daily folder");
            line(plugin.settings.dailyNotesFolder || "(vault root)");
            section("Scan window");
            const today = new Date();
            const twoWeeksAgo = new Date(today);
            twoWeeksAgo.setDate(today.getDate() - 14);
            line(`${formatDate(twoWeeksAgo)} → ${formatDate(today)} (last 14 days)`);

            band("▲ OUTPUT");
            const notes = plugin.findDailyNotesInRange(twoWeeksAgo, today) || [];
            section(`Matched files (${notes.length})`);
            if (notes.length === 0) { line("(none found)", true); return; }
            for (const n of notes.slice(0, 20)) {
                line(`• ${n.path || n.basename || String(n)}`);
            }
            if (notes.length > 20) line(`…and ${notes.length - 20} more`, true);

            section("Fields extracted");
            const pre = el.createEl("pre");
            pre.style.cssText = "white-space: pre-wrap; margin: 2px 0; padding: 6px 8px; background: var(--background-primary); border-radius: 4px; max-height: 200px; overflow: auto;";
            const lines = [];
            for (const f of notes.slice(0, 6)) {
                lines.push(`## ${f.basename}`);
                const fm = app.metadataCache.getFileCache(f)?.frontmatter || {};
                for (const [k, v] of Object.entries(fm)) {
                    if (k === "position" || k === "periodic-ritual") continue;
                    if (v === null || v === undefined || typeof v === "object") continue;
                    lines.push(`${k}: ${v}`);
                }
                lines.push("");
            }
            pre.setText(lines.join("\n") || "(no extractable fields)");
            return;
        }

        if (sourceNode.kind === "boundary") {
            const id = sourceNode.refKey || sourceNode.id.replace(/^boundary-/, "").replace(/^custom-/, "custom:");
            band("▼ INPUT");
            section("Detector");
            line(id);
            section("Reference date");
            line(formatDate(new Date()));

            band("▲ OUTPUT");
            try {
                const data = await plugin.getPRBoundaryData(id, new Date());
                section("Period");
                line(`${formatDate(data.start)} → ${formatDate(data.end)}`);
                section("Tokens");
                kv(data.tokens);
            } catch (e) {
                const err = el.createEl("div", { text: `Could not resolve: ${e.message}` });
                err.style.color = "var(--text-error, #e26a6a)";
            }
            return;
        }

        if (sourceNode.kind === "llm") {
            const svc = sourceNode.primitive;
            band("▼ INPUT");
            section("Service name");
            line(svc.name || "(unnamed)");
            band("▲ OUTPUT");
            section("Resolved config (sent with every call)");
            kv({
                provider: svc.provider,
                model: svc.model || "(none)",
                baseUrl: svc.baseUrl || "(default)",
                "API key": svc.apiKey ? `set (${svc.apiKey.length} chars)` : "(not set)",
            });
            const containersUsing = (plugin.settings.prContainers || []).filter(c => c.llmServiceId === svc.id);
            section(`Used by ${containersUsing.length} container(s)`);
            if (containersUsing.length === 0) line("(none)", true);
            for (const c of containersUsing) line(`• ${c.name || "(unnamed)"}`);
            return;
        }

        if (sourceNode.kind === "reflection") {
            const r = sourceNode.primitive;

            band("▼ INPUT");
            section("Mode");
            const flags = [];
            if (r.useLLM) flags.push("Send answers to LLM");
            if (r.replaceAutoLLM) flags.push("Replace auto-LLM");
            if (r.includeAlignmentContext) flags.push("Include alignment outputs");
            line(flags.length > 0 ? flags.join(" • ") : "Pure Q&A (no LLM)");
            if (r.promptPrepend) {
                section("Prompt prepend (layered over container system prompt)");
                const pre = el.createEl("pre");
                pre.style.cssText = "white-space: pre-wrap; margin: 2px 0; padding: 4px 6px; background: var(--background-primary); border-radius: 4px;";
                pre.setText(r.promptPrepend);
            }
            section(`Questions asked (${(r.questions || []).length})`);
            for (const q of (r.questions || [])) {
                const row = el.createEl("div");
                row.setText(`• ${q.text || "(empty)"}`);
            }

            band("▲ OUTPUT");
            // Questions that write to frontmatter
            const outs = (r.questions || []).filter(q => q.outputToField && q.outputFieldName);
            section("Frontmatter writes");
            if (outs.length === 0) line("(none)", true);
            for (const q of outs) line(`• ${q.outputFieldName}  ← answer to: ${q.text || "(empty)"}`);
            // Variables injected back into the LLM prompt
            const injects = (r.questions || []).filter(q => q.injectVar && q.varField);
            section("LLM variable injections");
            if (injects.length === 0) line("(none)", true);
            for (const q of injects) line(`• {{${q.varField}}}  ← answer to: ${q.text || "(empty)"}`);
            // Containers referencing this reflection — tells the user where
            // the output actually lands.
            const usedBy = (plugin.settings.prContainers || []).filter(c => c.reflectionId === r.id);
            section(`Attached to ${usedBy.length} container(s)`);
            if (usedBy.length === 0) line("(none)", true);
            for (const c of usedBy) line(`• ${c.name || "(unnamed)"}`);
            return;
        }

        if (sourceNode.kind === "alignment") {
            const a = sourceNode.primitive;
            const target = (plugin.settings.prContainers || []).find(c => c.id === a.containerId);
            const outKey = (a.outputField || "").trim() || `alignment_${(a.name || "unnamed").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

            band("▼ INPUT");
            section("Attached container");
            line(target ? target.name : "(unattached)", !target);
            section("Reads field");
            line(`${a.dataField || "(none)"} (${a.dataFieldType || "inline"})`);
            if (target) {
                section("Live value (from most recent note)");
                const file = await plugin.findMostRecentPRContainerNote(target);
                if (!file) {
                    line("(no generated note yet)", true);
                } else {
                    const fm = app.metadataCache.getFileCache(file)?.frontmatter || {};
                    const v = fm[a.dataField];
                    if (v === undefined) line("(field not present)", true);
                    else line(String(v));
                }
            }
            if (a.description) {
                section("System prompt");
                const pre = el.createEl("pre");
                pre.style.cssText = "white-space: pre-wrap; margin: 2px 0; padding: 4px 6px; background: var(--background-primary); border-radius: 4px;";
                pre.setText(a.description);
            }

            band("▲ OUTPUT");
            section("Writes to");
            line(`${outKey} on ${target?.name || "(unattached)"}`);
            if (target) {
                section("Last written value");
                const file = await plugin.findMostRecentPRContainerNote(target);
                if (!file) {
                    line("(no generated note yet)", true);
                } else {
                    const fm = app.metadataCache.getFileCache(file)?.frontmatter || {};
                    const v = fm[outKey];
                    if (v === undefined) line("(not yet written)", true);
                    else line(String(v));
                }
            }
            return;
        }

        if (sourceNode.kind === "alignment-group") {
            const g = sourceNode.primitive;
            const s = plugin.settings;

            band("▼ INPUT");
            section("Prefix");
            line(g.prefix || "alignment");

            section("Guidelines source");
            let sourceFile = null;
            if (g.sourceKind === "data-source" && g.sourceId) {
                const ds = (s.prDataSources || []).find(x => x.id === g.sourceId);
                if (ds) {
                    line(`${ds.name} (${ds.mode})`);
                    sourceFile = plugin.resolveDataSourceLatest(ds);
                } else line("(missing data source)", true);
            } else if (g.sourceKind === "container" && g.sourceId) {
                const sc = (s.prContainers || []).find(x => x.id === g.sourceId);
                if (sc) {
                    line(`${sc.name} (container)`);
                    sourceFile = await plugin.findMostRecentPRContainerNote(sc);
                } else line("(missing container)", true);
            } else {
                line("(not wired)", true);
            }

            let guidelines = {};
            let resolvedRows = [];
            if (sourceFile) {
                section("Latest source note");
                line(sourceFile.path);
                // Use the shared resolver so the preview matches runtime
                const src = await plugin.resolvePRAlignmentGroupSource(g);
                if (src) {
                    guidelines = src.guidelines || {};
                    for (const k of Object.keys(guidelines)) {
                        const cfg = plugin.resolvePRAlignmentConfig(g, k, src.sourceFm, src.sourceInline);
                        resolvedRows.push({ ...cfg, guideline: guidelines[k] });
                    }
                }
                section(`Auto-discovered guidelines (${Object.keys(guidelines).length})`);
                if (Object.keys(guidelines).length === 0) line(`(no ${g.prefix || "alignment"}_* fields)`, true);
                else {
                    for (const r of resolvedRows) {
                        const row = el.createEl("div");
                        row.style.cssText = "padding: 4px 0; border-bottom: 1px dashed var(--background-modifier-border);";
                        const hdr = row.createEl("div");
                        const keyEl = hdr.createEl("span", { text: r.alignmentKey });
                        keyEl.style.cssText = "color: var(--interactive-accent); font-weight: 600;";
                        const modeBadge = hdr.createEl("span", { text: r.mode });
                        modeBadge.style.cssText = "margin-left: 8px; padding: 1px 6px; border-radius: 3px; font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em; background: var(--text-muted); color: var(--background-primary);";
                        const targetBadge = hdr.createEl("span", { text: `→ ${r.target}` });
                        targetBadge.style.cssText = "margin-left: 6px; font-size: 0.75em; color: var(--text-faint); font-family: var(--font-monospace);";
                        const guide = row.createEl("div", { text: r.guideline });
                        guide.style.cssText = "margin-top: 2px; font-size: 0.85em; color: var(--text-normal);";
                    }
                }
            }

            section("Target container");
            const target = (s.prContainers || []).find(c => c.id === g.containerId);
            line(target ? target.name : "(not wired)", !target);

            section("LLM service");
            const svc = (s.prLLMServices || []).find(x => x.id === g.llmServiceId);
            line(svc ? `${svc.name} — ${svc.provider}${svc.model ? " / " + svc.model : ""}` : "(not wired)", !svc);

            section("System prompt");
            if (g.systemPromptFile) {
                line(g.systemPromptFile, true);
                try {
                    const sp = await plugin.loadTemplate(g.systemPromptFile);
                    const pre = el.createEl("pre");
                    pre.style.cssText = "white-space: pre-wrap; margin: 4px 0; padding: 6px 8px; background: var(--background-primary); border-radius: 4px; max-height: 180px; overflow: auto;";
                    pre.setText(sp);
                } catch (_) {}
            } else line("(none)", true);

            band("▲ OUTPUT");
            if (target && sourceFile && Object.keys(guidelines).length > 0) {
                section("Dry run — what would be written");
                const spliceCount = resolvedRows.filter(r => r.mode === "prepend").length;
                const llmCount    = resolvedRows.filter(r => r.mode === "separate" || r.mode === "rewrite").length;
                line(`${spliceCount} splice write(s), ${llmCount} LLM write(s)${llmCount > 0 && !svc ? " — LLM service NOT wired, LLM alignments will be skipped" : ""}`, true);
                try {
                    const targetFile = await plugin.findMostRecentPRContainerNote(target);
                    const targetData = await plugin.getPRBoundaryData(target.boundaryDetector, new Date());
                    const result = await plugin.runPRAlignmentGroupPass(g, target, targetFile || null, { start: targetData.start, end: targetData.end }, { dryRun: true, silent: true });
                    if (!result) {
                        line("(dry run returned nothing — check console)", true);
                    } else {
                        const writes = result.writes || {};
                        const existing = targetFile ? (app.metadataCache.getFileCache(targetFile)?.frontmatter || {}) : {};
                        const keys = Object.keys(writes);
                        if (keys.length === 0) {
                            line("(nothing would be written)", true);
                        } else {
                            line(`${keys.length} key(s) would be written:`, true);
                            const block = el.createEl("div");
                            block.style.cssText = "background: var(--background-primary); border-radius: 4px; padding: 6px 8px; margin-top: 4px;";
                            for (const k of keys) {
                                const row = block.createEl("div");
                                row.style.cssText = "padding: 4px 0; border-bottom: 1px dashed var(--background-modifier-border);";
                                const hdr = row.createEl("div");
                                const keyEl = hdr.createEl("span", { text: k });
                                keyEl.style.cssText = "color: var(--interactive-accent); font-weight: 600;";
                                const existed = Object.prototype.hasOwnProperty.call(existing, k);
                                const badge = hdr.createEl("span");
                                badge.style.cssText = "margin-left: 8px; padding: 1px 6px; border-radius: 3px; font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em;";
                                if (existed) {
                                    badge.setText("overwrites");
                                    badge.style.background = "#f0a04b";
                                    badge.style.color = "#000";
                                } else {
                                    badge.setText("new");
                                    badge.style.background = "var(--interactive-accent)";
                                    badge.style.color = "var(--text-on-accent, #fff)";
                                }
                                const val = row.createEl("div", { text: String(writes[k] ?? "") });
                                val.style.cssText = "margin-top: 2px; color: var(--text-normal); white-space: pre-wrap; font-size: 0.85em;";
                                if (existed) {
                                    const prev = existing[k];
                                    const prevStr = prev === null || prev === undefined ? "(empty)" : (typeof prev === "object" ? JSON.stringify(prev) : String(prev));
                                    const was = row.createEl("div", { text: `was: ${prevStr}` });
                                    was.style.cssText = "margin-top: 2px; color: var(--text-faint); font-size: 0.75em; font-style: italic;";
                                }
                            }
                        }
                    }
                } catch (e) {
                    const err = el.createEl("div", { text: `Error: ${e.message}` });
                    err.style.color = "var(--text-error, #e26a6a)";
                }
            } else {
                line("(wire target + source to enable live run; LLM service needed only for separate/rewrite modes)", true);
            }
            return;
        }

        if (sourceNode.kind === "container") {
            const c = sourceNode.primitive;

            // Shared: resolve the current period up front — both sides need it.
            let data = null;
            try {
                data = await plugin.getPRBoundaryData(c.boundaryDetector, new Date());
            } catch (e) {
                const err = el.createEl("div", { text: `Could not resolve boundary: ${e.message}` });
                err.style.color = "var(--text-error, #e26a6a)";
            }

            // ═════════ INPUT ═════════
            band("▼ INPUT");

            section("Current period");
            if (data) line(`${formatDate(data.start)} → ${formatDate(data.end)}`);
            else line("(unresolved)", true);

            if (data) {
                section("Period tokens");
                kv(data.tokens);
            }

            section("Data sources");
            const srcs = getContainerDataSources(c);
            if (srcs.length === 0) {
                line("(none configured)", true);
            } else {
                for (const src of srcs) {
                    if (src.type === "daily") line("• Daily notes");
                    else if (src.type === "container") {
                        const t = (plugin.settings.prContainers || []).find(x => x.id === src.containerId);
                        line(`• ${t?.name || "(missing)"} (container)`);
                    }
                }
            }

            // Resolved source payload — what the LLM actually sees.
            if (data) {
                section("Resolved source payload");
                try {
                    const payload = await plugin.buildPRSourcePayload(c, data.start, data.end);
                    line(`${payload.count} ${payload.label}`, true);
                    const pre = el.createEl("pre");
                    pre.style.cssText = "white-space: pre-wrap; margin: 4px 0; padding: 6px 8px; background: var(--background-primary); border-radius: 4px; max-height: 220px; overflow: auto;";
                    pre.setText(payload.text || "(empty)");
                } catch (e) {
                    const err = el.createEl("div", { text: `Could not build payload: ${e.message}` });
                    err.style.color = "var(--text-error, #e26a6a)";
                }
            }

            section("System Prompt");
            if (!c.systemPromptFile) {
                line("(none — auto-LLM aggregation will be skipped)", true);
            } else {
                const spFile = app.vault.getAbstractFileByPath(c.systemPromptFile);
                if (!spFile) {
                    line(`(missing: ${c.systemPromptFile})`, true);
                } else {
                    line(c.systemPromptFile, true);
                    try {
                        // Show the file raw — runtime does not resolve {{...}}
                        // tokens in the system prompt, so neither does the
                        // preview. Period metadata is delivered via the user
                        // message instead (see "# Period" header below).
                        const sp = await plugin.loadTemplate(c.systemPromptFile);
                        const pre = el.createEl("pre");
                        pre.style.cssText = "white-space: pre-wrap; margin: 4px 0; padding: 6px 8px; background: var(--background-primary); border-radius: 4px; max-height: 180px; overflow: auto;";
                        pre.setText(sp);
                    } catch (e) { /* ignore */ }
                }
            }

            section("LLM service");
            const svc = c.llmServiceId ? (plugin.settings.prLLMServices || []).find(s => s.id === c.llmServiceId) : null;
            if (!svc) line("(none attached)", true);
            else line(`${svc.name} — ${svc.provider}${svc.model ? " / " + svc.model : ""}`);

            // ═════════ OUTPUT ═════════
            band("▲ OUTPUT");

            section("Resolved file path");
            if (!c.naming) {
                line("(no naming convention set)", true);
            } else if (data) {
                const fileName = plugin.resolveTokens(c.naming, data.tokens);
                const folderPath = c.saveDir || "";
                const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
                const existing = app.vault.getAbstractFileByPath(filePath);
                line(`${filePath}${existing ? "  (exists)" : "  (would be created)"}`);
            }

            const refl = c.reflectionId ? (plugin.settings.prReflections || []).find(r => r.id === c.reflectionId) : null;
            if (refl) {
                section("Reflection attached");
                const flags = [];
                if (refl.useLLM) flags.push("LLM");
                if (refl.replaceAutoLLM) flags.push("replace auto-LLM");
                if (refl.includeAlignmentContext) flags.push("incl. alignments");
                line(`${refl.name}${flags.length ? " (" + flags.join(", ") + ")" : ""}`);
                line(`${(refl.questions || []).length} question(s)`, true);
            }

            const als = (plugin.settings.prAlignments || []).filter(a => a.containerId === c.id);
            if (als.length > 0) {
                section(`Alignments (${als.length})`);
                for (const a of als) {
                    const outKey = (a.outputField || "").trim() || `alignment_${(a.name || "unnamed").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
                    line(`• ${a.name} — reads ${a.dataField || "(no field)"} → ${outKey}`);
                }
            }

            section("Most recent generated note");
            const file = await plugin.findMostRecentPRContainerNote(c);
            if (file) {
                line(file.path);
                section("Existing frontmatter");
                const fm = app.metadataCache.getFileCache(file)?.frontmatter || {};
                kv(fm, (k) => k !== "position" && k !== "periodic-ritual" && !k.startsWith("pr-"));
            } else {
                line("(none generated yet)", true);
            }

            // ─ Alignment groups attached to this container — dry-run each ─
            const attachedGroups = (plugin.settings.prAlignmentGroups || []).filter(g => g.containerId === c.id);
            if (attachedGroups.length > 0) {
                section(`Alignment groups (${attachedGroups.length})`);
                for (const g of attachedGroups) {
                    const modeLbl = (g.defaultMode || "separate") === "combined" ? "combined" : g.defaultMode || "separate";
                    line(`• ${g.name} — prefix ${g.prefix || "alignment"} (${modeLbl})`);
                }

                // Actually dry-run each alignment group so their output
                // appears in the container probe alongside the main LLM.
                if (data) {
                    for (const g of attachedGroups) {
                        section(`Alignment dry run: ${g.name}`);
                        try {
                            const agResult = await plugin.runPRAlignmentGroupPass(g, c, file || null, { start: data.start, end: data.end }, { dryRun: true, silent: true });
                            if (!agResult || agResult.empty) {
                                line("(empty or no output)", true);
                            } else {
                                const agWrites = agResult.writes || agResult.parsed || {};
                                const agKeys = Object.keys(agWrites);
                                if (agKeys.length === 0) {
                                    line("(nothing would be written)", true);
                                } else {
                                    const existing = file ? (app.metadataCache.getFileCache(file)?.frontmatter || {}) : {};
                                    for (const k of agKeys) {
                                        const row = el.createEl("div");
                                        row.style.cssText = "padding: 4px 0; border-bottom: 1px dashed var(--background-modifier-border);";
                                        const hdr = row.createEl("div");
                                        const keyEl = hdr.createEl("span", { text: k });
                                        keyEl.style.cssText = "color: var(--interactive-accent); font-weight: 600;";
                                        const existed = Object.prototype.hasOwnProperty.call(existing, k);
                                        const badge = hdr.createEl("span");
                                        badge.style.cssText = "margin-left: 8px; padding: 1px 6px; border-radius: 3px; font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em;";
                                        if (existed) {
                                            badge.setText("overwrites");
                                            badge.style.background = "#f0a04b";
                                            badge.style.color = "#000";
                                        } else {
                                            badge.setText("new");
                                            badge.style.background = "var(--interactive-accent)";
                                            badge.style.color = "var(--text-on-accent, #fff)";
                                        }
                                        const val = row.createEl("div", { text: String(agWrites[k] ?? "") });
                                        val.style.cssText = "margin-top: 2px; color: var(--text-normal); white-space: pre-wrap; font-size: 0.85em;";
                                        if (existed) {
                                            const prev = existing[k];
                                            const prevStr = prev === null || prev === undefined ? "(empty)" : (typeof prev === "object" ? JSON.stringify(prev) : String(prev));
                                            const was = row.createEl("div", { text: `was: ${prevStr}` });
                                            was.style.cssText = "margin-top: 2px; color: var(--text-faint); font-size: 0.75em; font-style: italic;";
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            const err = el.createEl("div", { text: `Alignment error: ${e.message}` });
                            err.style.color = "var(--text-error, #e26a6a)";
                        }
                    }
                }
            }

            // ─ Live LLM dry run ─
            // Actually call the LLM with the resolved system prompt + user
            // message, parse the response, and show exactly which frontmatter
            // keys would be written and how they'd interact with what's
            // already on the note. Skipped when the container lacks a service
            // or a prompt file.
            if (c.llmServiceId && c.systemPromptFile && data) {
                section("Live LLM call (dry run)");
                line("Calling the LLM with the inputs above…", true);
                try {
                    const result = await plugin.runPRLLMAggregation(c, file || null, {
                        start: data.start, end: data.end,
                    }, { dryRun: true, silent: true });

                    if (!result) {
                        line("(call failed — check console / last-LLM-call debug modal)", true);
                    } else if (result.empty) {
                        line("(LLM returned empty or unparseable YAML)", true);
                        if (result.responseText) {
                            const pre = el.createEl("pre");
                            pre.style.cssText = "white-space: pre-wrap; margin: 4px 0; padding: 6px 8px; background: var(--background-primary); border-radius: 4px; max-height: 180px; overflow: auto;";
                            pre.setText(result.responseText);
                        }
                    } else {
                        const parsed = result.parsed || {};
                        const existing = file ? (app.metadataCache.getFileCache(file)?.frontmatter || {}) : {};
                        const keys = Object.keys(parsed);
                        line(`${keys.length} key(s) would be written:`, true);
                        const block = el.createEl("div");
                        block.style.cssText = "background: var(--background-primary); border-radius: 4px; padding: 6px 8px; margin-top: 4px;";
                        for (const k of keys) {
                            const row = block.createEl("div");
                            row.style.cssText = "padding: 4px 0; border-bottom: 1px dashed var(--background-modifier-border);";
                            const header = row.createEl("div");
                            const keyEl = header.createEl("span", { text: k });
                            keyEl.style.cssText = "color: var(--interactive-accent); font-weight: 600;";
                            // Badge: new vs overwrite (empty → overwrite, present → overwrite, absent → new)
                            const existed = Object.prototype.hasOwnProperty.call(existing, k);
                            const badge = header.createEl("span");
                            badge.style.cssText = "margin-left: 8px; padding: 1px 6px; border-radius: 3px; font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em;";
                            if (existed) {
                                badge.setText("overwrites");
                                badge.style.background = "#f0a04b";
                                badge.style.color = "#000";
                            } else {
                                badge.setText("new");
                                badge.style.background = "var(--interactive-accent)";
                                badge.style.color = "var(--text-on-accent, #fff)";
                            }
                            const v = parsed[k];
                            const valStr = v === null || v === undefined ? "" : (typeof v === "object" ? JSON.stringify(v, null, 2) : String(v));
                            const val = row.createEl("div", { text: valStr });
                            val.style.cssText = "margin-top: 2px; color: var(--text-normal); white-space: pre-wrap; font-size: 0.85em;";
                            if (existed) {
                                const prev = existing[k];
                                const prevStr = prev === null || prev === undefined ? "(empty)" : (typeof prev === "object" ? JSON.stringify(prev) : String(prev));
                                const was = row.createEl("div", { text: `was: ${prevStr}` });
                                was.style.cssText = "margin-top: 2px; color: var(--text-faint); font-size: 0.75em; font-style: italic;";
                            }
                        }
                    }
                } catch (e) {
                    const err = el.createEl("div", { text: `LLM call error: ${e.message}` });
                    err.style.color = "var(--text-error, #e26a6a)";
                }
            }
            return;
        }

        line("(no probe available for this node kind)", true);
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

    // ─── Multi-select keyboard ───
    //
    // Delete / Backspace → delete every selected primitive
    // Cmd/Ctrl + C → copy selected primitives to in-memory clipboard
    // Cmd/Ctrl + V → paste from clipboard (new ids, offset positions)
    // Cmd/Ctrl + A → select all primitive nodes
    // Escape → clear selection
    setupKeyboard() {
        if (!this.canvasEl) return;
        // Make the canvas focusable so it receives keyboard events.
        this.canvasEl.setAttribute("tabindex", "0");
        this.canvasEl.addEventListener("mouseenter", () => this.canvasEl.focus());

        const onKeyDown = async (e) => {
            // Don't hijack typing in an input/textarea
            const tag = (e.target?.tagName || "").toLowerCase();
            if (tag === "input" || tag === "textarea" || tag === "select") return;

            const isMod = e.metaKey || e.ctrlKey;

            if ((e.key === "Delete" || e.key === "Backspace") && this.selection.size > 0) {
                e.preventDefault();
                await this.deleteSelectedNodes();
                return;
            }
            if (e.key === "Escape" && this.selection.size > 0) {
                e.preventDefault();
                this.selection.clear();
                this.render();
                return;
            }
            if (isMod && (e.key === "a" || e.key === "A")) {
                e.preventDefault();
                this.selection = new Set(this.nodes.filter(n => this.nodeIsPrimitive(n)).map(n => n.id));
                this.render();
                return;
            }
            if (isMod && (e.key === "c" || e.key === "C") && this.selection.size > 0) {
                e.preventDefault();
                this.copySelectedToClipboard();
                new Notice(`Copied ${this.clipboard.items.length} node(s)`);
                return;
            }
            if (isMod && (e.key === "v" || e.key === "V") && this.clipboard) {
                e.preventDefault();
                await this.pasteFromClipboard();
                return;
            }
        };

        this.canvasEl.addEventListener("keydown", onKeyDown);
        this._keyboardCleanup = () => this.canvasEl?.removeEventListener("keydown", onKeyDown);
    }

    // Delete every primitive node currently in the selection set. Also
    // clears references to the deleted primitives on other primitives
    // (mirrors the per-node delete logic from the right-click menu).
    async deleteSelectedNodes() {
        if (this.selection.size === 0) return;
        // Snapshot to a list — we'll mutate settings while iterating.
        const ids = Array.from(this.selection);
        let deleted = 0;
        for (const id of ids) {
            const node = this.nodes.find(n => n.id === id);
            if (!node || !node.primitive) continue;
            await this.deletePrimitiveNode(node);
            deleted++;
        }
        this.selection.clear();
        new Notice(`Deleted ${deleted} node(s)`);
        // deletePrimitiveNode already calls render() each time. Final
        // render is implicit via the last call.
    }

    // Copy selected primitives to in-memory clipboard. Stores deep clones
    // by kind so the paste can recreate them with new ids.
    copySelectedToClipboard() {
        const items = [];
        for (const id of this.selection) {
            const node = this.nodes.find(n => n.id === id);
            if (!node || !node.primitive) continue;
            // Custom boundary nodes have kind "boundary" but live in
            // prCustomBoundaries. Built-in boundaries are not copyable
            // (they have no primitive — handled above).
            const kind = (node.kind === "boundary") ? "custom-boundary" : node.kind;
            items.push({
                kind,
                data: JSON.parse(JSON.stringify(node.primitive)),
                originalX: node.x,
                originalY: node.y,
            });
        }
        // Compute the centroid so paste positions are relative to the
        // group, not absolute.
        let cx = 0, cy = 0;
        for (const it of items) { cx += it.originalX; cy += it.originalY; }
        if (items.length > 0) { cx /= items.length; cy /= items.length; }
        this.clipboard = { items, centroidX: cx, centroidY: cy };
    }

    // Paste clipboard items as new primitives with fresh ids and positions
    // offset by 30/30 from where they were originally. Selects the newly
    // pasted nodes after render.
    async pasteFromClipboard() {
        if (!this.clipboard || !Array.isArray(this.clipboard.items)) return;
        const s = this.plugin.settings;
        const newIds = [];
        const idPrefix = (kind) => ({
            container: "pr",
            reflection: "rf",
            alignment: "al",
            llm: "lsv",
            "custom-boundary": "cb",
        })[kind] || "x";

        for (const it of this.clipboard.items) {
            const fresh = JSON.parse(JSON.stringify(it.data));
            fresh.id = `${idPrefix(it.kind)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            fresh.name = `${fresh.name || "(unnamed)"} (copy)`;
            // Reset per-instance state that shouldn't be cloned
            if (it.kind === "container") fresh.lastGeneratedEnd = "";

            // Push into the right settings array
            let nodeIdPrefix;
            if (it.kind === "container") {
                if (!Array.isArray(s.prContainers)) s.prContainers = [];
                s.prContainers.push(fresh);
                nodeIdPrefix = "container";
            } else if (it.kind === "reflection") {
                if (!Array.isArray(s.prReflections)) s.prReflections = [];
                s.prReflections.push(fresh);
                nodeIdPrefix = "reflection";
            } else if (it.kind === "alignment") {
                if (!Array.isArray(s.prAlignments)) s.prAlignments = [];
                s.prAlignments.push(fresh);
                nodeIdPrefix = "alignment";
            } else if (it.kind === "llm") {
                if (!Array.isArray(s.prLLMServices)) s.prLLMServices = [];
                s.prLLMServices.push(fresh);
                nodeIdPrefix = "llm";
            } else if (it.kind === "custom-boundary") {
                if (!Array.isArray(s.prCustomBoundaries)) s.prCustomBoundaries = [];
                s.prCustomBoundaries.push(fresh);
                nodeIdPrefix = "boundary-custom";
            } else {
                continue;
            }

            const nodeId = `${nodeIdPrefix}-${fresh.id}`;
            newIds.push(nodeId);
            // Seed position 30/30 offset from the original
            if (!s.prGraphLayout) s.prGraphLayout = {};
            s.prGraphLayout[nodeId] = { x: it.originalX + 30, y: it.originalY + 30 };
        }

        await this.plugin.saveSettings();
        this.selection = new Set(newIds);
        this.render();
        new Notice(`Pasted ${newIds.length} node(s)`);
    }

    // ─── Filter popover (Phase 10c-3) ───
    openFilterPopover(clientX, clientY) {
        // Close any existing menu
        const existing = document.querySelector(".pr-graph-ctx-menu");
        if (existing) existing.remove();

        const menu = document.createElement("div");
        menu.className = "pr-graph-ctx-menu pr-graph-filter-popover";
        menu.style.cssText = `position: fixed; left: ${clientX}px; top: ${clientY + 10}px; z-index: 1000; min-width: 240px; padding: 12px;`;

        // Title
        const title = menu.createEl("div", { text: "Filters", cls: "pr-graph-filter-title" });
        title.style.cssText = "color: var(--text-muted); font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;";

        // Kind checkboxes
        const KINDS = [
            { id: "container",        label: "Containers" },
            { id: "boundary",         label: "Boundaries" },
            { id: "llm",              label: "LLM Services" },
            { id: "reflection",       label: "Reflections" },
            { id: "alignment-group",  label: "Alignments" },
            { id: "daily",            label: "Daily source" },
            { id: "data-source",      label: "Data sources" },
            { id: "show",             label: "Show output probes" },
        ];
        const kindWrap = menu.createEl("div", { cls: "pr-graph-filter-section" });
        kindWrap.createEl("div", { text: "Show kinds", cls: "pr-graph-filter-section-label" });
        for (const k of KINDS) {
            const row = kindWrap.createEl("label", { cls: "pr-graph-filter-row" });
            const input = row.createEl("input", { type: "checkbox" });
            input.checked = !this.filters.hiddenKinds.has(k.id);
            row.createEl("span", { text: k.label });
            input.addEventListener("change", () => {
                if (input.checked) this.filters.hiddenKinds.delete(k.id);
                else this.filters.hiddenKinds.add(k.id);
                this.render();
                // Close + reopen popover so the count badge refreshes
                menu.remove();
            });
        }

        // Container focus dropdown
        const focusWrap = menu.createEl("div", { cls: "pr-graph-filter-section" });
        focusWrap.createEl("div", { text: "Focus on container", cls: "pr-graph-filter-section-label" });
        const focusSelect = focusWrap.createEl("select", { cls: "pr-graph-form-select" });
        focusSelect.createEl("option", { value: "", text: "All containers" });
        for (const c of (this.plugin.settings.prContainers || [])) {
            const opt = focusSelect.createEl("option", { value: c.id, text: c.name || "(unnamed)" });
            if (c.id === this.filters.focusContainerId) opt.selected = true;
        }
        focusSelect.addEventListener("change", () => {
            this.filters.focusContainerId = focusSelect.value;
            this.render();
            menu.remove();
        });

        // Enabled only toggle
        const enabledWrap = menu.createEl("div", { cls: "pr-graph-filter-section" });
        const enabledRow = enabledWrap.createEl("label", { cls: "pr-graph-filter-row" });
        const enabledInput = enabledRow.createEl("input", { type: "checkbox" });
        enabledInput.checked = !!this.filters.enabledOnly;
        enabledRow.createEl("span", { text: "Enabled containers only" });
        enabledInput.addEventListener("change", () => {
            this.filters.enabledOnly = enabledInput.checked;
            this.render();
            menu.remove();
        });

        // Reset button
        const sep = menu.createEl("div", { cls: "pr-graph-ctx-sep" });
        const resetBtn = menu.createEl("button", { text: "Reset all filters", cls: "pr-graph-ctx-item" });
        resetBtn.addEventListener("click", () => {
            this.filters = { hiddenKinds: new Set(), focusContainerId: "", enabledOnly: false };
            this.render();
            menu.remove();
        });

        document.body.appendChild(menu);

        // Dismiss on outside click
        const dismiss = (e) => {
            if (menu.contains(e.target)) return;
            menu.remove();
            document.removeEventListener("mousedown", dismiss, true);
        };
        setTimeout(() => document.addEventListener("mousedown", dismiss, true), 0);
    }

    // ─── Double-click ───
    //
    // - On empty canvas: open the Add menu at the click point.
    // - On a node: open settings to that primitive's tab. Also cancels any
    //   pending single-click "toggle expand" so the actions don't fight.
    setupDoubleClick() {
        if (!this.canvasEl) return;
        const canvas = this.canvasEl;
        const onDblClick = (e) => {
            // Sockets reserved for wire drag
            if (e.target.closest(".pr-graph-socket")) return;
            // Resize grip owns its own double-click (reset size)
            if (e.target.closest(".pr-graph-node-resize")) return;
            // Cancel any pending single-click action triggered by the first
            // click of this double-click sequence.
            if (this._pendingNodeTap) {
                clearTimeout(this._pendingNodeTap);
                this._pendingNodeTap = null;
            }
            const nodeEl = e.target.closest(".pr-graph-node");
            if (nodeEl) {
                const node = this.nodes.find(n => n.id === nodeEl.dataset.nodeId);
                if (!node) return;
                this.onNodeClick(node);  // opens settings to the primitive's tab
                return;
            }
            // Empty canvas → open the add menu at this position
            this.openCanvasContextMenu(e);
        };
        canvas.addEventListener("dblclick", onDblClick);
        this._dblClickCleanup = () => canvas.removeEventListener("dblclick", onDblClick);
    }

    // ─── Right-click context menus (Phase 10b-2) ───
    //
    // Three menu types:
    //   - Empty canvas: add a new primitive (container, reflection, etc.)
    //     positioned at the click location.
    //   - Node: edit, duplicate, delete, enable/disable (containers only).
    //   - Wire: delete (same as left-click on the wire, but discoverable).

    setupContextMenus() {
        if (!this.canvasEl) return;
        const canvas = this.canvasEl;

        const onContextMenu = (e) => {
            e.preventDefault();

            const wirePath = e.target.closest("path.pr-graph-wire:not(.pr-graph-wire-ghost)");
            const nodeEl = e.target.closest(".pr-graph-node");

            if (wirePath) {
                this.openWireContextMenu(e, wirePath);
            } else if (nodeEl) {
                this.openNodeContextMenu(e, nodeEl);
            } else {
                this.openCanvasContextMenu(e);
            }
        };
        canvas.addEventListener("contextmenu", onContextMenu);
        this._ctxMenuCleanup = () => canvas.removeEventListener("contextmenu", onContextMenu);
    }

    // Build a free-floating menu rooted at (clientX, clientY). Items is an
    // array of { label, onClick, danger? }.
    showFloatingMenu(clientX, clientY, items) {
        // Close any existing menu first
        const existing = document.querySelector(".pr-graph-ctx-menu");
        if (existing) existing.remove();

        const menu = document.createElement("div");
        menu.className = "pr-graph-ctx-menu";
        menu.style.cssText = `position: fixed; left: ${clientX}px; top: ${clientY}px; z-index: 1000;`;
        for (const item of items) {
            if (item === "separator") {
                const sep = document.createElement("div");
                sep.className = "pr-graph-ctx-sep";
                menu.appendChild(sep);
                continue;
            }
            const btn = document.createElement("button");
            btn.className = "pr-graph-ctx-item" + (item.danger ? " pr-graph-ctx-danger" : "");
            // If the item supplies a color, render a colored pipe before
            // the label text as a minimal kind identifier.
            if (item.color) {
                const pipe = document.createElement("span");
                pipe.className = "pr-color-pipe";
                pipe.style.backgroundColor = item.color;
                btn.appendChild(pipe);
            }
            btn.appendChild(document.createTextNode(item.label));
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                menu.remove();
                if (item.onClick) await item.onClick();
            });
            menu.appendChild(btn);
        }
        document.body.appendChild(menu);

        // Dismiss on any other click
        const dismiss = (e) => {
            if (menu.contains(e.target)) return;
            menu.remove();
            document.removeEventListener("mousedown", dismiss, true);
        };
        setTimeout(() => document.addEventListener("mousedown", dismiss, true), 0);
    }

    openWireContextMenu(e, wirePath) {
        const paths = Array.from(this.wireSvg.querySelectorAll("path.pr-graph-wire:not(.pr-graph-wire-ghost)"));
        const idx = paths.indexOf(wirePath);
        if (idx < 0 || !this.wires[idx]) return;
        const wire = this.wires[idx];
        this.showFloatingMenu(e.clientX, e.clientY, [
            { label: `Wire: ${wire.kind}`, onClick: null },
            "separator",
            { label: "Delete", danger: true, onClick: () => this.deleteWire(wire) },
        ]);
    }

    openNodeContextMenu(e, nodeEl) {
        const node = this.nodes.find(n => n.id === nodeEl.dataset.nodeId);
        if (!node) return;

        const items = [];
        items.push({ label: `${node.title} (${node.kind})`, onClick: null });
        items.push("separator");

        // Inspect — read-only "what does this currently produce" view.
        // Available for every node kind, including built-in boundaries
        // and the daily source.
        items.push({
            label: "Inspect output",
            onClick: () => new PRNodeInspectModal(this.app, this.plugin, node).open(),
        });

        // Container shortcut: open the system prompt MD file in a leaf
        // so the user can read what's defining the LLM contract.
        if (node.kind === "container" && node.primitive?.systemPromptFile) {
            items.push({
                label: "View system prompt",
                onClick: () => {
                    const file = this.app.vault.getAbstractFileByPath(node.primitive.systemPromptFile);
                    if (file && file instanceof TFile) {
                        this.app.workspace.getLeaf(false).openFile(file);
                    } else {
                        new Notice(`System prompt not found: ${node.primitive.systemPromptFile}`);
                    }
                },
            });
        }

        if (node.primitiveTab) {
            items.push({ label: "Edit in settings", onClick: () => this.onNodeClick(node) });
        }
        if (node.kind === "container" && node.primitive) {
            items.push({
                label: node.primitive.enabled ? "Disable" : "Enable",
                onClick: async () => {
                    node.primitive.enabled = !node.primitive.enabled;
                    await this.plugin.saveSettings();
                    this.render();
                },
            });
            items.push({
                label: "Duplicate",
                onClick: async () => {
                    const copy = JSON.parse(JSON.stringify(node.primitive));
                    copy.id = "pr-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
                    copy.name = `${copy.name} (copy)`;
                    copy.lastGeneratedEnd = "";
                    this.plugin.settings.prContainers.push(copy);
                    await this.plugin.saveSettings();
                    this.render();
                },
            });
        }
        if (node.kind === "reflection" && node.primitive) {
            items.push({
                label: "Duplicate",
                onClick: async () => {
                    const copy = JSON.parse(JSON.stringify(node.primitive));
                    copy.id = "rf-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
                    copy.name = `${copy.name} (copy)`;
                    this.plugin.settings.prReflections.push(copy);
                    await this.plugin.saveSettings();
                    this.render();
                },
            });
        }

        // Delete works for any primitive node — daily and built-in boundary
        // nodes have no primitive to delete and skip this entry.
        if (node.primitive) {
            items.push("separator");
            items.push({
                label: "Delete",
                danger: true,
                onClick: async () => {
                    await this.deletePrimitiveNode(node);
                },
            });
        }

        this.showFloatingMenu(e.clientX, e.clientY, items);
    }

    async deletePrimitiveNode(node) {
        const s = this.plugin.settings;
        if (node.kind === "container") {
            s.prContainers = (s.prContainers || []).filter(c => c.id !== node.primitive.id);
        } else if (node.kind === "reflection") {
            s.prReflections = (s.prReflections || []).filter(r => r.id !== node.primitive.id);
            // Also clear references on containers that pointed at this reflection
            for (const c of (s.prContainers || [])) {
                if (c.reflectionId === node.primitive.id) c.reflectionId = "";
            }
        } else if (node.kind === "alignment") {
            s.prAlignments = (s.prAlignments || []).filter(a => a.id !== node.primitive.id);
        } else if (node.kind === "llm") {
            s.prLLMServices = (s.prLLMServices || []).filter(svc => svc.id !== node.primitive.id);
            // Clear references on containers
            for (const c of (s.prContainers || [])) {
                if (c.llmServiceId === node.primitive.id) c.llmServiceId = "";
            }
        } else if (node.kind === "boundary" && node.id.startsWith("boundary-custom-")) {
            const cbId = node.id.replace(/^boundary-custom-/, "");
            s.prCustomBoundaries = (s.prCustomBoundaries || []).filter(cb => cb.id !== cbId);
            // Reset containers that referenced it
            for (const c of (s.prContainers || [])) {
                if (c.boundaryDetector === `custom:${cbId}`) c.boundaryDetector = "calendar-week";
            }
        } else if (node.kind === "alignment-group") {
            s.prAlignmentGroups = (s.prAlignmentGroups || []).filter(g => g.id !== node.primitive.id);
        } else if (node.kind === "show") {
            s.prShowNodes = (s.prShowNodes || []).filter(sh => sh.id !== node.primitive.id);
        } else if (node.kind === "data-source") {
            s.prDataSources = (s.prDataSources || []).filter(ds => ds.id !== node.primitive.id);
            // Strip any container.dataSource.sources entries that reference
            // the deleted primitive, so orphaned wires don't linger.
            for (const c of (s.prContainers || [])) {
                const sources = getContainerDataSources(c);
                const filtered = sources.filter(src => !(src.type === "dataSource" && src.dataSourceId === node.primitive.id));
                if (filtered.length !== sources.length) {
                    c.dataSource = { sources: filtered };
                }
            }
        }
        await this.plugin.saveSettings();
        this.render();
    }

    openCanvasContextMenu(e) {
        // Position the new node at the click location, in viewport coordinates.
        const rect = this.canvasEl.getBoundingClientRect();
        const vx = (e.clientX - rect.left - this.panX) / this.zoom;
        const vy = (e.clientY - rect.top - this.panY) / this.zoom;

        const seedPosition = (id) => {
            if (!this.plugin.settings.prGraphLayout) this.plugin.settings.prGraphLayout = {};
            this.plugin.settings.prGraphLayout[id] = { x: vx, y: vy };
        };

        this.showFloatingMenu(e.clientX, e.clientY, [
            { label: "Add…", onClick: null },
            "separator",
            {
                label: "Container",
                color: this.colorForKind("container"),
                onClick: async () => {
                    const c = makePRContainer({ name: "New container" });
                    this.plugin.settings.prContainers.push(c);
                    seedPosition(`container-${c.id}`);
                    await this.plugin.saveSettings();
                    this.render();
                },
            },
            {
                label: "Reflection",
                color: this.colorForKind("reflection"),
                onClick: async () => {
                    const r = makePRReflection();
                    this.plugin.settings.prReflections.push(r);
                    seedPosition(`reflection-${r.id}`);
                    await this.plugin.saveSettings();
                    this.render();
                },
            },
            {
                label: "Alignment",
                color: this.colorForKind("alignment-group"),
                onClick: async () => {
                    if (!Array.isArray(this.plugin.settings.prAlignmentGroups)) {
                        this.plugin.settings.prAlignmentGroups = [];
                    }
                    const g = makePRAlignmentGroup();
                    this.plugin.settings.prAlignmentGroups.push(g);
                    seedPosition(`alignmentgroup-${g.id}`);
                    await this.plugin.saveSettings();
                    this.render();
                },
            },
            {
                label: "LLM service",
                color: this.colorForKind("llm"),
                onClick: async () => {
                    const svc = makePRLLMService();
                    this.plugin.settings.prLLMServices.push(svc);
                    seedPosition(`llm-${svc.id}`);
                    await this.plugin.saveSettings();
                    this.render();
                },
            },
            {
                label: "Custom boundary",
                color: this.colorForKind("boundary"),
                onClick: async () => {
                    const cb = makePRCustomBoundary();
                    this.plugin.settings.prCustomBoundaries.push(cb);
                    seedPosition(`boundary-custom-${cb.id}`);
                    await this.plugin.saveSettings();
                    this.render();
                },
            },
            {
                label: "Data source…",
                color: this.colorForKind("data-source"),
                onClick: () => this.openDataSourcePickerMenu(e, seedPosition),
            },
            {
                label: "Show output (dry-run probe)",
                color: this.colorForKind("show"),
                onClick: async () => {
                    if (!Array.isArray(this.plugin.settings.prShowNodes)) {
                        this.plugin.settings.prShowNodes = [];
                    }
                    const sh = makePRShowNode();
                    this.plugin.settings.prShowNodes.push(sh);
                    seedPosition(`show-${sh.id}`);
                    await this.plugin.saveSettings();
                    this.render();
                },
            },
        ]);
    }

    // Secondary menu opened when the user picks "Data source…" from the
    // canvas context menu. Shows existing data sources + two shortcuts to
    // create fresh ones from a file or folder picker.
    openDataSourcePickerMenu(e, seedPosition) {
        const items = [];
        const existing = this.plugin.settings.prDataSources || [];
        items.push({ label: "Data source", onClick: null });
        items.push("separator");

        const createAndDrop = async (ds) => {
            if (!Array.isArray(this.plugin.settings.prDataSources)) {
                this.plugin.settings.prDataSources = [];
            }
            this.plugin.settings.prDataSources.push(ds);
            seedPosition(`datasource-${ds.id}`);
            await this.plugin.saveSettings();
            this.render();
        };

        items.push({
            label: "+ New static (pick a note)",
            onClick: () => {
                new MarkdownFileSuggestModal(this.app, async (file) => {
                    const ds = makePRDataSource({
                        name: file.basename,
                        mode: "static",
                        notePath: file.path,
                    });
                    await createAndDrop(ds);
                }).open();
            },
        });
        items.push({
            label: "+ New dynamic (pick a folder)",
            onClick: () => {
                new FolderSuggestModal(this.app, async (folder) => {
                    const ds = makePRDataSource({
                        name: folder.name || folder.path,
                        mode: "dynamic",
                        folderPath: folder.path,
                    });
                    await createAndDrop(ds);
                }).open();
            },
        });

        if (existing.length > 0) {
            items.push("separator");
            items.push({ label: "Existing", onClick: null });
            for (const ds of existing) {
                const subtitle = ds.mode === "static"
                    ? (ds.notePath || "(no note)")
                    : `${ds.folderPath || "(no folder)"}/ (dynamic)`;
                items.push({
                    label: `${ds.name || "(unnamed)"}  —  ${subtitle}`,
                    onClick: async () => {
                        // Dropping an "existing" data source is really just
                        // positioning it on the canvas. Seed its layout
                        // entry so it lands where the user clicked.
                        seedPosition(`datasource-${ds.id}`);
                        await this.plugin.saveSettings();
                        this.render();
                    },
                });
            }
        }

        this.showFloatingMenu(e.clientX, e.clientY, items);
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
            case "data-source":      return "data-source";  // user-defined note/folder source
            case "alignment-group":  return "alignment";     // group writes to container in-alignment
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
    //
    // Note the asymmetry: the data-source output type maps to the in-data
    // socket, not in-data-source. Other types (boundary / llm / reflection
    // / alignment) match their socket ids 1:1.
    canConnect(fromNode, toNode, toSocketId) {
        if (!fromNode || !toNode) return false;
        // Show-output probe accepts ANY output. Self-probe is pointless.
        if (toNode.kind === "show") {
            if (toSocketId !== "in-any") return false;
            if (fromNode.kind === "show") return false;
            return !!this.nodeOutputType(fromNode.kind);
        }
        // Alignment group accepts source wires (data-source OR container)
        // into in-source, and LLM service into in-llm.
        if (toNode.kind === "alignment-group") {
            if (toSocketId === "in-source") {
                return fromNode.kind === "data-source" || fromNode.kind === "container";
            }
            if (toSocketId === "in-llm") {
                return fromNode.kind === "llm";
            }
            return false;
        }
        if (toNode.kind !== "container") return false;
        const outType = this.nodeOutputType(fromNode.kind);
        if (!outType) return false;
        const SOCKET_FOR_OUTPUT_TYPE = {
            "data-source": "in-data",
            "boundary":    "in-boundary",
            "llm":         "in-llm",
            "reflection":  "in-reflection",
            "alignment":   "in-alignment",
        };
        const expectedSocket = SOCKET_FOR_OUTPUT_TYPE[outType];
        return toSocketId === expectedSocket;
    }

    // Apply a new connection — write the corresponding settings field.
    async applyConnection(fromNode, toNode, fromSocket, toSocket) {
        const containers = this.plugin.settings.prContainers || [];

        // Show-output probe: store the upstream node id on the show primitive.
        if (toNode.kind === "show") {
            const sh = (this.plugin.settings.prShowNodes || []).find(s => `show-${s.id}` === toNode.id);
            if (sh) {
                sh.sourceNodeId = fromNode.id;
                await this.plugin.saveSettings();
                this.render();
            }
            return;
        }

        // Alignment group input wires: in-source (data-source or container)
        // and in-llm (llm service). The wire from alignment-group → container
        // is handled below in the in-alignment branch.
        if (toNode.kind === "alignment-group") {
            const group = (this.plugin.settings.prAlignmentGroups || []).find(g => `alignmentgroup-${g.id}` === toNode.id);
            if (!group) return;
            if (toSocket === "in-source") {
                if (fromNode.kind === "data-source") {
                    group.sourceKind = "data-source";
                    group.sourceId = fromNode.id.replace(/^datasource-/, "");
                } else if (fromNode.kind === "container") {
                    group.sourceKind = "container";
                    group.sourceId = fromNode.id.replace(/^container-/, "");
                }
            } else if (toSocket === "in-llm" && fromNode.kind === "llm") {
                group.llmServiceId = fromNode.id.replace(/^llm-/, "");
            }
            await this.plugin.saveSettings();
            this.render();
            return;
        }

        if (toNode.kind !== "container") return;
        const target = containers.find(c => `container-${c.id}` === toNode.id);
        if (!target) return;

        if (toSocket === "in-data") {
            // Multi-source: ADD the new source instead of replacing.
            // Dedupe via dataSourceKey so two of the same don't pile up.
            const sources = getContainerDataSources(target);
            let toAdd = null;
            if (fromNode.id === "daily") {
                toAdd = { type: "daily" };
            } else if (fromNode.kind === "container") {
                const sourceId = fromNode.id.replace(/^container-/, "");
                if (sourceId === target.id) return; // can't self-reference
                toAdd = { type: "container", containerId: sourceId };
            } else if (fromNode.kind === "data-source") {
                const sourceId = fromNode.id.replace(/^datasource-/, "");
                toAdd = { type: "dataSource", dataSourceId: sourceId };
            }
            if (toAdd) {
                const key = dataSourceKey(toAdd);
                if (!sources.some(s => dataSourceKey(s) === key)) {
                    sources.push(toAdd);
                }
                target.dataSource = { sources };
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
            } else if (fromNode.kind === "alignment-group") {
                const groupId = fromNode.id.replace(/^alignmentgroup-/, "");
                const group = (this.plugin.settings.prAlignmentGroups || []).find(g => g.id === groupId);
                if (group) group.containerId = target.id;
            }
        }

        await this.plugin.saveSettings();
        this.render();
    }

    // ─── Snap helper for wire drag ───
    //
    // Find the closest compatible socket within a snap radius. Returns
    // { nodeId, socketId, el, pos } or null. drag.direction tells us
    // whether to look for input sockets (out-drag → in) or output sockets
    // (in-drag → out).
    findSnapTarget(clientX, clientY, drag) {
        const SNAP_RADIUS_VIEWPORT = 50; // 50px in viewport coords
        const rect = this.canvasEl.getBoundingClientRect();
        const mx = (clientX - rect.left - this.panX) / this.zoom;
        const my = (clientY - rect.top - this.panY) / this.zoom;

        const lookForOutputs = drag.direction === "in";
        const selector = lookForOutputs ? ".pr-graph-socket-out" : ".pr-graph-socket-in";

        let best = null;
        let bestDist = SNAP_RADIUS_VIEWPORT;

        for (const node of this.nodes) {
            if (!node.el) continue;
            const sockets = node.el.querySelectorAll(selector);
            for (const socket of sockets) {
                const socketId = socket.dataset.socketId;
                const pos = this.socketPos(node.id, socketId);
                const dx = pos.x - mx;
                const dy = pos.y - my;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist >= bestDist) continue;

                // Compatibility check via canConnect
                if (drag.direction === "out") {
                    if (!this.canConnect(drag.fromNode, node, socketId)) continue;
                } else {
                    if (!this.canConnect(node, drag.toNode, drag.toSocketId)) continue;
                }

                best = { nodeId: node.id, socketId, el: socket, pos };
                bestDist = dist;
            }
        }
        return best;
    }

    // Apply or clear the snap-target visual highlight on the relevant
    // socket. Cleans up the previous highlight when switching targets.
    setSnapHighlight(targetEl) {
        if (this._snapHighlight === targetEl) return;
        if (this._snapHighlight) this._snapHighlight.classList.remove("pr-graph-socket-snapping");
        this._snapHighlight = targetEl || null;
        if (targetEl) targetEl.classList.add("pr-graph-socket-snapping");
    }

    setupWireDrag() {
        if (!this.viewportEl || !this.wireSvg) return;
        const SVG_NS = "http://www.w3.org/2000/svg";

        // Drag direction: "out" = output socket → input socket (forward)
        //                 "in"  = empty input socket → menu (reverse)
        let active = null;

        const onMouseDown = (e) => {
            if (e.button !== 0) return;

            // Output socket — forward drag
            const outSocket = e.target.closest(".pr-graph-socket-out");
            if (outSocket) {
                const nodeEl = outSocket.closest(".pr-graph-node");
                if (!nodeEl) return;
                const node = this.nodes.find(n => n.id === nodeEl.dataset.nodeId);
                if (!node) return;
                const ghost = document.createElementNS(SVG_NS, "path");
                ghost.setAttribute("class", `pr-graph-wire pr-graph-wire-${this.nodeOutputType(node.kind)} pr-graph-wire-ghost`);
                ghost.setAttribute("fill", "none");
                this.wireSvg.appendChild(ghost);
                active = {
                    direction: "out",
                    fromNode: node,
                    fromSocketId: outSocket.dataset.socketId || "out",
                    ghost,
                };
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // Input socket — reverse drag (works on both empty AND connected
            // inputs; connected ones detach immediately so the wire follows
            // the cursor and can be re-routed).
            const inSocket = e.target.closest(".pr-graph-socket-in");
            if (inSocket) {
                const nodeEl = inSocket.closest(".pr-graph-node");
                if (!nodeEl) return;
                const node = this.nodes.find(n => n.id === nodeEl.dataset.nodeId);
                if (!node) return;
                const socketId = inSocket.dataset.socketId;

                // Check for existing wires on this input. With multi-source
                // and multi-alignment, an input can have more than one. We
                // only allow rewire-drag when there's exactly one wire — for
                // multiples, the user should right-click delete the specific
                // wire they want to remove.
                const existingWires = this.wires.filter(w => w.to === node.id && w.toSocket === socketId);
                let isRewire = false;
                if (existingWires.length === 1) {
                    const existingWire = existingWires[0];
                    if (socketId === "in-boundary") {
                        new Notice("Boundary is required. Drop a different boundary on the input or change it in settings.");
                        return;
                    }
                    this.applyDetachInPlace(existingWire);
                    this.plugin.saveSettings().catch(err => console.error("Periodic Ritual: detach save failed", err));
                    isRewire = true;
                } else if (existingWires.length > 1) {
                    // Multi-wire input — don't auto-detach. Let the user
                    // start a fresh drag from this socket to ADD another
                    // source / connection.
                    isRewire = false;
                }

                // Determine the wire color from the input socket type
                const wireKind = (socketId || "").replace(/^in-/, "") || "data-source";
                const ghost = document.createElementNS(SVG_NS, "path");
                ghost.setAttribute("class", `pr-graph-wire pr-graph-wire-${wireKind} pr-graph-wire-ghost`);
                ghost.setAttribute("fill", "none");
                this.wireSvg.appendChild(ghost);
                active = {
                    direction: "in",
                    toNode: node,
                    toSocketId: socketId,
                    ghost,
                    isRewire,
                };
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        };

        const onMouseMove = (e) => {
            if (!active) return;
            const rect = this.canvasEl.getBoundingClientRect();
            const mx = (e.clientX - rect.left - this.panX) / this.zoom;
            const my = (e.clientY - rect.top - this.panY) / this.zoom;

            // Snap to the closest compatible socket within the snap radius.
            // When snapping, the ghost wire's free end becomes the target
            // socket's center instead of the cursor — so the wire visibly
            // "locks on" to the target.
            const snap = this.findSnapTarget(e.clientX, e.clientY, active);
            this.setSnapHighlight(snap?.el);
            active.snap = snap;
            const tx = snap ? snap.pos.x : mx;
            const ty = snap ? snap.pos.y : my;

            if (active.direction === "out") {
                const a = this.socketPos(active.fromNode.id, active.fromSocketId);
                const dx = Math.max(60, Math.abs(tx - a.x) * 0.4);
                const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${tx - dx} ${ty}, ${tx} ${ty}`;
                active.ghost.setAttribute("d", d);
            } else {
                const b = this.socketPos(active.toNode.id, active.toSocketId);
                const dx = Math.max(60, Math.abs(b.x - tx) * 0.4);
                const d = `M ${tx} ${ty} C ${tx + dx} ${ty}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
                active.ghost.setAttribute("d", d);
            }
        };

        const onMouseUp = async (e) => {
            if (!active) return;
            const ghost = active.ghost;
            const drag = active;
            active = null;
            if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
            this.setSnapHighlight(null);

            // Snap target wins over hit-testing — if the user was within
            // the snap radius of a compatible socket, drop there.
            if (drag.snap) {
                const snapNode = this.nodes.find(n => n.id === drag.snap.nodeId);
                if (snapNode) {
                    if (drag.direction === "out") {
                        await this.applyConnection(drag.fromNode, snapNode, drag.fromSocketId, drag.snap.socketId);
                    } else {
                        await this.applyConnection(snapNode, drag.toNode, "out", drag.toSocketId);
                    }
                    return;
                }
            }

            const target = document.elementFromPoint(e.clientX, e.clientY);

            if (drag.direction === "out") {
                // Forward drag without a snap: hit-test for an input socket
                // directly under the cursor.
                const socket = target?.closest(".pr-graph-socket-in");
                if (socket) {
                    const nodeEl = socket.closest(".pr-graph-node");
                    if (!nodeEl) return;
                    const toNode = this.nodes.find(n => n.id === nodeEl.dataset.nodeId);
                    if (!toNode) return;
                    const toSocketId = socket.dataset.socketId;
                    if (!this.canConnect(drag.fromNode, toNode, toSocketId)) {
                        new Notice(`Can't connect ${drag.fromNode.kind} → ${toSocketId}`);
                        return;
                    }
                    await this.applyConnection(drag.fromNode, toNode, drag.fromSocketId, toSocketId);
                    return;
                }
                // Dropped on empty canvas — offer to create a Show-output
                // probe here and wire it up in one shot. This is the fastest
                // way to answer "what is this output actually producing?".
                const onCanvas = target?.closest(".pr-graph-canvas");
                if (onCanvas) {
                    this.openOutputDragMenu(e, drag.fromNode, drag.fromSocketId);
                }
                return;
            }

            // Reverse drag fallback (no snap): try the hit-test, then
            // fall back to disconnect (rewire) or create-source menu (fresh).
            const dropOnNodeEl = target?.closest(".pr-graph-node");
            if (dropOnNodeEl) {
                const fromNode = this.nodes.find(n => n.id === dropOnNodeEl.dataset.nodeId);
                if (fromNode && this.canConnect(fromNode, drag.toNode, drag.toSocketId)) {
                    await this.applyConnection(fromNode, drag.toNode, "out", drag.toSocketId);
                    return;
                }
            }
            if (drag.isRewire) {
                this.render();
                return;
            }
            this.openInputDragMenu(e, drag.toNode, drag.toSocketId);
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

    // Menu opened when the user drags FROM an output socket and releases on
    // empty canvas. Offers to create a Show-output probe at the drop point
    // and wire it up in a single gesture — the fastest path to "what is
    // this output producing?".
    openOutputDragMenu(e, fromNode, fromSocketId) {
        const rect = this.canvasEl.getBoundingClientRect();
        const vx = (e.clientX - rect.left - this.panX) / this.zoom;
        const vy = (e.clientY - rect.top - this.panY) / this.zoom;

        this.showFloatingMenu(e.clientX, e.clientY, [
            { label: `From: ${fromNode.title}`, onClick: null },
            "separator",
            {
                label: "Add Show output here",
                onClick: async () => {
                    if (!Array.isArray(this.plugin.settings.prShowNodes)) {
                        this.plugin.settings.prShowNodes = [];
                    }
                    const sh = makePRShowNode();
                    sh.sourceNodeId = fromNode.id;
                    this.plugin.settings.prShowNodes.push(sh);
                    if (!this.plugin.settings.prGraphLayout) this.plugin.settings.prGraphLayout = {};
                    this.plugin.settings.prGraphLayout[`show-${sh.id}`] = { x: vx, y: vy };
                    await this.plugin.saveSettings();
                    this.render();
                },
            },
        ]);
    }

    // Menu opened when the user drags FROM an empty container input socket
    // and releases on empty canvas. Lists compatible source options for the
    // socket type — picking one creates the source node + wires it to the
    // input. The new source node is positioned at the drop point.
    openInputDragMenu(e, toNode, toSocketId) {
        const rect = this.canvasEl.getBoundingClientRect();
        const vx = (e.clientX - rect.left - this.panX) / this.zoom;
        const vy = (e.clientY - rect.top - this.panY) / this.zoom;
        const seedPosition = (id) => {
            if (!this.plugin.settings.prGraphLayout) this.plugin.settings.prGraphLayout = {};
            const cur = this.plugin.settings.prGraphLayout[id] || {};
            cur.x = vx; cur.y = vy;
            this.plugin.settings.prGraphLayout[id] = cur;
        };

        const items = [];
        const headerLabel = ({
            "in-data":       "Add data source",
            "in-boundary":   "Add boundary",
            "in-llm":        "Add LLM service",
            "in-reflection": "Add reflection",
            "in-alignment":  "Add alignment",
        })[toSocketId] || "Add source";
        items.push({ label: headerLabel, onClick: null });
        items.push("separator");

        const wireUp = async () => {
            await this.plugin.saveSettings();
            this.render();
        };

        if (toSocketId === "in-data") {
            const addSource = (newSource) => {
                const sources = getContainerDataSources(toNode.primitive);
                const key = dataSourceKey(newSource);
                if (!sources.some(s => dataSourceKey(s) === key)) sources.push(newSource);
                toNode.primitive.dataSource = { sources };
            };
            items.push({
                label: "Daily notes",
                onClick: async () => {
                    addSource({ type: "daily" });
                    await wireUp();
                },
            });
            items.push({
                label: "+ New container",
                onClick: async () => {
                    const c = makePRContainer({ name: "New container" });
                    this.plugin.settings.prContainers.push(c);
                    seedPosition(`container-${c.id}`);
                    addSource({ type: "container", containerId: c.id });
                    await wireUp();
                },
            });
            // Existing containers we could pull from
            const others = (this.plugin.settings.prContainers || []).filter(c => c.id !== toNode.primitive.id);
            if (others.length > 0) {
                items.push("separator");
                items.push({ label: "Existing containers", onClick: null });
                for (const c of others) {
                    items.push({
                        label: c.name || "(unnamed)",
                        onClick: async () => {
                            addSource({ type: "container", containerId: c.id });
                            await wireUp();
                        },
                    });
                }
            }
        } else if (toSocketId === "in-boundary") {
            for (const det of this.plugin.getPRAvailableBoundaryDetectors()) {
                items.push({
                    label: det.label,
                    onClick: async () => {
                        toNode.primitive.boundaryDetector = det.id;
                        await wireUp();
                    },
                });
            }
            items.push("separator");
            items.push({
                label: "+ New custom boundary",
                onClick: async () => {
                    const cb = makePRCustomBoundary();
                    this.plugin.settings.prCustomBoundaries.push(cb);
                    seedPosition(`boundary-custom-${cb.id}`);
                    toNode.primitive.boundaryDetector = `custom:${cb.id}`;
                    await wireUp();
                },
            });
        } else if (toSocketId === "in-llm") {
            const services = this.plugin.settings.prLLMServices || [];
            for (const svc of services) {
                items.push({
                    label: svc.name || "(unnamed)",
                    onClick: async () => {
                        toNode.primitive.llmServiceId = svc.id;
                        await wireUp();
                    },
                });
            }
            if (services.length > 0) items.push("separator");
            items.push({
                label: "+ New LLM service",
                onClick: async () => {
                    const svc = makePRLLMService();
                    this.plugin.settings.prLLMServices.push(svc);
                    seedPosition(`llm-${svc.id}`);
                    toNode.primitive.llmServiceId = svc.id;
                    await wireUp();
                },
            });
        } else if (toSocketId === "in-reflection") {
            const reflections = this.plugin.settings.prReflections || [];
            for (const r of reflections) {
                items.push({
                    label: r.name || "(unnamed)",
                    onClick: async () => {
                        toNode.primitive.reflectionId = r.id;
                        await wireUp();
                    },
                });
            }
            if (reflections.length > 0) items.push("separator");
            items.push({
                label: "+ New reflection",
                onClick: async () => {
                    const r = makePRReflection();
                    this.plugin.settings.prReflections.push(r);
                    seedPosition(`reflection-${r.id}`);
                    toNode.primitive.reflectionId = r.id;
                    await wireUp();
                },
            });
        } else if (toSocketId === "in-alignment") {
            const alignments = this.plugin.settings.prAlignments || [];
            const unattached = alignments.filter(a => !a.containerId);
            for (const a of unattached) {
                items.push({
                    label: a.name || "(unnamed)",
                    onClick: async () => {
                        a.containerId = toNode.primitive.id;
                        await wireUp();
                    },
                });
            }
            if (unattached.length > 0) items.push("separator");
            items.push({
                label: "+ New alignment",
                onClick: async () => {
                    const a = makePRAlignment();
                    a.containerId = toNode.primitive.id;
                    this.plugin.settings.prAlignments.push(a);
                    seedPosition(`alignment-${a.id}`);
                    await wireUp();
                },
            });
        }

        this.showFloatingMenu(e.clientX, e.clientY, items);
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

    // Synchronous "detach" used by the rewire flow. Same logic as deleteWire
    // for the underlying field, but skips the saveSettings + render and
    // instead pops the wire out of this.wires + redraws just the SVG layer
    // so the visual wire disappears immediately while the drag begins.
    // saveSettings is fired in the background by the caller.
    applyDetachInPlace(wire) {
        const containers = this.plugin.settings.prContainers || [];
        const target = containers.find(c => `container-${c.id}` === wire.to);

        // Show-output probe wire: clear sourceNodeId on the show primitive.
        if (wire.kind === "show") {
            const sh = (this.plugin.settings.prShowNodes || []).find(s => `show-${s.id}` === wire.to);
            if (sh) sh.sourceNodeId = "";
            this.wires = this.wires.filter(w => w !== wire);
            this.renderWires();
            return true;
        }

        // Wires landing on an alignment-group's inputs
        if (wire.to && wire.to.startsWith("alignmentgroup-")) {
            const group = (this.plugin.settings.prAlignmentGroups || []).find(g => `alignmentgroup-${g.id}` === wire.to);
            if (group) {
                if (wire.toSocket === "in-source") { group.sourceKind = ""; group.sourceId = ""; }
                else if (wire.toSocket === "in-llm") { group.llmServiceId = ""; }
            }
            this.wires = this.wires.filter(w => w !== wire);
            this.renderWires();
            return true;
        }

        switch (wire.kind) {
            case "data-source":
                // Multi-source: remove just the one source this wire
                // represents. If that leaves the list empty, default back
                // to daily.
                if (target) {
                    const sources = getContainerDataSources(target);
                    let removeKey;
                    if (wire.from === "daily") removeKey = "daily";
                    else if (wire.from.startsWith("container-")) {
                        removeKey = `container:${wire.from.replace(/^container-/, "")}`;
                    } else if (wire.from.startsWith("datasource-")) {
                        removeKey = `dataSource:${wire.from.replace(/^datasource-/, "")}`;
                    }
                    const filtered = sources.filter(s => dataSourceKey(s) !== removeKey);
                    target.dataSource = { sources: filtered };
                }
                break;
            case "boundary":
                // Boundary detaches are blocked at mousedown, but defensive.
                return false;
            case "llm":
                if (target) target.llmServiceId = "";
                break;
            case "reflection":
                if (target) target.reflectionId = "";
                break;
            case "alignment":
                {
                    if (wire.from.startsWith("alignmentgroup-")) {
                        const groupId = wire.from.replace(/^alignmentgroup-/, "");
                        const g = (this.plugin.settings.prAlignmentGroups || []).find(x => x.id === groupId);
                        if (g) g.containerId = "";
                    } else {
                        const alignmentId = wire.from.replace(/^alignment-/, "");
                        const al = (this.plugin.settings.prAlignments || []).find(a => a.id === alignmentId);
                        if (al) al.containerId = "";
                    }
                }
                break;
        }
        // Pop the wire out of the model and redraw just the wires
        this.wires = this.wires.filter(w => w !== wire);
        this.renderWires();
        return true;
    }

    // Clear the relationship that this wire represents.
    async deleteWire(wire) {
        const containers = this.plugin.settings.prContainers || [];
        const targetContainerId = wire.to.replace(/^container-/, "");
        const target = containers.find(c => c.id === targetContainerId);

        // Show-output probe wire: clear sourceNodeId on the show primitive.
        if (wire.kind === "show") {
            const sh = (this.plugin.settings.prShowNodes || []).find(s => `show-${s.id}` === wire.to);
            if (sh) sh.sourceNodeId = "";
            await this.plugin.saveSettings();
            this.render();
            return;
        }

        // Wires landing on an alignment-group's inputs (not on a container)
        if (wire.to && wire.to.startsWith("alignmentgroup-")) {
            const group = (this.plugin.settings.prAlignmentGroups || []).find(g => `alignmentgroup-${g.id}` === wire.to);
            if (group) {
                if (wire.toSocket === "in-source") { group.sourceKind = ""; group.sourceId = ""; }
                else if (wire.toSocket === "in-llm") { group.llmServiceId = ""; }
            }
            await this.plugin.saveSettings();
            this.render();
            return;
        }

        switch (wire.kind) {
            case "data-source":
                if (target) {
                    // Multi-source: remove just the one source.
                    const sources = getContainerDataSources(target);
                    let removeKey;
                    if (wire.from === "daily") removeKey = "daily";
                    else if (wire.from.startsWith("container-")) {
                        removeKey = `container:${wire.from.replace(/^container-/, "")}`;
                    }
                    const filtered = sources.filter(s => dataSourceKey(s) !== removeKey);
                    target.dataSource = { sources: filtered };
                }
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
                    if (wire.from.startsWith("alignmentgroup-")) {
                        const groupId = wire.from.replace(/^alignmentgroup-/, "");
                        const g = (this.plugin.settings.prAlignmentGroups || []).find(x => x.id === groupId);
                        if (g) g.containerId = "";
                    } else {
                        const alignmentId = wire.from.replace(/^alignment-/, "");
                        const al = (this.plugin.settings.prAlignments || []).find(a => a.id === alignmentId);
                        if (al) al.containerId = "";
                    }
                }
                break;
        }
        await this.plugin.saveSettings();
        this.render();
    }

    // ─── Click to edit ───
    //
    // Double-clicking a node opens Obsidian's settings modal, switches the
    // outer tab to the one that owns the primitive, AND scrolls to the
    // specific card with a brief flash highlight so the user lands exactly
    // on the thing they clicked.
    //
    // Uses this.plugin.settingTab — captured at addSettingTab time — as the
    // direct reference to our settings tab instance instead of fishing
    // through Obsidian's internal lists.
    onNodeClick(node) {
        if (!node || !node.primitiveTab) {
            // Daily / built-in boundary nodes have no primitive to edit
            return;
        }
        const ourTab = this.plugin.settingTab;
        if (!ourTab || typeof ourTab.display !== "function") {
            new Notice("Could not access Periodic Ritual settings tab");
            return;
        }
        const setting = this.app.setting;
        if (!setting) {
            new Notice("Could not open settings — Obsidian setting API missing");
            return;
        }

        // Set the outer tab BEFORE openTabById, so when openTabById
        // triggers our display() the right outer tab is already active.
        ourTab.outerTab = node.primitiveTab;

        try {
            setting.open();
            setting.openTabById("monthly-ritual");
        } catch (e) {
            console.error("Periodic Ritual: failed to open settings", e);
            return;
        }

        // Defensive: re-call display() in case Obsidian's openTabById
        // didn't re-render with our new outerTab. Then scroll to the card.
        setTimeout(() => {
            try {
                ourTab.display();
            } catch (e) { /* ignore */ }
            const targetId = node.primitive?.id;
            if (!targetId) return;
            setTimeout(() => {
                const card = ourTab.containerEl.querySelector(`[data-pr-card-id="${targetId}"]`);
                if (!card) return;
                card.scrollIntoView({ behavior: "smooth", block: "center" });
                card.classList.add("pr-card-flash");
                setTimeout(() => card.classList.remove("pr-card-flash"), 1500);
            }, 50);
        }, 50);
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

        // Drag to pan — only when starting on empty canvas (not on a node).
        // Holding Ctrl/Cmd starts a marquee selection instead.
        let panning = false;
        let panStartX = 0;
        let panStartY = 0;
        let panOriginX = 0;
        let panOriginY = 0;

        // Marquee selection state
        let marquee = null;  // { startX, startY, el }

        canvas.addEventListener("mousedown", (e) => {
            // If the target is a node or inside one, let node-drag handle it
            if (e.target.closest(".pr-graph-node")) return;
            if (e.button !== 0 && e.button !== 1) return;

            // Ctrl/Cmd + drag on empty canvas → marquee selection
            if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
                const rect = canvas.getBoundingClientRect();
                const startX = e.clientX - rect.left;
                const startY = e.clientY - rect.top;
                const marqueeEl = canvas.createEl("div", { cls: "pr-graph-marquee" });
                marqueeEl.style.left = `${startX}px`;
                marqueeEl.style.top = `${startY}px`;
                marqueeEl.style.width = "0px";
                marqueeEl.style.height = "0px";
                marquee = { startX, startY, el: marqueeEl };
                e.preventDefault();
                return;
            }

            // Plain drag → pan. Also clears any active selection.
            panning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panOriginX = this.panX;
            panOriginY = this.panY;
            canvas.style.cursor = "grabbing";
            if (this.selection.size > 0) {
                this.selection.clear();
                this.render();
            }
            e.preventDefault();
        });

        const onMouseMove = (e) => {
            if (marquee) {
                const rect = canvas.getBoundingClientRect();
                const curX = e.clientX - rect.left;
                const curY = e.clientY - rect.top;
                const x = Math.min(marquee.startX, curX);
                const y = Math.min(marquee.startY, curY);
                const w = Math.abs(curX - marquee.startX);
                const h = Math.abs(curY - marquee.startY);
                marquee.el.style.left = `${x}px`;
                marquee.el.style.top = `${y}px`;
                marquee.el.style.width = `${w}px`;
                marquee.el.style.height = `${h}px`;
                return;
            }
            if (!panning) return;
            this.panX = panOriginX + (e.clientX - panStartX);
            this.panY = panOriginY + (e.clientY - panStartY);
            this.applyTransform();
        };

        const onMouseUp = (e) => {
            if (marquee) {
                // Compute selection: convert the screen-space rectangle to
                // viewport coordinates and intersect with each node's bbox.
                const rect = canvas.getBoundingClientRect();
                const curX = e.clientX - rect.left;
                const curY = e.clientY - rect.top;
                const x1 = Math.min(marquee.startX, curX);
                const y1 = Math.min(marquee.startY, curY);
                const x2 = Math.max(marquee.startX, curX);
                const y2 = Math.max(marquee.startY, curY);
                // Convert to viewport coords
                const vx1 = (x1 - this.panX) / this.zoom;
                const vy1 = (y1 - this.panY) / this.zoom;
                const vx2 = (x2 - this.panX) / this.zoom;
                const vy2 = (y2 - this.panY) / this.zoom;

                const newSel = new Set();
                for (const n of this.nodes) {
                    if (!n.el) continue;
                    const nw = n.el.offsetWidth;
                    const nh = n.el.offsetHeight;
                    const nx1 = n.x;
                    const ny1 = n.y;
                    const nx2 = n.x + nw;
                    const ny2 = n.y + nh;
                    const intersects = nx1 < vx2 && nx2 > vx1 && ny1 < vy2 && ny2 > vy1;
                    if (intersects) newSel.add(n.id);
                }
                this.selection = newSel;
                marquee.el.remove();
                marquee = null;
                this.render();
                return;
            }
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

    // Bottom-right resize grip on each node. Mousedown starts a resize
    // drag that updates the node's width/height live, persisting them into
    // prGraphLayout[id].w/h on mouseup. Double-click clears the override.
    setupNodeResize() {
        if (!this.viewportEl) return;
        const MIN_W = 180;
        const MIN_H = 120;
        let active = null;

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            const grip = e.target.closest(".pr-graph-node-resize");
            if (!grip) return;
            const nodeEl = grip.closest(".pr-graph-node");
            if (!nodeEl) return;
            const node = this.nodes.find(n => n.id === nodeEl.dataset.nodeId);
            if (!node) return;
            e.preventDefault();
            e.stopPropagation();

            const rect = nodeEl.getBoundingClientRect();
            active = {
                node,
                nodeEl,
                startMouseX: e.clientX,
                startMouseY: e.clientY,
                startW: rect.width / this.zoom,
                startH: rect.height / this.zoom,
            };
            nodeEl.classList.add("pr-graph-node-sized", "pr-graph-node-resizing");
        };

        const onMouseMove = (e) => {
            if (!active) return;
            const dx = (e.clientX - active.startMouseX) / this.zoom;
            const dy = (e.clientY - active.startMouseY) / this.zoom;
            const w = Math.max(MIN_W, Math.round(active.startW + dx));
            const h = Math.max(MIN_H, Math.round(active.startH + dy));
            active.nodeEl.style.width = `${w}px`;
            active.nodeEl.style.height = `${h}px`;
            // Keep wires attached to this node while it resizes. The out
            // socket's position changes with the width.
            this.renderWires();
        };

        const onMouseUp = async () => {
            if (!active) return;
            const { node, nodeEl } = active;
            const w = parseFloat(nodeEl.style.width);
            const h = parseFloat(nodeEl.style.height);
            nodeEl.classList.remove("pr-graph-node-resizing");
            if (!this.plugin.settings.prGraphLayout) this.plugin.settings.prGraphLayout = {};
            const cur = this.plugin.settings.prGraphLayout[node.id] || {};
            // Save to the slot matching the current state. Collapsed and
            // expanded get distinct sizes so chevron toggle swaps between
            // two clearly different views.
            const stateKey = this.isNodeExpanded(node) ? "expanded" : "collapsed";
            cur[stateKey] = { w, h };
            if (typeof cur.x !== "number") cur.x = node.x;
            if (typeof cur.y !== "number") cur.y = node.y;
            this.plugin.settings.prGraphLayout[node.id] = cur;
            active = null;
            await this.plugin.saveSettings();
            this.renderWires();
        };

        const onDblClick = async (e) => {
            const grip = e.target.closest(".pr-graph-node-resize");
            if (!grip) return;
            const nodeEl = grip.closest(".pr-graph-node");
            if (!nodeEl) return;
            const node = this.nodes.find(n => n.id === nodeEl.dataset.nodeId);
            if (!node) return;
            e.preventDefault();
            e.stopPropagation();
            const layout = this.plugin.settings.prGraphLayout?.[node.id];
            if (layout) {
                // Reset only the current state's saved size; leave the
                // other state's override alone.
                const stateKey = this.isNodeExpanded(node) ? "expanded" : "collapsed";
                delete layout[stateKey];
                // Clean up any legacy top-level w/h from before per-state
                // sizing, so they can't leak back in.
                delete layout.w;
                delete layout.h;
                await this.plugin.saveSettings();
            }
            this.render();
        };

        this.viewportEl.addEventListener("mousedown", onMouseDown);
        this.viewportEl.addEventListener("dblclick", onDblClick);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        this._nodeResizeCleanup = () => {
            this.viewportEl?.removeEventListener("mousedown", onMouseDown);
            this.viewportEl?.removeEventListener("dblclick", onDblClick);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }

    setupNodeDrag() {
        if (!this.viewportEl) return;
        const viewport = this.viewportEl;

        // Single-node fields (legacy single-drag)
        let dragging = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragStartNodeX = 0;
        let dragStartNodeY = 0;
        let moved = false;
        let lastMouseDownEvent = null;

        // Group-drag state when the user grabs a selected node — every
        // selected node moves by the same delta.
        let groupStarts = null;  // Map<nodeId, {x, y}> snapshot at mousedown

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            if (e.target.closest(".pr-graph-socket")) return;
            if (e.target.closest(".pr-graph-node-resize")) return;  // resize owns this
            const nodeEl = e.target.closest(".pr-graph-node");
            if (!nodeEl) return;

            const id = nodeEl.dataset.nodeId;
            const node = this.nodes.find(n => n.id === id);
            if (!node) return;

            // Ctrl/Cmd + click on a node → toggle its membership in the
            // selection set, no drag.
            if (e.ctrlKey || e.metaKey) {
                if (this.selection.has(id)) this.selection.delete(id);
                else this.selection.add(id);
                this.render();
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // If the clicked node is part of an existing selection, drag
            // the whole group together. Otherwise clear the selection and
            // start a single-node drag.
            if (this.selection.has(id) && this.selection.size > 1) {
                groupStarts = new Map();
                for (const sid of this.selection) {
                    const n = this.nodes.find(n => n.id === sid);
                    if (n) groupStarts.set(sid, { x: n.x, y: n.y });
                }
            } else {
                if (this.selection.size > 0) {
                    this.selection.clear();
                    // Defer the render to after we set dragging so the new
                    // single-node drag still works
                    requestAnimationFrame(() => this.render());
                }
                groupStarts = null;
            }

            dragging = node;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragStartNodeX = node.x;
            dragStartNodeY = node.y;
            moved = false;
            lastMouseDownEvent = e;
            nodeEl.style.zIndex = "10";
            e.preventDefault();
            e.stopPropagation();
        };

        const onMouseMove = (e) => {
            if (!dragging) return;
            const dx = (e.clientX - dragStartX) / this.zoom;
            const dy = (e.clientY - dragStartY) / this.zoom;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;

            if (groupStarts) {
                // Move every selected node by the same delta
                for (const [sid, start] of groupStarts) {
                    const n = this.nodes.find(n => n.id === sid);
                    if (!n || !n.el) continue;
                    n.x = start.x + dx;
                    n.y = start.y + dy;
                    n.el.style.left = `${n.x}px`;
                    n.el.style.top = `${n.y}px`;
                }
            } else {
                // Single-node drag — apply delta to remembered start.
                dragging.x = dragStartNodeX + dx;
                dragging.y = dragStartNodeY + dy;
                dragging.el.style.left = `${dragging.x}px`;
                dragging.el.style.top = `${dragging.y}px`;
            }
            this.renderWires();
        };

        const onMouseUp = async (e) => {
            if (!dragging) return;
            const node = dragging;
            dragging = null;
            node.el.style.zIndex = "";
            if (moved) {
                if (!this.plugin.settings.prGraphLayout) this.plugin.settings.prGraphLayout = {};
                if (groupStarts) {
                    // Persist every moved node's new position
                    for (const sid of groupStarts.keys()) {
                        const n = this.nodes.find(n => n.id === sid);
                        if (!n) continue;
                        const cur = this.plugin.settings.prGraphLayout[sid] || {};
                        cur.x = n.x;
                        cur.y = n.y;
                        this.plugin.settings.prGraphLayout[sid] = cur;
                    }
                } else {
                    const cur = this.plugin.settings.prGraphLayout[node.id] || {};
                    cur.x = node.x;
                    cur.y = node.y;
                    this.plugin.settings.prGraphLayout[node.id] = cur;
                }
                await this.plugin.saveSettings();
            }
            // Single click on a node:
            //   1. Select it (clear previous selection unless Ctrl held).
            //      This makes Delete/Backspace work immediately after click.
            //   2. Toggle expand/collapse (deferred 250ms so a double click
            //      can cancel and open settings instead).
            if (!moved) {
                // Selection — standard editor behavior: click = solo select,
                // Ctrl+click = toggle multi-select.
                if (node && this.nodeIsPrimitive(node)) {
                    if (lastMouseDownEvent && (lastMouseDownEvent.ctrlKey || lastMouseDownEvent.metaKey)) {
                        if (this.selection.has(node.id)) this.selection.delete(node.id);
                        else this.selection.add(node.id);
                    } else {
                        this.selection.clear();
                        this.selection.add(node.id);
                    }
                    for (const n of this.nodes) {
                        if (n.el) n.el.classList.toggle("pr-graph-node-selected", this.selection.has(n.id));
                    }
                }

                // Skip expand/collapse when the click landed on an
                // interactive element (toggle, input, button, select,
                // textarea, label wrapping a toggle). These should handle
                // their own events without triggering a layout change.
                const clickTarget = lastMouseDownEvent?.target;
                const isInteractive = clickTarget && (
                    clickTarget.closest("input") ||
                    clickTarget.closest("select") ||
                    clickTarget.closest("textarea") ||
                    clickTarget.closest("button") ||
                    clickTarget.closest(".pr-graph-widget-toggle") ||
                    clickTarget.closest(".pr-graph-form-select") ||
                    clickTarget.closest(".pr-graph-form-text") ||
                    clickTarget.closest(".pr-graph-form-textarea") ||
                    clickTarget.closest(".pr-graph-form-button") ||
                    clickTarget.closest(".pr-graph-form-picker-buttons") ||
                    clickTarget.closest(".pr-graph-node-resize")
                );

                if (!isInteractive) {
                    if (this._pendingNodeTap) clearTimeout(this._pendingNodeTap);
                    const clickedNode = node;
                    this._pendingNodeTap = setTimeout(async () => {
                        this._pendingNodeTap = null;
                        if (!this.nodeIsPrimitive(clickedNode)) return;
                        await this.setNodeExpanded(clickedNode, !this.isNodeExpanded(clickedNode));
                        this.render();
                    }, 250);
                }
            }
            lastMouseDownEvent = null;
            groupStarts = null;
        };

        // Click on empty canvas (not on a node) → clear selection so
        // Delete/Backspace doesn't accidentally fire on a stale selection.
        viewport.addEventListener("click", (e) => {
            if (e.target.closest(".pr-graph-node")) return;
            if (this.selection.size > 0) {
                this.selection.clear();
                for (const n of this.nodes) {
                    if (n.el) n.el.classList.remove("pr-graph-node-selected");
                }
            }
        });

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
        if (this._nodeResizeCleanup) this._nodeResizeCleanup();
        if (this._wireDragCleanup) this._wireDragCleanup();
        if (this._wireClickCleanup) this._wireClickCleanup();
        if (this._ctxMenuCleanup) this._ctxMenuCleanup();
        if (this._dblClickCleanup) this._dblClickCleanup();
        if (this._keyboardCleanup) this._keyboardCleanup();
        if (this._pendingNodeTap) {
            clearTimeout(this._pendingNodeTap);
            this._pendingNodeTap = null;
        }
        // Close any leftover floating menu
        const menu = document.querySelector(".pr-graph-ctx-menu");
        if (menu) menu.remove();
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
        this.outerTab = "general";
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
            { id: "general",    label: "General" },
            { id: "containers", label: "Containers" },
            { id: "boundaries", label: "Boundaries" },
            { id: "reflection", label: "Reflection" },
            { id: "alignments", label: "Alignment" },
            { id: "llm",        label: "LLM" },
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
            case "general":     this.displayGeneral(body); break;
            case "containers":  this.displayContainersStub(body); break;
            case "boundaries":  this.displayBoundaries(body); break;
            case "reflection":  this.displayReflections(body); break;
            case "alignments":  this.displayAlignmentsStub(body); break;
            case "llm":         this.displayLLMStub(body); break;
            default:            this.displayGeneral(body); break;
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
        card.dataset.prCardId = container.id;

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

        // ── Write-back at ──
        new Setting(card)
            .setName("Run LLM at")
            .setDesc("When the main LLM aggregation fires. 'Generate' = only at note creation. 'Write-back' = only at write-back. 'Both' = at both passes.")
            .addDropdown(dd => {
                dd.addOption("both", "Both passes");
                dd.addOption("generate", "Generate only");
                dd.addOption("writeback", "Write-back only");
                dd.setValue(container.runLLMAt || "both");
                dd.onChange(async v => {
                    container.runLLMAt = v;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(card)
            .setName("Write back at")
            .setDesc("Run alignments + LLM on the EXISTING note at a second boundary point. Use this when the note is created at the start of a period but you want the LLM aggregation to run at the end (when all daily data exists). Leave as 'None' for single-pass containers.")
            .addDropdown(dd => {
                dd.addOption("", "None (single pass)");
                dd.addOption("end", "End of period");
                dd.addOption("start", "Start of next period");
                dd.setValue(container.writeBackAt || "");
                dd.onChange(async v => {
                    container.writeBackAt = v;
                    await this.plugin.saveSettings();
                });
            });

        // ── Data sources (multi-source) ──
        // What the auto-LLM aggregation reads from. Default: daily notes.
        // Multiple sources can be combined — the LLM reads everything
        // merged into one user message. Enables roll-up chains and lateral
        // joins (e.g., daily + a sibling container in the same period).
        const sourceList = getContainerDataSources(container);
        const sourcesHeader = new Setting(card)
            .setName("Data sources")
            .setDesc("What this container's auto-LLM reads from. Add as many as you need — files are merged and deduped before going to the LLM.");
        const sourcesWrap = card.createDiv();
        sourcesWrap.style.cssText = "padding-left: 16px; margin-bottom: 8px;";
        for (let i = 0; i < sourceList.length; i++) {
            const source = sourceList[i];
            const row = sourcesWrap.createDiv();
            row.style.cssText = "display: flex; gap: 6px; align-items: center; margin-bottom: 4px;";
            const sel = row.createEl("select");
            sel.style.cssText = "flex: 1;";
            const dailyOpt = sel.createEl("option", { value: "daily", text: "Daily notes" });
            for (const other of (s.prContainers || [])) {
                if (other.id === container.id) continue;
                sel.createEl("option", { value: `container:${other.id}`, text: other.name || "(unnamed)" });
            }
            sel.value = dataSourceKey(source);
            sel.addEventListener("change", async () => {
                const sources = getContainerDataSources(container);
                const v = sel.value;
                if (v === "daily") sources[i] = { type: "daily" };
                else if (v.startsWith("container:")) sources[i] = { type: "container", containerId: v.slice("container:".length) };
                container.dataSource = { sources };
                await this.plugin.saveSettings();
                this.display();
            });
            const removeBtn = row.createEl("button", { text: "×" });
            removeBtn.style.cssText = "background: var(--interactive-normal); border: none; border-radius: 3px; width: 24px; cursor: pointer;";
            removeBtn.addEventListener("click", async () => {
                const sources = getContainerDataSources(container);
                sources.splice(i, 1);
                container.dataSource = { sources };
                await this.plugin.saveSettings();
                this.display();
            });
        }
        const addRow = sourcesWrap.createDiv();
        addRow.style.cssText = "margin-top: 4px;";
        const addBtn = addRow.createEl("button", { text: "+ Add source" });
        addBtn.style.cssText = "background: var(--interactive-normal); border: none; border-radius: 3px; padding: 4px 10px; cursor: pointer; font-size: 0.85em;";
        addBtn.addEventListener("click", async () => {
            const sources = getContainerDataSources(container);
            sources.push({ type: "daily" });
            container.dataSource = { sources };
            await this.plugin.saveSettings();
            this.display();
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

        // Use system prompt toggle (local override, respects global master)
        new Setting(card)
            .setName("Use system prompt")
            .setDesc("Send the system prompt above when this container runs its LLM call. When off, this container runs with an empty system role. Respects the global master in General — global off means system prompts are disabled regardless.")
            .addToggle(t => t
                .setValue(container.useSystemPrompt !== false)
                .onChange(async v => {
                    container.useSystemPrompt = v;
                    await this.plugin.saveSettings();
                }));

        // Framework reinforcement — markdown file picker. The file's contents
        // get injected into the user message at the highest-attention slot
        // (right before the YAML output instructions) when this container
        // runs. Respects the global Frameworks master in General.
        new Setting(card)
            .setName("Framework")
            .setDesc(container.framework || "None selected — the framework injection is skipped when empty.")
            .addButton(btn => {
                btn.setButtonText(container.framework ? "Change" : "Choose").onClick(() => {
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        container.framework = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    container.framework = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(card)
            .setName("Use framework")
            .setDesc("Inject the framework file above when this container runs its LLM call. Off = skip even if a file is picked. Respects the global master in General.")
            .addToggle(t => t
                .setValue(container.useFramework !== false)
                .onChange(async v => {
                    container.useFramework = v;
                    await this.plugin.saveSettings();
                }));

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
        card.dataset.prCardId = reflection.id;

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

        // Include alignment context
        new Setting(body)
            .setName("Include alignment outputs in LLM context")
            .setDesc("When on, alignments attached to the container fire BEFORE the reflection LLM call (instead of after) and a dedicated \"# Alignment outputs\" section is added to the LLM user message. Lets the reflection synthesize alignment measurements alongside the daily payload and your answers.")
            .addToggle(t => t
                .setValue(!!reflection.includeAlignmentContext)
                .onChange(async v => {
                    reflection.includeAlignmentContext = v;
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
                            dd.addOption("current", "Current note (last boundary crossed)");
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
                    const allContainersOut = s.prContainers || [];
                    new Setting(panel)
                        .setName("Target")
                        .addDropdown(dd => {
                            dd.addOption("current", "Current note (active container)");
                            dd.addOption("previous-period", "Previous period of THIS container");
                            dd.addOption("note", "A specific note");
                            dd.addOption("container-current", "Current note of ANOTHER container");
                            dd.addOption("container-previous", "Previous note of ANOTHER container");
                            dd.setValue(q.outputTarget || "current");
                            dd.onChange(async v => {
                                q.outputTarget = v;
                                await this.plugin.saveSettings();
                                this.display();
                            });
                        });

                    const tgt = q.outputTarget || "current";
                    if (tgt === "note") {
                        new Setting(panel)
                            .setName("Target note")
                            .setDesc(q.outputNotePath || "None selected")
                            .addButton(btn => {
                                btn.setButtonText(q.outputNotePath ? "Change" : "Choose").onClick(() => {
                                    new MarkdownFileSuggestModal(this.app, async (file) => {
                                        q.outputNotePath = file.path;
                                        await this.plugin.saveSettings();
                                        this.display();
                                    }).open();
                                });
                            });
                    } else if (tgt === "container-current" || tgt === "container-previous") {
                        new Setting(panel)
                            .setName("Target container")
                            .setDesc(allContainersOut.length === 0 ? "No containers defined yet" : "Which container to write to")
                            .addDropdown(dd => {
                                dd.addOption("", "— Pick one —");
                                for (const c of allContainersOut) dd.addOption(c.id, c.name || "(unnamed)");
                                dd.setValue(q.outputTargetContainerId || "");
                                dd.onChange(async v => {
                                    q.outputTargetContainerId = v;
                                    await this.plugin.saveSettings();
                                });
                            });
                    }

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
        if (!Array.isArray(s.prAlignmentGroups)) s.prAlignmentGroups = [];

        containerEl.createEl("h2", { text: "Alignment" });
        const intro = containerEl.createEl("p");
        intro.style.cssText = "color: var(--text-muted); max-width: 60ch;";
        intro.setText("Alignments run gap analysis when a container generates its note. Each alignment wires to a guidelines source (a DataSource or another container), an LLM service, and a target container. Individual alignment dimensions are auto-discovered from the source note by prefix — every field matching {prefix}_* becomes a gap-analysis target. Works for single alignments too — just put one field in the source note.");

        if (s.prAlignmentGroups.length === 0) {
            const empty = containerEl.createEl("p");
            empty.style.cssText = "color: var(--text-faint); margin: 8px 0;";
            empty.setText("No alignments yet. Create one here, then wire it up in the graph view (source → alignment → container).");
        } else {
            for (let i = 0; i < s.prAlignmentGroups.length; i++) {
                this.renderPRAlignmentGroupCard(containerEl, s.prAlignmentGroups[i], i);
            }
        }

        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText("+ Add alignment")
                .setCta()
                .onClick(async () => {
                    s.prAlignmentGroups.push(makePRAlignmentGroup());
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }

    renderPRAlignmentGroupCard(parent, group, idx) {
        const s = this.plugin.settings;

        const card = parent.createDiv({ cls: "mr-pr-card" });
        card.dataset.prCardId = group.id;

        const header = card.createDiv({ cls: "mr-pr-card-header" });
        const nameInput = header.createEl("input", { type: "text", value: group.name || "", cls: "mr-pr-name-input" });
        nameInput.placeholder = "Alignment name";
        nameInput.addEventListener("change", async () => {
            group.name = nameInput.value;
            await this.plugin.saveSettings();
        });

        const deleteBtn = header.createEl("button", { text: "×", cls: "mr-pr-delete-btn" });
        deleteBtn.title = "Delete alignment";
        deleteBtn.addEventListener("click", async () => {
            s.prAlignmentGroups.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
        });

        const body = card.createDiv({ cls: "mr-pr-card-body" });

        new Setting(body)
            .setName("Prefix")
            .setDesc("Composes the output frontmatter keys and determines which source-note fields are auto-discovered as guidelines. For example, prefix=\"alignment\" reads every alignment_* field from the source note.")
            .addText(t => t
                .setPlaceholder("alignment")
                .setValue(group.prefix || "alignment")
                .onChange(async v => {
                    group.prefix = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(body)
            .setName("Run at")
            .setDesc("When this alignment fires in the container's lifecycle. 'Generate' = only at note creation. 'Write-back' = only at write-back. 'Both' = at both passes.")
            .addDropdown(dd => {
                dd.addOption("both", "Both passes");
                dd.addOption("generate", "Generate only");
                dd.addOption("writeback", "Write-back only");
                dd.setValue(group.runAt || "both");
                dd.onChange(async v => {
                    group.runAt = v;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(body)
            .setName("Write to")
            .setDesc("Where this alignment's output lands on the container note. Frontmatter = YAML block. Inline = key:: value in the body. Body marker = replaces {{pr:key}} in the body.")
            .addDropdown(dd => {
                dd.addOption("frontmatter", "Frontmatter");
                dd.addOption("inline", "Inline (key:: value)");
                dd.addOption("body", "Body marker ({{pr:key}})");
                dd.setValue(group.writeTo || "frontmatter");
                dd.onChange(async v => {
                    group.writeTo = v;
                    await this.plugin.saveSettings();
                });
            });

        // Target container
        const target = (s.prContainers || []).find(c => c.id === group.containerId);
        new Setting(body)
            .setName("Target container")
            .setDesc(target ? target.name : "(wire this group to a container's in-alignment socket in the graph view)")
            .addDropdown(d => {
                d.addOption("", "— none —");
                for (const c of (s.prContainers || [])) {
                    d.addOption(c.id, c.name || "(unnamed)");
                }
                d.setValue(group.containerId || "");
                d.onChange(async v => {
                    group.containerId = v;
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // Source
        new Setting(body)
            .setName("Guidelines source")
            .setDesc("Pick a data source or a container to pull guidelines from. Can also be wired in the graph view.")
            .addDropdown(d => {
                d.addOption("", "— none —");
                for (const ds of (s.prDataSources || [])) {
                    d.addOption(`data-source:${ds.id}`, `${ds.name} (data source, ${ds.mode})`);
                }
                for (const c of (s.prContainers || [])) {
                    d.addOption(`container:${c.id}`, `${c.name} (container)`);
                }
                const cur = group.sourceKind && group.sourceId ? `${group.sourceKind}:${group.sourceId}` : "";
                d.setValue(cur);
                d.onChange(async v => {
                    if (!v) { group.sourceKind = ""; group.sourceId = ""; }
                    else {
                        const [kind, id] = v.split(":");
                        group.sourceKind = kind;
                        group.sourceId = id;
                    }
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // LLM service
        new Setting(body)
            .setName("LLM service")
            .addDropdown(d => {
                d.addOption("", "— none —");
                for (const svc of (s.prLLMServices || [])) {
                    d.addOption(svc.id, svc.name || "(unnamed)");
                }
                d.setValue(group.llmServiceId || "");
                d.onChange(async v => {
                    group.llmServiceId = v;
                    await this.plugin.saveSettings();
                });
            });

        // System prompt
        new Setting(body)
            .setName("System prompt")
            .setDesc(group.systemPromptFile || "None selected — the group will skip if no prompt is set.")
            .addButton(btn => {
                btn.setButtonText(group.systemPromptFile ? "Change" : "Choose").onClick(() => {
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        group.systemPromptFile = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    group.systemPromptFile = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(body)
            .setName("Use system prompt")
            .setDesc("Send the system prompt above when this group runs its LLM call. Respects the global master in General.")
            .addToggle(t => t
                .setValue(group.useSystemPrompt !== false)
                .onChange(async v => {
                    group.useSystemPrompt = v;
                    await this.plugin.saveSettings();
                }));

        // Framework reinforcement — markdown file picker (same pattern as
        // the system prompt picker above). Injected at the end of the user
        // message right before the per-alignment output instructions.
        new Setting(body)
            .setName("Framework")
            .setDesc(group.framework || "None selected — the framework injection is skipped when empty.")
            .addButton(btn => {
                btn.setButtonText(group.framework ? "Change" : "Choose").onClick(() => {
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        group.framework = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    group.framework = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(body)
            .setName("Use framework")
            .setDesc("Inject the framework file above when this group runs its LLM call. Off = skip even if a file is picked.")
            .addToggle(t => t
                .setValue(group.useFramework !== false)
                .onChange(async v => {
                    group.useFramework = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(body)
            .setName("Include container frontmatter")
            .setDesc("When on, the container note's existing frontmatter (summary fields, themes, etc.) is sent to the alignment LLM as extra context alongside the raw subdivision data. Useful when the alignment should reason about the summarized view, not just raw daily values. Note: alignment runs BEFORE the main aggregation at boundary time, so this context comes from any prior run or template defaults, not the current generation.")
            .addToggle(t => t
                .setValue(group.includeAggregatedSummary !== false)
                .onChange(async v => {
                    group.includeAggregatedSummary = v;
                    await this.plugin.saveSettings();
                }));

        // ── Output shape defaults ──
        const shapeHeader = body.createEl("h4", { text: "Output shape" });
        shapeHeader.style.cssText = "margin: 16px 0 8px 0; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em;";

        new Setting(body)
            .setName("Default mode")
            .setDesc("How each discovered alignment is written by default. Source-note meta keys and per-alignment overrides below can change this per alignment.")
            .addDropdown(d => d
                .addOption("separate", "separate — LLM narrative per alignment")
                .addOption("rewrite",  "rewrite — LLM concise string per alignment")
                .addOption("prepend",  "prepend — template splice, no LLM")
                .addOption("combined", "combined — one unified narrative for all alignments")
                .setValue(group.defaultMode || "separate")
                .onChange(async v => {
                    group.defaultMode = v;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(body)
            .setName("Default target key")
            .setDesc("Template for the frontmatter key each alignment writes to. Available tokens: {prefix}, {name}. Example: {prefix}_{name} keeps results in their own namespace; {name} blends them directly into the container's existing fields.")
            .addText(t => t
                .setPlaceholder("{prefix}_{name}")
                .setValue(group.defaultTarget || "{prefix}_{name}")
                .onChange(async v => {
                    group.defaultTarget = v;
                    await this.plugin.saveSettings();
                }));

        const defaultMode = group.defaultMode || "separate";
        if (defaultMode === "combined") {
            const combinedDefault = `${(group.prefix || "alignment").trim()}_combined`;
            new Setting(body)
                .setName("Combined output key")
                .setDesc(`Frontmatter key for the unified narrative. Leave blank to default to ${combinedDefault}.`)
                .addText(t => t
                    .setPlaceholder(combinedDefault)
                    .setValue(group.combinedOutputKey || "")
                    .onChange(async v => {
                        group.combinedOutputKey = v;
                        await this.plugin.saveSettings();
                    }));
            new Setting(body)
                .setName("Max sentences")
                .setDesc("How many sentences the LLM is allowed for the combined narrative.")
                .addText(t => t
                    .setPlaceholder("10")
                    .setValue(String(group.combinedMaxSentences || 10))
                    .onChange(async v => {
                        group.combinedMaxSentences = parseInt(v, 10) || 10;
                        await this.plugin.saveSettings();
                    }));
        }
        if (defaultMode === "prepend") {
            new Setting(body)
                .setName("Default template")
                .setDesc("Template string used for prepend mode. Tokens: {guideline} (source guideline), {entries} (joined subdivision field values for this alignment's short name), {existing} (current target key value on container note), {name} (alignment short name). Default if blank: \"**{guideline}** — {entries}\"")
                .addText(t => t
                    .setPlaceholder("**{guideline}** — {existing}")
                    .setValue(group.defaultTemplate || "")
                    .onChange(async v => {
                        group.defaultTemplate = v;
                        await this.plugin.saveSettings();
                    }));
        }

        // ── Discovered alignments table ──
        // Scans the wired source note for {prefix}_* base keys and shows one
        // row per discovered alignment. Each row lets the user override the
        // resolved config. Refresh button re-scans if the source changes.
        const tableHeader = body.createEl("h4", { text: "Discovered alignments" });
        tableHeader.style.cssText = "margin: 16px 0 8px 0; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em;";

        const tableWrap = body.createDiv();
        const renderTable = async () => {
            tableWrap.empty();
            if (!group.sourceKind || !group.sourceId) {
                const hint = tableWrap.createEl("p");
                hint.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin: 0;";
                hint.setText("Wire a source first (via the Guidelines source dropdown above or the graph view) to auto-discover alignments.");
                return;
            }
            const src = await this.plugin.resolvePRAlignmentGroupSource(group);
            if (!src || Object.keys(src.guidelines).length === 0) {
                const hint = tableWrap.createEl("p");
                hint.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin: 0;";
                hint.setText(`No ${group.prefix || "alignment"}_* fields found in the source note.`);
                return;
            }
            const pathHint = tableWrap.createEl("p");
            pathHint.style.cssText = "color: var(--text-muted); font-size: 0.8em; margin: 0 0 8px 0; font-family: var(--font-monospace);";
            pathHint.setText(src.sourceFile.path);

            for (const alignmentKey of Object.keys(src.guidelines)) {
                const resolved = this.plugin.resolvePRAlignmentConfig(group, alignmentKey, src.sourceFm, src.sourceInline);
                const row = tableWrap.createDiv();
                row.style.cssText = "display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; padding: 6px 0; border-bottom: 1px dashed var(--background-modifier-border); align-items: center;";

                const label = row.createDiv();
                label.style.cssText = "font-family: var(--font-monospace); font-size: 0.85em; color: var(--interactive-accent); overflow: hidden; text-overflow: ellipsis;";
                label.title = src.guidelines[alignmentKey];
                label.setText(alignmentKey);

                // Target override
                const targetInput = row.createEl("input", { type: "text" });
                targetInput.style.cssText = "font-size: 0.8em; padding: 2px 4px;";
                targetInput.placeholder = resolved.target;
                const curOverride = (group.overrides || {})[alignmentKey] || {};
                if (curOverride.target) targetInput.value = curOverride.target;
                targetInput.addEventListener("change", async () => {
                    if (!group.overrides) group.overrides = {};
                    if (!group.overrides[alignmentKey]) group.overrides[alignmentKey] = {};
                    if (targetInput.value.trim()) group.overrides[alignmentKey].target = targetInput.value.trim();
                    else delete group.overrides[alignmentKey].target;
                    await this.plugin.saveSettings();
                });

                // Mode override
                const modeSel = row.createEl("select");
                modeSel.style.cssText = "font-size: 0.8em; padding: 2px 4px;";
                for (const m of ["", "separate", "rewrite", "prepend"]) {
                    const opt = modeSel.createEl("option", { value: m, text: m || "(default)" });
                    if ((curOverride.mode || "") === m) opt.selected = true;
                }
                modeSel.addEventListener("change", async () => {
                    if (!group.overrides) group.overrides = {};
                    if (!group.overrides[alignmentKey]) group.overrides[alignmentKey] = {};
                    if (modeSel.value) group.overrides[alignmentKey].mode = modeSel.value;
                    else delete group.overrides[alignmentKey].mode;
                    await this.plugin.saveSettings();
                });

                // Template override (only meaningful for splice modes)
                const templateInput = row.createEl("input", { type: "text" });
                templateInput.style.cssText = "font-size: 0.8em; padding: 2px 4px; font-family: var(--font-monospace);";
                templateInput.placeholder = resolved.template || "—";
                if (curOverride.template) templateInput.value = curOverride.template;
                templateInput.addEventListener("change", async () => {
                    if (!group.overrides) group.overrides = {};
                    if (!group.overrides[alignmentKey]) group.overrides[alignmentKey] = {};
                    if (templateInput.value.trim()) group.overrides[alignmentKey].template = templateInput.value.trim();
                    else delete group.overrides[alignmentKey].template;
                    await this.plugin.saveSettings();
                });

                // Resolved summary (read-only)
                const summary = row.createDiv();
                summary.style.cssText = "font-size: 0.75em; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
                summary.setText(`→ ${resolved.target} (${resolved.mode})`);
                summary.title = `mode: ${resolved.mode}\ntarget: ${resolved.target}\ntemplate: ${resolved.template || "(none)"}\nguideline: ${src.guidelines[alignmentKey]}`;
            }

            const legendWrap = tableWrap.createDiv();
            legendWrap.style.cssText = "display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; padding: 4px 0 0 0; font-size: 0.7em; color: var(--text-faint);";
            legendWrap.createEl("div", { text: "alignment key" });
            legendWrap.createEl("div", { text: "target override" });
            legendWrap.createEl("div", { text: "mode override" });
            legendWrap.createEl("div", { text: "resolved" });
        };

        new Setting(body)
            .addButton(btn => btn
                .setButtonText("Refresh discovered alignments")
                .onClick(() => renderTable()));

        renderTable();
    }

    renderPRAlignmentCard(parent, alignment, idx) {
        const s = this.plugin.settings;

        const card = parent.createDiv({ cls: "mr-pr-card" });
        card.dataset.prCardId = alignment.id;

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
            .setDesc("Which container this alignment is attached to.")
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

        // Data field + field type
        new Setting(body)
            .setName("Data field")
            .setDesc("Daily field to pull values from. e.g. \"health\" reads inline health:: or frontmatter health: from each daily note.")
            .addText(t => t
                .setPlaceholder("health")
                .setValue(alignment.dataField || "")
                .onChange(async v => {
                    alignment.dataField = v;
                    await this.plugin.saveSettings();
                }));

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

        // Description — doubles as inline system prompt when no file is set
        new Setting(body)
            .setName("Description")
            .setDesc("What you're measuring. Used as the system prompt when no system prompt file is set below. Also becomes the {guideline} token for prepend mode templates.")
            .addTextArea(t => {
                t.setValue(alignment.description || "")
                    .onChange(async v => {
                        alignment.description = v;
                        await this.plugin.saveSettings();
                    });
                t.inputEl.rows = 3;
                t.inputEl.style.width = "100%";
            });

        // Mode
        new Setting(body)
            .setName("Mode")
            .setDesc("separate = LLM narrative to its own key. rewrite = LLM concise string replaces the target key. prepend = template splice with {entries} from subdivisions, no LLM.")
            .addDropdown(dd => {
                dd.addOption("separate", "separate (LLM narrative)");
                dd.addOption("rewrite", "rewrite (LLM concise)");
                dd.addOption("prepend", "prepend (splice, no LLM)");
                dd.setValue(alignment.mode || "separate");
                dd.onChange(async v => {
                    alignment.mode = v;
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // Prefix + output key
        new Setting(body)
            .setName("Prefix")
            .setDesc("Namespace prefix. Output key auto-computes to {prefix}_{name} when the Output key field below is empty.")
            .addText(t => t
                .setPlaceholder("alignment")
                .setValue(alignment.prefix || "alignment")
                .onChange(async v => {
                    alignment.prefix = v;
                    await this.plugin.saveSettings();
                }));

        const shortName = (alignment.name || "unnamed").toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const resolvedKey = (alignment.outputField || "").trim() || `${(alignment.prefix || "alignment").trim()}_${shortName}`;
        new Setting(body)
            .setName("Output key")
            .setDesc(`Explicit override for the frontmatter key. Leave blank to use ${resolvedKey}.`)
            .addText(t => t
                .setPlaceholder(resolvedKey)
                .setValue(alignment.outputField || "")
                .onChange(async v => {
                    alignment.outputField = v;
                    await this.plugin.saveSettings();
                }));

        // Template (prepend mode only)
        if ((alignment.mode || "separate") === "prepend") {
            new Setting(body)
                .setName("Template")
                .setDesc("Splice format for prepend mode. Tokens: {guideline} (description), {entries} (subdivision field values), {existing} (current target key value), {name}. Default: **{guideline}** — {entries}")
                .addText(t => t
                    .setPlaceholder("**{guideline}** — {entries}")
                    .setValue(alignment.template || "")
                    .onChange(async v => {
                        alignment.template = v;
                        await this.plugin.saveSettings();
                    }));
        }

        // LLM service (own, or fall back to container's)
        const llmOpts = [{ id: "", label: "— Use container's LLM —" }];
        for (const svc of (s.prLLMServices || [])) {
            llmOpts.push({ id: svc.id, label: svc.name || "(unnamed)" });
        }
        new Setting(body)
            .setName("LLM service")
            .setDesc("Pick an LLM for this alignment specifically, or leave blank to use the container's LLM service.")
            .addDropdown(dd => {
                for (const opt of llmOpts) dd.addOption(opt.id, opt.label);
                dd.setValue(alignment.llmServiceId || "");
                dd.onChange(async v => {
                    alignment.llmServiceId = v;
                    await this.plugin.saveSettings();
                });
            });

        // System prompt file (overrides description as system prompt)
        new Setting(body)
            .setName("System prompt file")
            .setDesc(alignment.systemPromptFile || "None — using Description above as inline system prompt.")
            .addButton(btn => {
                btn.setButtonText(alignment.systemPromptFile ? "Change" : "Choose").onClick(() => {
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        alignment.systemPromptFile = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    alignment.systemPromptFile = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(body)
            .setName("Use system prompt")
            .setDesc("When off, runs with an empty system role (description is also skipped). Respects the global master in General.")
            .addToggle(t => t
                .setValue(alignment.useSystemPrompt !== false)
                .onChange(async v => {
                    alignment.useSystemPrompt = v;
                    await this.plugin.saveSettings();
                }));

        // Framework file
        new Setting(body)
            .setName("Framework")
            .setDesc(alignment.framework || "None — no framework injection for this alignment.")
            .addButton(btn => {
                btn.setButtonText(alignment.framework ? "Change" : "Choose").onClick(() => {
                    new MarkdownFileSuggestModal(this.app, async (file) => {
                        alignment.framework = file.path;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
            })
            .addExtraButton(btn => {
                btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                    alignment.framework = "";
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(body)
            .setName("Use framework")
            .setDesc("Inject the framework file above when this alignment runs. Respects the global master in General.")
            .addToggle(t => t
                .setValue(alignment.useFramework !== false)
                .onChange(async v => {
                    alignment.useFramework = v;
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
        card.dataset.prCardId = service.id;

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
        card.dataset.prCardId = cb.id;

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

    renderPRDataSourceCard(parent, ds, idx) {
        const s = this.plugin.settings;

        const card = parent.createDiv({ cls: "mr-pr-card" });
        card.dataset.prCardId = ds.id;

        const header = card.createDiv({ cls: "mr-pr-card-header" });
        const nameInput = header.createEl("input", { type: "text", value: ds.name || "", cls: "mr-pr-name-input" });
        nameInput.placeholder = "Data source name";
        nameInput.addEventListener("change", async () => {
            ds.name = nameInput.value;
            await this.plugin.saveSettings();
        });

        const deleteBtn = header.createEl("button", { text: "×", cls: "mr-pr-delete-btn" });
        deleteBtn.title = "Delete data source";
        deleteBtn.addEventListener("click", async () => {
            // Also strip orphaned references from container sources.
            for (const c of (s.prContainers || [])) {
                const sources = getContainerDataSources(c);
                const filtered = sources.filter(src => !(src.type === "dataSource" && src.dataSourceId === ds.id));
                if (filtered.length !== sources.length) c.dataSource = { sources: filtered };
            }
            s.prDataSources.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
        });

        const body = card.createDiv({ cls: "mr-pr-card-body" });

        new Setting(body)
            .setName("Mode")
            .setDesc("Static references one specific note. Dynamic scans a folder — container consumers filter by period, alignment groups read the latest note.")
            .addDropdown(d => d
                .addOption("static", "Static (single note)")
                .addOption("dynamic", "Dynamic (folder)")
                .setValue(ds.mode || "static")
                .onChange(async v => {
                    ds.mode = v;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if ((ds.mode || "static") === "static") {
            new Setting(body)
                .setName("Note")
                .setDesc(ds.notePath || "None selected")
                .addButton(btn => {
                    btn.setButtonText(ds.notePath ? "Change" : "Choose").onClick(() => {
                        new MarkdownFileSuggestModal(this.app, async (file) => {
                            ds.notePath = file.path;
                            if (!ds.name || ds.name === "New data source") ds.name = file.basename;
                            await this.plugin.saveSettings();
                            this.display();
                        }).open();
                    });
                })
                .addExtraButton(btn => {
                    btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                        ds.notePath = "";
                        await this.plugin.saveSettings();
                        this.display();
                    });
                });
        } else {
            new Setting(body)
                .setName("Folder")
                .setDesc(ds.folderPath || "None selected")
                .addButton(btn => {
                    btn.setButtonText(ds.folderPath ? "Change" : "Choose").onClick(() => {
                        new FolderSuggestModal(this.app, async (folder) => {
                            ds.folderPath = folder.path;
                            if (!ds.name || ds.name === "New data source") ds.name = folder.name || folder.path;
                            await this.plugin.saveSettings();
                            this.display();
                        }).open();
                    });
                })
                .addExtraButton(btn => {
                    btn.setIcon("cross").setTooltip("Clear").onClick(async () => {
                        ds.folderPath = "";
                        await this.plugin.saveSettings();
                        this.display();
                    });
                });
        }
    }

    displayGeneral(containerEl) {
        const s = this.plugin.settings;
        containerEl.createEl("h2", { text: "General" });

        // ── Readme / Help link ──
        const helpBox = containerEl.createDiv();
        helpBox.style.cssText = "display: flex; align-items: center; gap: 12px; padding: 10px 14px; margin: 0 0 16px 0; background: var(--background-secondary); border-left: 3px solid var(--interactive-accent); border-radius: 4px;";
        const helpText = helpBox.createDiv();
        helpText.style.cssText = "flex: 1; color: var(--text-muted); font-size: 0.9em; line-height: 1.4;";
        helpText.setText("New to Periodic Ritual, or not sure where to start? The README has a beginner-friendly quick start plus deep dives into alignment groups, data sources, and the graph view.");
        const helpBtn = helpBox.createEl("button", { text: "📖 Open README" });
        helpBtn.style.cssText = "flex-shrink: 0; background: var(--interactive-accent); color: var(--text-on-accent, #fff); border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-weight: 500;";
        helpBtn.addEventListener("click", () => {
            window.open("https://github.com/PoweredbyPugs/monthly-ritual/blob/main/README.md", "_blank");
        });

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

        // ── Feature masters — global on/off for system prompts and frameworks ──
        const featureHeader = containerEl.createEl("h3", { text: "Features" });
        featureHeader.style.marginTop = "24px";
        const featureIntro = containerEl.createEl("p");
        featureIntro.style.cssText = "color: var(--text-muted); font-size: 0.9em; max-width: 60ch;";
        featureIntro.setText("Master switches for two LLM input channels. When a master is off, every container and alignment group runs without that channel — even if its local toggle is on. Use the masters to kill all system prompts or frameworks across the vault in one click (for debugging, A/B testing, or temporarily stripping the model down to bare inputs).");

        new Setting(containerEl)
            .setName("Enable system prompts (global)")
            .setDesc("Master switch for every container and alignment group's system prompt. When off, the model sees an empty system role and relies entirely on the user message. Each container and group can also turn this off locally.")
            .addToggle(t => t
                .setValue(s.prSystemPromptsGlobalEnabled !== false)
                .onChange(async v => {
                    s.prSystemPromptsGlobalEnabled = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Enable frameworks (global)")
            .setDesc("Master switch for Framework Reinforcement injection. A framework is a short markdown snippet you can attach to any container or alignment group; it gets placed at the end of the user message, right before the output instructions — the highest-attention slot. Use it when you want procedural thinking guidance (mental models, lenses, checklists) that survive long source payloads.")
            .addToggle(t => t
                .setValue(s.prFrameworksGlobalEnabled !== false)
                .onChange(async v => {
                    s.prFrameworksGlobalEnabled = v;
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

        // ── Data sources ──
        containerEl.createEl("h3", { text: "Data sources" }).style.marginTop = "24px";
        const dsIntro = containerEl.createEl("p");
        dsIntro.style.cssText = "color: var(--text-muted); font-size: 0.9em; max-width: 60ch;";
        dsIntro.setText("Reusable named references to notes or folders. Wire them into container data inputs and alignment groups in the graph view. Static sources read one file; dynamic sources scan a folder (container consumers filter by period, alignment groups read the latest).");

        if (!Array.isArray(s.prDataSources)) s.prDataSources = [];

        if (s.prDataSources.length === 0) {
            const empty = containerEl.createEl("p");
            empty.style.cssText = "color: var(--text-faint); font-size: 0.85em; margin: 8px 0;";
            empty.setText("No data sources yet.");
        }

        for (let i = 0; i < s.prDataSources.length; i++) {
            this.renderPRDataSourceCard(containerEl, s.prDataSources[i], i);
        }

        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText("+ Add static source")
                .onClick(async () => {
                    s.prDataSources.push(makePRDataSource({ mode: "static" }));
                    await this.plugin.saveSettings();
                    this.display();
                }))
            .addButton(btn => btn
                .setButtonText("+ Add dynamic source")
                .onClick(async () => {
                    s.prDataSources.push(makePRDataSource({ mode: "dynamic" }));
                    await this.plugin.saveSettings();
                    this.display();
                }));

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
