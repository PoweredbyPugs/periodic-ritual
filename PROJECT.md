# Periodic Ritual — Project Document

> Obsidian plugin for periodic review notes. Daily Ritual was folded in as a sub-tab.

---

## Overview

Maintains any combination of independent **container types** — calendar week, calendar month, calendar quarter, calendar year, lunar cycle, lunar phase, solar cycle, solar zodiac, plus user-defined custom boundaries. Each container has a template, save directory, boundary detector, data source(s), optional LLM service + system prompt + framework reinforcement, optional reflection profile, optional alignment groups.

**The plugin's job is narrow:**
1. Detect a container's boundary has been crossed.
2. Create the container note from a template.
3. Run alignment group passes (gap analysis against guideline notes).
4. Gather source notes and hand them to an LLM with the system-prompt MD file + framework file.
5. Write the LLM's YAML output to the container's frontmatter (or inline fields, or body markers).
6. Optionally run a write-back pass when the period ends (second-pass lifecycle).
7. Optionally run a reflection Q&A flow on demand.

Templater scripts in the user's vault render note bodies via Dataview. The plugin owns frontmatter; templater owns presentation.

## Design principles

1. **The system-prompt MD file is the customization layer.** Settings stay tiny. Behavior changes by editing markdown, not code.
2. **The framework file is the thinking-model layer.** Injected at the highest-attention slot in the user message (right before output instructions) so procedural guidance, mental models, and lenses survive long source payloads.
3. **Containers are independent.** No mutually-exclusive modes. Any combination. Each has its own LLM service if desired.
4. **The LLM does aggregation.** No hand-rolled field pipeline. The plugin shovels source data and a prompt at an LLM and writes the result.
5. **Anti-fragile.** Skip a week, nothing breaks. Empty periods still generate notes. The LLM aggregates whatever exists.
6. **Goals are anchors, not prisons.** Alignments surface patterns. They do not produce shame, compliance scores, or red/green dashboards.
7. **Templater stays.** It renders bodies via Dataview. The plugin owns frontmatter; templater owns presentation. Complementary.
8. **Daily Ritual is upstream.** Periodic Ritual reads what Daily Ritual already writes. It does not modify daily notes.
9. **Multi-source.** A container can read from daily notes + other containers + named data sources simultaneously. Merged, deduped, fed to the LLM as one payload.

## Repo and build

- GitHub: `poweredbypugs/periodic-ritual`
- Plugin id: `periodic-ritual`
- User-facing name: **Periodic Ritual** (in `manifest.json`)
- Version: 1.3.0
- Plugin install path: `KAI/.obsidian/plugins/periodic-ritual/`
- Working clone: `~/Documents/Plugin Project/periodic-ritual/`
- **Plain JS, no build step, no TypeScript.** `main.js` is the source of truth — same convention as Daily Ritual. Edit, reload, done.

```
periodic-ritual/
├── main.js          — all plugin code (~13500 lines)
├── manifest.json    — name: "Periodic Ritual", id: "periodic-ritual"
├── styles.css       — graph view + settings styling
├── data.json        — user settings (gitignored)
├── PROJECT.md       — this file
├── README.md        — user-facing docs (beginner-friendly quick start + deep dives)
├── bulbasaur.gif    — loader animation asset
├── prompts/         — starter system prompts (5 files, embedded in main.js too)
│   ├── calendar-month.md
│   ├── calendar-week.md
│   ├── chapter-quarter.md
│   ├── lunar-phase.md
│   ├── sun-ingress.md
│   └── README.md
└── boundaries/      — sample custom boundary scripts (4 files)
    ├── pr-daily.js
    ├── pr-fortnight.js
    ├── pr-ki-9day.js
    ├── pr-monday-week.js
    └── README.md
```

---

## Primitives

Eight first-class objects. Each lives in its own settings section and is a node type in the graph view.

### Container

The unit of periodic aggregation.

```js
{
  id: "pr-...",
  name: "Weekly Review",
  enabled: true,
  useSystemPrompt: true,       // local toggle, respects global master in General
  useFramework: true,          // local toggle, respects global master in General
  framework: "Frameworks/wu-xing-lens.md",  // file path, read at runtime via loadTemplate()
  boundaryDetector: "calendar-week",
  generateAt: "start" | "end",
  writeBackAt: "" | "end" | "start",  // enables second-pass lifecycle
  runLLMAt: "generate" | "writeback" | "both",  // which phase(s) the main LLM fires at
  template: "Templates/weekly.md",
  saveDir: "Home/Weekly",
  naming: "W{{week}}-{{year}}",
  metadataPlacement: "frontmatter" | "inline" | "none",
  // Multi-source: array of { type: "daily" } | { type: "container", containerId }
  //             | { type: "dataSource", dataSourceId }
  dataSource: { sources: [{ type: "daily" }] },
  systemPromptFile: "Templates/prompts/weekly-prompt.md",
  llmServiceId: "lsv-...",
  reflectionId: "rf-...",
  lastGeneratedEnd: "2026-04-12",
}
```

### Boundary

Built-in or custom. Eight built-ins: calendar-week, calendar-month, calendar-quarter, calendar-year, lunar-cycle, lunar-phase, solar-cycle, sun-ingress (Solar Zodiac). Custom boundaries are user-provided JS modules:

```js
module.exports = function(date, app, plugin) {
  return { start: Date, end: Date, tokens: { ... } };
};
```

Each custom boundary has `{ id, name, scriptPath, description }`. The description is prepended to the container's system prompt as orienting context.

### LLM Service

```js
{
  id: "lsv-...",
  name: "Gemini Flash",
  provider: "gemini" | "openai" | "anthropic" | "openrouter" | "lmstudio" | "openclaw",
  apiKey: "...",
  model: "gemini-2.0-flash-exp",
  baseUrl: "",
}
```

Six providers. All HTTP uses `requestUrl` to bypass CORS.

### Data Source

Named, reusable reference to a note or folder. Two modes:
- **static** — one specific note, always read that file
- **dynamic** — a folder of notes; consumer determines the query:
  - Container consumer -> period-filtered (by `pr-start/end` frontmatter, mtime fallback)
  - Alignment group consumer -> single latest note (by mtime)

```js
{
  id: "ds-...",
  name: "Life charter",
  mode: "static" | "dynamic",
  notePath: "Core/Charter.md",     // static only
  folderPath: "Journal/Months",    // dynamic only
}
```

Defined in Settings -> General -> Data sources. Rendered as teal nodes in the graph view.

### Alignment Group

Gap-analysis pass attached to a container. Reads guidelines from a source (DataSource or container), auto-discovers `{prefix}_*` fields as individual alignments, compares against the container's subdivision activity, writes results back to the container note.

```js
{
  id: "ag-...",
  name: "Life alignments",
  prefix: "alignment",
  containerId: "",               // wire-driven (target container)
  sourceKind: "data-source",     // wire-driven or dropdown
  sourceId: "ds-...",
  llmServiceId: "lsv-...",
  systemPromptFile: "Prompts/gap-analysis.md",
  useSystemPrompt: true,
  useFramework: true,
  framework: "Frameworks/alignment-framework.md",
  includeAggregatedSummary: true,
  defaultMode: "separate",
  defaultTarget: "{prefix}_{name}",
  defaultTemplate: "",
  overrides: {},                 // per-alignment: { mode, target, template }
  runAt: "generate" | "writeback" | "both",  // which phase(s) the group fires at
  writeTo: "frontmatter" | "inline" | "body", // where output is written
  combined: false,               // when true, all alignments feed into one unified narrative
  combinedOutputKey: "",         // defaults to {prefix}_combined
  combinedMaxSentences: 10,      // max sentences for combined output
}
```

**Four output modes** per discovered alignment:

| Mode | LLM? | What it does |
|---|---|---|
| `separate` | yes | LLM narrative per key -> `{prefix}_{name}` |
| `rewrite` | yes | LLM concise string -> replaces target key |
| `prepend` | **no** | Template splice with `{entries}` from subdivisions, no LLM call |
| `combined` | yes | One unified narrative for all discovered alignments -> `combinedOutputKey` |

**Per-alignment config precedence:**
1. Source-note meta keys (`alignment_health_target`, `_mode`, `_template`) — highest
2. Group `overrides` map — middle
3. Group `defaultMode` / `defaultTarget` / `defaultTemplate` — fallback

**Template tokens** (prepend mode): `{guideline}`, `{entries}`, `{existing}`, `{name}`

`{entries}` = collected subdivision field values via `collectPRFieldFromSubdivisions`, joined with ", ".

**LLM bundling:** all LLM-mode alignments in a group are sent in ONE API call. Splice-mode (prepend) alignments run as pure string operations — no tokens, no latency.

**Instructions isolation:** the bundled prompt explicitly tells the LLM to treat each alignment independently, not cross-reference, not merge concepts across dimensions.

**Phase control:** `runAt` (generate/writeback/both) determines which phase the group fires at. `writeTo` (frontmatter/inline/body) determines where output lands. Inline writes use `key:: value` format. Body writes use `{{pr:key}}` markers.

**Combined mode:** when enabled, all discovered alignments feed into a single unified narrative. Output key defaults to `{prefix}_combined`. `combinedMaxSentences` controls length. Uses its own system prompt, framework, and LLM service (all separate from the container's).

### Reflection

Reusable Q&A profile. Attached to a container via `container.reflectionId`. Runs on demand via the "Periodic Ritual: Reflect" command, not at boundary. The command opens a picker showing containers with reflections that have generated notes.

```js
{
  id: "rf-...",
  name: "Weekly reflection",
  questions: [ ... ],           // inject + output config per question
  useLLM: false,
  replaceAutoLLM: false,
  includeAlignmentContext: false,
  promptPrepend: "",
}
```

**Five source options** for variable injection per question:
| Source | Meaning |
|---|---|
| `current` | Last boundary crossed (current note of this container) |
| `previous-period` | Previous note of the same container |
| `note` | A specific .md file by path |
| `container-current` | Current corresponding note of another container |
| `container-previous` | Previous note of another container |

### Show Output (graph-only)

Debugging/inspection node. One universal `in-any` input, no output. "Dry Run" button probes the wired upstream node and renders inline structured output. Actually calls the LLM in dry-run mode (no file writes, returns parsed keys for preview). Progress bar persists through the entire async run. Container probe also dry-runs attached alignment groups. Auto-resize on result.

---

## Generation pipeline (at boundary)

1. **Boundary check.** Walk every enabled container in topological order (by dataSource dependencies). Ask the boundary detector "has a new period started since lastGeneratedEnd?"
2. **Note creation.** Template -> token resolution -> `vault.create` -> metadata stamp -> open file.
3. **Alignment groups run FIRST.** For each group attached to this container, filtered by `group.runAt` vs current phase ("generate" or "writeback"):
   - Resolve guidelines source -> latest note
   - Auto-discover `{prefix}_*` fields (skip meta keys)
   - Resolve per-alignment config (mode, target, template)
   - Splice-mode (prepend) writes run immediately (no LLM)
   - LLM-mode alignments bundled into one API call using the **group's own system prompt** + **group's framework file** (NOT the container's)
   - Write results to container note per `group.writeTo` setting (frontmatter, inline, or body markers)
4. **Main LLM aggregation** (filtered by `container.runLLMAt` vs current phase):
   - Uses the **container's system prompt** + **container's framework file** (NOT the alignment group's)
   - Reads source payload with `includePreviousFrontmatter: true` so it sees alignment results from step 3
   - Container's system prompt can reference alignment results narratively
   - Parse YAML response, merge into frontmatter
5. **Legacy single alignments** (backward compat, if any exist) run after main aggregation.
6. **propagatePRFrontmatterToBody** — syncs frontmatter values to inline fields (`key:: value`) and `{{pr:key}}` body markers.
7. **Update `lastGeneratedEnd`.**

**System prompts never bleed between layers.** Each LLM call uses its own system prompt file. The alignment group call and the main container call are completely isolated — different system prompts, different framework files, different instruction blocks.

### Write-back lifecycle

A container's `writeBackAt` field enables a second pass on existing notes. When set to "end" or "start", the catch-up flow detects when a write-back is due (e.g., the period has ended) and triggers `writeBackToPRContainerNote`. This runs the same pipeline as generation but with phase set to "writeback", so only primitives whose `runAt`/`runLLMAt` includes "writeback" (or "both") will fire. This allows alignment groups and LLM aggregation to be split across the two passes — for example, alignments at generate time, main LLM at writeback time.

### Framework reinforcement

A markdown FILE (not inline text) read via `loadTemplate()`. Injected at the highest-attention slot in the LLM user message (right before output instructions). More reliable than system prompts for procedural thinking guidance, mental models, and analytical lenses.

Two global master switches in General settings: "Enable system prompts" and "Enable frameworks". When off, all containers/groups run without that channel. Each container/group also has local `useSystemPrompt` and `useFramework` toggles.

### YAML safety

All LLM calls append a YAML formatting requirements tail (no colons in values, no quotes, no doc markers). Alignment calls also append isolation instructions. The `parsePRLLMResponse` function runs a pre-parse sanitizer (`sanitizePRYamlForParse`) that auto-quotes ambiguous values before handing them to `parseYaml`.

### Inline field regex

Uses `[ \t]*` not `\s*` to prevent cross-line bleed from empty fields.

---

## Graph view

Node-based visual editor. Custom-built — no third-party library. DOM nodes + SVG bezier wires inside a pannable/zoomable viewport.

### Node kinds

| Node | Source array | Kind pill color |
|---|---|---|
| **Container** | `prContainers` | blue (accent) |
| **Boundary** (built-in + custom) | implicit / `prCustomBoundaries` | blue-gray |
| **LLM Service** | `prLLMServices` | green |
| **Reflection** | `prReflections` | purple |
| **Alignment Group** | `prAlignmentGroups` | orange |
| **Data Source** | `prDataSources` | teal |
| **Daily source** | implicit | faint |
| **Show Output** | `prShowNodes` | gray |

Colored kind pills appear **in node headers** (not above the card). Canvas context menus (add node) have **colored pipes** next to each option.

### Sockets

- **Container**: 5 inputs (data, boundary, llm, reflection, alignment) + 1 output
- **Alignment Group**: 2 inputs (source, llm) + 1 output (-> container in-alignment)
- **Show Output**: 1 universal input (in-any), no output
- **Data Source**: 1 output, no inputs
- All other nodes: 1 output, no inputs

### Node sizing

Each node has a resize grip (bottom-right corner). Collapsed and expanded states have **independent saved sizes** — chevron toggle swaps between them. Double-click the grip resets the current state's override.

### Interaction

Click selects a node (enables Delete/Backspace to remove). Interactive elements (dropdowns, toggles, text inputs) suppress the expand/collapse toggle so clicking controls doesn't accidentally toggle the card. Filter popover for showing/hiding node kinds.

### Persistence

`settings.prGraphLayout = { [nodeId]: { x, y, expanded, collapsed: {w,h}, expanded: {w,h} } }`

---

## Settings structure

Six outer tabs, General first:

- **General** — README link, auto-generate toggle, Features section (global system-prompt + framework masters), data sources list, daily notes folder, astrology toggles, Zodiac Calendar settings.
- **Containers** — container cards. Each: enabled, boundary, generate-at, write-back-at, run-LLM-at, template, save dir, naming (live preview), metadata, data sources list, LLM service, system prompt + use-system-prompt toggle, framework picker + use-framework toggle, reflection, Generate now.
- **Boundaries** — built-in cards + custom cards.
- **Reflection** — reflection profiles with questions + mode toggles.
- **Alignment** — Alignment Groups (primary, with discovered-alignments table per group) + legacy single alignments (if any exist).
- **LLM** — provider service definitions.

---

## Phase history

| Phase | What |
|---|---|
| 0 | Tab structure, "Existing" legacy settings preserved, additive only |
| 1 | Container primitives: template, save dir, naming, token resolution |
| 2 | LLM aggregation via configurable services |
| 3 | Auto-generation on load (boundary-driven catch-up) |
| 4 | Boundary rework: custom JS, descriptions, Fork-as-custom |
| 5 | Multi-provider LLM: Gemini, OpenAI, Anthropic, OpenRouter, LM Studio, OpenClaw |
| 6 | Reflection rework: reusable profiles with Q&A, cross-container inject/output |
| 7 | Alignments: daily-field measurement per container |
| 8 | Multi-source containers, cross-container data flow, topological catch-up |
| 9 | README + starter prompts rewrite |
| 10 | Graph view: custom node editor with pan/zoom, wire drag, snap, multi-select, marquee, filter, inspect, copy/paste, inline editors |
| 11 | Show Output nodes (dry-run probes with live LLM calls), Data Sources (static/dynamic note/folder references), Alignment Groups (auto-discovered gap analysis with prepend/rewrite/separate/combined modes, per-alignment config, one LLM call per group, framework reinforcement), Framework feature (file-based injection at highest-attention slot), global system-prompt/framework masters, node resize with per-state sizing, YAML safety (sanitizer + LLM instructions), inline field regex fix (cross-line bleed), colored kind pipes in menus, write-back lifecycle (two-pass generation with phase filtering), phase-aware runAt/runLLMAt controls, writeTo (frontmatter/inline/body) output routing, propagatePRFrontmatterToBody sync, combined alignment mode |
| 12 | Daily Ritual: midnight auto-create of today's daily note (`vault.create` with core template tokens resolved manually so the Daily Notes plugin's createDailyNote can be bypassed without focus stealing); image attachments on Alignment + Reflection questions (static / from-note / from-folder modes, gallery picker, upload-from-disk into a configured gallery folder, image-only modal steps when question text is empty). Zodiac Calendar self-rescheduling midnight refresh (one-shot timer re-armed each render, cleared in onClose). |

---

## Glossary

| Term | Meaning |
|---|---|
| **Container** | A periodic note class (weekly, monthly, lunar, etc.) |
| **Boundary detector** | Function that returns `{start, end, tokens}` for a date |
| **Source payload** | The text blob sent to the LLM (frontmatter + inline fields from source notes, no body content) |
| **Alignment Group** | Gap-analysis primitive: reads guidelines, compares against subdivisions, writes to container |
| **Data Source** | Named note/folder reference (static or dynamic) |
| **Framework** | Markdown file injected at highest-attention position in the LLM user message |
| **Splice mode** | Alignment output mode (prepend) that uses a template string with `{guideline}`, `{entries}`, `{existing}`, `{name}` tokens — no LLM call |
| **Combined mode** | Alignment output mode that merges all discovered alignments into one unified narrative |
| **Show Output** | Graph-only probe node for dry-running any upstream node |
| **Write-back** | Second-pass lifecycle: re-runs the pipeline on an existing note when the period ends/starts |
| **Phase** | Either "generate" (note creation) or "writeback" (second pass) — primitives filter by this |
| **propagatePRFrontmatterToBody** | Syncs frontmatter values to inline fields and `{{pr:key}}` body markers |
| **processFrontMatter** | Obsidian API for safe YAML writes — parse -> mutate -> serialize |
| **Helios** | Local ephemeris server (baratie:3000) used by lunar/solar boundary detectors |
