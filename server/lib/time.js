// Time helpers. Everything the API returns is expressed in US Eastern.
const etDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const etTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const etWeekdayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
});

// Accepts a Date or anything the Date constructor understands (ISO string, epoch ms).
export function toEastern(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    return { etDate: null, etTime: null, etWeekday: null, iso: null };
  }
  return {
    iso: d.toISOString(),
    etDate: etDateFmt.format(d), // YYYY-MM-DD
    etTime: etTimeFmt.format(d).replace(/ /g, ' '), // "7:00 PM"
    etWeekday: etWeekdayFmt.format(d),
  };
}

// Iterate ISO date strings (YYYY-MM-DD) from start to end inclusive.
export function* eachISODate(startISO, endISO) {
  const [ys, ms, ds] = startISO.split('-').map(Number);
  const [ye, me, de] = endISO.split('-').map(Number);
  const cur = new Date(Date.UTC(ys, ms - 1, ds));
  const end = new Date(Date.UTC(ye, me - 1, de));
  while (cur <= end) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
