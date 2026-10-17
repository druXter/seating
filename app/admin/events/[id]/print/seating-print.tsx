// app/admin/events/[id]/print/seating-print.tsx
import { Segmented } from '../../../../ui/kit'
import type { LoadedEvent } from '../../../../lib/events/store'
import { loadSeatingBoard } from '../../../../lib/events/assign'
import { formatRange } from '../../../../lib/timezone'
import PrintButton from '../../../../ui/print-button'

/**
 * Druckansicht der Sitzordnung (Modus ASSIGNED): Liste je Tisch bzw. Reihe mit den Namen (für Einlass,
 * Deko, Service), Personen ohne Platz am Ende; mit ?view=cards eine Tischkarte pro Person.
 */
export default async function SeatingPrint({ event, cards }: { event: LoadedEvent; cards: boolean }) {
  const { parties, seats } = await loadSeatingBoard(event)
  const persons = new Map(parties.flatMap(party => party.persons.map(person => [person.id, { ...person, party }] as const)))
  const seated = seats.flatMap(seat => {
    const person = seat.attendeeId ? persons.get(seat.attendeeId) : undefined
    return person ? [{ seat, person }] : []
  })
  const groups = [...new Set(seated.map(s => s.seat.group))]
  const unseated = parties.flatMap(party => party.persons.filter(p => !p.seatKey).map(p => ({ ...p, party })))
  const base = `/admin/events/${event.id}`

  return (
    <div className="space-y-4">
        <div className="print:hidden flex flex-wrap items-center justify-between gap-2">
          <Segmented label="Druckart" items={[
            { href: `${base}/print`, label: 'Tischliste', active: !cards },
            { href: `${base}/print?view=cards`, label: 'Tischkarten', active: cards }
          ]} />
          <PrintButton />
        </div>
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 dark:border-gray-700 dark:bg-gray-800 print:rounded-none print:border-0 print:p-0 print:shadow-none">

        {cards ? (
          <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
            {seated.map(({ seat, person }) => (
              <div key={seat.key} className="border-2 border-gray-800 dark:border-gray-300 rounded-lg p-6 text-center break-inside-avoid" data-testid="table-card">
                <p className="text-sm text-gray-600 dark:text-gray-400">{event.title}</p>
                <p className="text-3xl font-bold my-3">{person.name}</p>
                <p className="text-lg">{seat.label}</p>
              </div>
            ))}
            {seated.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-400">Noch niemand hat einen Platz.</p>}
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-semibold">{event.title} – Sitzordnung</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {formatRange(event.startsAt, event.endsAt, event.timezone)}{event.location && ` · ${event.location}`} · {seated.length} von {persons.size} Personen mit Platz
              </p>
            </div>
            {groups.map(group => (
              <section key={group} className="break-inside-avoid">
                <h2 className="font-semibold border-b-2 border-gray-800 mt-4">{group}</h2>
                <table className="w-full text-sm border-collapse">
                  <tbody>
                    {seated.filter(s => s.seat.group === group).map(({ seat, person }) => (
                      <tr key={seat.key} className="border-b border-gray-300 dark:border-gray-600 align-top" data-testid="seating-row">
                        <td className="py-1 pr-3 w-48">{seat.label}</td>
                        <td className="py-1 pr-3 font-medium">{person.name}</td>
                        <td className="py-1 pr-3 text-gray-600 dark:text-gray-400">{person.party.name !== person.name ? person.party.name : ''}</td>
                        <td className="py-1 whitespace-pre-line text-gray-600 dark:text-gray-400">{person.party.adminNote}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            {unseated.length > 0 && (
              <section className="break-inside-avoid">
                <h2 className="font-semibold border-b-2 border-gray-800 mt-4">Ohne Platz ({unseated.length})</h2>
                <ul className="text-sm">
                  {unseated.map(person => <li key={person.id} className="py-1 border-b border-gray-300 dark:border-gray-600">{person.name}{person.party.name !== person.name && ` (${person.party.name})`}</li>)}
                </ul>
              </section>
            )}
          </>
        )}
        </div>
    </div>
  )
}
