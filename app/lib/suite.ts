// app/lib/suite.ts
import {
  loadSignersFromEnv,
  normalizeOrigin,
  parseIdpConfig,
  parseTrustedApps,
  type IdpConfig,
  type Signer
} from 'suite-kit'
import type { Role } from '@prisma/client'
import { baseUrl } from './base-url'

/**
 * Anbindung an die Konto-Föderation der App-Suite (Paket suite-kit, docs/KONZEPT.md Abschnitt 10),
 * übernommen aus dem Abstimmungstool. Alles hier ist OPTIONAL: Ohne SUITE_SIGNING_KEY stellt Seating
 * keine Anmeldungen für andere Tools aus, ohne SUITE_IDPS nimmt es keine an - dann gibt es nicht
 * einmal einen Login-Button dafür, und Seating arbeitet ausschließlich mit eigenen lokalen Konten.
 */

/** Origin dieses Tools (`iss`/`aud` in der ganzen Suite) - abgeleitet aus BASE_URL. */
export function selfOrigin(): string | null {
  return normalizeOrigin(baseUrl())
}

let signers: Signer[] | undefined
export function getSigners(): Signer[] {
  if (!signers) {
    try {
      signers = loadSignersFromEnv()
    } catch (error) {
      // Ein kaputter Schlüssel soll das eigenständige Tool nicht lahmlegen, sondern nur die
      // Föderation abschalten - dafür aber laut im Log, damit es auffällt.
      console.error('[suite] SUITE_SIGNING_KEY ungültig, Anmeldung für andere Tools ist deaktiviert:', (error as Error).message)
      signers = []
    }
  }
  return signers
}

let idps: IdpConfig[] | undefined
export function getIdps(): IdpConfig[] {
  return (idps ??= selfOrigin() ? parseIdpConfig(process.env.SUITE_IDPS) : [])
}

let trustedApps: string[] | undefined
export function getTrustedApps(): string[] {
  return (trustedApps ??= parseTrustedApps(process.env.SUITE_TRUSTED_APPS))
}

/** Anzeigename in der Discovery und auf Login-Buttons anderer Tools. */
export function appName(): string {
  return process.env.SUITE_APP_NAME?.trim() || 'Seating'
}

/** Beschriftung eines Anbieters auf dem Login-Button, ohne dafür das Netzwerk zu bemühen. */
export function idpLabel(idp: Pick<IdpConfig, 'issuer' | 'label'>): string {
  return idp.label ?? new URL(idp.issuer).host
}

/** Anzeige eines verknüpften Anbieters (Konto-Seite, Kontoverwaltung): Label aus SUITE_IDPS, sonst der Host. */
export function issuerLabel(issuer: string): string {
  const idp = getIdps().find(i => i.issuer === issuer)
  if (idp) return idpLabel(idp)
  try {
    return new URL(issuer).host
  } catch {
    return issuer
  }
}

/**
 * Das Rollen-Mapping beim ERSTEN Login eines fremden Kontos (danach vergeben nur noch lokale Admins
 * Rollen). Rechte gibt der Empfänger, nie der Anbieter: Ein Admin des Anbieters wird hier nur Admin,
 * wenn der Anbieter ausdrücklich mit mapAdminRole konfiguriert ist. Ein Moderator bleibt Moderator
 * (kleinste Rechte - sieht nur freigegebene Events), alles andere bekommt die Standardrolle CREATOR.
 */
export function mapRole(idp: Pick<IdpConfig, 'mapAdminRole'>, remoteRole: string | undefined): Role {
  if (remoteRole === 'ADMIN' && idp.mapAdminRole) return 'ADMIN'
  if (remoteRole === 'MODERATOR') return 'MODERATOR'
  return 'CREATOR'
}

export const AUTHORIZE_CONTINUE_PREFIX = '/api/suite/authorize?'

/**
 * Ziel der Zwischenseite /login/continue: ausschließlich das Fortsetzen des Anbieter-Endpunkts
 * dieses Tools - alles andere fällt auf den Admin-Bereich zurück, damit die Seite kein Weg für
 * Weiterleitungen an beliebige Adressen wird.
 */
export function continueTarget(to: string | undefined | null): string {
  return to && to.startsWith(AUTHORIZE_CONTINUE_PREFIX) && !/[\u0000-\u001f\\]/.test(to) ? to : '/admin'
}
