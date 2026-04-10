// pr-fortnight.js — Custom Periodic Ritual boundary
//
// 14-day periods anchored on a configurable reference date. Useful for
// biweekly cadences (paychecks, sprints, etc.). Edit REFERENCE_DATE
// below to set when fortnight #1 starts.
//
// Tokens: year, month, month-name, day, date, fortnight, fortnight-start,
//         fortnight-end, fortnight-num

// Edit me: the start date of fortnight #1 (any date, the cycle counts
// forward and backward from here in 14-day jumps).
const REFERENCE_DATE = "2026-01-05"; // a Monday in early Jan

function fmt(d) { return d.toISOString().slice(0, 10); }
function monthName(d) { return d.toLocaleString("default", { month: "long" }); }

module.exports = function (date) {
    const d = date || new Date();
    const ref = new Date(REFERENCE_DATE);
    ref.setHours(0, 0, 0, 0);

    // How many days from reference to today?
    const dayMs = 86400000;
    const daysSinceRef = Math.floor((d - ref) / dayMs);
    // Which fortnight cycle are we in? (negative if before reference)
    const fortnightIdx = Math.floor(daysSinceRef / 14);

    const start = new Date(ref);
    start.setDate(start.getDate() + fortnightIdx * 14);
    const end = new Date(start);
    end.setDate(end.getDate() + 13);

    // Cycle number — 1-indexed from the reference
    const fortnightNum = fortnightIdx + 1;

    return {
        start,
        end,
        tokens: {
            year: String(start.getFullYear()),
            month: String(start.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(start),
            day: String(start.getDate()).padStart(2, "0"),
            date: fmt(start),
            fortnight: String(fortnightNum).padStart(2, "0"),
            "fortnight-num": String(fortnightNum),
            "fortnight-start": fmt(start),
            "fortnight-end": fmt(end),
        },
    };
};
