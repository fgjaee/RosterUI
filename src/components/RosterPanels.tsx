import type {
  TeamMember, Target, SummaryRow, ShiftDefinitions, Role,
  EmploymentStatus, RosterStatus,
} from '../types';
import {
  days, roleFor, roleLabel, checkAvailabilityViolation,
  formatHours, toNumber,
} from '../lib/helpers';
import { AppButton, AppInput, AppSelect, Card, CardContent } from './ui';

const roleBadge: Record<Role, string> = {
  open: 'bg-status-opener-bg text-status-opener-text',
  close: 'bg-status-closer-bg text-status-closer-text',
  overnight: 'bg-status-overnight-bg text-status-overnight-text',
  mid: 'bg-status-mid-bg text-status-mid-text',
  excluded: 'bg-surface-container-high text-on-surface-variant',
  none: 'bg-surface-container-lowest text-on-surface-variant',
};

interface CompactRosterPanelsProps {
  roster: TeamMember[];
  targets: Target[];
  summary: SummaryRow[];
  shiftDefinitions: ShiftDefinitions;
  onUpdateShift: (rowIndex: number, dayIndex: number, value: string) => void;
  onUpdateUnavailable: (rowIndex: number, dayIndex: number, value: string) => void;
  onUpdateName: (rowIndex: number, value: string) => void;
  onUpdateStatus: (rowIndex: number, value: EmploymentStatus) => void;
  onUpdateRosterStatus: (rowIndex: number, value: RosterStatus) => void;
  onRemovePerson: (id: string) => void;
}

export function CompactRosterPanels({
  roster,
  targets,
  summary,
  shiftDefinitions,
  onUpdateShift,
  onUpdateUnavailable,
  onUpdateName,
  onUpdateStatus,
  onUpdateRosterStatus,
  onRemovePerson,
}: CompactRosterPanelsProps) {
  return (
    <div className="space-y-4">
      {/* ── Schedule ─────────────────────────────────────────── */}
      <Card className="rounded-xl shadow-sm border-outline-variant">
        <CardContent className="p-3 sm:p-4">
          <div className="mb-3">
            <h2 className="text-headline-md text-on-surface">Weekly Schedule</h2>
            <p className="text-body-sm text-on-surface-variant">Compact view — one card per person. Shifts outside availability turn red.</p>
          </div>
          <div className="space-y-3">
            {roster.map((person, rowIndex) => {
              const isInactive = person.rosterStatus === 'Inactive';
              return (
                <div key={person.id} className={`rounded-xl border p-3 ${isInactive ? 'border-outline-variant/30 bg-surface-container-low opacity-80' : 'border-outline-variant/40 bg-surface-container-lowest'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <AppInput
                      value={person.name}
                      onChange={(e) => onUpdateName(rowIndex, e.target.value)}
                      placeholder="Full Name"
                      className="h-9 flex-1 min-w-[140px] rounded-lg font-semibold"
                    />
                    <AppSelect value={person.status} onChange={(e) => onUpdateStatus(rowIndex, e.target.value as EmploymentStatus)} className="h-9 w-[64px] rounded-lg text-xs">
                      <option value="FT">FT</option>
                      <option value="PT">PT</option>
                    </AppSelect>
                    <AppSelect value={person.rosterStatus} onChange={(e) => onUpdateRosterStatus(rowIndex, e.target.value as RosterStatus)} className="h-9 w-[112px] rounded-lg text-xs">
                      <option value="Active">Active</option>
                      <option value="Starts Next Week">Next Wk</option>
                      <option value="Inactive">Inactive</option>
                    </AppSelect>
                    <AppButton variant="ghost" size="icon" onClick={() => onRemovePerson(person.id)} className="h-9 w-9 rounded-lg text-error" aria-label={`Remove ${person.name || 'team member'}`}>
                      <span className="text-lg leading-none">×</span>
                    </AppButton>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {days.map((day, dayIndex) => {
                      const shift = person.shifts[dayIndex] || '';
                      const role = isInactive ? 'none' : roleFor(person.coverageStatus, shift, shiftDefinitions);
                      const check = checkAvailabilityViolation(shift, person.unavailable[dayIndex] || '');
                      const bad = check.isViolation || check.isHardBlock;
                      return (
                        <div key={day} className={`rounded-lg border p-2 ${bad ? 'border-error/40 bg-error-container/60' : 'border-outline-variant/40 bg-surface-container-low'}`}>
                          <div className="flex items-center justify-between text-[11px] font-bold text-on-surface-variant">
                            <span>{day}</span>
                            <span className="font-data-tabular tabular-nums opacity-70">{targets[dayIndex]?.date?.slice(5) || ''}</span>
                          </div>
                          <AppInput
                            value={shift}
                            onChange={(e) => onUpdateShift(rowIndex, dayIndex, e.target.value)}
                            placeholder="OFF"
                            className={`mt-1 h-9 rounded-lg text-xs font-data-tabular tabular-nums ${bad ? 'border-error/40 text-error' : ''}`}
                          />
                          {role !== 'none' && (
                            <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleBadge[role]}`}>
                              {roleLabel(role)}
                            </div>
                          )}
                          {check.message && (
                            <div className={`mt-1 text-[10px] leading-tight ${bad ? 'text-on-error-container' : 'text-on-surface-variant'}`}>{check.message}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Availability ─────────────────────────────────────── */}
      <Card className="rounded-xl shadow-sm border-outline-variant">
        <CardContent className="p-3 sm:p-4">
          <div className="mb-3">
            <h2 className="text-headline-md text-on-surface">Availability</h2>
            <p className="text-body-sm text-on-surface-variant">Leave blank if available. Add a reason or pattern (e.g. &quot;No mornings&quot;) otherwise.</p>
          </div>
          <div className="space-y-3">
            {roster.map((person, rowIndex) => (
              <div key={person.id} className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
                <div className="mb-2 font-semibold text-on-surface">
                  {person.name || '—'}
                  {person.rosterStatus !== 'Active' && (
                    <span className="ml-1 text-[11px] font-normal uppercase text-on-surface-variant">({person.rosterStatus})</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {days.map((day, dayIndex) => {
                    const reason = person.unavailable[dayIndex] || '';
                    return (
                      <div key={day} className={`rounded-lg border p-2 ${reason ? 'border-error/40 bg-error-container/60' : 'border-outline-variant/40 bg-surface-container-low'}`}>
                        <div className="text-[11px] font-bold text-on-surface-variant">{day}</div>
                        <AppInput
                          value={reason}
                          onChange={(e) => onUpdateUnavailable(rowIndex, dayIndex, e.target.value)}
                          placeholder="Available"
                          className={`mt-1 h-9 rounded-lg text-xs font-data-tabular tabular-nums ${reason ? 'border-error/40 text-error' : ''}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Coverage Summary (read-only) ─────────────────────── */}
      <Card className="rounded-xl shadow-sm border-outline-variant">
        <CardContent className="p-3 sm:p-4">
          <h2 className="mb-3 text-headline-md text-on-surface">Coverage Summary</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {summary.map((row, dayIndex) => {
              const target = targets[dayIndex];
              const problem = row.openDelta < 0 || row.closeDelta < 0 || row.overnightDelta < 0;
              const cell = (label: string, have: number, needed: number, delta: number) => (
                <div className="flex items-center justify-between rounded-md bg-surface-container-low px-2 py-1">
                  <span className="text-[11px] font-bold uppercase text-on-surface-variant">{label}</span>
                  <span className="font-data-tabular tabular-nums text-on-surface">
                    {have}/{needed}
                    <span className={`ml-1 font-bold ${delta < 0 ? 'text-error' : 'text-status-opener-text'}`}>
                      ({delta >= 0 ? `+${delta}` : delta})
                    </span>
                  </span>
                </div>
              );
              return (
                <div key={row.day} className={`rounded-xl border p-3 ${problem ? 'border-error/30 bg-error-container/50' : 'border-outline-variant/40 bg-surface-container-lowest'}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-bold text-on-surface">{row.day}</span>
                    <span className="text-body-sm text-on-surface-variant font-data-tabular tabular-nums">{row.date}</span>
                  </div>
                  <div className="space-y-1">
                    {cell('Open', row.open, toNumber(target?.openNeeded ?? '0'), row.openDelta)}
                    {cell('Close', row.close, toNumber(target?.closeNeeded ?? '0'), row.closeDelta)}
                    {cell('Overnight', row.overnight, toNumber(target?.overnightNeeded ?? '0'), row.overnightDelta)}
                  </div>
                  <div className="mt-2 text-right text-body-sm text-on-surface-variant">
                    Scheduled <span className="font-bold text-on-surface font-data-tabular tabular-nums">{formatHours(row.scheduledHours)}h</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface PrintableRosterProps {
  mode: 'schedule' | 'availability';
  roster: TeamMember[];
  targets: Target[];
  shiftDefinitions: ShiftDefinitions;
  department: string;
}

export function PrintableRoster({ mode, roster, targets, shiftDefinitions, department }: PrintableRosterProps) {
  const people = roster.filter((p) => p.rosterStatus !== 'Inactive');
  const range = targets.length
    ? `${targets[0]?.date ?? ''} – ${targets[targets.length - 1]?.date ?? ''}`
    : '';
  const title = mode === 'schedule' ? 'Weekly Schedule' : 'Weekly Availability';

  return (
    <div className="p-6 text-black">
      <div className="mb-4 border-b-2 border-black pb-2">
        <h1 className="text-2xl font-bold">{department} — {title}</h1>
        <div className="text-sm">{range} · Printed {new Date().toLocaleDateString()}</div>
      </div>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="border border-gray-500 p-1 text-left">Name</th>
            {days.map((day, dayIndex) => (
              <th key={day} className="border border-gray-500 p-1 text-center">
                <div className="font-bold">{day}</div>
                <div className="font-normal">{targets[dayIndex]?.date ?? ''}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.id} style={{ breakInside: 'avoid' }}>
              <td className="border border-gray-500 p-1 font-semibold">
                {person.name || '—'}
                {person.rosterStatus !== 'Active' && (
                  <span className="font-normal"> ({person.rosterStatus})</span>
                )}
              </td>
              {days.map((day, dayIndex) => {
                if (mode === 'schedule') {
                  const shift = person.shifts[dayIndex] || '';
                  const role = roleFor(person.coverageStatus, shift, shiftDefinitions);
                  return (
                    <td key={day} className="border border-gray-500 p-1 text-center align-top">
                      <div>{shift || '—'}</div>
                      {shift && role !== 'none' && (
                        <div className="text-[9px] uppercase opacity-70">{roleLabel(role)}</div>
                      )}
                    </td>
                  );
                }
                const reason = person.unavailable[dayIndex] || '';
                return (
                  <td key={day} className="border border-gray-500 p-1 text-center">
                    {reason || 'Available'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
