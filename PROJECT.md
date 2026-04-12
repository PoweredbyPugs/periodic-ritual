# Periodic Ritual — Project Document

> Obsidian plugin for periodic review notes. Companion to **Daily Ritual**.
> Plugin id stays `monthly-ritual` for zero migration friction. User-facing name is **Periodic Ritual**.

---

## Overview

Maintains any combination of independent **container types** — calendar week, calendar month, calendar quarter, calendar year, lunar cycle, lunar phase, solar cycle, solar zodiac, plus user-defined custom boundaries. Each container has a template, save directory, boundary detector, data source(s), optional LLM service + system prompt + framework reinforcement, optional reflection profile, optional alignment groups.

**The plugin's job is narrow:**
1. Detect a container's boundary has been crossed.
2. Create the container note from a template.
3. Run alignment group passes (gap analysis against guideline notes).
4. Gather source notes and hand them to an LLM with the system-prompt MD file + framework file.
5. Write the LLM's YAML output to the container's frontmatter.
6. Optionally run a reflection Q&A flow on demand.

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

- GitHub: `poweredbypugs/monthly-ritual`
- Plugin id: `monthly-ritual` (unchanged for migration safety)
- User-facing name: **Periodic Ritual** (in `manifest.json`)
- Plugin install path: `KAI/.obsidian/plugins/monthly-ritual/`
- Working clone: `~/Documents/Plugin Project/monthly-ritual/`
- **Plain JS, no build step, no TypeScript.** `main.js` is the source of truth — same convention as Daily Ritual. Edit, reload, done.

```
monthly-ritual/
├── main.js          — all plugin code (~9000+ lines as of Phase 11)
├── manifest.json    — name: "Periodic Ritual", id: "monthly-ritual"
├── styles.css       — graph view + settings styling
├── data.json        — user settings (gitignored)
├── PROJECT.md       — this file
├── README.md        — user-facing docs (beginner-friendly quick start + deep dives)
├── bulbasaur.gif    — loader animation asset
├── prompts/         — starter system prompts (5 files, embedded in main.js too)
└── boundaries/      — sample custom boundary scripts (3 files)
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
  framework: "Frameworks/wu-xing-lens.md",  // file path, read at runtime
  boundaryDetector: "calendar-week",
  generateAt: "start" | "end",
  template: "Templates/weekly.md",
  saveDir: "Home/Weekly",
  naming: "W{{week}}-{{year}}",
  metadataPlacement: "frontmatter" | "inline" | "none",
  metadataInlineKey: "periodic-ritual",
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

Built-in or custom. Seven built-ins: calendar-week, calendar-month, calendar-quarter, calendar-year, lunar-cycle, lunar-phase, solar-cycle, sun-ingress (Solar Zodiac). Custom boundaries are user-provided JS modules:

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
  - Container consumer → period-filtered (by `pr-start/end` frontmatter, mtime fallback)
  - Alignment group consumer → single latest note (by mtime)

```js
{
  id: "ds-...",
  name: "Life charter",
  mode: "static" | "dynamic",
  notePath: "Core/Charter.md",     // static only
  folderPath: "Journal/Months",    // dynamic only
}
```

Defined in Settings → General → Data sources. Rendered as teal nodes in the graph view. Output wires into container `in-data` sockets or alignment group `in-source` sockets.

### Alignment Group

Gap-analysis pass attached to a container. Reads guidelines from a source (DataSource or container), auto-discovers `{prefix}_*` fields as individual alignments, compares against the container's subdivision activity, writes results back to the container's frontmatter.

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
}
```

**Four output modes** per discovered alignment:
| Mode | LLM? | What it does |
|---|---|---|
| `separate` | yes | LLM narrative → `{prefix}_{name}` key |
| `rewrite` | yes | LLM concise string → replaces target key |
| `prepend` | **no** | Template splice with `{entries}` from subdivisions |

**Per-alignment config precedence:**
1. Source-note meta keys (`alignment_health_target`, `_mode`, `_template`) — highest
2. Group `overrides` map — middle
3. Group `defaultMode` / `defaultTarget` / `defaultTemplate` — fallback

**Template tokens** (prepend only): `{guideline}`, `{entries}`, `{existing}`, `{name}`

`{entries}` = collected subdivision field values for the alignment's short name, joined with ", ".

**LLM bundling:** all LLM-mode alignments in a group are sent in ONE API call. Splice-mode alignments run as pure string operations — no tokens, no latency.

**Instructions isolation:** the bundled prompt explicitly tells the LLM to treat each alignment independently, not cross-reference, not merge concepts across dimensions.

### Reflection

Reusable Q&A profile. Attached to a container via `container.reflectionId`. Runs on demand, not at boundary.

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

### Show Output (graph-only)

Debugging/inspection node. One universal `in-any` input, no output. "Dry Run" button probes the wired upstream node and renders inline structured output (▼ INPUT / ▲ OUTPUT). Actually calls the LLM for containers and alignment groups (dry-run mode: skips file writes, returns parsed keys for preview). Progress bar stays visible through the entire async run.

---

## Generation pipeline (at boundary)

1. **Boundary check.** Walk every enabled container in topological order (by dataSource dependencies). Ask the boundary detector "has a new period started since lastGeneratedEnd?"
2. **Note creation.** Template → token resolution → `vault.create` → metadata stamp → open file.
3. **Alignment groups run FIRST.** For each group attached to this container:
   - Resolve guidelines source → latest note
   - Auto-discover `{prefix}_*` fields (skip meta keys)
   - Resolve per-alignment config (mode, target, template)
   - Splice-mode writes run immediately (no LLM)
   - LLM-mode alignments bundled into one API call using the **group's own system prompt** (NOT the container's) + **group's framework file** (if set)
   - Write results to container frontmatter
4. **Main LLM aggregation** (unless suppressed by `replaceAutoLLM` reflection):
   - Uses the **container's system prompt** (NOT the alignment group's) + **container's framework file** (if set)
   - Reads source payload + previous frontmatter (which now includes alignment outputs from step 3)
   - Container's system prompt can reference alignment results narratively
   - Parse YAML response, merge into frontmatter
5. **Legacy single alignments** (if any) run after main aggregation.
6. **Update `lastGeneratedEnd`.**

**System prompts never bleed between layers.** Each LLM call uses its own system prompt file. The alignment group call and the main container call are completely isolated — different system prompts, different framework files, different instruction blocks.

### Framework reinforcement

A markdown file whose contents get injected into the LLM user message at the highest-attention position (right before the YAML output instructions). More reliable than system prompts for procedural thinking guidance, mental models, and analytical lenses.

Two global master switches in General: "Enable system prompts" and "Enable frameworks". When off, all containers/groups run without that channel. Each container/group also has local `useSystemPrompt` and `useFramework` toggles.

### YAML safety

All LLM calls append a YAML formatting requirements tail (no colons in values, no quotes, no doc markers). The `parsePRLLMResponse` function also runs a pre-parse sanitizer (`sanitizePRYamlForParse`) that auto-quotes ambiguous values before handing them to `parseYaml`.

---

## Graph view (Phase 10+11)

Node-based visual editor. Custom-built — no third-party library. DOM nodes + SVG bezier wires inside a pannable/zoomable viewport.

### Node kinds

| Node | Source | Kind pill color |
|---|---|---|
| **Container** | `prContainers` | blue (accent) |
| **Boundary** (built-in) | implicit | blue-gray |
| **Boundary** (custom) | `prCustomBoundaries` | blue-gray |
| **LLM Service** | `prLLMServices` | green |
| **Reflection** | `prReflections` | purple |
| **Alignment** | `prAlignments` | orange |
| **Alignment Group** | `prAlignmentGroups` | darker orange |
| **Data Source** | `prDataSources` | teal |
| **Daily source** | implicit | faint |
| **Show Output** | `prShowNodes` | gray |

All nodes have a colored kind pill in the header. Canvas context menus (add node) have colored pipes next to each option.

Sockets:
- **Container**: 5 inputs (data, boundary, llm, reflection, alignment) + 1 output
- **Alignment Group**: 2 inputs (source, llm) + 1 output (→ container in-alignment)
- **Show Output**: 1 universal input (in-any), no output
- **Data Source**: 1 output, no inputs
- All other nodes: 1 output, no inputs

### Node sizing

Each node has a resize grip (bottom-right corner). Collapsed and expanded states have **independent saved sizes** — chevron toggle swaps between them. Double-click the grip resets the current state's override.

### Persistence

`settings.prGraphLayout = { [nodeId]: { x, y, expanded, collapsed: {w,h}, expanded: {w,h} } }`

---

## Settings structure

Seven outer tabs, General first:

- **General** — README link, auto-generate toggle, Features section (global system-prompt + framework masters), data sources list, daily notes folder, astrology toggles, Zodiac Calendar settings.
- **Containers** — container cards. Each: enabled, boundary, generate-at, template, save dir, naming (live preview), metadata, data sources list, LLM service, system prompt + use-system-prompt toggle, framework picker + use-framework toggle, reflection, Generate now.
- **Boundaries** — built-in cards + custom cards.
- **Reflection** — reflection profiles with questions + mode toggles.
- **Alignment** — Alignment Groups (primary, with discovered-alignments table per group) + single alignments (if any exist).
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
| 11 | Show Output nodes (dry-run probes with live LLM calls), Data Sources (static/dynamic note/folder references), Alignment Groups (auto-discovered gap analysis with prepend/rewrite/separate modes, per-alignment config, one LLM call per group, framework reinforcement), Framework feature (file-based injection at highest-attention slot), global system-prompt/framework masters, node resize with per-state sizing, YAML safety (sanitizer + LLM instructions), inline field regex fix (cross-line bleed), colored kind pipes in menus |

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
| **Splice mode** | Alignment output mode that uses a template string with `{guideline}`, `{entries}`, `{existing}` tokens — no LLM call |
| **Show Output** | Graph-only probe node for dry-running any upstream node |
| **processFrontMatter** | Obsidian API for safe YAML writes — parse → mutate → serialize |
| **Helios** | Local ephemeris server (baratie:3000) used by lunar/solar boundary detectors |
