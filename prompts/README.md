# Periodic Ritual — Example System Prompts

These are starter prompts for the LLM aggregation feature in Periodic Ritual. Each prompt corresponds to one container type and tells the LLM how to read the daily notes in that container's date range and write its findings back into the container note's frontmatter.

## Files

| File | Container type | Date range | Tone |
|---|---|---|---|
| `calendar-week.md` | Calendar Week | 7 days | Practical, momentum-focused |
| `calendar-month.md` | Calendar Month | ~30 days | Reflective, pattern-aware |
| `chapter-quarter.md` | Chapter (90 days) | 90 days | Arc-level, emergence-focused |
| `sun-ingress.md` | Sun Ingress (~30 days) | One zodiac sign | Thematic, archetypal |
| `lunar-phase.md` | Lunar Phase (~7 days) | One quarter of a moon cycle | Brief, textural |

## How to use

1. Copy any of these files into your Obsidian vault — somewhere stable, like `Templates/prompts/`.
2. Edit them to match how you actually log daily data. Field names, voice, and what you want surfaced are personal — the prompts ship with sensible defaults but won't match every vault.
3. In Settings → Periodic Ritual → Containers, pick the prompt file in the **System prompt** field of the relevant container.
4. Pair it with an LLM service in the same card.

## Editing prompts

The prompts assume:

- **6 pillars**: Health, Wealth, Work, Links, Creative, Study (sometimes called Education).
- **Daily fields are records of what was done**, not numeric ratings.
- **Goals are anchors, not prisons** — the LLM should surface patterns without compliance shaming.
- **Anti-fragile** — empty days, missed weeks, and silent gaps are valid data, not failures.
- **The user's voice** is reflective and honest.

If your vault uses different pillar names, different field names, or a different philosophical framing, edit the prompts. Each prompt is self-contained and roughly 50–80 lines — readable in one sitting.

## Output format

Every prompt asks the LLM to output **only** a YAML frontmatter block, no code fences, no commentary. Periodic Ritual parses the response as YAML and merges the keys into the container note's frontmatter via Obsidian's `processFrontMatter` API. If parsing fails, the raw response is written to a `pr-llm-raw` field so you can see what came back and debug.

## Cost and tokens

- **Calendar Week** and **Lunar Phase** are cheap — 7 daily notes is small.
- **Calendar Month** and **Sun Ingress** are moderate — 30 daily notes.
- **Chapter** is expensive — 90 daily notes can be a lot of tokens. The chapter prompt asks the LLM to summarize per moon arc rather than per day to keep output manageable.
- **Book** (1 year, ~365 days) is currently not in the example set. When that container type lands, the recommended approach is to aggregate from the chapter notes, not from the dailies, to keep the context window sane.

## Customization patterns

Things you might want to add to a prompt:

- **Reference the parent container's frontmatter** ("Look at the chapter note's `chapter_arc` field and treat it as orienting context for the week."). Phase 4+.
- **Pull in a reference document** ("The user's life arcs are defined in [[2034 Vision]]. Read it before summarizing.") — though this requires the LLM to be able to read other vault files, which Periodic Ritual doesn't currently do.
- **Tighter format constraints** ("`summary` must be exactly 4 sentences.").
- **Looser format constraints** ("`summary` can be any length up to 500 words.").
- **Custom pillars** — rename or replace the 6 standard pillars with whatever you actually track.
- **Different output keys** — the LLM will write whatever YAML keys you ask for. The plugin doesn't care.

The system prompt is the entire customization layer. If you can express it in markdown, you can change it.
