// create-user.js
// Legt ein Konto an (oder setzt bei einem bestehenden das Passwort und die Rolle neu).
// Für das allererste Konto auf einem frischen Server, da es keine öffentliche
// Registrierung gibt - danach kannst du unter /admin/users weitere Konten einladen. Auch der
// einzige Weg, ein Administrator-Konto zu ändern (die Oberfläche schützt diese absichtlich).
//
// Das Passwort wird verdeckt abgefragt, damit es weder im Shell-Verlauf noch in der
// Prozessliste landet. (Nicht-interaktiv geht auch: PASSWORD=... node create-user.js ...)
//
// Mit --invite wird KEIN Passwort vergeben: Das Konto entsteht ohne Passwort und die Person
// bekommt einen Einmal-Link (7 Tage), über den sie es selbst festlegt - per Mail, falls
// SMTP_HOST gesetzt ist, sonst wird der Link ausgegeben. So muss nie ein Passwort
// weitergegeben werden (auch nicht für das allererste Admin-Konto).
//
// Lokal:  node create-user.js deine-email@domain.de [ADMIN|CREATOR|MODERATOR] [--invite]
// Docker: docker compose run --rm seating node create-user.js deine-email@domain.de ADMIN --invite
const readline = require('node:readline');
const { createHash, randomBytes, scrypt } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ROLES = ['ADMIN', 'CREATOR', 'MODERATOR'];
const MIN_PASSWORD_LENGTH = 10;

// Muss zum Format in app/lib/password.ts passen (scrypt$N$r$p$salt$hash). Die Parameter
// stehen im Hash selbst - die App liest sie von dort und schreibt beim nächsten Login
// einen neuen Hash, falls die dortigen Werte inzwischen höher sind.
function hashPassword(password) {
  const N = 2 ** 15, r = 8, p = 3, keyLength = 64;
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: 128 * 1024 * 1024 }, (error, key) => {
      if (error) return reject(error);
      resolve(`scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      // Die Frage selbst anzeigen, getippte Zeichen aber nicht.
      if (text.includes(question)) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const INVITE_VALID_DAYS = 7;

// Gleicher Ablauf wie issueInvite in app/auth-actions.ts: Nur der SHA-256-Hash des Tokens
// landet in der Datenbank, der Klartext-Link geht ausschließlich an die Person.
async function invite(email, role) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.passwordHash) {
    console.error('Zu dieser Adresse gibt es bereits ein Konto mit Passwort. Ohne --invite lässt sich das Passwort neu setzen.');
    process.exit(1);
  }

  const token = randomBytes(32).toString('base64url');
  const data = {
    resetTokenHash: createHash('sha256').update(token).digest('hex'),
    resetTokenExpiresAt: new Date(Date.now() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000),
  };
  const user = existing
    ? await prisma.user.update({ where: { email }, data: { ...data, role } })
    : await prisma.user.create({ data: { email, role, ...data } });

  const base = (process.env.BASE_URL || 'http://localhost:3700').replace(/\/+$/, '');
  const link = `${base}/reset-password?token=${token}&invite=1`;

  if (!process.env.SMTP_HOST) {
    console.log(`Konto bereit: ${user.email} (${user.role}) - noch ohne Passwort.`);
    console.log(`Einladungslink (${INVITE_VALID_DAYS} Tage gültig, einmalig, NICHT weitergeben außer an die Person selbst):\n${link}`);
    return;
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: 'Einladung zu Seating',
    text: `Hallo,\n\nfür dich wurde ein Konto bei Seating angelegt. Lege mit diesem Link dein Passwort fest (${INVITE_VALID_DAYS} Tage gültig, nur einmal nutzbar):\n${link}\n\nFalls du damit nicht gerechnet hast, ignoriere diese Mail einfach.`,
    envelope: { from: process.env.SMTP_USER, to: user.email },
  });
  console.log(`Konto bereit: ${user.email} (${user.role}) - Einladung per E-Mail verschickt.`);
}

async function main() {
  const args = process.argv.slice(2);
  const inviteMode = args.includes('--invite');
  const [emailArg, roleArg] = args.filter((a) => !a.startsWith('--'));
  const role = roleArg || 'CREATOR';
  if (!emailArg || !ROLES.includes(role)) {
    console.error(`Verwendung: node create-user.js <email> [${ROLES.join('|')}] [--invite]`);
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();

  if (inviteMode) return invite(email, role);

  const password = process.env.PASSWORD || (await askHidden('Passwort: '));
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
    process.exit(1);
  }
  if (!process.env.PASSWORD && (await askHidden('Passwort wiederholen: ')) !== password) {
    console.error('Die Passwörter stimmen nicht überein.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    // Ein offener Einladungs-/Reset-Link wird mit einem neu gesetzten Passwort überflüssig.
    update: { passwordHash, role, resetTokenHash: null, resetTokenExpiresAt: null },
    create: { email, passwordHash, role },
  });
  // Ein neues Passwort beendet alle bestehenden Sitzungen dieses Kontos.
  await prisma.session.deleteMany({ where: { userId: user.id } });

  console.log(`Konto bereit: ${user.email} (${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
