import { Fragment, useState } from 'react';
import type { TeamMember, TimeOffRequest, EmploymentStatus, RosterStatus } from '../../types';
import { parseShift, createTeamMember, days } from '../../lib/helpers';
import { Card, CardContent } from '../ui';

interface EmployeesViewProps {
  roster: TeamMember[]; // This will be the global pool
  autoDeductLunch: boolean;
  onRosterChange?: (next: TeamMember[]) => void;
}

type SortKey = 'name' | 'status' | 'rosterStatus' | 'weeklyHours' | 'primaryDepartment' | 'seniority';

const DEPARTMENTS = ['Produce', 'Bakery', 'Meat', 'Deli', 'Grocery', 'Front End'];

export function EmployeesView({ roster, autoDeductLunch, onRosterChange }: EmployeesViewProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'All' | 'FT' | 'PT'>('All');
  const [rosterFilter, setRosterFilter] = useState<'All' | 'Active' | 'Starts Next Week' | 'Inactive'>('All');
  const [deptFilter, setDeptFilter] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const editable = !!onRosterChange;

  function patchMember(id: string, patch: Partial<TeamMember>) {
    onRosterChange?.(roster.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }

  function addMember() {
    if (!onRosterChange) return;
    const m = createTeamMember(roster.length);
    m.name = '';
    m.primaryDepartment = deptFilter !== 'All' ? deptFilter : 'Produce';
    onRosterChange([...roster, m]);
    setExpandedId(m.id);
    setSearch('');
  }

  function removeMember(p: TeamMember) {
    if (!onRosterChange) return;
    if (!confirm(`Remove ${p.name || 'this team member'} from the team? They will no longer appear on future weeks.`)) return;
    onRosterChange(roster.filter(x => x.id !== p.id));
    if (expandedId === p.id) setExpandedId(null);
  }

  function updateTimeOff(p: TeamMember, next: TimeOffRequest[]) {
    patchMember(p.id, { timeOff: next });
  }

  const departments = ['All', ...DEPARTMENTS];

  const withHours = roster.map(p => {
    const weeklyHours = p.shifts.reduce((sum, s) => {
      const parsed = parseShift(s, autoDeductLunch);
      return sum + (parsed?.hours ?? 0);
    }, 0);
    return { ...p, weeklyHours };
  });

  const filtered = withHours
    .filter(p => {
      const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'All' || p.status === statusFilter;
      const matchRoster = rosterFilter === 'All' || p.rosterStatus === rosterFilter;
      const matchDept = deptFilter === 'All' || p.primaryDepartment === deptFilter;
      return matchSearch && matchStatus && matchRoster && matchDept;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortKey === 'rosterStatus') cmp = a.rosterStatus.localeCompare(b.rosterStatus);
      else if (sortKey === 'weeklyHours') cmp = a.weeklyHours - b.weeklyHours;
      else if (sortKey === 'primaryDepartment') cmp = (a.primaryDepartment || '').localeCompare(b.primaryDepartment || '');
      else if (sortKey === 'seniority') {
        // Most senior first = earliest date. Missing dates sort last.
        const da = a.seniorityDate || '9999-12-31';
        const db = b.seniorityDate || '9999-12-31';
        cmp = da.localeCompare(db);
      }
      return sortAsc ? cmp : -cmp;
    });

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const SortIcon = ({ col }: { col: SortKey }) => (
    <span className={`material-symbols-outlined text-[14px] ml-1 ${sortKey === col ? 'opacity-100' : 'opacity-30'}`}>
      {sortKey === col && !sortAsc ? 'arrow_downward' : 'arrow_upward'}
    </span>
  );

  const active = roster.filter(r => r.rosterStatus === 'Active').length;
  const inactive = roster.filter(r => r.rosterStatus === 'Inactive').length;

  const fieldCls =
    'w-full bg-surface-container-low border border-outline-variant/30 rounded-md px-2 py-1.5 text-body-sm text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary/50 outline-none';
  const labelCls = 'block text-label-bold uppercase text-on-surface-variant mb-1';

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">Employees</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            Full directory of all team members. This list persists week to week until a member is removed here.
          </p>
        </div>
        {editable && (
          <button
            onClick={addMember}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-body-sm font-semibold text-on-primary hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            Add Member
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Active', value: active, color: 'text-status-opener-text', bg: 'bg-status-opener-bg' },
          { label: 'Inactive', value: inactive, color: 'text-on-surface-variant', bg: 'bg-surface-container' },
        ].map(({ label, value, color, bg }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${bg}`}>
                <span className={`text-headline-md font-bold font-data-tabular tabular-nums ${color}`}>{value}</span>
              </div>
              <div className="text-body-md text-on-surface-variant">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none">search</span>
            <input
              className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant/30 rounded-md text-body-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 outline-none text-on-surface placeholder:text-outline"
              placeholder="Search by name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2">
          {(['All', 'FT', 'PT'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-md text-body-sm font-semibold transition-colors ${statusFilter === f ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {departments.map(f => (
            <button
              key={f}
              onClick={() => setDeptFilter(f)}
              className={`px-3 py-1.5 rounded-md text-body-sm font-semibold transition-colors ${deptFilter === f ? 'bg-tertiary text-on-tertiary' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {(['All', 'Active', 'Inactive'] as const).map(f => (
            <button
              key={f}
              onClick={() => setRosterFilter(f as typeof rosterFilter)}
              className={`px-3 py-1.5 rounded-md text-body-sm font-semibold transition-colors ${rosterFilter === f ? 'bg-secondary text-on-secondary' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-outline-variant/30 bg-surface-container-low">
                {([
                  { key: 'name', label: 'Name' },
                  { key: 'status', label: 'Type' },
                  { key: 'primaryDepartment', label: 'Department' },
                  { key: null, label: 'Role' },
                  { key: 'rosterStatus', label: 'Roster' },
                  { key: 'seniority', label: 'Seniority' },
                  { key: null, label: 'Leader' },
                  { key: 'weeklyHours', label: 'Weekly Hrs' },
                  { key: null, label: '' },
                ] as { key: SortKey | null; label: string }[]).map(({ key, label }, idx) => (
                  <th
                    key={label || `col-${idx}`}
                    className={`p-3 text-left text-label-bold uppercase text-on-surface-variant select-none ${key ? 'cursor-pointer hover:text-on-surface' : ''}`}
                    onClick={key ? () => toggleSort(key) : undefined}
                  >
                    {label}{key && <SortIcon col={key} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-on-surface-variant">No employees match your filters.</td>
                </tr>
              ) : filtered.map((p, i) => (
                <Fragment key={p.id}>
                  <tr
                    className={`border-b border-outline-variant/20 transition-colors hover:bg-surface-container-low ${i % 2 === 0 ? '' : 'bg-surface-container-lowest'} ${expandedId === p.id ? 'bg-primary/5' : ''}`}
                  >
                    <td className="p-3 font-semibold text-on-surface">{p.name || <span className="text-on-surface-variant font-normal italic">Unnamed</span>}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-bold ${p.status === 'FT' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-on-surface-variant text-body-sm font-medium">{p.primaryDepartment || 'Unassigned'}</span>
                    </td>
                    <td className="p-3">
                      <span className="text-on-surface-variant text-body-sm">{p.role || '—'}</span>
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-bold ${
                        p.rosterStatus === 'Active' ? 'bg-status-opener-bg text-status-opener-text'
                        : p.rosterStatus === 'Starts Next Week' ? 'bg-primary/10 text-primary'
                        : 'bg-surface-container text-on-surface-variant'
                      }`}>
                        {p.rosterStatus}
                      </span>
                    </td>
                    <td className="p-3 font-data-tabular tabular-nums text-on-surface-variant text-body-sm">
                      {p.seniorityDate || '—'}
                    </td>
                    <td className="p-3">
                      {p.isTeamLeader ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-bold bg-primary text-on-primary">
                          <span className="material-symbols-outlined text-[14px]">star</span>Leader
                        </span>
                      ) : (
                        <span className="text-on-surface-variant">—</span>
                      )}
                    </td>
                    <td className="p-3 font-data-tabular tabular-nums font-bold text-on-surface">
                      {p.weeklyHours > 0 ? `${p.weeklyHours.toFixed(1)}h` : <span className="text-on-surface-variant font-normal">—</span>}
                    </td>
                    <td className="p-3 whitespace-nowrap text-right">
                      <button
                        onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-body-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">{expandedId === p.id ? 'expand_less' : 'edit'}</span>
                        {expandedId === p.id ? 'Close' : 'Edit'}
                      </button>
                      {editable && (
                        <button
                          onClick={() => removeMember(p)}
                          title={`Remove ${p.name || 'team member'}`}
                          className="ml-1 inline-flex items-center rounded-md px-2 py-1 text-body-sm font-semibold text-error hover:bg-error/10 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === p.id && (
                    <tr className="border-b border-outline-variant/30 bg-surface-container-lowest">
                      <td colSpan={9} className="p-5">
                        {!editable && (
                          <div className="mb-4 rounded-md bg-surface-container px-3 py-2 text-body-sm text-on-surface-variant">
                            Editing is read-only here.
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                          <div>
                            <label className={labelCls}>Name</label>
                            <input className={fieldCls} value={p.name} disabled={!editable}
                              onChange={e => patchMember(p.id, { name: e.target.value })} />
                          </div>
                          <div>
                            <label className={labelCls}>Employment</label>
                            <select className={fieldCls} value={p.status} disabled={!editable}
                              onChange={e => patchMember(p.id, { status: e.target.value as EmploymentStatus })}>
                              <option value="FT">Full Time</option>
                              <option value="PT">Part Time</option>
                            </select>
                          </div>
                          <div>
                            <label className={labelCls}>Department</label>
                            <select className={fieldCls} value={p.primaryDepartment || 'Produce'} disabled={!editable}
                              onChange={e => patchMember(p.id, { primaryDepartment: e.target.value })}>
                              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={labelCls}>Roster Status</label>
                            <select className={fieldCls} value={p.rosterStatus === 'Starts Next Week' ? 'Active' : p.rosterStatus} disabled={!editable}
                              onChange={e => patchMember(p.id, { rosterStatus: e.target.value as RosterStatus })}>
                              <option value="Active">Active</option>
                              <option value="Inactive">Inactive</option>
                            </select>
                          </div>
                          <div>
                            <label className={labelCls}>Role / Position</label>
                            <input className={fieldCls} value={p.role || ''} disabled={!editable}
                              placeholder="e.g. Produce Stock"
                              onChange={e => patchMember(p.id, { role: e.target.value || undefined })} />
                          </div>
                          <div>
                            <label className={labelCls}>Job Title</label>
                            <input className={fieldCls} value={p.jobTitle || ''} disabled={!editable}
                              placeholder="e.g. Team Leader"
                              onChange={e => patchMember(p.id, { jobTitle: e.target.value || undefined })} />
                          </div>
                          <div>
                            <label className={labelCls}>Birthday</label>
                            <input type="date" className={fieldCls} value={p.birthday || ''} disabled={!editable}
                              onChange={e => patchMember(p.id, { birthday: e.target.value || undefined })} />
                          </div>
                          <div>
                            <label className={labelCls}>Seniority Date</label>
                            <input type="date" className={fieldCls} value={p.seniorityDate || ''} disabled={!editable}
                              onChange={e => patchMember(p.id, { seniorityDate: e.target.value || undefined })} />
                          </div>
                          <div>
                            <label className={labelCls}>Coverage</label>
                            <select className={fieldCls} value={p.coverageStatus ?? 'Included'} disabled={!editable}
                              onChange={e => patchMember(p.id, { coverageStatus: e.target.value as 'Included' | 'Excluded' })}>
                              <option value="Included">Included</option>
                              <option value="Excluded">Excluded</option>
                            </select>
                          </div>
                          <div className="flex items-end">
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={() => patchMember(p.id, { isTeamLeader: !p.isTeamLeader })}
                              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-body-sm font-semibold transition-colors ${p.isTeamLeader ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'} disabled:opacity-60`}
                            >
                              <span className="material-symbols-outlined text-[16px]">{p.isTeamLeader ? 'star' : 'star_outline'}</span>
                              {p.isTeamLeader ? 'Team Leader' : 'Mark as Leader'}
                            </button>
                          </div>
                        </div>

                        {/* Preferred days off (soft preference) */}
                        <div className="mt-5">
                          <span className={labelCls}>Preferred Days Off</span>
                          <p className="text-body-sm text-on-surface-variant mb-2">
                            A soft preference (not a hard block). The scheduler tries to keep these days free but may override when coverage requires it.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {days.map((dayName, di) => {
                              const on = !!p.preferredDaysOff?.[di];
                              return (
                                <button
                                  key={dayName}
                                  type="button"
                                  disabled={!editable}
                                  onClick={() => {
                                    const arr = (p.preferredDaysOff && p.preferredDaysOff.length === 7)
                                      ? [...p.preferredDaysOff]
                                      : [false, false, false, false, false, false, false];
                                    arr[di] = !arr[di];
                                    patchMember(p.id, { preferredDaysOff: arr });
                                  }}
                                  className={`rounded-md px-3 py-1.5 text-body-sm font-semibold transition-colors disabled:opacity-60 ${on ? 'bg-secondary text-on-secondary' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'}`}
                                >
                                  {dayName}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Time-off requests */}
                        <div className="mt-5">
                          <div className="flex items-center justify-between">
                            <span className={labelCls}>Time-off Requests</span>
                            {editable && (
                              <button
                                onClick={() => updateTimeOff(p, [...(p.timeOff || []), { date: '', type: 'Paid' }])}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-body-sm font-semibold text-primary hover:bg-primary/10"
                              >
                                <span className="material-symbols-outlined text-[16px]">add</span>Add request
                              </button>
                            )}
                          </div>
                          {(p.timeOff && p.timeOff.length > 0) ? (
                            <div className="mt-2 space-y-2">
                              {p.timeOff.map((req, idx) => (
                                <div key={idx} className="flex flex-wrap items-center gap-2">
                                  <input type="date" className={`${fieldCls} max-w-[170px]`} value={req.date} disabled={!editable}
                                    onChange={e => updateTimeOff(p, p.timeOff!.map((r, j) => j === idx ? { ...r, date: e.target.value } : r))} />
                                  <select className={`${fieldCls} max-w-[120px]`} value={req.type} disabled={!editable}
                                    onChange={e => updateTimeOff(p, p.timeOff!.map((r, j) => j === idx ? { ...r, type: e.target.value as 'Paid' | 'Unpaid' } : r))}>
                                    <option value="Paid">Paid</option>
                                    <option value="Unpaid">Unpaid</option>
                                  </select>
                                  <input className={`${fieldCls} flex-1 min-w-[160px]`} value={req.note || ''} placeholder="Note (optional)" disabled={!editable}
                                    onChange={e => updateTimeOff(p, p.timeOff!.map((r, j) => j === idx ? { ...r, note: e.target.value } : r))} />
                                  {editable && (
                                    <button
                                      onClick={() => updateTimeOff(p, p.timeOff!.filter((_, j) => j !== idx))}
                                      className="inline-flex items-center rounded-md px-2 py-1.5 text-error hover:bg-error/10"
                                      title="Remove request"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">close</span>
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-body-sm text-on-surface-variant">No time-off requests.</p>
                          )}
                        </div>

                        {editable && (
                          <div className="mt-5 flex justify-end">
                            <button
                              onClick={() => removeMember(p)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-error/40 px-3 py-2 text-body-sm font-semibold text-error hover:bg-error/10"
                            >
                              <span className="material-symbols-outlined text-[16px]">person_remove</span>
                              Remove from team
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
