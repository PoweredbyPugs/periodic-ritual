# Monthly Ritual

Obsidian plugin for cyclical review notes. Companion to **Daily Ritual**.

## Modes

| Icon | Mode | Container | Subdivision |
|------|------|-----------|-------------|
| 📅 | Calendar | Calendar month | Weeks |
| 🌙 | Moon | New moon → new moon | Four lunar phases |
| ☀️ | Solar | Sun sign period | Solar terms or lunar phases |

**📅 Calendar** works standalone. **🌙 Moon** and **☀️ Solar** require the [Moon Phase](https://github.com/PoweredbyPugs/obsidian-moon) plugin (Helios API).

## Calendar View

A lunisolar calendar view accessible via command palette (**Open Ritual Calendar**). Requires Moon Phase plugin with Helios server.

### Layout

- **Container**: Zodiac sign (~30 days). Header shows sign glyph and name (e.g. "♈ Aries 2026"). Click to open the sign's note.
- **Rows**: Lunar phase periods within the sign. Each row starts on the exact day that phase begins (from Swiss Ephemeris via Helios `/moon-phases`).
- **Moon emoji**: Clickable — opens the lunar phase note. Hover shows the moon's zodiac sign glyph + phase emoji.
- **Day cells**: Show abbreviated day-of-week and date number. Click to open the daily note.
- **Dimmed days**: Days outside the zodiac sign boundary are shown dimmed (they belong to the adjacent sign but are part of the lunar phase that spills over).
- **Minor term marker**: The day the Sun reaches 15° of the sign (minor solar term boundary) is highlighted in teal. Requires Helios `/sun-degree` endpoint.
- **Navigation**: `<` / `>` moves between zodiac signs. `TODAY` returns to the current sign.

### Helios Endpoints Required

| Endpoint | Purpose |
|----------|---------|
| `/moon-now` | Current moon age and sign |
| `/planets-now` | Current Sun degree for minor term calculation |
| `/moon-phases?start=YYYY-MM-DD&end=YYYY-MM-DD` | Exact major phase dates from Swiss Ephemeris |
| `/planetary-ingresses?planet=Moon&start=X&end=Y` | Moon sign transitions |
| `/sun-degree?degree=15&sign=Aries` | Exact date Sun reaches 15° of a sign (minor solar term) |

### Calendar View Settings

| Setting | Description |
|---------|-------------|
| **Timezone** | Timezone for lunar phase calculations (default: `America/New_York`) |
| **Note folder** | Shared folder for solar and lunar notes |
| **Solar note naming** | Template for zodiac sign notes. Tokens: `{{sign}}`, `{{glyph}}`, `{{year}}`. Default: `☀️ Sun in {{sign}}` |
| **Lunar note naming** | Per-phase naming templates (🌑🌓🌕🌗). Tokens: `{{phase-name}}`, `{{phase-emoji}}`, `{{moon-sign}}`, `{{moon-glyph}}` |

## Commands

Commands adapt their names based on the active mode:

| Command | Calendar | Moon | Solar |
|---------|----------|------|-------|
| Generate Container | Generate Monthly Note | Generate Moon Cycle Note | Generate Solar Cycle Note |
| Generate Subdivision | Generate Weekly Note | Generate Phase Note | Generate Term Note |
| Container Reflection | Monthly Reflection | Moon Cycle Reflection | Solar Cycle Reflection |
| Subdivision Reflection | Weekly Reflection | Phase Reflection | Term Reflection |
| Collect Fields | Collect Fields | Collect Fields | Collect Fields |
| Test Container | Test Monthly Reflection | Test Moon Cycle Reflection | Test Solar Cycle Reflection |
| Test Subdivision | Test Weekly Reflection | Test Phase Reflection | Test Term Reflection |
| Open Calendar | Open Ritual Calendar | Open Ritual Calendar | Open Ritual Calendar |

## Setup

1. Enable the plugin in Obsidian settings
2. Choose your mode (📅 / 🌙 / ☀️)
3. Set templates, save locations, and naming conventions for container and subdivision notes
4. Configure Calendar View settings (note folder, naming conventions for solar/lunar notes)
5. Optionally configure field mappings to pull data from daily → subdivision → container
6. Optionally configure reflections (questions, LLM summary)

## Note Generation

Run **Generate [Container]** or **Generate [Subdivision]** from the command palette. Notes are created from your templates with tokens resolved:

| Token | Example | Notes |
|-------|---------|-------|
| `{{year}}` | 2026 | |
| `{{month}}` | 03 | Zero-padded |
| `{{month-name}}` | March | Full name |
| `{{date}}` | 2026-03-14 | ISO format |
| `{{cycle}}` | 03 | Cycle number within year |
| `{{phase}}` | New Moon | 🌙 mode |
| `{{phase-short}}` | new / q1 / full / q3 | 🌙 mode |
| `{{sign}}` | Pisces | Astrology toggle |
| `{{sign-glyph}}` | ♓ | Astrology toggle |
| `{{term}}` | Rain Water | ☀️ mode |
| `{{term-cn}}` | 雨水 | ☀️ mode |
| `{{week}}` | 11 | 📅 mode, ISO week |
| `{{week-start}}` | 2026-03-09 | 📅 mode |
| `{{week-end}}` | 2026-03-15 | 📅 mode |

## Field Pipeline

Configure field mappings in settings to automatically collect inline fields or frontmatter from daily notes into subdivision notes, and from subdivision notes into container notes.

Run **Collect Fields** on an active container or subdivision note to pull data.

Values are collected chronologically, separated by ` | `:
```
work:: Faced the Work — TALA edit. | Avoidant — reorganized channels. | Faced the Work — rough cut done.
```

## Reflections

Each reflection type (container and subdivision) has its own set of questions and summary configuration. Questions use progressive disclosure — one at a time, Enter to advance.

### Variable Injection
Questions can display a value from a previous note (e.g., last month's summary) above the question prompt.

### LLM Summary
After answering, optionally generate an AI summary using Gemini, OpenAI, or Anthropic. Configure the system prompt, what data to pass, and where to write the output.

## Settings

- **Mode**: 📅 Calendar / 🌙 Moon / ☀️ Solar — controls which settings sections appear
- **Notes**: Template, save location, naming convention for container and subdivision
- **Calendar View**: Timezone, note folder, solar/lunar note naming conventions
- **Field Mapping**: Configure which fields to collect at each layer
- **LLM**: Provider, API key, model selection
- **Reflection**: Tabbed config for container and subdivision — questions, summary settings
