// app/api/suite/pow/route.ts
import { powChallengeResponse } from 'suite-kit'

export const dynamic = 'force-dynamic'

/** Aufgabe für den Bot-Schutz der öffentlichen Formulare (ProofOfWork aus suite-kit/ui). */
export function GET() {
  return powChallengeResponse()
}
