# Monthly Ritual — Project Document

## Overview
Obsidian plugin for cyclical review notes. Generates container notes (monthly/lunar/solar cycles) and subdivision notes (weekly/phase/term) from templates, pulls inline fields and frontmatter from the layer below, runs reflection modals, and optionally summarizes via LLM. Companion to **Daily Ritual**.

## Repo
- GitHub: `PoweredbyPugs/monthly-ritual` (to be created)
- Plugin location: `KAI/.obsidian/plugins/monthly-ritual/`
- **Plain JS — no build step, no TypeScript** (matches Daily Ritual)

## Architecture

### Files
```
monthly-ritual/
├── main.js          — all plugin code
├── manifest.json    — plugin metadata (id: "monthly-ritual")
├── styles.css       — minimal styling
├── data.json        — settings (gitignored)
├── PROJECT.md       — this file
└── README.md        — user-facing docs
```

### Dependencies
- Obsidian API only (no npm packages)
- **Moon Phase plugin** (optional) — required for 🌙 and ☀️ modes to resolve cycle/phase boundaries

---

## Modes

Three modes, one active at a time. Faint icon toggle in upper-right corner of the note view. Tooltip on hover.

| Icon | Mode | Container | Subdivision (default) | Subdivision (alt) |
|------|------|-----------|----------------------|-------------------|
| 📅 | Calendar | Calendar month | Weeks | — |
| 🌙 | Moon | New moon → new moon (~29.5 days) | Four lunar phases | — |
| ☀️ | Solar | Major term pair (~30 days) | Individual solar terms | Lunar phases |

- **📅 Calendar** is the default mode. No external plugin dependency.
- **🌙 Moon** and **☀️ Solar** require Moon Phase plugin for boundary dates. If not installed, these icons are disabled with tooltip "Requires Moon Phase plugin."
- ☀️ Solar mode has a sub-toggle: subdivide by solar terms (default) or lunar phases.

---

## Note Lifecycle

### Generation
1. **Container note** auto-generates at cycle **start** or **end** (user setting, default: start)
2. **Subdivision notes** auto-generate at their respective boundaries
3. Both use user-defined templates (selected via fuzzy finder in settings)
4. Both use user-defined naming conventions (template string with tokens)
5. Both use user-defined save locations (folder picker)

### Naming Tokens
Available tokens for naming conventions (resolved at generation time):

| Token | Example | Notes |
|-------|---------|-------|
| `{{year}}` | `2026` | |
| `{{month}}` | `03` | Zero-padded |
| `{{month-name}}` | `March` | Full name |
| `{{day}}` | `14` | |
| `{{date}}` | `2026-03-14` | ISO format |
| `{{cycle}}` | `03` | Cycle number within year |
| `{{phase}}` | `New Moon` | 🌙 mode only |
| `{{phase-short}}` | `new` / `q1` / `full` / `q3` | 🌙 mode only |
| `{{sign}}` | `Pisces` | 🌙/☀️ + astrology toggle |
| `{{sign-glyph}}` | `♓` | 🌙/☀️ + astrology toggle |
| `{{term}}` | `Rain Water` | ☀️ mode only |
| `{{term-cn}}` | `雨水` | ☀️ mode only |
| `{{eclipse}}` | `🝘` | 🌙 + astrology + eclipse detected |
| `{{week}}` | `11` | 📅 mode, ISO week number |
| `{{week-start}}` | `2026-03-09` | 📅 mode |
| `{{week-end}}` | `2026-03-15` | 📅 mode |

Default naming conventions:
- 📅 Container: `{{month-name}} {{year}}` → `March 2026`
- 📅 Subdivision: `Week {{week}} — {{week-start}}` → `Week 11 — 2026-03-09`
- 🌙 Container: `{{phase}} {{date}}` → `New Moon 2026-03-14`
- 🌙 Subdivision: `{{phase}} {{date}}` → `First Quarter 2026-03-22`
- ☀️ Container: `{{term}} {{year}}` → `Rain Water 2026`
- ☀️ Subdivision: `{{term}} {{date}}` → `Awakening of Insects 2026-03-05`

### Astrology Toggle (🌙/☀️ only)
- Requires Moon Phase plugin
- When on: naming tokens `{{sign}}`, `{{sign-glyph}}`, `{{eclipse}}` resolve to values
- When off: those tokens resolve to empty strings
- Two sub-toggles in settings:
  - Include sign glyphs (toggle)
  - Include eclipse flags (toggle)

---

## Field Pipeline

**Entirely optional.** Users who query with Dataview/Bases don't need this — their templates and naming conventions are sufficient. The pipeline is a convenience for pulling data up through layers automatically.

### Layer 1: Daily → Subdivision
- User defines 0+ field mappings in settings
- Each mapping: `{ source: string, type: "inline" | "frontmatter" }`
- At subdivision boundary (or on command), plugin finds all daily notes in the date range
- Daily note identification: uses the same date-from-filename parsing as Daily Ritual (`parseDateFromFilename()`)
- Reads specified fields from each daily note
- Writes collected values into the subdivision note (appended under a section or as multi-value field — follow template structure)

### Layer 2: Subdivision → Container
- Same mechanic, independently configured
- Reads from subdivision notes in the cycle's date range
- Writes into the container note

### Collection Format
When pulling fields, values are collected chronologically. Format in the target note:
```
work:: Faced the Work — TALA edit. | Avoidant — reorganized channels. | Faced the Work — rough cut done.
```
Each day's value separated by ` | `. If a day has no value for that field, it's skipped (no empty entries).

---

## Reflection Modals

Two independent reflection flows, same progressive disclosure pattern as Daily Ritual.

### Architecture (per reflection)
Each reflection has:
- **Questions array** — ordered list of question objects (same structure as Daily Ritual)
  ```js
  {
    text: "",                    // question text
    injectVar: false,            // show a value from another note above this question
    varField: "",                // inline field name to pull
    varSource: "previous",       // "previous" (previous note in sequence) or "note"
    varNotePath: "",             // specific note path
    outputToField: false,        // write answer to its own field
    outputFieldName: "",         // field name
    outputFieldType: "inline",   // "inline" or "frontmatter"
  }
  ```
- **System prompt prepend** — short text area (behavioral directives, inline in settings)
- **System prompt file** — fuzzy finder to select a `.md` file in the vault
- **Data pass-through** — what additional data to send to the LLM alongside answers:
  - `answers-only` — just the Q&A
  - `selected-fields` — Q&A + specified fields from the note
  - `whole-note` — Q&A + full note content
- **Output field** — user-defined name and type (inline or frontmatter)

### "Previous note" for variable injection
- Container reflection: "previous" = the prior container note (last month / last lunar cycle / last solar term pair)
- Subdivision reflection: "previous" = the prior subdivision note (last week / last phase / last term)

### Commands (modular naming)
Command names adapt based on active mode + subdivision type:

| Mode | Subdivision | Container Command | Subdivision Command |
|------|-------------|-------------------|---------------------|
| 📅 | Weeks | Monthly Reflection | Weekly Reflection |
| 🌙 | Phases | Moon Cycle Reflection | Phase Reflection |
| ☀️ | Terms | Solar Cycle Reflection | Term Reflection |
| ☀️ | Lunar phases | Solar Cycle Reflection | Phase Reflection |

Commands are re-registered when mode changes. Each command:
1. Checks if active file matches the expected note type (container or subdivision) — warns if not
2. Loads injected variables
3. Opens ReflectionModal (progressive disclosure, one question at a time, Enter to advance)
4. On submit: writes answers to fields, optionally runs LLM summary, writes summary to output field

---

## LLM Integration

Same provider architecture as Daily Ritual. Shared across both reflection types.

### Providers
- **Google Gemini** — `system_instruction` (snake_case), `generateContent` endpoint
- **OpenAI** — `system` role in messages, chat completions endpoint
- **Anthropic Claude** — `system` field in body, messages endpoint

### Settings (shared)
- Provider dropdown
- API key (password field)
- Model dropdown with "Fetch Models" button (auto-populated from provider API)

### Per-Reflection Summary Config
Each reflection (container + subdivision) independently configures:
- Pass to LLM: `answers-only` | `+ selected fields` | `+ whole note`
- Fields to include (multi-select, when "selected fields" chosen)
- Output field name (user-defined, not hardcoded)
- Output field type (inline or frontmatter)

### Prompt Structure (matches Daily Ritual pattern)
```
System role: [system prompt prepend] (behavioral directives)

User message:
  ## Mental Model (apply this lens to the reflection below)
  [contents of system prompt .md file]
  ---
  ## My Reflection
  **Q1: [question text]**
  [answer]

  **Q2: [question text]**
  [answer]
  ---
  ## Context Data  (only if pass-through includes fields/note)
  [field values or note content]
  ---
  Now follow the system instructions above precisely. Produce only the final output, nothing else.
```

---

## Settings Structure

### Layout
```
═══════════════════════════════════════════
 MODE
═══════════════════════════════════════════
Cycle mode:  📅 │ 🌙 │ ☀️    (icon toggle, tooltip on hover)
             Controls which settings sections appear below.
             📅 = Calendar (months + weeks)
             🌙 = Moon (lunar cycles + phases)
             ☀️ = Solar (solar terms + terms or phases)

═══════════════════════════════════════════
 NOTES
═══════════════════════════════════════════

── Container ──
Template:            [fuzzy finder → .md file]
Save location:       [folder picker]
Naming convention:   [text field]  (token reference link)
Generate at:         [cycle start ▾ │ cycle end]

── Subdivision ──
Template:            [fuzzy finder → .md file]
Save location:       [folder picker]
Naming convention:   [text field]  (token reference link)

── Astrology ──  (visible only in 🌙/☀️ + Moon Phase detected)
Include sign glyphs:    [toggle]
Include eclipse flags:  [toggle]

── Solar Subdivision ──  (visible only in ☀️)
Subdivide by:        [Solar terms ▾ │ Lunar phases]

═══════════════════════════════════════════
 FIELD MAPPING  (all optional)
═══════════════════════════════════════════

── Daily → Subdivision ──
[+ Add field]
┌──────────────────────────────────────────┐
│ Source: [text]    Type: [inline ▾ │ fm]  │
│ Source: [text]    Type: [inline ▾ │ fm]  │  (× to remove)
└──────────────────────────────────────────┘

── Subdivision → Container ──
[+ Add field]
┌──────────────────────────────────────────┐
│ Source: [text]    Type: [inline ▾ │ fm]  │
└──────────────────────────────────────────┘

═══════════════════════════════════════════
 LLM
═══════════════════════════════════════════

Enable LLM:          [toggle]

(when enabled:)
Provider:             [Gemini ▾ │ OpenAI │ Anthropic]
API Key:              [password field]
Model:                [dropdown]  [Fetch Models]

═══════════════════════════════════════════
 REFLECTION  ─── Tabs: [Container] [Subdivision]
═══════════════════════════════════════════

(Each tab contains independently:)

── Questions ──
[Q1]  [←] [question text___________] [→] [↑↓×]
  (← expands: inject variable config)
  (→ expands: output to field config)
[Q2]  [←] [question text___________] [→] [↑↓×]
[+ Add Question]

── Summary ──
System prompt prepend:  [text area, 3 rows]
System prompt file:     [fuzzy finder]  [× clear]
Pass to LLM:            [answers only ▾ │ + fields │ + whole note]
Fields to include:      [multi-select]  (when "+ fields" selected)
Output field name:      [text field]
Output field type:      [inline ▾ │ frontmatter]
```

---

## Implementation Plan

### Phase 1: Core — Note Generation
1. Plugin scaffold (manifest, settings, onload/onunload)
2. Mode setting (📅/🌙/☀️) with conditional settings rendering
3. Calendar mode: month boundary detection, container + weekly subdivision note generation from templates
4. Template loading + token resolution
5. Naming convention engine
6. Save location handling
7. Commands: "Generate [Container]" and "Generate [Subdivision]" (manual triggers for v1)

**Milestone: can create monthly + weekly notes from templates with correct names in correct folders.**

### Phase 2: Moon & Solar Modes
8. Moon Phase plugin integration — API for reading lunar boundaries (new/q1/full/q3 dates)
9. Moon mode: lunar cycle boundary detection, container + phase subdivision generation
10. Solar mode: solar term boundary detection, container + term subdivision generation
11. Solar mode alt: lunar phase subdivisions within solar container
12. Astrology toggle: sign glyph + eclipse token resolution (reads from Moon Phase plugin)

**Milestone: all three modes generate correct notes at correct boundaries.**

### Phase 3: Field Pipeline
13. Daily note discovery (date-from-filename parsing, shared with Daily Ritual)
14. Inline field + frontmatter reader
15. Daily → Subdivision field collection (chronological, pipe-separated)
16. Subdivision → Container field collection
17. Field mapping settings UI (add/remove rows, source + type)
18. "Collect Fields" command (manual trigger — runs pipeline for active note)

**Milestone: can pull `today::` values from daily notes into weekly note, weekly summaries into monthly note.**

### Phase 4: Reflection Modals
19. ReflectionModal (reuse Daily Ritual pattern — progressive disclosure, Enter to advance)
20. Question objects with inject/output config
21. Container reflection flow (questions → field writes → optional LLM)
22. Subdivision reflection flow (same, independent config)
23. "Previous note" resolution per reflection type
24. Modular command naming based on active mode
25. Tab UI in settings for container vs subdivision reflection config

**Milestone: can run weekly reflection modal, answers write to fields, LLM summary writes to output field.**

### Phase 5: LLM Integration
26. Provider architecture (Gemini/OpenAI/Anthropic — port from Daily Ritual)
27. System prompt prepend + file loading
28. Prompt builder (structured reflection + optional context data)
29. Data pass-through options (answers only / + fields / + whole note)
30. Summary output writing
31. Loading animation during LLM calls
32. Test/debug modal (like Daily Ritual's "Test Daily Ritual" command)

**Milestone: full pipeline works — generate note, collect fields, run reflection, get LLM summary.**

### Phase 6: Polish
33. Mode toggle polish (icon styling, tooltip hover states in settings tab)
34. Auto-generation scheduling (detect when a boundary has passed and offer to generate)
35. Edge cases: missing daily notes, partial cycles, mode switching mid-cycle
36. Companion script support (same pattern as Daily Ritual — folder + file + validation)
37. Migration handling for settings changes
38. README

---

## Code Patterns (from Daily Ritual)

### Carry forward as-is:
- `makeQuestion()` factory
- `PROVIDERS` object with `buildUrl`, `buildBody`, `extractText`, `headers`, `listModels`
- `ReflectionModal` (progressive disclosure)
- `MarkdownFileSuggestModal` (fuzzy finder)
- `LoadingModal` + `DebugModal`
- `parseDateFromFilename()` + `formatDateForFilename()`
- `readInlineField()` (regex-based inline field reader)
- `escapeRegex()`
- Settings persistence pattern (`loadSettings` / `saveSettings` / `loadData`)

### New code needed:
- Mode setting with conditional settings rendering (📅/🌙/☀️ + subdivision variant)
- Boundary detection engine (calendar = date math, lunar = Sun-Moon elongation scan, solar = Sun ingresses from Helios)
- Moon Phase plugin bridge (read serverUrl, reuse glyph/emoji helpers)
- Template engine (token resolution)
- Field collection engine (multi-note reader + chronological assembly)
- Note generator (template + tokens + save location → create file)
- Tabbed settings UI (container vs subdivision reflection config)
- Dynamic command registration (re-register on mode change)
- Mode toggle UI component (StatusBarItem or view decoration)

### Helios API (baratie:3000 — via Moon Phase plugin's serverUrl):
- `GET /moon-now` → `{ moonPhase, moonSign, degreeInSign, moonAge }` (moonAge = days since last new moon)
- `GET /weekly-major-phase` → `{ date, moonPhase, moonSign }` or null
- `GET /planets-now` → `{ planets: [{ name, sign, degreeInSign, isRetrograde }] }`
- `GET /planetary-ingresses?planet=Sun&start=YYYY-MM-DD&end=YYYY-MM-DD` → Sun sign changes (= major solar terms)
- `GET /planetary-ingresses?planet=Moon&start=X&end=Y` → Moon sign changes
- `GET /planetary-ingresses?start=X&end=Y` → all planets (filter client-side)
- `GET /void-of-course-moons` → VOC periods
- `GET /dignity-score?planet=X&sign=Y&degree=Z` → dignity data

### Moon Phase plugin bridge (`obsidian-moon`):
- Access: `this.app.plugins.plugins["obsidian-moon"]`
- Settings: `.settings.serverUrl` (Helios URL, e.g. `http://baratie:3000`)
- API helpers (reuse for display): `.api.getMoonPhaseEmoji(phase)`, `.api.getPlanetGlyph(name)`
- Detection: check `this.app.plugins.plugins["obsidian-moon"]` exists before enabling 🌙/☀️ modes

### Key Obsidian APIs:
- `this.app.vault.create(path, content)` — create notes
- `this.app.vault.read(file)` / `this.app.vault.modify(file, content)` — read/write
- `this.app.vault.getAbstractFileByPath(path)` — find files
- `this.addCommand()` — register commands (call in onload, re-register on mode change)
- `this.addStatusBarItem()` — potential location for mode toggle
- `this.app.plugins.plugins["moon-phase"]` — access Moon Phase plugin API (if available)

---

## Resolved Questions

1. **Moon Phase plugin API** — Exposes `this.api` with: `getMoonData()`, `getWeeklyMajorPhase()`, `getPlanetaryData()`, `getPlanetGlyph()`, `getMoonPhaseEmoji()`, `getAspectsData()`, `getVOCStatus()`, `getTransitsData()`, `getDignityScore()`. No phase boundary dates or ingress data — it's a "right now" reader. **Solution:** Read `serverUrl` from Moon Phase plugin's settings (`this.app.plugins.plugins["obsidian-moon"].settings.serverUrl`) and call Helios directly. Use `/planetary-ingresses?planet=Sun&start=X&end=Y` for solar terms (Sun sign changes = major terms). **Lunar phase boundaries** are determined by Sun-Moon angular separation (aspect geometry): 0° conjunction = New Moon, 90° waxing square = First Quarter, 180° opposition = Full Moon, 270° waning square = Last Quarter. Scan forward by computing Sun-Moon elongation at daily intervals via `/planets-now` until the target angle is crossed, then narrow to exact date. Use Moon Phase plugin's `getPlanetGlyph()` and `getMoonPhaseEmoji()` for display glyphs.

2. **Auto-generation trigger** — Command-triggered for v1. On plugin load, check if current boundary has passed since last generated note. If so, show Notice: "New [cycle] started. Run [command] to generate." No silent auto-creation.

3. **Mode toggle placement** — Settings-level control, not a runtime widget. The 📅 🌙 ☀️ toggle lives in the settings tab and controls which sections of settings are visible (conditional rendering in `display()` based on `this.plugin.settings.mode`). 📅 shows week config. 🌙 shows phase config + astrology toggles. ☀️ shows term config + subdivision choice + astrology toggles. No status bar item.

4. **Daily note folder convention** — Configurable "Daily notes folder" setting in plugin settings. Defaults to vault root. Plugin scans that folder for files matching date-from-filename parser.

5. **Mode switching** — Existing notes stay. No deletion, no migration. New mode generates its own notes going forward. Half-finished cycle notes become orphans — still valid, still queryable.

---

## Calendar View (v1.1)

Lunisolar calendar view added as an `ItemView` in the right sidebar.

### Architecture
- **Container**: Zodiac sign period (~30 days), derived from `ZODIAC_DATES` approximate boundaries
- **Subdivisions**: Lunar phase periods within the sign, from Helios `/moon-phases` endpoint (Swiss Ephemeris)
- **View class**: `RitualCalendarView extends ItemView`, registered as `monthly-ritual-calendar`
- **Ribbon icon**: `calendar-days`, plus command `open-calendar`

### Data Flow
1. `getZodiacSignPeriod(date)` determines which sign the display date falls in
2. `getPhasePeriodsFromHelios(plugin, start, end)` calls `/moon-phases?start=X&end=Y` for exact phase boundaries
3. Phases are filtered to those overlapping the sign period, but full phase days are rendered (out-of-sign days dimmed)
4. Moon sign per phase comes directly from the `/moon-phases` response
5. Minor solar term (15° of sign) highlighted via `/sun-degree` endpoint (pending) or `/planets-now` fallback

### Navigation
- `<` / `>` calls `navigateZodiacSign(date, delta)` to move between signs
- `TODAY` resets to current date
- Header click opens the zodiac sign note (resolved via `calendarNoteNaming` template)
- Moon emoji click opens the lunar phase note (resolved via `lunarNoteNaming[phase]` template)
- Day click opens the daily note

### Settings Added
- `calendarTimezone` — timezone for calculations (default: `America/New_York`)
- `calendarNoteFolder` — shared folder for solar/lunar notes
- `calendarNoteNaming` — zodiac sign note template (default: `☀️ Sun in {{sign}}`)
- `lunarNoteNaming` — per-phase naming templates with tokens: `{{phase-name}}`, `{{phase-emoji}}`, `{{moon-sign}}`, `{{moon-glyph}}`

### Helios Endpoints
- `/moon-phases?start=YYYY-MM-DD&end=YYYY-MM-DD` — **new endpoint** added to server.js. Scans Sun-Moon elongation every 6 hours, binary-searches to ~5 minute precision for exact phase crossings (0°, 90°, 180°, 270°). Returns date, time, phase name, moon sign, degree.
- `/sun-degree?degree=15&sign=Aries` — **new endpoint** (pending deployment). Finds exact date Sun reaches a specific degree in a sign. Used for minor solar term highlight.
- `/planets-now` — existing endpoint, used as fallback for Sun degree calculation
- `/planetary-ingresses?planet=Moon` — existing endpoint, used for moon sign lookup

---

## Non-Goals (v1)
- No simultaneous modes
- No cross-cycle trend analysis
- No auto-fire LLM summaries (command-triggered only)
- No Daily Ritual code changes (Monthly Ritual reads what DR already writes)
- No mobile-specific UI (desktop-first, mobile works but not optimized)
