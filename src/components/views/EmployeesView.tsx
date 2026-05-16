import { useState } from 'react';
import type { TeamMember } from '../../types';
import { parseShift } from '../../lib/helpers';
import { Card, CardContent } from '../ui';

interface EmployeesViewProps {
  roster: TeamMember[]; // This will be the global pool
  autoDeductLunch: boolean;
  onRosterChange?: (next: TeamMember[]) => void;
}

type SortKey = 'name' | 'status' | 'rosterStatus' | 'weeklyHours' | 'primaryDepartment' | 'seniority';

export function EmployeesView({ roster, autoDeductLunch, onRosterChange }: EmployeesViewProps) {
  function patchMember(id: string, patch: Partial<TeamMember>) {
    onRosterChange?.(roster.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'All' | 'FT' | 'PT'>('All');
  const [rosterFilter, setRosterFilter] = useState<'All' | 'Active' | 'Starts Next Week' | 'Inactive'>('All');
  const [deptFilter, setDeptFilter] = useState('All');

  const departments = ['All', 'Produce', 'Bakery', 'Meat', 'Deli', 'Grocery', 'Front End'];

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
  const next = roster.filter(r => r.rosterStatus === 'Starts Next Week').length;
  const inactive = roster.filter(r => r.rosterStatus === 'Inactive').length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">Employees</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">Full directory of all team members.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active', value: active, color: 'text-status-opener-text', bg: 'bg-status-opener-bg' },
          { label: 'Starting Next Week', value: next, color: 'text-primary', bg: 'bg-primary/10' },
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
                  { key: 'rosterStatus', label: 'Roster' },
                  { key: null, label: 'Coverage' },
                  { key: 'seniority', label: 'Seniority' },
                  { key: null, label: 'Leader' },
                  { key: 'weeklyHours', label: 'Weekly Hrs' },
                ] as { key: SortKey | null; label: string }[]).map(({ key, label }) => (
                  <th
                    key={label}
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
                  <td colSpan={8} className="p-8 text-center text-on-surface-variant">No employees match your filters.</td>
                </tr>
              ) : filtered.map((p, i) => (
                <tr
                  key={p.id}
                  className={`border-b border-outline-variant/20 transition-colors hover:bg-surface-container-low ${i % 2 === 0 ? '' : 'bg-surface-container-lowest'}`}
                >
                  <td className="p-3 font-semibold text-on-surface">{p.name || '—'}</td>
                  <td className="p-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-bold ${p.status === 'FT' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="text-on-surface-variant text-body-sm font-medium">{p.primaryDepartment || 'Unassigned'}</span>
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
                  <td className="p-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-bold ${p.coverageStatus === 'Excluded' ? 'bg-surface-container text-on-surface-variant' : 'bg-status-opener-bg text-status-opener-text'}`}>
                      {p.coverageStatus ?? 'Included'}
                    </span>
                  </td>
                  <td className="p-3">
                    <input
                      type="date"
                      value={p.seniorityDate || ''}
                      onChange={e => patchMember(p.id, { seniorityDate: e.target.value || undefined })}
                      disabled={!onRosterChange}
                      className="bg-surface-container-low border border-outline-variant/30 rounded-md px-2 py-1 text-body-sm text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary/50 outline-none disabled:opacity-60"
                    />
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => onRosterChange && patchMember(p.id, { isTeamLeader: !p.isTeamLeader })}
                      disabled={!onRosterChange}
                      title={p.isTeamLeader ? 'Team leader (seniority not used for cuts)' : 'Mark as team leader'}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-bold transition-colors ${p.isTeamLeader ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
                    >
                      <span className="material-symbols-outlined text-[14px]">{p.isTeamLeader ? 'star' : 'star_outline'}</span>
                      {p.isTeamLeader ? 'Leader' : '—'}
                    </button>
                  </td>
                  <td className="p-3 font-data-tabular tabular-nums font-bold text-on-surface">
                    {p.weeklyHours > 0 ? `${p.weeklyHours.toFixed(1)}h` : <span className="text-on-surface-variant font-normal">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
