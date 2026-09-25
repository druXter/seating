// app/lib/roles.ts
import type { Role } from '@prisma/client'

/** Anzeigenamen der Rollen - gleiche Rollen wie im Abstimmungstool, Beschreibung auf Events bezogen. */
export const ROLE_LABELS: Record<Role, string> = { ADMIN: 'Administrator*in', CREATOR: 'Creator', MODERATOR: 'Moderator*in' }
