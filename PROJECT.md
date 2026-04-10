# Periodic Ritual — Project Document

> **Rebrand in progress.** Plugin id stays `monthly-ritual` for now (zero migration friction). User-facing name in `manifest.json` becomes **Periodic Ritual**. Repo rename optional, deferred. This document supersedes the prior architecture which was built around mutually-exclusive modes and a hand-rolled field pipeline.

---

## Overview

Obsidian plugin for **periodic review notes**. Companion to Daily Ritual. Maintains an arbitrary number of independent, parallel **container types** (calendar week, calendar month, sun ingress, lunar phase, chapter, book, …) — each one optional, each one configured the same way: a template, a save directory, an LLM service, and a system-prompt markdown file that tells the LLM how to summarize the container's daily data into the container's frontmatter.

The plugin's job is narrow: **detect a container's boundary, create the container note from a template, gather the daily notes in range, hand them to an LLM with a system-prompt MD file, and write the LLM's output to the container's frontmatter.** Templater scripts in the user's vault render the body afterward via Dataview, untouched by the plugin.

A separate first-class module, **Alignment**, lets the user attach measurable anchors to a container — each alignment names a daily field, a description of what's being measured, and the container level it lives in. The plugin gathers the matching daily data and surfaces patterns against the description (via another LLM pass).

## Design principles

1. **The system-prompt MD file is the customization layer.** Settings stay tiny. Behavior changes by editing markdown, not code.
2. **Containers are independent.** No mutually-exclusive modes. Enable any combination. Each has its own LLM service if desired.
3. **The LLM does aggregation.** No hand-rolled field pipeline. The plugin shovels daily data and a prompt at an LLM and writes the result.
4. **Anti-fragile.** Skip a week, nothing breaks. The LLM aggregates whatever data exists.
5. **Goals are anchors, not prisons.** Alignments surface patterns. They do not produce shame, compliance scores, or red/green dashboards.
6. **Templater stays.** It renders bodies via Dataview. The plugin owns frontmatter; templater owns presentation. Complementary.
7. **Daily Ritual is upstream of everything.** Periodic Ritual reads what Daily Ritual already writes (inline fields and frontmatter). It does not modify daily notes.

## Repo and build

- GitHub: `poweredbypugs/monthly-ritual`
- Plugin id: `monthly-ritual` (unchanged)
- User-facing name: **Periodic Ritual** (in `manifest.json`)
- Plugin install path: `KAI/.obsidian/plugins/monthly-ritual/`
- Working clone: `~/Documents/Plugin Project/monthly-ritual/`
- **Plain JS, no build step, no TypeScript.** `main.js` is the source of truth — same as Daily Ritual.

```
monthly-ritual/
├── main.js          — all plugin code
├── manifest.json    — name: "Periodic Ritual", id: "monthly-ritual"
├── styles.css
├── data.json        — settings (gitignored)
├── PROJECT.md       — this file
└── README.md        — user-facing docs
```

---

## Core primitive: the Container

A **container** is the unit of periodic aggregation. The plugin does not distinguish between built-in and user-defined container types — they all use the same config object and the same generation flow. The only difference between, say, a Calendar Week and a Sun Ingress is which **boundary detector** computes its date range.

### Container config (one per enabled container type)

```js
{
  id: "calendar-week",          // unique key
  name: "Calendar Week",        // display name
  enabled: true,
  template: "Templates/2025-Weekly-Review.md",
  saveDir: "Home/Water/02. Weekly",
  naming: "W{{week}}-{{year}}", // token template
  systemPromptFile: "Templates/prompts/weekly.md",
  llmService: "gemini-1.5-pro", // can differ per container
  boundaryDetector: "calendar-week",
  reflectionMode: "auto",       // "auto" | "manual" | "both"
  questions: [ /* same shape as Daily Ritual */ ],
  alignments: [ /* see Alignment module below */ ]
}
```

### Reflection mode

Each container chooses how its frontmatter gets filled:

- **`auto`** — The plugin generates the note at the boundary, collects daily data, runs the LLM with the system prompt, writes the result to frontmatter. No user interaction required. Anti-fragile default.
- **`manual`** — The plugin generates the note at the boundary with empty (or minimally populated) frontmatter. The user runs a "Reflect on [container]" command when they want to fill it in — this opens a Daily-Ritual-style progressive-disclosure modal of the container's configured questions, then runs the LLM with both the answers and the daily data, then writes to frontmatter.
- **`both`** — Auto runs at the boundary as in `auto` mode. The user can *also* run the reflection command at any time afterward to re-summarize with manual context layered in. The second pass reads the existing frontmatter as additional context and overwrites it with the new synthesis.

The reflection modal is the same primitive Daily Ritual already uses — questions array, progressive disclosure, Enter-to-advance. We lift the modal directly. Per-container question lists are configured under each container's tab.

### Boundary detectors (built-in)

| id | source | range |
|----|--------|-------|
| `calendar-week` | ISO week math | Mon → Sun |
| `calendar-month` | calendar month | 1st → last day |
| `sun-ingress` | Helios `/planetary-ingresses?planet=Sun` | one zodiacal sign (~30d) |
| `lunar-phase` | Helios `/moon-phases` | one phase (~7d) |
| `lunar-cycle` | Helios `/moon-phases` | new moon → new moon (~29.5d) |
| `chapter` | calendar quarter | 90d |
| `book` | calendar year | 365d |

Sun ingress and lunar detectors require the Moon Phase plugin's Helios server (`baratie:3000` by default — read from `app.plugins.plugins["obsidian-moon"].settings.serverUrl`). If Helios is unavailable, those container types are disabled with a tooltip.

### Note generation flow

1. **Boundary check.** On plugin load and on a daily timer, walk every enabled container. Ask its boundary detector "has a new period started since the last note we generated?" If yes:
2. **Resolve naming.** Run the container's `naming` template through the token engine using the new period's date range to produce a filename.
3. **Materialize template.** Read the template file. Apply token substitution. Write the new note to `saveDir/<filename>.md`. (Templater scripts inside the template execute as normal — they're rendered by templater on first open, not by us.)
4. **Collect daily data.** Find all daily notes whose date falls within the new container's range, using the same `parseDateFromFilename` logic Daily Ritual uses. Collect each daily note's frontmatter and inline fields.
5. **Build the LLM payload.** Concatenate the system-prompt MD file (verbatim, as the system role) with the collected daily data (as the user message). Hand to the configured LLM service.
6. **Write the result.** Parse the LLM's response as YAML and merge it into the new container note's frontmatter via `app.fileManager.processFrontMatter`. Verify the write before declaring success (same pattern Daily Ritual now uses).
7. **Notice.** Show a single notification: "Generated [container name]: [filename]." Do not block, do not pop modals, do not require interaction.

If any step fails, log to console and surface a notice with the actual error. Never silently no-op.

### What the plugin does NOT do

- Doesn't modify daily notes.
- Doesn't write to the body of the container note. (Templater renders the body.)
- Doesn't enforce a pillar schema. The 6 pillars exist in the user's prompts, not in plugin code.
- Doesn't require manual reflection. Reflection modals are optional, demoted from v0 architecture.
- Doesn't aggregate across container types. Each container is independent.

---

## Data the LLM sees

The plugin sends two things to the configured LLM service when it aggregates a container: the **system prompt MD file** as the system role, and a generated **user message** built from the daily notes in the container's date range.

The user message has this exact shape:

```
# Period
start: 2026-04-06
end: 2026-04-12
daily_count: 7

# Daily notes

## Monday, April 6th 2026
season: Spring
Ki: ䷤ 9.4
study: Worked through chapter 3 of the Go book
work: Rewrote the auth middleware
today:: Ship the migration before EOD
health:: 30 min walk, lifted
lessons:: Don't merge after 5pm

---

## Tuesday, April 7th 2026
[ ... ]
```

Per-day rules:

- **Section header** is `## <filename>` — the daily note's basename without extension.
- **Frontmatter keys** appear as `key: value` lines, one per line. Plugin-internal keys (`periodic-ritual`, `position`) are filtered out. Nested objects and arrays are skipped.
- **Inline fields** (`key:: value`) from the daily's body appear after the frontmatter on their own lines. Multiple values for the same key on the same day get joined with ` | `.
- **Body content** (paragraphs, dataview blocks, headings) is **not** sent. Only frontmatter and inline fields. The user's templates have huge dataview blocks that aren't useful to the LLM and would burn tokens. If a future container needs the body, that's a per-container setting.
- **Days with no fields** still appear with just their `## <filename>` header.
- **Days outside the range** never appear.
- **Sections are separated** by `\n\n---\n\n`.

When writing system prompts, you can reference any field name you expect the daily notes to contain. The plugin doesn't filter or transform field names — it passes them through verbatim. Translation from daily field names to container frontmatter keys (e.g., daily `admin::` → container `wealth:`) is the prompt's job.

Token cost is roughly proportional to `daily_count × (avg fields per day × ~10 tokens)`. A 7-day calendar week is small (~1k tokens). A 30-day month is moderate (~5k). A 90-day chapter is significant (~15k). A 365-day book run directly against dailies is too expensive — for that container, the recommendation is to have the system prompt aggregate from the chapter notes instead, which the plugin can do once Phase 4+ wires up parent-context reading.

## System prompt MD files

The customization layer. One markdown file per container type, picked via fuzzy finder in settings. The file's contents are sent to the LLM as the system role on every aggregation pass for that container.

**Starter prompts ship in `prompts/` in the source repo** and as embedded constants in `main.js` (`PR_STARTER_PROMPTS`). The container card has a "Create starter" button that drops the embedded content into a vault folder you pick and wires it as the container's system prompt. From there you edit the markdown to taste.

Five starter prompts are provided in v1.1: `calendar-week`, `calendar-month`, `chapter-quarter`, `sun-ingress`, `lunar-phase`. Each is grounded in the user's six-pillar system (Health, Wealth, Work, Links, Creative, Study) and the anti-fragile philosophy (records, not ratings; patterns, not compliance; empty days are valid data).

This is where the user encodes:
- Which daily fields to read (`work::`, `study::`, `health::`, etc.)
- Which YAML keys to write into the container's frontmatter
- The narrative voice / pattern-spotting framing
- How to handle missing days
- How to translate daily-level field names into container-level field names (e.g., daily `admin::` → container `wealth:` if that's the prompt's job)
- Whether to look at the parent container's frontmatter for orienting context

Example skeleton (for a calendar week prompt):

```markdown
You are aggregating one week of Atlas's daily notes into a weekly review's frontmatter.

Read each day's frontmatter and inline fields. Look for: study, creative, admin, work, links, today, health, challenge, lessons.

Output ONLY a YAML frontmatter block (no fences, no commentary). Keys to fill:
- summary: one paragraph synthesizing the week's arc, written in second person.
- lessons: bullet list of 3–5 learnings.
- health, study, links, work, creative, wealth: pipe-separated chronological values from each day's same field. Skip empty days. Translate `admin::` daily values into the `wealth` field at this level.
- highlights: bullet list of standout moments.
- challenges: bullet list of frictions and what got in the way.

Treat goals as anchors, not prisons. If the week missed the mark, surface the pattern without judgment.
```

Changing the prompt changes the behavior. No code touch. This is the entire customization story for v1.

---

## Alignment module

Separate primitive. An Alignment is a measurable anchor attached to a container.

```js
{
  id: "morning-mobility",
  containerType: "chapter",         // which container level it lives in
  description: "30 min mobility/cardio daily, 80% sleep score average",
  dataSource: "health",             // daily field to read
  dataSourceType: "inline"          // "inline" or "frontmatter"
}
```

### Behavior

1. When a container is generated, the plugin finds all alignments attached to that container type.
2. For each alignment, it pulls the named field from every daily note in the container's range.
3. It sends the alignment description + the collected data to the container's LLM (separate pass from the main aggregation, or appended — TBD).
4. The LLM produces a short narrative + pattern observation, written into a dedicated frontmatter field on the container note (e.g., `alignment_health: "..."`) or into a body section the templater script can render.

Multiple alignments per container. Modular — the user defines pillars, boundaries, and data sources. The plugin does not know that "Health" is a pillar; it only knows there's an alignment named "morning-mobility" attached to chapters with `dataSource: "health"`.

### "Arc" terminology

Arc and Alignment are the same mechanic. The user's existing vocabulary calls it "arc" when it lives in a sun ingress note with a dataview visualization. Internally the plugin treats them as one type.

---

## Settings UI

Single settings tab in Obsidian, organized as **outer tabs by area** and **inner tabs by container**.

```
═══════════════════════════════════════
[ Containers ] [ Alignments ] [ LLM ] [ General ]
═══════════════════════════════════════

CONTAINERS TAB:
┌─[ + Add container ]──────────────────┐
│ [📅 Calendar Week] [📅 Calendar Month] [☀️ Sun Ingress] [🌙 Lunar Phase] [Chapter] [Book] [+ custom] │
└──────────────────────────────────────┘

  Selected: Calendar Week
  ┌──────────────────────────────────┐
  │ Enabled:           [toggle]      │
  │ Template:          [fuzzy file]  │
  │ Save directory:    [folder]      │
  │ Naming convention: [text + tokens link] │
  │ Boundary detector: [dropdown]    │
  │ System prompt:     [fuzzy file]  │
  │ LLM service:       [dropdown — see LLM tab] │
  │ Reflection mode:   [auto ▾ │ manual │ both] │
  │                                  │
  │ ── Questions (visible if mode ≠ auto) ── │
  │ [Q1] [← inject] [text] [output →] [↑↓×] │
  │ [+ Add Question]                 │
  │                                  │
  │ [Test boundary] [Generate now] [Reflect now] │
  └──────────────────────────────────┘

ALIGNMENTS TAB:
┌─[ + Add alignment ]──────────────────┐
│ Name | Container | Data source | Description (truncated) | × │
│ ...                                                          │
└──────────────────────────────────────┘

LLM TAB:
  Define one or more LLM services. Each service is a {provider, api key, model} bundle.
  [+ Add service]
  ┌──────────────────────────────────┐
  │ Name:     [text]                 │
  │ Provider: [Gemini ▾ │ OpenAI │ Anthropic] │
  │ API key:  [password]             │
  │ Model:    [dropdown] [↻ fetch]   │
  └──────────────────────────────────┘
  Containers reference services by name.

GENERAL TAB:
  Daily notes folder:    [folder picker]
  Daily filename format: [text — for parseDateFromFilename]
  Auto-generate on load: [toggle]   (when off, generate manually via command)
```

The settings model means:
- Adding a new container type = adding a tab.
- Adding a custom container = picking a boundary detector + filling four fields.
- Switching LLMs per container = choosing a service from the dropdown.

---

## What's reused from existing `main.js`

- LLM provider abstraction (Gemini / OpenAI / Anthropic + model fetching)
- Helios bridge (read `serverUrl` from Moon Phase plugin)
- Calendar View (`ItemView` + sidebar grid) — keep, possibly extend to show all enabled containers
- Token engine for naming conventions (`{{year}}`, `{{month-name}}`, `{{phase}}`, `{{sign}}`, etc.)
- `parseDateFromFilename` / `formatDateForFilename`
- `MarkdownFileSuggestModal` (fuzzy finder)
- `escapeRegex`, settings persistence pattern, loadData/saveData

## What's deleted or rewritten

- **Modes (📅/🌙/☀️ as mutually exclusive).** Replaced with independent containers.
- **Field pipeline (Daily → Subdivision → Container as a hand-rolled per-field collector).** Replaced with "give the LLM the daily files in range."
- **Reflection modals as the *only* flow.** They're now per-container optional via the `reflectionMode` setting (`auto` / `manual` / `both`). Auto-LLM at boundary is the new default; reflection modals are an opt-in enhancement, lifted directly from Daily Ritual's working pattern.
- **The "container vs subdivision" distinction.** Gone. There are just containers.
- **Tabbed reflection settings (container tab vs subdivision tab).** Gone, replaced by per-container tabs.
- **The "astrology toggle."** Gone — sun ingress and lunar phase are first-class containers, not toggled features of another mode.

## What still needs design work

These are the open questions to resolve before or during implementation. Each is small but real.

1. **Auto-generate trigger.** Single on/off toggle in the General tab. When on, the plugin checks every enabled container's boundary detector at plugin load. For any container whose boundary has been crossed since the last time it generated a note, it generates the missed note(s). No timers, no polling — boundary-driven only. When off, the user generates manually via command. (Resolved.)
2. **What happens when a boundary is missed by multiple periods.** Generate each missed period as its own note in chronological order. The note exists even if there is nothing to aggregate — the *existence of the empty note* is itself data, and the system must not require the user's attention to function. Empty containers get empty (or LLM-acknowledged-as-empty) frontmatter and move on. (Resolved.)
3. **LLM payload size limits.** A chapter (90 days) of dailies could be a lot of tokens. Need a strategy: (a) trust the model's context window; (b) chunk and summarize hierarchically (daily → weekly → chapter); (c) let the system prompt handle truncation. Likely (a) for v1, document the limit, revisit if it bites.
4. **YAML output parsing.** The LLM is asked to output YAML. What happens when it outputs garbage? Strategy: extract fenced YAML if present, fall back to parsing the whole response, fall back to writing the raw response into a single `summary` field with a notice.
5. **Alignment LLM pass — same call or separate?** Either alignments are appended to the main aggregation prompt, or they get their own LLM pass per alignment. Trade-off: one call is cheaper, separate calls let alignments use a different model and avoid prompt-stuffing. Default: separate pass per alignment, batchable later.
6. **Templater interaction.** Templater scripts in the body run on first file open in Obsidian, *after* the plugin has written frontmatter. We need to confirm Templater respects pre-existing frontmatter and doesn't clobber it. Test before shipping.
7. **Custom container types.** The "+ custom" option in settings needs a UX. v1 ships built-in types only. v1.1 adds custom containers (user picks any boundary detector + fills the four fields).
8. **Migration from prior monthly-ritual settings.** Existing installs have a settings shape from the old architecture. On load, detect old shape and migrate (or wipe with notice). Decide: migrate or wipe.

---

## Implementation phases

### Phase 0 — Rewrite groundwork
- Update `manifest.json` name to "Periodic Ritual" (id stays).
- Rewrite settings shape, write a migration that wipes old settings with a one-time notice.
- Rip out: modes, field pipeline UI, reflection-tab settings, container/subdivision split.
- Keep: LLM providers, Helios bridge, Calendar View, naming engine, fuzzy finder, daily filename parser.

### Phase 1 — Single container, calendar week, no LLM
- Settings: Containers tab with one hardcoded entry (Calendar Week).
- Boundary detector: ISO week math.
- Generation: read template, apply naming tokens, write file. No daily aggregation, no LLM.
- Command: "Generate next [container]" for manual triggering during dev.
- **Milestone:** clicking the command creates a correctly named, correctly placed weekly note from a template.

### Phase 2 — LLM aggregation
- LLM services tab: define one or more services.
- Per-container: pick service + system prompt MD file.
- On generate: collect dailies in range, send to LLM with prompt, write YAML response to frontmatter, verify.
- **Milestone:** running "Generate next Calendar Week" produces a weekly note whose frontmatter is filled by Gemini from the system prompt.

### Phase 3 — Auto-generation on boundary
- On plugin load: walk all enabled containers, run their boundary detectors, generate any that have crossed since last run.
- Track "last generated" timestamps in settings per container.
- Optional periodic timer (default once per local midnight).
- **Milestone:** open Obsidian Monday morning, last week's note is sitting there, filled in.

### Phase 4 — Multiple container types
- Add Calendar Month, Chapter (Quarter), Book (Year) — calendar-based, no Helios needed.
- Each gets its own tab, its own template, its own prompt, its own service.
- **Milestone:** week + month + chapter all auto-generate at their boundaries with different prompts.

### Phase 5 — Astro containers
- Sun Ingress and Lunar Phase boundary detectors via Helios.
- Detect Moon Phase plugin presence; gate the UI.
- Reuse Calendar View for visual reference.
- **Milestone:** the day the Sun enters Aries, an "♈ Aries 2026" note auto-creates with LLM-aggregated frontmatter.

### Phase 6 — Reflection modals
- Lift `ReflectionModal` from Daily Ritual's `main.js`.
- Per-container `reflectionMode` setting (`auto` / `manual` / `both`) and `questions` array in the container's tab.
- "Reflect on [container]" command per enabled container — opens the modal, runs the LLM with both the answers and the daily data, writes to frontmatter.
- In `both` mode, the manual reflection pass reads the existing auto-filled frontmatter as additional context and overwrites with the new synthesis.
- **Milestone:** running "Reflect on Calendar Week" opens a question modal, accepts answers, and produces an updated weekly note frontmatter that incorporates both the answers and the daily data.

### Phase 7 — Alignment module
- Alignments tab. Add/edit/remove alignments.
- On container generation, run alignment passes after main aggregation.
- Write alignment results to dedicated frontmatter fields or a body section template.
- **Milestone:** chapter notes have a working "morning mobility" alignment that surfaces patterns over 90 days.

### Phase 8 — Polish
- Custom container types UI.
- Migration warnings.
- Edge cases: missing daily folder, malformed dailies, LLM rate limits, partial periods.
- README rewrite.

---

## Non-goals (v1)

- No mobile-specific UI.
- No daily-note modification.
- No cross-container analysis ("how does my Aries period compare to my Pisces period").
- No built-in dashboards or charts. (Templater + Dataview do this in the body.)
- No conflict resolution if two containers want to write the same frontmatter key. The user is responsible for not configuring overlapping prompts on the same note.
- No streak tracking, no compliance scores, no red/green/yellow status indicators. Anti-fragile by design.

---

## Glossary

| Term | Meaning |
|------|---------|
| Container | A periodic note (week, month, sun ingress, lunar phase, chapter, book). The unit of aggregation. |
| Container type | A class of container with its own boundary detector, template, prompt, and LLM service. |
| Boundary detector | The function that decides "has a new period of this type started?" — calendar math or Helios call. |
| System prompt MD | A markdown file the user picks per container type. Sent to the LLM as the system role on every aggregation. The customization layer. |
| LLM service | A `{provider, api key, model}` bundle defined in the LLM tab. Containers reference services by name. |
| Alignment | A measurable anchor attached to a container. Pulls a daily field, runs an LLM pass against a description. |
| Arc | User-facing alias for an alignment that lives in a sun ingress note. Same mechanic. |
| Pillar | Health, Wealth, Work, Links, Creative, Study. Lives in the user's prompts, not in plugin code. |
| Chapter | 90-day container (= calendar quarter). |
| Book | 365-day container (= calendar year). |
| Helios | Local API server on `baratie:3000` for ephemeris data. Provided by the Moon Phase plugin. |
