// Planify — Calendar subscription feed
//
// GET /functions/v1/calendar-feed?token=<uuid>
//   → text/calendar response with the user's full schedule (past+future).
//
// The token is opaque, generated via `rotate_calendar_token()` (see the SQL
// migration). A user can rotate it from the app, which immediately revokes the
// previous URL. Lookups go through the service-role key — this Edge Function
// is intentionally the only place that bypasses RLS.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ── ICS helpers (kept in sync with js/utils.js) ──────────────────────────────

function icsEscape(s: string): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g,  '\\;')
    .replace(/,/g,  '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icsFold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? '' : ' ') + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
}

function icsBuild(lines: string[]): string {
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

const pad = (n: number) => String(n).padStart(2, '0');

function icsLocalDateTime(d: Date): string {
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' +
         pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function icsUtcDateTime(d: Date): string {
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
         pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}

function icsDate(d: Date): string {
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
}

function parseHM(s?: string | null): { h: number; m: number } | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, m: mi };
}

function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isOvernightShift(type: EventType): boolean {
  if (type.allDay) return false;
  const s = parseHM(type.startTime);
  const e = parseHM(type.endTime);
  if (!s || !e) return false;
  return e.h * 60 + e.m <= s.h * 60 + s.m;
}

// ── Event type registry (matches js/palette.js) ──────────────────────────────

interface EventType {
  id: string;
  label: string;
  emoji: string;
  allDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
  informationalTime?: boolean;
}

const BUILTIN_TYPES: Record<string, EventType> = {
  matin:    { id: 'matin',    label: 'Matin',    emoji: '☀️',  allDay: false, startTime: '08:00', endTime: '15:30', informationalTime: true },
  soir:     { id: 'soir',     label: 'Soir',     emoji: '🌇',  allDay: false, startTime: '14:00', endTime: '22:30', informationalTime: true },
  nuit:     { id: 'nuit',     label: 'Nuit',     emoji: '🌙',  allDay: false, startTime: '22:00', endTime: '07:30', informationalTime: true },
  repos:    { id: 'repos',    label: 'Repos',    emoji: '😴',  allDay: true },
  vacances: { id: 'vacances', label: 'Vacances', emoji: '🏖️',  allDay: true },
};

// ── ICS document builder ─────────────────────────────────────────────────────

function buildVEvent(dateStr: string, type: EventType, dtStamp: string): string[] {
  const start = parseISODate(dateStr);
  const lines: string[] = ['BEGIN:VEVENT'];

  lines.push(`UID:${dateStr}-${type.id}@planify.local`);
  lines.push(`DTSTAMP:${dtStamp}`);
  // SEQUENCE bumps on every fetch — calendars treat a higher value as "update
  // this event". Using the unix-day-of-the-fetch keeps it monotonic without
  // needing per-event state in DB.
  const dayStamp = Math.floor(Date.now() / 86400000);
  lines.push(`SEQUENCE:${dayStamp}`);
  lines.push(`SUMMARY:${icsEscape(`${type.emoji} ${type.label}`)}`);

  const exportAsAllDay = type.allDay || type.informationalTime === true;

  if (exportAsAllDay) {
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(end)}`);
  } else {
    const s = parseHM(type.startTime) ?? { h: 8,  m: 0 };
    const e = parseHM(type.endTime)   ?? { h: 18, m: 0 };

    const startDT = new Date(start);
    startDT.setHours(s.h, s.m, 0, 0);
    const endDT = new Date(start);
    endDT.setHours(e.h, e.m, 0, 0);
    if (isOvernightShift(type)) endDT.setDate(endDT.getDate() + 1);

    lines.push(`DTSTART:${icsLocalDateTime(startDT)}`);
    lines.push(`DTEND:${icsLocalDateTime(endDT)}`);
  }

  lines.push('END:VEVENT');
  return lines;
}

interface EventRow { date: string; type_id: string }
interface CustomTypeRow {
  id: string; label: string; emoji: string;
  all_day: boolean; start_time: string | null; end_time: string | null;
}

function buildCalendar(eventRows: EventRow[], customRows: CustomTypeRow[]): string {
  // Index custom types (presets + user-created) by id.
  const customMap: Record<string, EventType> = {};
  for (const r of customRows) {
    customMap[r.id] = {
      id:        r.id,
      label:     r.label,
      emoji:     r.emoji,
      allDay:    r.all_day,
      startTime: r.start_time,
      endTime:   r.end_time,
    };
  }

  const dtStamp = icsUtcDateTime(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Planify//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Planify',
    'X-WR-TIMEZONE:Europe/Paris',
  ];

  for (const row of eventRows) {
    const type = BUILTIN_TYPES[row.type_id] ?? customMap[row.type_id];
    if (!type) continue; // type was deleted — silently skip the event
    lines.push(...buildVEvent(row.date, type, dtStamp));
  }

  lines.push('END:VCALENDAR');
  return icsBuild(lines);
}

// ── HTTP handler ─────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// UUID v4 — match any reasonable UUID (we don't enforce the version digit).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function plain(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return plain(405, 'Method not allowed');
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token || !UUID_RE.test(token)) {
    return plain(400, 'Missing or malformed token');
  }

  // Look up the user owning this token.
  const { data: tokRow, error: tokErr } = await admin
    .from('user_calendar_tokens')
    .select('user_id')
    .eq('token', token)
    .maybeSingle();

  if (tokErr) {
    console.error('token lookup error:', tokErr);
    return plain(500, 'Internal error');
  }
  if (!tokRow) {
    // 404 (not 403) so accidental leakage of the URL doesn't reveal whether
    // any token has ever existed at this exact value.
    return plain(404, 'Calendar not found');
  }
  const userId = tokRow.user_id;

  const [{ data: events, error: e1 }, { data: customs, error: e2 }] = await Promise.all([
    admin.from('events').select('date, type_id').eq('user_id', userId),
    // Pas de filtre sur is_deleted : un type archivé (retiré de la palette ou
    // créé en "ponctuel") reste référencé par des jours du planning, ses
    // événements doivent continuer à sortir dans le flux.
    admin.from('custom_types').select('id, label, emoji, all_day, start_time, end_time')
      .eq('user_id', userId),
  ]);

  if (e1 || e2) {
    console.error('data fetch error:', e1 ?? e2);
    return plain(500, 'Internal error');
  }

  const body = buildCalendar(events ?? [], customs ?? []);

  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="planify.ics"',
      // 30 min — Google/Apple typically poll less often than this anyway,
      // but caching the response at the edge softens spikes if shared.
      'Cache-Control': 'public, max-age=1800',
    },
  });
});
