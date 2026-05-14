# Periodic Ritual

An Obsidian plugin for **periodic review notes**. It watches your calendar (or any period rule you define), generates weekly / monthly / chapter / lunar / custom notes from a template when a period begins or ends, summarizes what happened through an LLM, and writes the result into the note's frontmatter. It can also measure your activity against named "guidelines" and produce gap analysis, drive Q&A reflections, and compose rich pipelines in a visual graph editor.

Daily Ritual is now folded in as a sub-tab inside Periodic Ritual's settings.

---

## Table of contents

1. [What it does, in plain terms](#what-it-does-in-plain-terms)
2. [Install](#install)
3. [Five-minute quick start](#five-minute-quick-start)
4. [The seven primitives](#the-seven-primitives)
5. [How generation actually runs at a boundary](#how-generation-actually-runs-at-a-boundary)
6. [The Graph View](#the-graph-view)
7. [Alignment Groups (gap analysis)](#alignment-groups-gap-analysis)
8. [Data Sources](#data-sources)
9. [Show Output nodes (dry-run probes)](#show-output-nodes-dry-run-probes)
10. [Reflection flows](#reflection-flows)
11. [Hierarchical containers](#hierarchical-containers)
12. [Custom boundaries](#custom-boundaries)
13. [Daily Ritual (folded in)](#daily-ritual-folded-in)
14. [Commands](#commands)
15. [Settings reference](#settings-reference)
16. [Tips and troubleshooting](#tips-and-troubleshooting)
17. [Files in this repo](#files-in-this-repo)
18. [License](#license)

---

## What it does, in plain terms

Imagine you keep daily notes. At the end of each week, you'd like Obsidian to:

1. **Create a new "weekly review" note** from your template, named something like `W15-2026`, in your Reviews folder.
2. **Read all the daily notes** from that week.
3. **Summarize them with an LLM** into a few structured frontmatter fields — `summary`, `themes`, `wins`, `friction`.
4. **Compare what actually happened against your goals** ("did 5 workouts?", "20 focus hours?") and write the gap analysis as extra frontmatter fields.
5. **Optionally ask you a few reflection questions** on top.

Now imagine doing the same thing for *months*, *quarters*, *lunar phases*, *custom 9-day cycles*, or any other period you care about, stacking them so weekly feeds into monthly, monthly into quarterly, and so on. That's Periodic Ritual.

---

## Install

1. Drop the plugin folder into `<your vault>/.obsidian/plugins/periodic-ritual/`.
2. Enable **Periodic Ritual** in Settings → Community plugins.
3. Open Settings → Periodic Ritual. You'll see tabs: **Containers · Boundaries · Reflection · Alignment · LLM · General**.

No build step. `main.js` is what Obsidian loads.

---

## Five-minute quick start

This creates a working weekly container with LLM summarization but no alignments or reflections yet. Keep it simple first.

1. **Add an LLM service.**
   - Settings → LLM → **+ Add LLM service**
   - Name it (e.g. "Claude"), pick a provider (OpenAI / Anthropic / Gemini / OpenRouter / LM Studio / OpenClaw), paste your API key, click the refresh icon next to Model to fetch available models, pick one.

2. **Prepare two markdown files in your vault:**
   - A **template** for the weekly note — anything you want. Example:
     ```markdown
     # Week {{week}} — {{year}}
     {{date}}

     ## What happened
     ```
   - A **system prompt** for the LLM — describes the voice, framing, and output format. Example:
     ```markdown
     You are a warm, perceptive weekly-review assistant.

     Read the daily notes below for the week and return a YAML block with:
     - summary: a 2-3 sentence narrative summary of the week
     - themes: a short list of recurring patterns
     - wins: 1-3 things that went well
     - friction: 1-3 things that got in the way

     Return ONLY the YAML block, no prose before or after.
     ```

3. **Add a container.**
   - Settings → Containers → **+ Add container**
   - Name: "Weekly review"
   - Boundary: Calendar week
   - Generate at: End of period (so the note is created after the week completes)
   - Template: pick your weekly template file
   - Save dir: pick the folder where weekly notes should live
   - Naming: `W{{week}}-{{year}}`
   - LLM service: pick your Claude/GPT/etc entry
   - System prompt: pick the prompt file
   - Data source: "Daily notes" (the default)

4. **Point the plugin at your daily notes.**
   - Settings → General → set **Daily notes folder** to wherever your dailies live.

5. **Test it.**
   - On the container card, click **Generate now**. The note gets created in your save dir, opens automatically, and (after a moment) has LLM-written frontmatter.

6. **Turn on automation.**
   - Settings → General → **Auto-generate on load**. Now whenever you open Obsidian and a boundary has passed since last time, the plugin generates the missed notes automatically.

That's the minimum viable loop. Everything else in this readme adds power on top.

---

## The seven primitives

Periodic Ritual is built from a small number of reusable pieces. You wire them together either in the flat settings tabs or visually in the graph view. The primitives:

| Primitive | What it is | Where it lives |
|---|---|---|
| **Container** | A recurring note — the thing that gets generated at each boundary. Has a template, save dir, naming, boundary detector, LLM service, system prompt. | Containers tab |
| **Boundary** | A date-range calculator. Built-in: calendar week / month / quarter / year, lunar cycle, lunar phase, solar cycle (Aries→Aries), solar zodiac (sun-in-sign). Custom: any JS file in your vault exporting `{start, end, tokens}`. | Boundaries tab |
| **LLM Service** | A `{provider, api key, model}` bundle. Containers and alignment groups reference services by id. | LLM tab |
| **Data Source** | A named reference to a note or folder, reusable across containers and alignment groups. Two modes — *static* (one note) or *dynamic* (folder, filtered by consumer). | General → Data sources |
| **Reflection** | A reusable Q&A profile. Ask questions, inject context, route answers to frontmatter or sibling notes, optionally layer them into an LLM call. | Reflection tab |
| **Alignment Group** | A gap-analysis pass that reads "guidelines" from a source note and compares them against the container's activity, writing the results back to the container's frontmatter. | Alignment tab |
| **Show Output** | A graph-only debugging node — wire any output into it, click Dry Run, see exactly what would happen without touching disk. | Graph view only |

Plus an older **Alignment (single)** primitive for per-container one-off measurements — still supported but replaced by Alignment Groups going forward.

---

## How generation actually runs at a boundary

When a container's boundary is crossed (either via Auto-generate on load, the Catch up command, or Generate now):

1. **Compute the period.** The boundary detector returns `{start, end, tokens}` for the active period.
2. **Create the note.** Template is read, naming tokens are resolved (`{{week}}`, `{{month-name}}`, `{{year}}`, etc.), Obsidian core template tokens (`{{title}}`, `{{date:FORMAT}}`) are resolved, metadata is stamped (`periodic-ritual.start`, `periodic-ritual.end`, container id), file is written.
3. **Alignment Groups run FIRST.** Each group attached to this container:
   - Resolves its guidelines source (a Data Source or another container)
   - Auto-discovers every field in the source note that starts with the group's prefix (e.g. `alignment_health`, `alignment_work`, `alignment_energy`)
   - Splits them into splice-mode (`prepend`/`append` — pure string writes, no LLM) and LLM-mode (`separate`/`rewrite` — needs the model)
   - Bundles all LLM-mode alignments into ONE call using the group's own system prompt
   - Writes the results into the container's frontmatter
4. **Main LLM aggregation runs.** Your container's system prompt + the period's source payload (daily notes or upstream container notes, extracted into frontmatter/inline fields) gets sent to the container's LLM service. The response YAML is merged into frontmatter. Because alignment groups ran first, the main summary prompt sees their outputs as previous-frontmatter context and can reference them — so the main summary can incorporate gap analysis narratively.
5. **Legacy single alignments** (if any are configured) run after the main pass, same as the old behavior.
6. **Reflection is deferred.** It only runs when you manually invoke "Reflect on container".

You can see all of this in action via a **Show Output node** wired to the container — click Dry Run and you'll see every step, including the live LLM calls, without touching disk.

---

## The Graph View

Click **Open graph view** in the Containers tab header, or run the "Open Periodic Ritual graph view" command.

You get a pan/zoom canvas that shows every primitive as a node, with wires representing the relationships. You can:

- **Drag nodes** around; positions persist.
- **Resize nodes** by dragging the grip in the bottom-right. Each node has separate sizes for collapsed vs expanded state — double-click the grip to reset the current state's size. Click the **▶** chevron to expand the node into its full inline editor.
- **Draw wires** by dragging from an output socket on one node to a compatible input socket on another. Wires snap when you get within 50 pixels of a compatible target.
- **Rewire** by grabbing an existing wire on an input socket and dragging it somewhere else (or to empty canvas to delete).
- **Multi-select** with Ctrl+click or Ctrl+drag marquee. Then Delete deletes the selection, Ctrl+C copies primitive nodes, Ctrl+V pastes them.
- **Filter** with the top-right 🔍 Filter button: hide kinds, focus on one container's dependency graph (upstream and downstream), or hide disabled containers.
- **Add nodes** by right-clicking empty canvas or double-clicking it: Container, Boundary, LLM Service, Reflection, Alignment Group, Data source…, Show output, Custom boundary.
- **Inspect** via right-click → "Inspect output" for any node (read-only snapshot of what it's currently producing).
- **Edit** via single-click (expands the node into its full inline form) or double-click (jumps to the same settings tab + highlights the card).

Each node kind has a colored pill in the header so you can recognize it at a glance — containers are blue, boundaries blue-gray, LLM services green, reflections purple, alignment groups orange, data sources teal, show probes gray.

Wires are also color-coded by what they carry. Data-source wires are solid accent; boundary / llm / reflection / alignment wires are dashed in their own color.

---

## Alignment Groups (gap analysis)

This is the heart of the plugin's "am I living in alignment with what I said mattered" loop.

**Mental model:** you have a note somewhere that defines what alignment looks like for you — 5 workouts per week, 20 focus hours, daily meditation, whatever. An **Alignment Group** reads that note at boundary time, auto-discovers every field that matches its prefix, compares each against what actually happened during the period, and writes the gap analysis back to the container note's frontmatter.

### Setting one up

1. **Write your guidelines note.** Create any note (e.g. `Life/Charter.md`) and add frontmatter or inline fields with a consistent prefix:
   ```yaml
   ---
   alignment_health: "4x/week strength training, 7h sleep minimum"
   alignment_work: "20 focus hours, no late-night sessions"
   alignment_energy: "7/10 subjective average"
   alignment_play: "1 hobby session per week"
   ---
   ```
   Or inline:
   ```markdown
   alignment_health:: 4x/week strength training, 7h sleep minimum
   alignment_work:: 20 focus hours, no late-night sessions
   ```
   Both are read. Frontmatter wins if the same key appears in both.

2. **Register the guidelines note as a Data Source.**
   - Settings → General → Data sources → **+ Add static source**
   - Name: "Life charter", Mode: Static, Note: pick your charter file.

3. **Create the alignment group.**
   - Settings → Alignment → **+ Add alignment group**
   - Name: "Life alignments"
   - Prefix: `alignment` (this is what filters the source note's fields)
   - Target container: pick the container you want the gap analysis written to
   - Guidelines source: pick your "Life charter" data source
   - LLM service: pick your LLM service
   - System prompt: pick a markdown file that instructs the LLM how to do gap analysis (tone, format, depth)
   - Include aggregated summary: on (default) — feeds the container's freshly-written summary to the gap analysis as extra context

4. **Done.** Next time the container generates, the group runs automatically and writes keys like `alignment_health`, `alignment_work`, etc. into the container note's frontmatter, each with the LLM's gap analysis as the value.

### Output shapes: four modes per alignment

Every alignment in a group can be output four different ways. You set this per alignment, and each alignment can be different.

| Mode | LLM call? | What it does |
|---|---|---|
| **separate** | yes | LLM writes a narrative gap analysis into its own key (`alignment_health: "Met the 4x target…"`). Default. |
| **rewrite** | yes | LLM writes a concise string (5-20 words) that replaces the target key. Good for compressing into an existing key like `health: "3 of 5 workouts, sleep drifted"`. |
| **prepend** | **no** | Pure string splice. Prepends the guideline to whatever's in the target key, using a template like `**{guideline}** — {existing}`. |
| **append** | **no** | Same splice, reversed order. |

**Key thing:** splice modes (`prepend`/`append`) don't use the LLM at all. They run as deterministic string operations at boundary time. Zero tokens, zero latency. This is perfect when you just want the guideline prepended to your existing summary text, no AI required.

### Where each alignment's mode/target lives (precedence)

Three places can set per-alignment config, highest priority first:

1. **Source-note meta keys.** Next to the guideline itself:
   ```yaml
   alignment_health: "4x/week strength training"
   alignment_health_target: "health"         # write to "health" instead of "alignment_health"
   alignment_health_mode: "rewrite"          # LLM concise rewrite mode
   alignment_health_template: "**{guideline}** ({existing})"   # only for prepend/append
   ```
   Self-documenting, co-located with the guideline, no plugin UI needed.

2. **Per-alignment overrides in the alignment group's settings card.** There's a "Discovered alignments" table that auto-scans the wired source note and shows one row per alignment. Each row has inputs for Target, Mode, Template, and shows the resolved value. Refresh button re-scans if the source note changed.

3. **Group defaults.** `defaultMode`, `defaultTarget` (templated with `{prefix}` and `{name}`), `defaultTemplate`. These apply to every discovered alignment unless overridden by (2) or (1).

Common patterns:

- **All narrative, in own keys (default):** defaults are `separate` + `{prefix}_{name}`. Every alignment becomes `alignment_health`, `alignment_work`, etc.
- **All compressed, blended into existing keys:** default mode `rewrite`, default target `{name}`. Alignments become `health`, `work`, etc. (existing summaries get replaced with concise gap strings).
- **Prepend guidelines as framing:** default mode `prepend`, default target `{name}`, no LLM burn.
- **Mix:** set defaults to `separate`, then use source-note meta keys to override specific alignments (`alignment_health_mode: rewrite`).

### Template tokens (splice modes only)

When mode is `prepend` or `append`, the template string can reference:

- `{guideline}` — the source-note value (what you wrote in the charter)
- `{existing}` — the current value of the target key on the container note (empty if not yet written)
- `{name}` — the alignment's short name (e.g., `health`)

Defaults:
- prepend → `**{guideline}** — {existing}`
- append → `{existing} — **{guideline}**`

### Multiple alignments targeting the same key

If `alignment_health` and `alignment_sleep` both target `health` in splice mode, they splice sequentially in discovery order. Each splice sees the previous splice's result as its `{existing}`. Stack them as far as you want.

### One LLM call per group

Even with 10 alignments all in `separate` or `rewrite` mode, the group bundles them all into ONE LLM call, with per-alignment instructions listing the target key and format style. Efficient; no per-alignment round-trips.

---

## Data Sources

A **Data Source** is a named, reusable pointer to a note or folder. It exists so containers and alignment groups can share source configurations instead of each one having its own.

Two modes:

- **Static** — one specific note. Always that file, regardless of period. Use for charter notes, goal notes, reference docs.
- **Dynamic** — a folder of notes. The *consumer* decides how to use it:
  - A **container** reading a dynamic source filters the folder by its period window. Uses `pr-start`/`pr-end` frontmatter if present, falls back to file mtime. This is how you chain Day → Week → Month → Year if your container-output folders aren't the same thing.
  - An **alignment group** reading a dynamic source ignores period entirely and takes the single latest note in the folder (the "current milestone" interpretation).

### Defining data sources

**In settings** (flat list):
- Settings → General → **Data sources** → **+ Add static source** or **+ Add dynamic source**
- Fill in name, mode, note/folder path.

**In the graph view** (live, with a file picker):
- Right-click empty canvas → **Data source…** → sub-menu:
  - **+ New static (pick a note)** — opens file picker, auto-creates and drops a node
  - **+ New dynamic (pick a folder)** — opens folder picker, same
  - **Existing** → click any already-defined data source to drop its node

Dropping an "existing" data source node just positions it on the canvas — the primitive itself isn't duplicated. The same data source can be wired to multiple consumers.

### Wiring a data source

Drag from the data-source node's output socket into a container's `in-data` input OR an alignment group's `in-source` input. You can also mix data sources with the daily-notes built-in source in a container — a container's source list supports an arbitrary mix of `{daily, container, dataSource}` entries.

---

## Show Output nodes (dry-run probes)

These are debugging-only graph nodes. They have one universal input socket that accepts any output type, and a **Dry Run** button in the expanded body.

Dry Run **actually executes** whatever it's probing — including real LLM calls when the upstream is a container with an LLM service attached. No files are written. The result renders inline in the node as a structured "▼ INPUT / ▲ OUTPUT" breakdown per source kind:

- **Daily notes source** — folder, scan window, matched files, extracted fields
- **Boundary** — detector, reference date, resolved period, tokens
- **LLM service** — service config, containers using it
- **Reflection** — mode flags, prompt prepend, questions, frontmatter writes, variable injections
- **Alignment** — attached container, read field, live value, output key, last written value
- **Container** — period, tokens, data sources, **resolved source payload** (the actual bytes the LLM would see), system prompt, LLM service, reflection attached, alignments, most recent note's frontmatter, AND a **live LLM call** that shows exactly which frontmatter keys would be written and how they'd interact with the existing note (NEW / OVERWRITES badges)
- **Alignment Group** — prefix, source, auto-discovered guidelines with resolved mode/target badges, and a dry run that shows every splice result and LLM write with NEW / OVERWRITES badges

A progress bar animates while the dry run is in flight. The node auto-resizes to fit its content when a new result lands.

### Adding a show output node

- Right-click empty canvas → **Show output (dry-run probe)**
- OR drag from any output socket into empty canvas → **Add Show output here** (one-shot create + wire)

Drag any output socket onto the show node's `in-any` input to connect it.

---

## Reflection flows

Reflection profiles are reusable Q&A flows, the same modal Daily Ritual uses. One question per screen, Enter to advance, results routed to fields you pick.

Each question can:

- **Inject context** from another note above the prompt (previous period of same container, a specific note, current/previous note of a different container)
- **Output the answer** to a field — on the active container note, or cross-container to a sibling container's current note
- Be sent to the LLM as part of the period's user message, with the injected context as a blockquote so the model sees what you were responding to

Two toggles per profile:

- **Send answers to LLM** — when off, reflection just writes answers to fields and stops. Pure Q&A.
- **Replace container's auto-LLM at boundary** — when on, the container's boundary-time auto-LLM is suppressed and you run reflection on demand instead. When off, reflection is additive to the auto-LLM pass.

Attach a reflection profile to a container in the Containers tab. Run it via the "Reflect on container" command — it picks up the active file if it's a PR container note, or fuzzy-picks otherwise.

---

## Hierarchical containers

Containers can read from other containers instead of daily notes. Set a container's data source to `container:<id>` and its LLM aggregation will read all notes from that container whose `pr-start` falls in the reading container's period.

Example chains:

- **Solar** — Lunar Phase → Lunar Cycle → Solar Year
- **Calendar** — Week → Month → Quarter → Year
- **Custom** — anything you build with a custom JS boundary

Catch-up generates containers in topological order, so when Monthly runs, Weekly has already generated for every week in the month. Circular dependencies are detected and refused.

In the graph view, container-to-container wires appear as data-source wires (solid accent color) — visually identical to daily-notes wires.

You can also mix daily notes and container sources in the same container. Container A's source list can be `[{daily}, {container: B}, {dataSource: ds-charter}]` and the aggregation will walk all three.

---

## Custom boundaries

The Boundaries tab shows every built-in detector (with a View Source button to see the code and a Fork as custom button to copy it as a starting point). Custom boundaries are CommonJS modules anywhere in your vault:

```js
module.exports = function(date, app, plugin) {
    // date: JS Date the plugin is asking about
    // app: Obsidian App (so you can read vault files, call requestUrl, etc.)
    // plugin: the Periodic Ritual plugin instance
    return {
        start: <Date>,
        end:   <Date>,
        tokens: { /* any string-keyed values for {{naming-tokens}} */ }
    };
};
```

You can `require("obsidian")` for `requestUrl` if your boundary talks to a local server (Helios ephemeris, Ki calculator, etc.). The `app` and `plugin` arguments let the script read vault files or use plugin state.

Examples in `boundaries/`:
- `pr-monday-week.js` — Calendar Week but explicitly Monday-start
- `pr-fortnight.js` — 14-day periods from a reference date
- `pr-ki-9day.js` — placeholder for 9-star Ki cycle

Each custom boundary gets an optional **description** field. The description is prepended to the container's system prompt as "what kind of period this is" context whenever an LLM call runs on a note using that boundary. Useful when the calculation is opaque to the model.

---

## Daily Ritual (folded in)

Daily Ritual was a separate plugin; it now lives as a sub-tab inside Periodic Ritual's settings (Settings → Daily Ritual). It runs **two Q&A modals** against the active daily note:

- **Daily Align** — morning bookend. No LLM, no combined paragraph. Each question's answer can be written to its own field.
- **Daily Reflect** — evening bookend. Same engine, plus an optional combined paragraph and an optional LLM summary.

Both modals share the same question schema. You configure them in two parallel lists in the Daily Ritual tab — Alignment Questions on top, Reflection Questions below.

### Per-question controls

- **Response mode** — *Input* (user types an answer) or *Prompt only* (display-only — useful for affirmations, meditation cues, or just showing context without prompting an answer).
- **Inject variable** — optionally show a value pulled from somewhere else, in bold above the question. Nine source kinds:

  | Source | What it reads |
  |---|---|
  | Previous daily note | Yesterday's daily by filename |
  | Current daily note | The active file |
  | Specific note | Any `.md` by path |
  | Data Source (PR) | A PR data source — static = the note, dynamic = newest .md in the folder |
  | PR container — current note | Current note of a chosen PR container |
  | PR container — previous note | Previous-period note of a chosen PR container |
  | PR container — any that crossed today | Whichever PR container last stamped `lastGeneratedEnd === today` (no picker — auto-detected) |
  | Boundary tokens (live, now) | Any token from a boundary detector evaluated at the current moment (e.g., `phase_name` from `lunar-phase`, `sign` from `sun-ingress`) |
  | PR Alignment Group output | A specific output key the alignment group writes onto its container |

- **Skip if no inject value** — hide this question from the modal entirely when the source resolves to empty. Combine with boundary-driven sources to make a question only appear when it's actually relevant.
- **Skip unless source container crossed today** — hide unless the source PR container's last boundary crossing was today. Lets you wire questions that ONLY surface on transit / cycle / phase-shift days.
- **Output to own field** — write the answer to a per-question inline field or frontmatter key. Independent of the combined paragraph.

### Why the "skip" toggles matter

The skip predicates are how you keep the modal short. You can configure 30 alignment questions covering every transit, cycle, and phase you care about, and on most mornings only the 3-4 actually relevant ones appear. A "what does this Mars transit ask of me?" question can sit dormant for months and surface only when a Mars-transit PR container crosses its boundary today.

### Empty answers are OK

Both modals let you submit blank — press Next / Submit without typing. Empty answers are silently skipped: no empty fields written, no LLM call burned on a fully-blank reflection.

### Auto-open Daily Align on Obsidian start

Optional toggle in the Daily Ritual tab. When on, the Alignment modal auto-opens once per day shortly after Obsidian load. Dismissing without submitting still counts as "ran today" — won't re-pester on next reload. The manual **Daily Align** command always opens it, regardless of the gate.

### Auto-generate today's daily note at midnight

Optional toggle near the bottom of the Daily Ritual tab. When on, the plugin checks every 10 minutes whether today's daily note exists and, if not, creates it in the background using your Daily Notes core plugin's configured folder, date format, and template. Your current focus is never disturbed — the note is written via `vault.create` rather than opening the file.

- **Core template tokens are resolved** before write: `{{title}}`, `{{date[:FORMAT]}}`, `{{time[:FORMAT]}}`, `{{yesterday[:FORMAT]}}`, `{{tomorrow[:FORMAT]}}`. So if your template has `# {{title}}` or `[[{{yesterday:YYYY-MM-DD}}]]`, those land already expanded.
- **Templater runs too**, via its "Trigger Templater on new file creation" option (Templater's settings). Templater's `<% %>` tags expand after the file is written. If you don't see Templater output, that toggle is the first thing to check.
- **Idempotent** — if the file already exists, the function does nothing. So the 10-minute polling is safe.
- **Requires the Daily Notes core plugin to be enabled.** It only reads the configured folder / format / template from it; the file is created directly. Toggling this setting on/off takes effect after reloading the plugin.

### Image attachments on questions

Both Alignment and Reflection questions can carry an image. In each question row, the new image-icon button expands a panel where you pick an image mode:

| Mode | What it shows in the modal |
|---|---|
| **Static image file** | The exact image you picked. |
| **From note** | The first embedded image (`![[file.png]]` or `![](path)`) in the chosen `.md` note. |
| **From folder** | The most recently modified image in the chosen folder. Drop a new image into the folder and the question shows it next time the modal opens. |

You can leave the question's text empty — the modal step then shows just the image and a Next button. Otherwise the image renders between the injected variable (if any) and the question text. The modal card widens up to ~720px to fit the image; the image itself is capped at 620px wide / 60vh tall.

For the picker, configure the **Image gallery folder** in the new "Images" section of the Daily Ritual tab. The gallery picker recursively browses that folder (or the whole vault if blank). The **Upload** button on each question opens an OS file dialog and copies the chosen file into the gallery folder, with automatic `-1`, `-2` collision suffixes.

### Settings storage

Everything lives at `data.json` under `dailyRitual: { ... }`. Including the LLM provider config for the Reflection summary (each provider's API key is cached separately, so you can swap providers without re-typing keys).

---

## Commands

| Command | What it does |
|---|---|
| **Generate container note** | Fuzzy-pick a container and generate its current period note |
| **Catch up missed notes** | Walk all enabled containers, generate any missed periods in topological order |
| **Reflect on container** | Run a reflection profile against a container. Picks up active file if it's a PR container, otherwise fuzzy-picks. |
| **Open Periodic Ritual graph view** | Opens the visual graph editor in a new tab |
| **Show last LLM call** | Debug modal with the full system prompt, user message, request body, status, and raw response from the most recent LLM call. Invaluable when something looks wrong. |
| **Show hierarchy diagram** | Mermaid flowchart of all containers, their data sources, reflections, alignments, and LLM references |
| **Open Ritual Calendar** | Sidebar zodiac + lunar phase calendar view |
| **Daily Align** | Open the morning Daily Ritual alignment modal on the active note |
| **Daily Reflect** | Open the evening Daily Ritual reflection modal on the active note |
| **Test Daily Reflect** | Run the reflection modal but instead of writing anything, show the LLM's full request + response in a debug modal. Useful for tuning the summary prompt. |

---

## Settings reference

Six top-level tabs:

### Containers
List of containers. Each card has: Enabled toggle, boundary detector, generate-at (start/end), template picker, save dir picker, naming convention (with live preview), metadata placement (frontmatter / inline / none), data sources list (with add/remove per source), LLM service dropdown, system prompt picker, reflection dropdown, Generate now button.

### Boundaries
Built-in detectors (Calendar Week/Month/Quarter/Year, Lunar Cycle, Lunar Phase, Solar Cycle, Sun Ingress) — each has View Source and Fork-as-custom. Custom boundaries section with per-script cards (script path picker, description textarea, test button).

### Reflection
Reusable reflection profiles. Each card has name, the two mode toggles, prompt prepend textarea, and a list of questions with per-question inject/output panels.

### Alignment
Primary section: **Alignment Groups** — cards for each group with prefix, target container dropdown, guidelines source dropdown, LLM service dropdown, system prompt picker, include-aggregated-summary toggle, output-shape defaults (default mode, default target, default template), and a **Discovered alignments** table that live-scans the wired source note.

Legacy section: old per-container single alignments (only shown if any exist).

### LLM
Provider configurations. One card per service: name, provider dropdown, API key, base URL (for LM Studio / OpenClaw / OpenRouter custom endpoints), model picker (with a refresh button that fetches the provider's model list dynamically).

### Daily Ritual
Folded-in former plugin. Two question banks (Alignment Questions and Reflection Questions) plus inline-field config, optional LLM summary for reflection, and an "Open Daily Alignment on Obsidian start" toggle. See the [Daily Ritual section](#daily-ritual-folded-in) above.

### General
Plugin-wide settings:

- **Auto-generate on load** — toggle
- **Daily notes folder** — where the plugin looks for dailies
- **Data sources** — list of reusable static/dynamic note-or-folder references
- **Astrology** — toggles for sign glyph and eclipse tokens
- **Zodiac Calendar** — timezone, solar-note folder, lunar-note folder

---

## Tips and troubleshooting

**Nothing's happening when a boundary passes.**
Check that the container is enabled and Auto-generate on load is on. Run "Catch up missed notes" manually to force a pass. Check the "Show last LLM call" modal for errors.

**The LLM returned nothing / empty / unparseable.**
Your system prompt probably isn't asking for a YAML block, or the model returned extra prose before/after. Every system prompt should end with something like "Return ONLY a YAML block with these keys: …". Check the Show last LLM call modal to see the raw response.

**My summary doesn't mention the alignment results.**
Alignment groups now run BEFORE main aggregation and the main call auto-includes previous frontmatter, so your container's system prompt can reference alignment keys. Add something like "If `alignment_health` indicates drift, frame the health portion of the summary compassionately" to your system prompt.

**Show Output node's source payload is long and I can't scroll.**
Hover over the payload pane and scroll — wheel events are eaten by the canvas zoom everywhere except inside the show node's result panel, where they're intercepted. If you can't scroll, you're probably hovering outside the panel.

**Alignment groups aren't discovering any alignments.**
Make sure your source note has fields starting with the exact prefix (default `alignment_`). Check for typos. Meta keys (`_target`, `_mode`, `_template`) are excluded from discovery but need to be paired with a base key. Use a Show Output probe on the group node to see what's being detected.

**I want to see exactly what an LLM would receive without burning tokens… or WITH burning tokens.**
Add a Show Output node, wire it to a container or alignment group, click Dry Run. The Resolved Source Payload section shows what the LLM would see byte-for-byte. The Live LLM Call section (if service + prompt are configured) actually makes the request and shows the parsed response — but no files are written.

**Two alignments targeting the same key in splice mode.**
They chain in discovery order. Each subsequent splice sees the previous splice's result as its `{existing}` value. Rare but supported.

**Template tokens aren't resolving in my system prompt.**
They won't. Template token substitution (`{{week}}`, `{{month-name}}`, `{{year}}`) happens only in the container's **template** and **naming convention**, not in the system prompt. The plugin sends the system prompt raw. Period metadata is delivered to the LLM via the user message's `# Period` header instead.

**I want my system prompt to reference alignment outputs.**
Your container's system prompt runs AFTER alignment groups, and it auto-includes previous frontmatter. So you can say "You'll see `alignment_*` keys in the previous frontmatter block; reference them in your summary." The main call now has that context.

**Where do my plugin settings live?**
`.obsidian/plugins/periodic-ritual/data.json` inside your vault. Copy this file to back up or migrate all your containers, groups, data sources, etc.

---

## Files in this repo

```
periodic-ritual/
├── main.js          — all plugin code (single file, no build step)
├── manifest.json    — plugin metadata
├── styles.css       — UI styling
├── PROJECT.md       — architecture document (for contributors)
├── README.md        — this file
├── bulbasaur.gif    — loader animation asset
├── prompts/         — starter system prompts you can copy into your vault
└── boundaries/      — example custom boundary scripts
```

No build step. `main.js` is hand-written JavaScript. Edit, reload Obsidian, done.

---

## License

MIT.
