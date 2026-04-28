import type { Event } from "./models";

function icsDate(dateStr: string, time?: string): string {
  const d = dateStr.replace(/-/g, "");
  if (time) {
    const t = time.replace(/:/g, "");
    return `${d}T${t.padEnd(4, "0")}00`;
  }
  return d;
}

function escapeIcs(str: string): string {
  return str.replace(/[\\;,\n]/g, (m) =>
    m === "\n" ? "\\n" : `\\${m}`,
  );
}

export function generateICS(events: Event[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//shoWMe//Calendar Export//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.id}@showme.app`);
    lines.push(`DTSTAMP:${icsDate(new Date().toISOString().slice(0, 10))}T000000Z`);

    // If event has schedule times, use them for start/end
    lines.push(`DTSTART;VALUE=DATE:${icsDate(e.date)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(e.date)}`);

    lines.push(`SUMMARY:${escapeIcs(e.name)}`);

    const descParts: string[] = [];
    if (e.artist) descParts.push(`Performer: ${e.artist}`);
    if (e.venue) descParts.push(`Venue: ${e.venue}`);
    if (e.operator) descParts.push(`Operator: ${e.operator}`);
    if (descParts.length > 0) {
      lines.push(`DESCRIPTION:${escapeIcs(descParts.join("\\n"))}`);
    }

    if (e.venue) lines.push(`LOCATION:${escapeIcs(e.venue)}`);
    lines.push(`STATUS:${e.eventStatus === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadICS(events: Event[], filename = "showme-calendar.ics") {
  const content = generateICS(events);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
