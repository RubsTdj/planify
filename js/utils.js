// ─── Utils ────────────────────────────────────────────────────────────────────
// Tiny shared helpers used across the app. Two main goals:
//   1) Safe DOM construction (no `innerHTML` with user-provided strings → no XSS).
//   2) Correct ICS (RFC 5545) text/date helpers so calendar apps accept the file.

// ── DOM ───────────────────────────────────────────────────────────────────────

// Create an element with classes + safe text content. Children may be nodes
// or strings (strings are appended as text — never parsed as HTML).
function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class)   node.className = opts.class;
  if (opts.id)      node.id        = opts.id;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v != null) node.setAttribute(k, String(v));
    }
  }
  if (opts.style)   node.setAttribute('style', opts.style);
  if (opts.dataset) {
    for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = String(v);
  }
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Replace a container's children with the given nodes. Avoids `innerHTML =`.
function replaceChildren(container, ...nodes) {
  container.replaceChildren(...nodes.filter(Boolean));
}

// ── ICS (RFC 5545) ────────────────────────────────────────────────────────────

// Escape special chars in TEXT properties — required by RFC 5545.
function icsEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g,  '\\;')
    .replace(/,/g,  '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Fold long lines to 75 octets per RFC 5545 (continuation lines start with a space).
function icsFold(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? '' : ' ') + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
}

// Build an ICS file from an array of folded property lines.
// All ICS files MUST use CRLF line endings (RFC 5545 §3.1).
function icsBuild(lines) {
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

// Format a local Date as YYYYMMDDTHHMMSS (floating local time — no Z).
// Floating local is correct here because the user enters times in their own
// timezone and expects the calendar to render them at that wall-clock time.
function icsLocalDateTime(date) {
  const pad = n => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) + 'T' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

// Format a UTC Date as YYYYMMDDTHHMMSSZ — used for DTSTAMP.
function icsUtcDateTime(date) {
  const pad = n => String(n).padStart(2, '0');
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) + 'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) + 'Z'
  );
}

// Format a local Date as YYYYMMDD — used for VALUE=DATE all-day events.
function icsDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
}

// ── Misc ──────────────────────────────────────────────────────────────────────

// Strict-ish email validator (good enough for client-side UX).
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Parse "HH:MM" into { h, m }. Returns null on invalid input.
function parseHM(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, m: mi };
}

// True when the event ends the next calendar day (e.g. Nuit 22:00 → 07:30).
function isOvernightShift(type) {
  if (!type || type.allDay) return false;
  const s = parseHM(type.startTime);
  const e = parseHM(type.endTime);
  if (!s || !e) return false;
  return e.h * 60 + e.m <= s.h * 60 + s.m;
}
