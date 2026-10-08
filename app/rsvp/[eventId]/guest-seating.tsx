// app/rsvp/[eventId]/guest-seating.tsx
import type { GuestSeatingView } from '../../lib/rsvp/guest-seating'

/** Sitzordnung für Gäste mit Zusage (Event.guestSeatingVisible): eigener Platz oben, darunter alle Tische mit Namen. */
export default function GuestSeating({ view }: { view: GuestSeatingView }) {
  if (view.groups.length === 0) {
    return <p className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow text-sm text-gray-700 dark:text-gray-300">Die Sitzordnung steht noch nicht fest. Schau später noch einmal vorbei.</p>
  }
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4">
      <h2 className="text-lg font-bold">Sitzordnung</h2>
      {view.ownSeats.length > 0 ? (
        <p className="text-sm bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded p-3" data-testid="own-seats">
          {view.ownSeats.length === 1 ? 'Dein Platz' : 'Eure Plätze'}:{' '}
          {view.ownSeats.map(s => `${s.name} – ${s.seat}`).join(' · ')}
        </p>
      ) : (
        <p className="text-sm text-gray-700 dark:text-gray-300">Für deine Zusage ist noch kein Platz eingetragen.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {view.groups.map(group => (
          <section key={group.label} className={`rounded border p-3 ${group.own ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/50' : 'border-gray-200 dark:border-gray-700'}`} data-testid="guest-seating-group">
            <h3 className="font-semibold">{group.label}</h3>
            <ul className="text-sm mt-1 space-y-0.5">
              {group.persons.map(person => (
                <li key={person.seat} className={person.own ? 'font-semibold' : ''}>{person.name}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
