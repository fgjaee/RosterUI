import type { TeamMember, Target, ShiftDefinitions, Day } from '../types';
import { days, parseShift, roleFor, checkAvailabilityViolation, toNumber } from './helpers';

/**
 * Smart schedule revision.
 *
 * This is the rule-based engine. The signature is intentionally a pure
 * function (constraints in -> revision out) so it can later be swapped for
 * an LLM-backed implementation without touching any callers: replace the
 * body of `reviseSchedule` with a model call that returns the same
 * `RevisionResult` shape.
 */

type CoverageRole = 'open' | 'close' | 'overnight';

const STANDARD_SHIFT: Record<CoverageRole, string> = {
  open: '6:00 AM - 2:00 PM',
  close: '1:00 PM - 9:00 PM',
  overnight: '10:00 PM - 6:00 AM',
};

export type ScheduleChange = {
  personId: string;
  name: string;
  dayIndex: number;
  day: Day;
  from: string;
  to: string;
  reason: string;
  kind: 'add' | 'remove';
};

export type RevisionResult = {
  changes: ScheduleChange[];
  notes: string[];
};

export interface ReviseScheduleArgs {
  roster: TeamMember[];
  targets: Target[];
  shiftDefinitions: ShiftDefinitions;
  autoDeductLunch: boolean;
  minimumShiftLength: number;
  weeklyHoursAvailable: number;
}

function isFlexible(p: TeamMember): boolean {
  return !p.scheduleLocked && p.rosterStatus !== 'Inactive' && p.coverageStatus !== 'Excluded';
}

function countRoles(roster: TeamMember[], dayIndex: number, defs: ShiftDefinitions) {
  const counts: Record<CoverageRole, number> = { open: 0, close: 0, overnight: 0 };
  for (const p of roster) {
    if (p.rosterStatus === 'Inactive') continue;
    const role = roleFor(p.coverageStatus, p.shifts[dayIndex] || '', defs);
    if (role === 'open' || role === 'close' || role === 'overnight') counts[role]++;
  }
  return counts;
}

function totalHours(roster: TeamMember[], autoDeductLunch: boolean): number {
  let total = 0;
  for (const p of roster) {
    if (p.rosterStatus === 'Inactive') continue;
    for (const s of p.shifts) {
      const parsed = parseShift(s, autoDeductLunch);
      if (parsed) total += parsed.hours;
    }
  }
  return total;
}

function neededFor(target: Target | undefined): Record<CoverageRole, number> {
  return {
    open: Math.max(0, toNumber(target?.openNeeded ?? '0')),
    close: Math.max(0, toNumber(target?.closeNeeded ?? '0')),
    overnight: Math.max(0, toNumber(target?.overnightNeeded ?? '0')),
  };
}

export function reviseSchedule(args: ReviseScheduleArgs): RevisionResult {
  const { targets, shiftDefinitions, autoDeductLunch, weeklyHoursAvailable } = args;
  const roster = args.roster.map(p => ({ ...p, shifts: [...p.shifts] }));
  const changes: ScheduleChange[] = [];
  const notes: string[] = [];

  // 1) Fill coverage shortages using available flexible staff.
  for (let d = 0; d < 7; d++) {
    const need = neededFor(targets[d]);
    (['open', 'close', 'overnight'] as const).forEach(role => {
      let counts = countRoles(roster, d, shiftDefinitions);
      let safety = 0;
      while (counts[role] < need[role] && safety < 50) {
        safety++;
        const std = STANDARD_SHIFT[role];
        const candidate = roster.find(p => {
          if (!isFlexible(p)) return false;
          if ((p.shifts[d] || '').trim()) return false;
          const check = checkAvailabilityViolation(std, p.unavailable[d] || '');
          if (check.isViolation || check.isHardBlock) return false;
          return roleFor(p.coverageStatus, std, shiftDefinitions) === role;
        });
        if (!candidate) {
          notes.push(`${days[d]}: still short ${need[role] - counts[role]} ${role} — no available flexible staff.`);
          break;
        }
        const from = candidate.shifts[d] || '';
        candidate.shifts[d] = std;
        changes.push({
          personId: candidate.id,
          name: candidate.name,
          dayIndex: d,
          day: days[d],
          from,
          to: std,
          reason: `Cover ${role} shortage on ${days[d]}`,
          kind: 'add',
        });
        counts = countRoles(roster, d, shiftDefinitions);
      }
    });
  }

  // 2) Trim flexible shifts to fit the weekly labor budget, only where
  //    removal does not push any role below its required coverage.
  const budget = weeklyHoursAvailable;
  if (budget > 0) {
    let guard = 0;
    while (totalHours(roster, autoDeductLunch) > budget && guard < 500) {
      guard++;
      let removed = false;
      for (let d = 0; d < 7 && !removed; d++) {
        const need = neededFor(targets[d]);
        const counts = countRoles(roster, d, shiftDefinitions);
        const candidates = roster
          .filter(p => isFlexible(p) && (p.shifts[d] || '').trim())
          .map(p => {
            const role = roleFor(p.coverageStatus, p.shifts[d] || '', shiftDefinitions);
            const hrs = parseShift(p.shifts[d] || '', autoDeductLunch)?.hours ?? 0;
            return { p, role, hrs };
          })
          .filter(({ role }) =>
            role === 'none' || role === 'mid' || role === 'excluded'
              ? true
              : counts[role as CoverageRole] > need[role as CoverageRole]
          )
          .sort((a, b) => b.hrs - a.hrs);

        if (candidates.length > 0) {
          const { p } = candidates[0];
          const from = p.shifts[d];
          p.shifts[d] = '';
          changes.push({
            personId: p.id,
            name: p.name,
            dayIndex: d,
            day: days[d],
            from,
            to: '',
            reason: `Trim labor to budget (${budget}h)`,
            kind: 'remove',
          });
          removed = true;
        }
      }
      if (!removed) {
        const over = Math.round(totalHours(roster, autoDeductLunch) - budget);
        notes.push(`Still ${over}h over budget — no further safe cuts without breaking coverage.`);
        break;
      }
    }
  }

  return { changes, notes };
}
