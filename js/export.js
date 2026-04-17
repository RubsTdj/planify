function exportICS() {
  let ics = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Planify//FR\n';
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatDate(currentYear, currentMonth, d);
    (events[dateStr] || []).forEach(evtId => {
      const type = getEventType(evtId);
      if (!type) return;
      const dtStr = dateStr.replace(/-/g, '');
      if (type.allDay) {
        ics += `BEGIN:VEVENT\nDTSTART;VALUE=DATE:${dtStr}\nDTEND;VALUE=DATE:${dtStr}\nSUMMARY:${type.emoji} ${type.label}\nEND:VEVENT\n`;
      } else {
        const st = (type.startTime || '08:00').replace(':', '') + '00';
        const et = (type.endTime   || '18:00').replace(':', '') + '00';
        ics += `BEGIN:VEVENT\nDTSTART:${dtStr}T${st}\nDTEND:${dtStr}T${et}\nSUMMARY:${type.emoji} ${type.label}\nEND:VEVENT\n`;
      }
    });
  }

  ics += 'END:VCALENDAR';
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `Planify_${MONTHS_FR[currentMonth]}_${currentYear}.ics`;
  a.click();
  showToast('📅 Fichier .ics téléchargé !');
}
