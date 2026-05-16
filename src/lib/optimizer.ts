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
 *
 * Labor protection rules enforced here:
 *  - Full-timers are never trimmed (their shifts are fully protected).
 *  - Trims come from part-timers, least senior first.
 *  - Coverage gaps are filled with the most senior part-timer available,
 *    avoiding (as a tie-breaker) pushing a part-timer above the
 *    lowest-seniority full-timer's weekly hours.
 *  - The team leader's seniority is never used for ranking.
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

function isFullTime(p: TeamMember): boolean {
  return p.status === 'FT';
}

// Lower value = more senior. The team leader and anyone without a seniority
// date rank as least senior (so they are cut first / get extra hours last).
function seniorityValue(p: TeamMember): number {
  if (p.isTeamLeader || !p.seniorityDate) return Number.POSITIVE_INFINITY;
  const t = Date.parse(p.seniorityDate);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function weeklyHoursOf(p: TeamMember, autoDeductLunch: boolean): number {
  let total = 0;
  for (const s of p.shifts) {
    const parsed = parseShift(s, autoDeductLunch);
    if (parsed) total += parsed.hours;
  }
  return total;
}

// Weekly hours of the least-senior full-timer (excluding the team leader).
// Part-timers should not exceed this as a tie-breaker.
function lowestSeniorityFTHours(roster: TeamMember[], autoDeductLunch: boolean): number | null {
  const fts = roster.filter(p => isFullTime(p) && !p.isTeamLeader && p.rosterStatus !== 'Inactive');
  if (fts.length === 0) return null;
  let pick = fts[0];
  for (const p of fts) if (seniorityValue(p) > seniorityValue(pick)) pick = p;
  return weeklyHoursOf(pick, autoDeductLunch);
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
    total += weeklyHoursOf(p, autoDeductLunch);
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

  // 1) Fill coverage shortages. Prefer the most senior part-timer who is
  //    available, and as a tie-breaker avoid pushing a part-timer past the
  //    lowest-seniority full-timer's weekly hours.
  for (let d = 0; d < 7; d++) {
    const need = neededFor(targets[d]);
    (['open', 'close', 'overnight'] as const).forEach(role => {
      let counts = countRoles(roster, d, shiftDefinitions);
      let safety = 0;
      while (counts[role] < need[role] && safety < 50) {
        safety++;
        const std = STANDARD_SHIFT[role];
        const stdHrs = parseShift(std, autoDeductLunch)?.hours ?? 0;
        const cap = lowestSeniorityFTHours(roster, autoDeductLunch);

        const pool = roster.filter(p => {
          if (!isFlexible(p)) return false;
          if ((p.shifts[d] || '').trim()) return false;
          const check = checkAvailabilityViolation(std, p.unavailable[d] || '');
          if (check.isViolation || check.isHardBlock) return false;
          return roleFor(p.coverageStatus, std, shiftDefinitions) === role;
        });

        pool.sort((a, b) => {
          const aOver =
            cap != null && a.status === 'PT' && weeklyHoursOf(a, autoDeductLunch) + stdHrs > cap ? 1 : 0;
          const bOver =
            cap != null && b.status === 'PT' && weeklyHoursOf(b, autoDeductLunch) + stdHrs > cap ? 1 : 0;
          if (aOver !== bOver) return aOver - bOver;
          // Soft preference: avoid scheduling someone on a preferred day off.
          const aPref = a.preferredDaysOff?.[d] ? 1 : 0;
          const bPref = b.preferredDaysOff?.[d] ? 1 : 0;
          if (aPref !== bPref) return aPref - bPref;
          return seniorityValue(a) - seniorityValue(b);
        });

        const candidate = pool[0];
        if (!candidate) {
          notes.push(`${days[d]}: still short ${need[role] - counts[role]} ${role} — no available staff.`);
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

  // 2) Trim to the weekly labor budget. Full-timers are never cut; trims come
  //    from part-timers, least senior first, and only where removal does not
  //    push any role below its required coverage.
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
          .filter(p => isFlexible(p) && !isFullTime(p) && !p.isTeamLeader && (p.shifts[d] || '').trim())
          .map(p => {
            const role = roleFor(p.coverageStatus, p.shifts[d] || '', shiftDefinitions);
            const hrs = parseShift(p.shifts[d] || '', autoDeductLunch)?.hours ?? 0;
            return { p, role, hrs };
          })
          .filter(({ role }) =>
            role === 'open' || role === 'close' || role === 'overnight'
              ? counts[role] > need[role]
              : true
          )
          .sort((a, b) => {
            // Honor preferred days off first: cut those shifts before others.
            const aPref = a.p.preferredDaysOff?.[d] ? 1 : 0;
            const bPref = b.p.preferredDaysOff?.[d] ? 1 : 0;
            if (aPref !== bPref) return bPref - aPref;
            // Least senior first (larger seniority value = more junior).
            const s = seniorityValue(b.p) - seniorityValue(a.p);
            if (s !== 0 && !Number.isNaN(s)) return s;
            return b.hrs - a.hrs;
          });

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
        notes.push(`Still ${over}h over budget — no further safe part-time cuts (full-timers are protected).`);
        break;
      }
    }
  }

  return { changes, notes };
}
