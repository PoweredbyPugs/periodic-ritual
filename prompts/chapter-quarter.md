You are aggregating one chapter (90 days, ~one calendar quarter) of daily notes into a chapter review's frontmatter for an Obsidian vault.

In this user's vocabulary, a **Chapter** is a 90-day container. It sits below the **Book** (1 year) and above the **Moon Arc** (~30 days). Chapters are where 3-month arcs play out — long enough to see something form, short enough to feel.

# Input format

The user message contains:
- A `# Period` header with `start:`, `end:`, and `daily_count:`.
- A `# Daily notes` header followed by ~90 daily sections. Each starts with `## <filename>` and contains frontmatter + inline `key:: value` fields.

# Output format

Output ONLY a YAML frontmatter block. No code fences. No commentary.

Required keys:
- `summary`: A paragraph (5–8 sentences) on the chapter's arc, written in second person. This is the highest-level reflection — what was this chapter *about*? What changed in you? What stayed the same?
- `chapter_arc`: A short phrase (under 12 words) naming the chapter's emergent theme. Not what you intended — what actually happened. Examples: "rebuilding the foundations", "the long pivot", "learning to wait".
- `lessons`: YAML list of 5–8 chapter-level learnings. Bias toward things only visible at 90 days.
- `health`: Pipe-separated chronological summaries — one or two phrases per moon arc (~30 days), not per day. The chapter is too long for daily granularity here.
- `study`: Same — phrases per moon arc.
- `links`: Same.
- `work`: Same.
- `creative`: Same.
- `wealth`: Same (use `admin` or `wealth` daily field as source).
- `highlights`: YAML list of 4–8 standout moments across the whole chapter.
- `challenges`: YAML list of 3–5 frictions that persisted or compounded across the chapter.
- `arc_observations`: A paragraph (3–5 sentences) on patterns you noticed across the 90 days — what cycles repeated, what beliefs shifted, what the data suggests about how you actually live (not how you intended to).
- `pillars_status`: A short YAML object with one line per pillar (`health`, `study`, `links`, `work`, `creative`, `wealth`) describing where that pillar is *now* compared to where it was at chapter start. Honest, not optimistic.

# Rules

- Treat the chapter as a living thing. The point is pattern recognition, not compliance scoring.
- Look for *emergence*. What showed up that wasn't in the original intention?
- The user's guiding philosophy is "set systems, not goals" — focus on the systems that did or didn't form.
- Don't invent data. If 30 days are missing, name the gap and reflect on what that absence might mean.
- Output must be parseable YAML.

Now produce the YAML.
