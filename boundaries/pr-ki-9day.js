// pr-ki-9day.js — Custom Periodic Ritual boundary
//
// Placeholder for 9-Star Ki integration. The Ki cycle is 9 days, with
// each day carrying a "Ki number" (1-9) that influences the energetic
// quality. The classical calculation depends on the user's birth chart
// and the date.
//
// This stub assumes you have a local server (or another tool) that can
// answer "what is the Ki number for date X" and "what's the start of
// the current 9-day cycle." Edit KI_BASE_URL and the request shape to
// match your own setup.
//
// If you don't have a Ki server, you can hard-code your calculation
// inline below — it's just JavaScript.
//
// Tokens: year, month, month-name, day, date, ki-number, ki-start,
//         ki-end, cycle

const KI_BASE_URL = "http://localhost:9090";  // edit me

function fmt(d) { return d.toISOString().slice(0, 10); }
function monthName(d) { return d.toLocaleString("default", { month: "long" }); }

async function fetchKiCycle(d) {
    const obsidian = require("obsidian");
    const url = `${KI_BASE_URL}/ki-cycle?date=${fmt(d)}`;
    try {
        const r = await obsidian.requestUrl({ url, method: "GET", throw: false });
        if (r.status < 200 || r.status >= 300) {
            throw new Error(`Ki server returned ${r.status}`);
        }
        // Expected response shape:
        //   { cycleStart: "2026-04-08", cycleEnd: "2026-04-16", kiNumber: 5 }
        return r.json;
    } catch (e) {
        // Fallback: anchor on REFERENCE_DATE and assume a strict 9-day cycle.
        // This isn't astrologically correct but lets the boundary work
        // standalone for testing.
        const REFERENCE_DATE = "2026-01-01";
        const ref = new Date(REFERENCE_DATE);
        ref.setHours(0, 0, 0, 0);
        const daysSince = Math.floor((d - ref) / 86400000);
        const cycleIdx = Math.floor(daysSince / 9);
        const start = new Date(ref);
        start.setDate(start.getDate() + cycleIdx * 9);
        const end = new Date(start);
        end.setDate(end.getDate() + 8);
        return {
            cycleStart: fmt(start),
            cycleEnd: fmt(end),
            kiNumber: ((cycleIdx % 9) + 9) % 9 + 1, // 1-9
        };
    }
}

module.exports = async function (date, app, plugin) {
    const d = date || new Date();
    const cycle = await fetchKiCycle(d);

    const start = new Date(cycle.cycleStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(cycle.cycleEnd);
    end.setHours(0, 0, 0, 0);

    return {
        start,
        end,
        tokens: {
            year: String(start.getFullYear()),
            month: String(start.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(start),
            day: String(start.getDate()).padStart(2, "0"),
            date: fmt(start),
            "ki-number": String(cycle.kiNumber),
            "ki-start": fmt(start),
            "ki-end": fmt(end),
            cycle: String(cycle.kiNumber),
        },
    };
};
