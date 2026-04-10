// pr-monday-week.js — Custom Periodic Ritual boundary
//
// Like the built-in Calendar Week detector, but explicitly starts on
// Monday regardless of locale. Built-in respects the user's locale, which
// can put week start on Sunday in en-US.
//
// Period: Monday 00:00 through Sunday 23:59 of the week containing `date`.
//
// Tokens: year, month, month-name, day, date, week, week-start, week-end

function getISOWeek(d) {
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    return 1 + Math.ceil((firstThursday - target) / 604800000);
}

function getMondayWeekStart(d) {
    const x = new Date(d);
    const day = x.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const offset = day === 0 ? -6 : 1 - day; // negative or zero
    x.setDate(x.getDate() + offset);
    x.setHours(0, 0, 0, 0);
    return x;
}

function fmt(d) { return d.toISOString().slice(0, 10); }
function monthName(d) { return d.toLocaleString("default", { month: "long" }); }

module.exports = function (date) {
    const d = date || new Date();
    const ws = getMondayWeekStart(d);
    const we = new Date(ws);
    we.setDate(we.getDate() + 6); // Sunday
    return {
        start: ws,
        end: we,
        tokens: {
            year: String(d.getFullYear()),
            month: String(d.getMonth() + 1).padStart(2, "0"),
            "month-name": monthName(d),
            day: String(d.getDate()).padStart(2, "0"),
            date: fmt(ws),
            week: String(getISOWeek(d)),
            "week-start": fmt(ws),
            "week-end": fmt(we),
        },
    };
};
