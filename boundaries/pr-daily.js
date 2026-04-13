// pr-daily.js — Custom Periodic Ritual boundary
//
// One-day boundary. Each day is its own period, midnight to midnight.
// Useful when you want Periodic Ritual to write to daily notes using
// the same alignment / LLM / framework pipeline that containers use.
//
// Tokens: year, month, month-name, day, date, day-name, day-short

module.exports = function (date, app, plugin) {
    const d = date || new Date();
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    // Ordinal suffix for the day number (1st, 2nd, 3rd, 4th, etc.)
    const dayNum = start.getDate();
    const suffix = (dayNum % 10 === 1 && dayNum !== 11) ? "st"
        : (dayNum % 10 === 2 && dayNum !== 12) ? "nd"
        : (dayNum % 10 === 3 && dayNum !== 13) ? "rd" : "th";

    return {
        start,
        end,
        tokens: {
            year:        String(start.getFullYear()),
            month:       String(start.getMonth() + 1).padStart(2, "0"),
            "month-name": monthNames[start.getMonth()],
            day:         String(dayNum).padStart(2, "0"),
            date:        start.toISOString().slice(0, 10),
            "day-name":  dayNames[start.getDay()],
            "day-short": dayShort[start.getDay()],
            "day-ordinal": `${dayNum}${suffix}`,
        },
    };
};
