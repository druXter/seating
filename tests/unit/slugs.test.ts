import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RESERVED_SLUGS, validateSlug } from '../../app/lib/slugs'

const APP_DIR = join(__dirname, '../../app')
const PUBLIC_DIR = join(__dirname, '../../public')

/** Enthält das Verzeichnis (rekursiv) eine Seite oder einen Route Handler? */
function hasRoute(dir: string): boolean {
  return readdirSync(dir).some(entry => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return hasRoute(path)
    return /^(page|route)\.(tsx?|jsx?)$/.test(entry)
  })
}

describe('RESERVED_SLUGS', () => {
  it('enthält jedes Routen-Verzeichnis auf oberster Ebene von app/', () => {
    const routeDirs = readdirSync(APP_DIR)
      // Route Groups "(x)", private Ordner "_x" und dynamische Segmente "[x]" belegen keinen festen Pfad.
      .filter(entry => !/^[([_]/.test(entry))
      .filter(entry => statSync(join(APP_DIR, entry)).isDirectory() && hasRoute(join(APP_DIR, entry)))
    expect(routeDirs.length).toBeGreaterThan(0)
    for (const dir of routeDirs) expect(RESERVED_SLUGS, `app/${dir} fehlt in RESERVED_SLUGS`).toContain(dir)
  })

  it('enthält jede Datei und jedes Verzeichnis auf oberster Ebene von public/', () => {
    const entries = existsSync(PUBLIC_DIR) ? readdirSync(PUBLIC_DIR) : []
    for (const entry of entries.filter(e => !e.startsWith('.'))) {
      expect(RESERVED_SLUGS, `public/${entry} fehlt in RESERVED_SLUGS`).toContain(entry)
    }
  })
})

describe('validateSlug', () => {
  it('akzeptiert gültige Slugs', () => {
    for (const slug of ['winterball-2026', 'sommerfest', 'm001', 'a1']) expect(validateSlug(slug)).toBeNull()
  })

  it('lehnt falsches Format ab', () => {
    for (const slug of ['A', 'Winterball', '-fest', 'fest-', 'doppel--strich', 'mit leerzeichen', 'ümlaut', 'x', 'a'.repeat(61), '../admin', 'fest.de']) {
      expect(validateSlug(slug), slug).not.toBeNull()
    }
  })

  it('lehnt reservierte Namen ab', () => {
    for (const slug of ['admin', 'api', 'login', 'verify', 'plans', 'impressum', 'datenschutz', 'reset-password']) {
      expect(validateSlug(slug), slug).toMatch(/reserviert/)
    }
  })
})
