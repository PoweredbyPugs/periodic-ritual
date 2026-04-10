# Periodic Ritual

An Obsidian plugin for **periodic review notes**. Generates weekly / monthly / chapter / book / lunar / solar containers from templates, aggregates daily notes through an LLM, runs reflection Q&A flows, and tracks measurable alignments per period. Companion to **Daily Ritual**.

> Plugin id is still `monthly-ritual` for migration safety. The user-facing name is "Periodic Ritual" everywhere else.

## What it does

You configure containers (weekly, monthly, lunar phase, chapter, etc.). The plugin creates a note for each container at every period boundary, fills it from a template, optionally hands the period's daily notes to an LLM for summarization, and writes the LLM's YAML response into the container note's frontmatter. You can also attach **reflection profiles** (Q&A flows) that ask you questions and weave your answers into the LLM payload, and **alignments** that measure a specific daily field against a description across the period.

Five primitives, each with its own settings tab:

| Primitive | What it is |
|---|---|
| **Container** | A periodic note. Has a template, save directory, naming convention, boundary detector, and optionally an LLM service + system prompt + reflection + alignments. |
| **Boundary** | A date-range calculator. Built-in: calendar week / month / quarter / year, lunar cycle, lunar phase, solar cycle (Aries → Aries), solar zodiac (sun in one sign). Custom: any JS module in your vault that exports a function returning `{start, end, tokens}`. |
| **Reflection** | A reusable Q&A profile. Questions can inject context from other notes and write answers to specific fields. Optionally calls the LLM with the answers attached. |
| **Alignment** | A measurable anchor attached to a container. Names a daily field and a description; the plugin runs an LLM pass per period to surface patterns of consistency, drift, and absence. |
| **LLM Service** | A `{provider, api key, model}` bundle. Containers reference services by name. Supports Gemini, OpenAI, Anthropic, OpenRouter, LM Studio (local), OpenClaw (local agent). |

Plus a **General** tab for plugin-wide settings: auto-generate on load toggle, daily notes folder, astrology toggles, and Calendar View configuration.

## Quick start

1. Install the plugin (drop the folder into `.obsidian/plugins/monthly-ritual/`).
2. Enable it in Settings → Community plugins.
3. Open Settings → Periodic Ritual.
4. **LLM tab** → add an LLM service. Name it, pick provider, paste API key, click the refresh icon to fetch models, pick one.
5. **Containers tab** → click **+ Add container**. Pick a boundary detector (Calendar Week is the simplest start), set a template path, save directory, and naming convention. Optionally pick the LLM service and a system prompt MD file.
6. **Reflection tab** (optional) → define a reflection profile with questions. Attach it to your container in the Containers tab.
7. **Alignments tab** (optional) → define alignments that measure daily fields against descriptions.
8. **General tab** → turn on **Auto-generate on load** if you want notes to appear automatically when boundaries are crossed.
9. Click **Generate now** on a container card to test. The note appears in your save directory, opens automatically, and (if LLM is configured) gets aggregated frontmatter.

## How aggregation works

When a container generates:

1. The boundary detector computes the period's date range.
2. The template is read, naming tokens are resolved, the file is created.
3. The plugin collects source data:
   - **Default** (`dataSource: daily`): all daily notes whose filename date falls in the period's range.
   - **Hierarchical** (`dataSource: container:<id>`): all notes from another PR container whose `pr-start` falls in this period's range. Used for chains like Lunar Phase → Lunar Cycle → Solar Year.
4. The plugin builds a user message: period header + reflection answers (if any) + previous frontmatter (in "both" reflection re-runs) + source notes formatted as `## <filename>` sections with their frontmatter and inline `key:: value` fields.
5. The LLM is called with your system prompt as the system role and the user message as the user role. The system prompt tells the LLM which fields to read and which YAML keys to write.
6. The LLM's YAML response is parsed and merged into the container note's frontmatter via `processFrontMatter`.
7. Alignments run after the main aggregation. Each alignment is a separate focused LLM call that pulls one daily field across the period and writes a short observation to a dedicated frontmatter key.

If reflection is set to **manual** mode, steps 5–7 are deferred until you run "Periodic Ritual: Reflect on container."

## Hierarchical roll-up

Containers can read from other containers. Configure container A's data source to point at container B, and A's auto-LLM will aggregate B's notes (in A's date range) instead of dailies. Chains:

- Lunar Phase → Lunar Cycle → Solar Year (`{ source: daily }` → `{ source: container:lunar-phase }` → `{ source: container:lunar-cycle }`)
- Calendar Week → Calendar Month → Calendar Quarter → Calendar Year
- Anything custom you build with custom JS boundaries

Catch-up generates containers in topological order so children always exist when parents run.

## Reflection flow

Reflection profiles are Q&A flows that ask one question at a time (Enter to advance), the same modal Daily Ritual uses. Each question can:

- **Inject context** from another note above the question prompt — previous period of the same container, a specific note, or the current/previous note of a different container
- **Output the answer** directly to a field on the active container note OR a sibling container's current note (cross-container push)
- Be sent to the LLM as part of the period's user message, with the injected context as a blockquote so the model knows what the user was responding to

Two toggles per reflection profile:

- **Send answers to LLM** — when off, the reflection just writes answers to fields and stops; no LLM call. Pure Q&A flow.
- **Replace container's auto-LLM at boundary** — when on, the container's auto-LLM is suppressed (you run reflection on demand instead). When off, the reflection is additive.

Four combinations cover every workflow from "I just want to write some answers down" to "auto-LLM + on-demand re-summarization with context."

## Custom boundaries

The Boundaries tab shows every built-in detector with its source code (View source) and lets you fork any of them as a custom JS module in your vault (Fork as custom). Custom boundaries can also be written from scratch — they're CommonJS modules:

```js
module.exports = function(date, app, plugin) {
    // date: JS Date the plugin is asking about
    // app:  Obsidian App instance (so you can read vault files etc.)
    // plugin: the Periodic Ritual plugin instance
    return {
        start: <Date>,
        end:   <Date>,
        tokens: { /* string-keyed object for {{naming-tokens}} */ }
    };
};
```

You can `require("obsidian")` for `requestUrl` if your boundary needs to call a local server (Helios, Ki calculator, anything else). The script gets passed the app and plugin instances so it can read vault files for date data.

Examples are in `boundaries/` of the source repo:

- `pr-monday-week.js` — like Calendar Week but starts on Monday explicitly
- `pr-fortnight.js` — 14-day periods anchored on a specific reference date
- `pr-ki-9day.js` — placeholder for Ki cycle integration with a local calculator

## Commands

| Command | What it does |
|---|---|
| **Generate container note** | Fuzzy-pick a container and generate its current period note |
| **Catch up missed notes** | Walk all enabled containers, generate any missed periods in topological order |
| **Reflect on container** | If active file is a PR container note with reflection attached, run it directly. Otherwise fuzzy-pick. |
| **Show last LLM call** | Debug modal showing the system prompt, user message, request body, and raw response from the most recent LLM call. |
| **Show hierarchy diagram** | Mermaid flowchart visualizing containers, their data sources, reflections, alignments, and LLM service references. |
| **Open Ritual Calendar** | Sidebar lunisolar calendar view (zodiac sign + lunar phases). |

## Settings

Six tabs:

- **Containers** — list of configured containers. Each card has all per-container settings (boundary, generate at, template, save dir, naming, metadata placement, LLM service, system prompt, reflection picker, data source).
- **Boundaries** — built-in detectors (read-only with View source / Fork as custom) and custom boundaries (editable cards with script picker, description, test button).
- **Reflection** — reusable reflection profiles with questions, mode toggles, prompt prepend, and per-question inject/output panels.
- **Alignments** — measurable anchors attached to containers.
- **LLM** — provider configurations.
- **General** — auto-generate toggle, daily notes folder, astrology toggles, Calendar View settings.

## Files

```
monthly-ritual/
├── main.js          — all plugin code (single file, no build step)
├── manifest.json    — plugin metadata
├── styles.css       — minimal styling
├── PROJECT.md       — architecture document
├── README.md        — this file
├── prompts/         — starter system prompts for LLM aggregation
└── boundaries/      — example custom boundary scripts
```

No build step. `main.js` is hand-written JavaScript (with obsidian via `require`). Edit, reload, done. Same convention as Daily Ritual.

## Companion: Daily Ritual

Periodic Ritual is the periodic-aggregation power tool. Daily Ritual is the daily-Q&A entry point. They coexist — Daily Ritual handles the per-day reflection on the active daily note, Periodic Ritual handles the aggregation of those daily notes into weekly / monthly / chapter summaries. Reflection inject/output in Periodic Ritual can read from and write to daily notes by path, and Daily Ritual can be extended to inject context from the current corresponding PR container note (separate plugin update).

## License

MIT.
