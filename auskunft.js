// auskunft.js
// Auskunft und Löschung zu einer E-Mail-Adresse (Art. 15 und 17 DSGVO, Idee Q8 der Suite, Regeln in
// suite-kit/docs/KONVENTIONEN.md „Datenschutz“). Läuft nur auf dem Server, es gibt keinen Endpunkt dafür.
//
//   node auskunft.js <adresse>                  alles zu dieser Adresse als JSON auf stdout
//   node auskunft.js <adresse> --loeschen       zeigt, was gelöscht würde - ändert nichts
//   node auskunft.js <adresse> --loeschen --ja  löscht
//
// Docker: docker compose exec -T seating node auskunft.js anna@example.org
// Für alle Tools auf einmal: suite-kit/scripts/auskunft.sh
//
// Gefunden wird über die Adresse (ohne Groß-/Kleinschreibung): Verwaltungskonto, Buchungen (auch aus rsvp-app, falls
// mit Adresse) und das Mailprotokoll. Löschen: Buchungen werden anonymisiert statt gelöscht - Name, Adresse, Telefon,
// Notizen und die Namen der Personen am Platz verschwinden, die Plätze bleiben belegt (sonst rückten Plätze ohne
// Zutun der Verwaltung frei). Das Änderungsprotokoll der Buchung (enthält alte Werte) und Mails an die Adresse werden
// gelöscht. Verwaltungskonten löscht es nie, nur einen Hinweis.
const { PrismaClient } = require('@prisma/client');

const TOOL = 'seating';
const prisma = new PrismaClient();

/** Technisches, das keine Auskunft braucht und nicht hinausgehört (Tokens, Hashes, Push-Schlüssel). */
const SECRET_KEYS = /(token|hash|secret|hmac|nonce|enc)$|^p256dh$|^auth$|^endpoint$/i;
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEYS.test(key)).map(([key, v]) => [key, clean(v)]));
  }
  return value;
}
const same = (a, b) => typeof a === 'string' && a.trim().toLowerCase() === b;
async function idsByEmail(model, email, fields = ['email']) {
  const rows = await model.findMany({ select: { id: true, ...Object.fromEntries(fields.map(f => [f, true])) } });
  return rows.filter(row => fields.some(f => same(row[f], email))).map(row => row.id);
}

/** Gemeinsamer Ablauf: Adresse prüfen, Auskunft oder Probe bzw. Löschung ausgeben. */
async function run({ collect, report, plan, erase, hints }) {
  const [rawEmail, ...flags] = process.argv.slice(2);
  const email = (rawEmail ?? '').trim().toLowerCase();
  if (!email.includes('@')) {
    console.error('Aufruf: node auskunft.js <adresse> [--loeschen [--ja]]');
    process.exit(1);
  }
  const found = await collect(email);
  const notes = hints(found);
  if (!flags.includes('--loeschen')) {
    console.log(JSON.stringify({ tool: TOOL, adresse: email, erstellt: new Date().toISOString(), daten: clean(report(found)), hinweise: notes }, null, 2));
    return;
  }
  const confirmed = flags.includes('--ja');
  if (confirmed) await erase(found, email);
  console.log(JSON.stringify({ tool: TOOL, adresse: email, modus: confirmed ? 'geloescht' : 'probe', loeschen: plan(found), hinweise: notes }, null, 2));
}

async function collect(email) {
  const users = await prisma.user.findMany({
    where: { id: { in: await idsByEmail(prisma.user, email) } },
    include: { identities: true, _count: { select: { floorPlans: true, events: true, sessions: true } } }
  });
  const bookings = await prisma.booking.findMany({
    where: { id: { in: await idsByEmail(prisma.booking, email) } },
    include: {
      event: { select: { title: true, startsAt: true, endsAt: true } },
      attendees: { select: { id: true, name: true, position: true } },
      allocations: { select: { unit: { select: { label: true } } } },
      auditLogs: { select: { action: true, actor: true, diff: true, createdAt: true } }
    }
  });
  const mailLogs = (await prisma.mailLog.findMany({ select: { id: true, recipient: true, type: true, status: true, createdAt: true } }))
    .filter(m => same(m.recipient, email));
  return { users, bookings, mailLogs };
}

function report({ users, bookings, mailLogs }) {
  return { verwaltungskonten: users, buchungen: bookings, mailprotokoll: mailLogs };
}

function plan({ bookings, mailLogs }) {
  return { buchungenAnonymisiert: bookings.length, mailprotokoll: mailLogs.length };
}

function hints({ users, bookings }) {
  const notes = [];
  if (users.length) notes.push('Verwaltungskonto vorhanden: wird nicht automatisch gelöscht (daran hängen Raumpläne und Events). Löschen über „Konten“ einer Admin-Person.');
  const now = new Date();
  for (const b of bookings) {
    if (b.event.endsAt > now && !['CANCELLED', 'EXPIRED'].includes(b.status)) {
      notes.push(`Buchung für „${b.event.title}“ belegt weiter ${b.partySize} Platz/Plätze - kommt die Person nicht, die Buchung in der Verwaltung stornieren.`);
    }
  }
  return notes;
}

async function erase({ bookings, mailLogs }) {
  const ids = bookings.map(b => b.id);
  await prisma.$transaction([
    prisma.booking.updateMany({
      where: { id: { in: ids } },
      data: { name: 'Gelöscht', email: null, phone: null, note: null, adminNote: null, pendingIpHash: null, verifyTokenHash: null, verifyCodeHmac: null }
    }),
    ...bookings.flatMap(b => b.attendees.map(a => prisma.attendee.update({ where: { id: a.id }, data: { name: `Gast ${a.position + 1}` } }))),
    prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } }),
    prisma.mailLog.deleteMany({ where: { OR: [{ id: { in: mailLogs.map(m => m.id) } }, { bookingId: { in: ids } }] } })
  ]);
}

run({ collect, report, plan, erase, hints })
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
