# Periodic Ritual — Project Document

> Obsidian plugin for periodic review notes. Companion to **Daily Ritual**.
> Plugin id stays `monthly-ritual` for zero migration friction. User-facing name is **Periodic Ritual**.

---

## Overview

Maintains any combination of independent **container types** — calendar week, calendar month, calendar quarter, calendar year, lunar cycle, lunar phase, solar cycle, solar zodiac, plus user-defined custom boundaries. Each container is configured the same way: a template, a save directory, a boundary detector, a data source (or multiple), an optional LLM service + system prompt, optional reflection profile, optional alignments.

**The plugin's job is narrow:**
1. Detect a container's boundary has been crossed.
2. Create the container note from a template.
3. Gather source notes in range (daily notes by default, or other container notes for hierarchical roll-ups).
4. Hand them to an LLM with the system-prompt MD file.
5. Write the LLM's YAML output to the container's frontmatter.
6. Optionally run alignment passes and/or a reflection Q&A flow.

Templater scripts in the user's vault render note bodies via Dataview. The plugin owns frontmatter; templater owns presentation.

## Design principles

1. **The system-prompt MD file is the customization layer.** Settings stay tiny. Behavior changes by editing markdown, not code.
2. **Containers are independent.** No mutually-exclusive modes. Any combination. Each has its own LLM service if desired.
3. **The LLM does aggregation.** No hand-rolled field pipeline. The plugin shovels source data and a prompt at an LLM and writes the result.
4. **Anti-fragile.** Skip a week, nothing breaks. Empty periods still generate notes. The LLM aggregates whatever exists.
5. **Goals are anchors, not prisons.** Alignments surface patterns. They do not produce shame, compliance scores, or red/green dashboards.
6. **Templater stays.** It renders bodies via Dataview. The plugin owns frontmatter; templater owns presentation. Complementary.
7. **Daily Ritual is upstream.** Periodic Ritual reads what Daily Ritual already writes. It does not modify daily notes.
8. **Multi-source.** A container can read from daily notes + any number of other containers simultaneously. Merged, deduped, fed to the LLM as one payload.

## Repo and build

- GitHub: `poweredbypugs/monthly-ritual`
- Plugin id: `monthly-ritual` (unchanged for migration safety)
- User-facing name: **Periodic Ritual** (in `manifest.json`)
- Plugin install path: `KAI/.obsidian/plugins/monthly-ritual/`
- Working clone: `~/Documents/Plugin Project/monthly-ritual/`
- **Plain JS, no build step, no TypeScript.** `main.js` is the source of truth — same convention as Daily Ritual. Edit, reload, done.

```
monthly-ritual/
├── main.js          — all plugin code (~7500 lines as of Phase 10)
├── manifest.json    — name: "Periodic Ritual", id: "monthly-ritual"
├── styles.css       — graph view + settings styling
├── data.json        — user settings (gitignored)
├── PROJECT.md       — this file
├── README.md        — user-facing docs
├── prompts/         — starter system prompts (5 files, embedded in main.js too)
└── boundaries/      — sample custom boundary scripts (3 files)
```

---

## Primitives

Five first-class objects plus the Container (which references all of them). Each lives in its own top-level settings tab AND is a node type in the graph view.

### Container

The unit of periodic aggregation.

```js
{
  id: "pr-...",
  name: "Weekly Review",
  enabled: true,
  boundaryDetector: "calendar-week",
  generateAt: "start" | "end",
  template: "Templates/weekly.md",
  saveDir: "Home/Weekly",
  naming: "W{{week}}-{{year}}",
  metadataPlacement: "frontmatter" | "inline" | "none",
  metadataInlineKey: "periodic-ritual",
  // Multi-source: array of { type: "daily" } | { type: "container", containerId }
  // Empty array is valid — container has no data sources until one is added.
  dataSource: { sources: [{ type: "daily" }] },
  systemPromptFile: "Templates/prompts/weekly-prompt.md",
  llmServiceId: "lsv-...",
  reflectionId: "rf-...",
  lastGeneratedEnd: "2026-04-12",  // tracks catch-up resume point
}
```

### Boundary

Built-in or custom. Seven built-ins: calendar-week, calendar-month, calendar-quarter, calendar-year, lunar-cycle, lunar-phase, solar-cycle, sun-ingress (Solar Zodiac). Helios-backed ones require the Moon Phase plugin (`obsidian-moon` → baratie:3000 server by default).

Custom boundaries are user-provided JS modules:
```js
module.exports = function(date, app, plugin) {
  return { start: Date, end: Date, tokens: { ... } };
};
```

Each custom boundary has `{ id, name, scriptPath, description }`. The description is prepended to the container's system prompt as orienting context ("this period is a Ki cycle...") so the LLM knows what kind of period it's looking at even when the calculation is opaque.

The Boundaries tab shows every built-in with View source (embedded standalone JS module source, copyable) and Fork as custom (drops a copy in a vault folder the user picks). Custom boundaries get full edit UI + Test against today button.

### Reflection

Reusable Q&A profile. Attached to a container via `container.reflectionId`.

```js
{
  id: "rf-...",
  name: "Weekly reflection",
  questions: [
    {
      text: "What did you learn this week?",
      injectVar: true,
      varField: "summary",
      varFieldType: "frontmatter",
      varSource: "previous-period" | "note" | "container-current" | "container-previous",
      varNotePath: "",
      varSourceContainerId: "",
      outputToField: true,
      outputFieldName: "learning",
      outputFieldType: "inline",
      outputTargetContainer: "" | "daily-today" | "<pr-container-id>",
    },
    // ...
  ],
  useLLM: false,               // does submitting answers trigger an LLM call
  replaceAutoLLM: false,       // does this reflection replace the container's auto-LLM at boundary
  includeAlignmentContext: false, // include alignment outputs in the LLM call
  promptPrepend: "",           // optional markdown layered on top of the system prompt
}
```

Variable injection sources:
- `previous-period` — previous note of the same container (e.g., last week)
- `note` — a specific .md file by path
- `container-current` — current corresponding note of another PR container
- `container-previous` — previous note of another PR container

Output targets:
- empty — active container note
- `daily-today` — today's daily note (Daily Ritual companion target)
- `<container-id>` — another PR container's current note

### Alignment

Measurable anchor attached to one container. Runs as a separate focused LLM pass that reads one daily field across the period and writes a short observation to a frontmatter key.

```js
{
  id: "al-...",
  name: "Morning mobility",
  containerId: "pr-...",
  dataField: "health",
  dataFieldType: "inline" | "frontmatter",
  description: "30 min mobility daily. Surface patterns of consistency and avoidance.",
  outputField: "alignment_morning_mobility",  // auto-derived from name if empty
}
```

### LLM Service

Provider configuration referenced by containers.

```js
{
  id: "lsv-...",
  name: "Gemini Flash",
  provider: "gemini" | "openai" | "anthropic" | "openrouter" | "lmstudio" | "openclaw",
  apiKey: "...",
  model: "gemini-2.0-flash-exp",
  baseUrl: "",  // used by lmstudio and openclaw
}
```

Six providers. LM Studio and OpenClaw are local; both take a configurable base URL. OpenClaw selects agents via the model field (`openclaw/default`, `openclaw/mei`, etc.) — the model fetcher lists them as agent targets.

All HTTP uses Obsidian's `requestUrl` to bypass CORS — local servers without CORS headers (LM Studio, OpenClaw, custom Helios) work natively.

---

## Generation pipeline (at boundary)

1. **Boundary check.** On plugin load (if `prAutoGenerateOnLoad`), walk every enabled container in topological order (by dataSource dependencies). For each, ask the boundary detector "has a new period started since lastGeneratedEnd?"
2. **Note creation.** Read the container's template. Apply token resolution (Obsidian core `{{title}}/{{date:FMT}}`, plus PR-specific `{{week}}`, `{{month-name}}`, `{{phase-emoji}}`, etc.). Resolve the naming convention to a filename. Create the file with `vault.create`. Stamp per-note metadata (`id`, `boundary`, `start`, `end`) to the configured placement (frontmatter nested key, inline marker, or none).
3. **Open the file** in a leaf so templater scripts that read `app.workspace.getActiveFile()` see the right file.
4. **Main LLM aggregation** (unless suppressed by a `replaceAutoLLM` reflection):
   - Build the source payload: walk `dataSource.sources`, collect daily notes + other-container notes in range, dedupe by path, format each as a `## <filename>` section with frontmatter + inline fields (body excluded to save tokens).
   - Compose the user message: period header → reflection answers (if any) → previous frontmatter (for "both" re-runs) → alignment outputs (if `includeAlignmentContext`) → source notes payload.
   - Build the system prompt: container's system prompt MD file content, prepended with the boundary description.
   - Call the LLM via the configured service.
   - Parse the YAML response (with code-fence + doc-marker stripping) and merge into the container note's frontmatter via `processFrontMatter`.
5. **Alignment passes.** For each alignment attached to the container: pull the named daily field from every daily in range, send as a focused LLM payload with the alignment description as system prompt, write the response to the alignment's output key on the container note.
6. **Update `lastGeneratedEnd`.** Saves the period's end date so next run resumes from there.
7. **Notice.** "Generated [container name]: [filename]." No blocking modals.

If auto-generate is off, all of this happens manually via the "Generate container note" command or the "Generate now" button on the container card / node.

### Reflection flow (on-demand)

Runs when the user invokes "Reflect on container" (or the context-aware version that auto-detects the active file's container). Opens the `ReflectionModal` (same class Daily Ritual uses) with the reflection's questions. On submit:

1. **Write each answer to its output field** (active container note, another container's current note, or today's daily note).
2. **If `includeAlignmentContext`:** run alignments first (instead of after) so they're in the frontmatter when the LLM reads it.
3. **If `useLLM`:** run `runPRLLMAggregation` with answers + injected context + (conditionally) previous frontmatter + alignment outputs.
4. **If `replaceAutoLLM` and alignments haven't run yet:** run them now.

---

## Graph view (Phase 10)

Node-based visual editor. Custom-built for PR's primitive set — no third-party library. DOM nodes inside a pannable/zoomable viewport, SVG layer for bezier wires.

### Access

- Ribbon icon: "Periodic Ritual Graph" (fork icon)
- Command: `Periodic Ritual: Open graph view`
- Settings → Containers tab → "Open graph view" button

### Node kinds

| Node | Source | Editable title | Inline widgets | Full inline editor |
|---|---|---|---|---|
| **Container** | `prContainers` | yes | Enabled toggle | Boundary, generate at, template, save dir, naming (with live preview), metadata, data sources, LLM service, system prompt, reflection, generate button |
| **Reflection** | `prReflections` | yes | Send to LLM, Replace auto, Inc. alignments toggles | Prompt prepend, full questions list with per-question inject + output panels |
| **Alignment** | `prAlignments` | yes | Field text | Container picker, field type, description, output key |
| **LLM Service** | `prLLMServices` | yes | — | Provider, base URL (conditional), API key, model + fetch button |
| **Custom Boundary** | `prCustomBoundaries` | yes | — | Script picker, description, test button |
| **Built-in Boundary** | implicit | no | — | — (inspect only) |
| **Daily source** | implicit | no | — | — (inspect only) |

Nodes have sockets on the sides: containers have 5 input sockets on the left (data, boundary, llm, reflection, alignment), every node has one output socket on the right. Sockets hover-label their type and scale on hover.

### Interactions

| Action | Effect |
|---|---|
| Wheel | Zoom (0.25x–3x), centered on cursor |
| Drag empty canvas | Pan |
| Ctrl/Cmd + drag empty canvas | Marquee selection |
| Click node (no modifier) | Toggle expand/collapse (250ms deferred) |
| Double-click node | Open settings to that primitive's tab, scroll to its card with accent flash |
| Double-click empty canvas | Add menu at click point |
| Right-click node | Context menu: Inspect output, View system prompt (containers), Edit in settings, Enable/Disable (containers), Duplicate (containers/reflections), Delete |
| Right-click wire | Delete option |
| Right-click empty canvas | Add menu (Container, Reflection, Alignment, LLM service, Custom boundary) |
| Drag output socket → input socket | Create connection (snap within 50px of compatible sockets) |
| Drag empty input socket → empty canvas | Opens create-source menu with compatible options |
| Drag empty input socket → compatible output | Wire it up |
| Drag connected input socket | Detach wire, drag free, reconnect on drop or stay disconnected |
| Click a wire | Delete |
| Ctrl/Cmd + click node | Toggle membership in selection |
| Drag selected node | Moves every selected node together |
| Delete / Backspace (selection) | Delete all selected primitives |
| Cmd/Ctrl + C (selection) | Copy selected to in-memory clipboard |
| Cmd/Ctrl + V (clipboard set) | Paste with new ids, positions offset 30/30 |
| Cmd/Ctrl + A | Select all primitive nodes |
| Escape | Clear selection |

### Snap connect

During wire drag, the closest compatible socket within 50 viewport-pixels of the cursor gets a pulsing accent ring and the ghost wire locks on. Release lands the connection on the snapped socket regardless of exact cursor position.

### Filter popover

Toolbar → 🔍 Filter button. Three controls:
- **Kind checkboxes** (show containers / boundaries / LLM services / reflections / alignments / daily source)
- **Focus on container** dropdown: reduces the graph to one container's full dependency graph (upstream sources + downstream consumers, recursively)
- **Enabled containers only** toggle

### Inspect output

Right-click any node → "Inspect output". Per-kind read-only modal:
- Container: data sources, current period, most recent generated note path + open button, filtered frontmatter, alignment outputs section
- Boundary: description, current period from today, full token map
- Reflection: mode flags, prompt prepend, question list with [inject:field] [output:field] tags
- Alignment: wired-to container, reads field, writes-to key, description
- LLM service: provider / model / baseUrl / key status
- Daily: folder + recent count

### Empty-state canvas

When there are no primitive nodes yet, the canvas still renders with the toolbar and dotted-grid background. A small overlay at the center reads "Blank graph — right-click or double-click anywhere to add a container, reflection, alignment, LLM service, or custom boundary." Pointer-events disabled on the overlay so the canvas interactions work through it.

### Persistence

Node positions and expanded state save to `settings.prGraphLayout = { [nodeId]: { x, y, expanded } }`. Selection, filters, and clipboard are in-memory only.

---

## Settings structure

Six outer tabs (the legacy "Existing" tab was deleted in Phase 8f):

- **Containers** — list of container cards with full edit UI. "Open graph view" button in the header.
- **Boundaries** — built-in cards (read-only with View source / Fork as custom) and custom cards (editable).
- **Reflection** — reusable reflection profiles with full editor.
- **Alignment** — alignment definitions attached to containers.
- **LLM** — provider service definitions.
- **General** — auto-generate toggle, daily notes folder, astrology toggles, Zodiac Calendar settings (timezone, separate solar and lunar note folders, per-phase naming).

Settings tab card renderers stamp `data-pr-card-id` on each card so the graph view's double-click can scroll to the exact card and flash an accent pulse.

---

## Companion: Daily Ritual

Cross-plugin integration (one change on each side):

- **Daily Ritual → Periodic Ritual (read):** DR's question inject sources now include "Current note of a Periodic Ritual container" — looks up a PR container by id, finds its most recent generated note, reads the named field from frontmatter (or inline) to inject above the daily question.
- **Periodic Ritual → Daily Ritual (write):** PR reflection question output targets now include "Today's daily note" — writes the answer to the daily note matching today's date via `parseDateFromFilename`.

Both plugins treat each other as optional dependencies. DR hides the PR source option when PR isn't installed; PR's daily-note target works without DR being present.

---

## Phase history

| Phase | What shipped |
|---|---|
| **0** | Scaffolding: new outer tabs (Containers / Boundaries / Reflection / Alignment / LLM / Existing / General), additive settings keys, legacy UI preserved in Existing tab |
| **1** | Single container card with Calendar Week detector, template + save dir + naming tokens, no LLM |
| **2** | LLM services with 6 providers, per-container system prompt, YAML merge into frontmatter, CORS fix via requestUrl, 5 starter prompts, data-shape documentation |
| **3** | Auto-generation at boundary with topological catch-up, on/off toggle, generateAt start-vs-end setting |
| **4a** | Calendar Month / Quarter / Year detectors |
| **4b** | Lunar Cycle / Lunar Phase / Sun Ingress (Helios-backed) detectors |
| **4c** | Boundaries tab, custom JS module backend, boundary description prepended to system prompt, Solar Cycle detector |
| **5** | (merged into 4b/4c) |
| **6** | Reflection as a first-class tab with reusable profiles, per-question inject + output, useLLM and replaceAutoLLM toggles decoupled from Q&A collection |
| **7** | Alignment module — per-container measurable anchors with focused LLM passes |
| **8a–f** | dataSource for hierarchical roll-up, cross-container reflection pull/push, topological sort, lunar token convenience, General tab consolidation, Existing tab deletion |
| **9** | Active-file-aware reflection command, debug modal showing last LLM call, Mermaid hierarchy diagram, README rewrite, sample custom boundary scripts, cross-plugin DR↔PR interop |
| **10a** | Graph view scaffold: node rendering, pan/zoom, drag to move, click to edit |
| **10b** | Wire drag, click-to-delete, right-click menus, inline parameter widgets |
| **10c** | Collapsible nodes, full inline edit forms for all primitive types, filter popover, scroll-to-card on double-click |
| **10c polish** | Socket hover labels, alignment-context toggle on reflection, drag from empty input, rewire connected inputs, multi-select with marquee, snap-connect, multi-source data, container→container wire fix, inspect modal, blank-canvas empty state |

---

## Non-goals (v1)

- No mobile-specific UI
- No daily-note modification (read-only)
- No cross-container analysis ("how does my Aries period compare to my Pisces period")
- No built-in dashboards or charts (templater + Dataview in the body)
- No conflict resolution if two containers write the same frontmatter key (user is responsible)
- No streak tracking, compliance scores, or red/green status (anti-fragile by design)

---

## Glossary

| Term | Meaning |
|---|---|
| Container | A periodic note (week, month, chapter, lunar phase, ...). The unit of aggregation. |
| Boundary | A date-range calculator. Built-in (calendar math / Helios HTTP) or custom JS. |
| Data source | Where a container reads from: daily notes, or another container, or any combination. |
| Reflection | Reusable Q&A profile attached to a container. Questions support inject + output. |
| Alignment | Measurable anchor attached to a container. One focused LLM pass per period. |
| LLM service | A `{provider, api key, model}` bundle. Containers reference services by id. |
| System prompt | Markdown file sent as the system role during LLM aggregation. The customization layer. |
| Helios | Local API server (`baratie:3000` by default) for ephemeris data. Provided by the Moon Phase plugin. |
| Graph view | Node-based visual editor for the full primitive set. |
| Topological sort | Catch-up order so a container's sources generate before it does. |
| lastGeneratedEnd | ISO date of the most recent period a container generated a note for. Resume point for catch-up. |
