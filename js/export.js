// ─── ICS export ───────────────────────────────────────────────────────────────
// Builds an RFC 5545–compliant .ics file for the currently displayed month.
// Key correctness points (previously broken):
//   • Overnight shifts (e.g. Nuit 22:00 → 07:30) now span to the NEXT day,
//     otherwise DTEND < DTSTART and calendars silently drop the event.
//   • All TEXT properties are escaped (\, ; , and newlines).
//   • Lines use CRLF + 75-octet folding.
//   • Every VEVENT carries a stable UID and a DTSTAMP (some apps reject events
//     missing these).
//   • All-day events use DTEND = next day per the RFC (exclusive end).

// Parse "YYYY-MM-DD" into a local Date (avoids the new Date(str) UTC pitfall).
function parseISODate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Build a single VEVENT for a (date, eventType) pair.
function buildVEvent(dateStr, type, dtStamp) {
  const start = parseISODate(dateStr);
  const lines = ['BEGIN:VEVENT'];
  // Stable UID: same (date, type) always yields the same UID across exports.
  lines.push(`UID:${dateStr}-${type.id}@planify.local`);
  lines.push(`DTSTAMP:${dtStamp}`);

  // Shifts dont l'horaire est purement informatif (Matin/Soir/Nuit) :
  // exportés en all-day pour éviter tout chevauchement (notamment Nuit qui
  // passe minuit). L'horaire reste visible dans le titre.
  const isInformational = type.informationalTime === true;
  const exportAsAllDay  = type.allDay || isInformational;

  const summaryBase = `${type.emoji} ${type.label}`;
  const summary = (isInformational && type.startTime && type.endTime)
    ? `${summaryBase} (${type.startTime} → ${type.endTime})`
    : summaryBase;
  lines.push(`SUMMARY:${icsEscape(summary)}`);

  if (exportAsAllDay) {
    // RFC 5545: DTEND is exclusive — use next day for a 1-day all-day event.
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(end)}`);
  } else {
    const s = parseHM(type.startTime) || { h: 8,  m: 0  };
    const e = parseHM(type.endTime)   || { h: 18, m: 0  };

    const startDT = new Date(start);
    startDT.setHours(s.h, s.m, 0, 0);

    const endDT = new Date(start);
    endDT.setHours(e.h, e.m, 0, 0);
    // Sécurité : si un event custom franchit minuit, on bascule la fin au
    // lendemain (sinon DTEND < DTSTART et certains calendriers refusent).
    if (isOvernightShift(type)) endDT.setDate(endDT.getDate() + 1);

    lines.push(`DTSTART:${icsLocalDateTime(startDT)}`);
    lines.push(`DTEND:${icsLocalDateTime(endDT)}`);
  }

  lines.push('END:VEVENT');
  return lines;
}

// Trigger a download of the given Blob.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Free the object URL on the next tick — the click has already started the
  // download by then.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportICS() {
  const dtStamp = icsUtcDateTime(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Planify//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatDate(currentYear, currentMonth, d);
    for (const evtId of (events[dateStr] || [])) {
      const type = getEventType(evtId);
      if (!type) continue;
      lines.push(...buildVEvent(dateStr, type, dtStamp));
    }
  }

  lines.push('END:VCALENDAR');

  const blob = new Blob([icsBuild(lines)], { type: 'text/calendar;charset=utf-8' });
  downloadBlob(blob, `Planify_${MONTHS_FR[currentMonth]}_${currentYear}.ics`);
  showToast('📅 Fichier .ics téléchargé !');
}
