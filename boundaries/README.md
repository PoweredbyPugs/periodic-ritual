# Sample Custom Boundaries

Drop any of these into your vault, then in Settings → Boundaries → **+ Add custom boundary**, point at the file. Each one is a standalone CommonJS module — `module.exports = function(date, app, plugin) { return { start, end, tokens } }`.

| File | Period | What it is |
|---|---|---|
| `pr-monday-week.js` | 7 days | Like the built-in Calendar Week but explicitly starts on Monday (built-in matches your locale). |
| `pr-fortnight.js` | 14 days | Anchored on a configurable reference date. Useful for biweekly cadences (paychecks, sprints). |
| `pr-ki-9day.js` | 9 days | Placeholder for the 9-Star Ki cycle. Calls a local server endpoint via `requestUrl`. Edit the URL to point at your own Ki calculator. |

## How to use one

1. Open the file, copy its contents.
2. Paste into a new `.js` file in your vault — e.g. `Templates/pr-boundaries/pr-fortnight.js`.
3. Edit the parameters at the top if there are any (e.g. fortnight reference date).
4. Settings → Boundaries → **+ Add custom boundary**.
5. Pick the script, give the boundary a name, write a description (used as orienting context for the LLM during aggregation).
6. Test with the **Test against today** button.
7. Settings → Containers → make a container that uses your new boundary.

## Writing your own

The function signature is:

```js
module.exports = function(date, app, plugin) {
    // date:   JS Date — the date the plugin is asking about
    // app:    Obsidian App instance — read vault files via app.vault
    // plugin: the Periodic Ritual plugin instance
    return {
        start: <JS Date>,
        end:   <JS Date>,
        tokens: { /* string-keyed object */ }
    };
};
```

Rules:

- Return `start` and `end` as JS Date objects (not ISO strings).
- `tokens` is a flat object of strings — these become `{{token-name}}` substitutions in your container's naming convention.
- The function can be `async` if you need `await` — `requestUrl`, `app.vault.read`, etc.
- You can `require("obsidian")` to get `requestUrl` and other Obsidian APIs.
- Keep token names consistent across your container set so naming conventions can be portable.
