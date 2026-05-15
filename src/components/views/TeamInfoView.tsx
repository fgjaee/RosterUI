import type { TeamMember } from '../../types';
import { parseShift } from '../../lib/helpers';
import { Card, CardContent } from '../ui';

interface TeamInfoViewProps {
  roster: TeamMember[];
  autoDeductLunch: boolean;
}

function personWeeklyHours(p: TeamMember, autoDeductLunch: boolean): number {
  return p.shifts.reduce((sum, s) => {
    const parsed = parseShift(s, autoDeductLunch);
    return sum + (parsed?.hours ?? 0);
  }, 0);
}

function PersonCard({ person, autoDeductLunch }: { person: TeamMember; autoDeductLunch: boolean }) {
  const hours = personWeeklyHours(person, autoDeductLunch);
  const scheduled = person.shifts
    .map((s, i) => ({ day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i], shift: s }))
    .filter(d => d.shift.trim());
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-body-md">
              {(person.name || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-semibold text-on-surface">{person.name || '—'}</div>
              <div className="flex gap-1.5 mt-0.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${person.status === 'FT' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'}`}>
                  {person.status}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  person.rosterStatus === 'Active' ? 'bg-status-opener-bg text-status-opener-text'
                  : person.rosterStatus === 'Starts Next Week' ? 'bg-primary/10 text-primary'
                  : 'bg-surface-container text-on-surface-variant'
                }`}>
                  {person.rosterStatus}
                </span>
                {person.coverageStatus === 'Excluded' && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold bg-surface-container text-on-surface-variant">
                    Excl.
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold font-data-tabular tabular-nums text-on-surface">{hours > 0 ? `${hours.toFixed(1)}h` : '—'}</div>
            <div className="text-body-sm text-on-surface-variant">this week</div>
          </div>
        </div>
        {scheduled.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {scheduled.map(d => (
              <div key={d.day} className="bg-surface-container-high rounded-md px-2 py-1 text-body-sm text-on-surface">
                <span className="font-semibold text-on-surface-variant mr-1">{d.day}</span>
                {d.shift}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-body-sm text-on-surface-variant italic">No shifts scheduled this week.</div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, persons, emptyMsg, autoDeductLunch }: { title: string; persons: TeamMember[]; emptyMsg: string; autoDeductLunch: boolean }) {
  return (
    <div>
      <h2 className="font-headline-md text-headline-md text-on-surface mb-3">{title}
        <span className="ml-2 text-body-md text-on-surface-variant font-normal">({persons.length})</span>
      </h2>
      {persons.length === 0 ? (
        <div className="text-body-md text-on-surface-variant italic">{emptyMsg}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {persons.map(p => <PersonCard key={p.id} person={p} autoDeductLunch={autoDeductLunch} />)}
        </div>
      )}
    </div>
  );
}

export function TeamInfoView({ roster, autoDeductLunch }: TeamInfoViewProps) {
  const active = roster.filter(p => p.rosterStatus === 'Active');
  const nextWeek = roster.filter(p => p.rosterStatus === 'Starts Next Week');
  const inactive = roster.filter(p => p.rosterStatus === 'Inactive');

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">Team Info</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">
          Full team directory with shift schedules and status details.
        </p>
      </div>

      <Section title="Active" persons={active} emptyMsg="No active team members." autoDeductLunch={autoDeductLunch} />
      {nextWeek.length > 0 && <Section title="Starting Next Week" persons={nextWeek} emptyMsg="" autoDeductLunch={autoDeductLunch} />}
      <Section title="Inactive" persons={inactive} emptyMsg="No inactive members." autoDeductLunch={autoDeductLunch} />
    </div>
  );
}
