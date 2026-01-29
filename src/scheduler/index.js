import { getTimePartsInTZ, isActiveHours, parseHoursList } from "./time.js";

export function scheduleDailyAt({ hour, minute }, fn, label = "daily") {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);

  const delay = target - now;
  console.log(`🗓 ${label}: через ${Math.round(delay / 60000)} мин`);

  setTimeout(() => {
    fn();
    setInterval(fn, 24 * 60 * 60 * 1000);
  }, delay);
}

export function scheduleHourly(fn) {
  const now = new Date();
  const msToNextHour =
    (60 - now.getMinutes()) * 60 * 1000 -
    now.getSeconds() * 1000 -
    now.getMilliseconds();
  console.log(`⏱ До следующего часа: ${Math.max(0, Math.round(msToNextHour / 1000))} сек`);

  setTimeout(() => {
    fn();
    setInterval(fn, 60 * 60 * 1000);
  }, msToNextHour);
}

export function scheduleAtHours({ hours, minute, timezone, activeHours }, fn, label = "hours") {
  const hoursList = parseHoursList(hours);
  const safeMinute = Math.min(59, Math.max(0, Number(minute) || 0));

  let lastRunKey = null;
  console.log(`🗓 ${label}: часы=${hoursList.join(",")} минуты=${String(safeMinute).padStart(2, "0")} (${timezone})`);

  setInterval(() => {
    if (activeHours && !isActiveHours({ timezone, start: activeHours.start, end: activeHours.end })) return;

    const t = getTimePartsInTZ(timezone);
    if (!hoursList.includes(t.hour)) return;
    if (t.minute !== safeMinute) return;

    const key = `${t.dateKey}-${t.hour}-${t.minute}`;
    if (key === lastRunKey) return;

    lastRunKey = key;
    fn();
  }, 20 * 1000);
}
