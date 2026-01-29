export function getTimePartsInTZ(tz) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type, fallback = "00") => parts.find((p) => p.type === type)?.value ?? fallback;

  const year = Number(get("year", "1970"));
  const month = Number(get("month", "01"));
  const day = Number(get("day", "01"));
  const hour = Number(get("hour", "00"));
  const minute = Number(get("minute", "00"));

  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, hour, minute, dateKey };
}

export function isActiveHours({ timezone, start, end }) {
  const parts = getTimePartsInTZ(timezone);
  const hour = parts.hour;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function parseHHMM(value, fallback = "08:30") {
  const v = String(value || fallback).trim();
  const m = v.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return { hour: 8, minute: 30 };
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function parseHoursList(value, fallback = "8,12,18") {
  const raw = String(value || fallback)
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const hours = raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 23);
  return [...new Set(hours)].sort((a, b) => a - b);
}
