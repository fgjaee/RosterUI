import type { TeamMember, Target, ShiftDefinitions, Day } from '../types';
import { days, parseShift, roleFor, checkAvailabilityViolation, toNumber } from './helpers';

/**
 * Schedule revision engine (rule-based; LLM-swappable).
 *
 * Pure function: constraints in -> revision out. Replace the body of
 * `reviseSchedule` with a model call returning the same `RevisionResult`
 * to swap in an LLM later.
 *
 * Rules:
 *  - Availability is a HARD constraint. Existing shifts that violate it are
 *    cleared; nothing is ever assigned outside availability.
 *  - Morning (openers) is filled first — the floor must be stocked by 9am.
 *  - Full-timers are never trimmed and capped at 5 days / 40h; part-timers
 *    capped at 6 days / 40h.
 *  - Seniority gets first chance at extra hours; juniors lose preferred
 *    days off before seniors; no senior ends with fewer hours than a junior
 *    they could have covered for (availability permitting).
 *  - The team leader must never be the only closer on a day.
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

const isFullTime = (p: TeamMember) => p.status === 'FT';
const isFlexible = (p: TeamMember) =>
  !p.scheduleLocked && p.rosterStatus !== 'Inactive' && p.coverageStatus !== 'Excluded';
const maxDaysFor = (p: TeamMember) => (isFullTime(p) ? 5 : 6);
const MAX_HOURS = 40;

function seniorityValue(p: TeamMember): number {
  if (p.isTeamLeader || !p.seniorityDate) return Number.POSITIVE_INFINITY;
  const t = Date.parse(p.seniorityDate);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function shiftHours(s: string, autoDeductLunch: boolean): number {
  const p = parseShift(s, autoDeductLunch);
  return p ? p.hours : 0;
}

function weeklyHoursOf(p: TeamMember, autoDeductLunch: boolean): number {
  let t = 0;
  for (const s of p.shifts) t += shiftHours(s, autoDeductLunch);
  return t;
}

function daysWorked(p: TeamMember): number {
  return p.shifts.filter(s => s && s.trim()).length;
}

function availableFor(p: TeamMember, dayIndex: number, shift: string): boolean {
  const chk = checkAvailabilityViolation(shift, p.unavailable[dayIndex] || '');
  return !chk.isViolation && !chk.isHardBlock;
}

function lowestSeniorityFTHours(roster: TeamMember[], autoDeductLunch: boolean): number | null {
  const fts = roster.filter(p => isFullTime(p) && !p.isTeamLeader && p.rosterStatus !== 'Inactive');
  if (fts.length === 0) return null;
  let pick = fts[0];
  for (const p of fts) if (seniorityValue(p) > seniorityValue(pick)) pick = p;
  return weeklyHoursOf(pick, autoDeductLunch);
}

function countRoles(roster: TeamMember[], d: number, defs: ShiftDefinitions) {
  const c: Record<CoverageRole, number> = { open: 0, close: 0, overnight: 0 };
  for (const p of roster) {
    if (p.rosterStatus === 'Inactive') continue;
    const r = roleFor(p.coverageStatus, p.shifts[d] || '', defs);
    if (r === 'open' || r === 'close' || r === 'overnight') c[r]++;
  }
  return c;
}

function neededFor(t: Target | undefined): Record<CoverageRole, number> {
  return {
    open: Math.max(0, toNumber(t?.openNeeded ?? '0')),
    close: Math.max(0, toNumber(t?.closeNeeded ?? '0')),
    overnight: Math.max(0, toNumber(t?.overnightNeeded ?? '0')),
  };
}

function totalHours(roster: TeamMember[], autoDeductLunch: boolean): number {
  let t = 0;
  for (const p of roster) if (p.rosterStatus !== 'Inactive') t += weeklyHoursOf(p, autoDeductLunch);
  return t;
}

function closerInfo(roster: TeamMember[], d: number, defs: ShiftDefinitions) {
  const closers = roster.filter(
    p => p.rosterStatus !== 'Inactive' && roleFor(p.coverageStatus, p.shifts[d] || '', defs) === 'close'
  );
  return {
    total: closers.length,
    nonLeader: closers.filter(p => !p.isTeamLeader).length,
    hasLeader: closers.some(p => p.isTeamLeader),
  };
}

// Candidate ordering for ASSIGNING a shift on day d:
//  - people who do NOT prefer that day off come first;
//  - within "no preference", most senior first (first chance at hours);
//  - within "prefers off", least senior first (seniors keep their day off);
//  - PT staying at/under the lowest-seniority FT hours as a final tiebreaker.
function makeAssignComparator(d: number, stdHrs: number, cap: number | null, autoDeduct: boolean) {
  return (a: TeamMember, b: TeamMember): number => {
    const aPref = a.preferredDaysOff?.[d] ? 1 : 0;
    const bPref = b.preferredDaysOff?.[d] ? 1 : 0;
    if (aPref !== bPref) return aPref - bPref;
    if (aPref === 1) {
      // both prefer this day off -> pick the least senior
      const s = seniorityValue(b) - seniorityValue(a);
      if (s !== 0 && !Number.isNaN(s)) return s;
    } else {
      // neither prefers off -> most senior first
      const s = seniorityValue(a) - seniorityValue(b);
      if (s !== 0 && !Number.isNaN(s)) return s;
    }
    const aOver = cap != null && a.status === 'PT' && weeklyHoursOf(a, autoDeduct) + stdHrs > cap ? 1 : 0;
    const bOver = cap != null && b.status === 'PT' && weeklyHoursOf(b, autoDeduct) + stdHrs > cap ? 1 : 0;
    return aOver - bOver;
  };
}

export function reviseSchedule(args: ReviseScheduleArgs): RevisionResult {
  const { targets, shiftDefinitions: defs, autoDeductLunch, weeklyHoursAvailable } = args;
  const roster = args.roster.map(p => ({ ...p, shifts: [...p.shifts] }));
  const changes: ScheduleChange[] = [];
  const notes: string[] = [];

  const record = (
    p: TeamMember, d: number, from: string, to: string, reason: string, kind: 'add' | 'remove'
  ) => changes.push({ personId: p.id, name: p.name, dayIndex: d, day: days[d], from, to, reason, kind });

  // PASS 0 — clear shifts that violate the person's availability.
  for (const p of roster) {
    if (p.rosterStatus === 'Inactive') continue;
    for (let d = 0; d < 7; d++) {
      const shift = p.shifts[d];
      if (!shift || !shift.trim()) continue;
      const chk = checkAvailabilityViolation(shift, p.unavailable[d] || '');
      if (chk.isViolation || chk.isHardBlock) {
        if (p.scheduleLocked) {
          notes.push(`${p.name}: locked shift on ${days[d]} conflicts with availability (${p.unavailable[d]}).`);
        } else {
          record(p, d, shift, '', `Clears availability conflict on ${days[d]}`, 'remove');
          p.shifts[d] = '';
        }
      }
    }
  }

  // PASS 1 — fill coverage, openers first (floor stocked by 9am).
  for (let d = 0; d < 7; d++) {
    const need = neededFor(targets[d]);
    (['open', 'close', 'overnight'] as const).forEach(role => {
      const std = STANDARD_SHIFT[role];
      const stdHrs = shiftHours(std, autoDeductLunch);
      let guard = 0;
      while (countRoles(roster, d, defs)[role] < need[role] && guard < 50) {
        guard++;
        const cap = lowestSeniorityFTHours(roster, autoDeductLunch);
        const pool = roster.filter(p =>
          isFlexible(p) &&
          !(p.shifts[d] || '').trim() &&
          availableFor(p, d, std) &&
          roleFor(p.coverageStatus, std, defs) === role &&
          daysWorked(p) < maxDaysFor(p) &&
          weeklyHoursOf(p, autoDeductLunch) + stdHrs <= MAX_HOURS
        );
        pool.sort(makeAssignComparator(d, stdHrs, cap, autoDeductLunch));
        const pick = pool[0];
        if (!pick) {
          notes.push(`${days[d]}: short ${role} coverage — no available staff within hour/day limits.`);
          break;
        }
        record(pick, d, '', std, `Cover ${role} on ${days[d]}`, 'add');
        pick.shifts[d] = std;
      }
    });
  }

  // PASS 2 — the team leader must not be the only closer.
  for (let d = 0; d < 7; d++) {
    const info = closerInfo(roster, d, defs);
    if (info.hasLeader && info.total > 0 && info.nonLeader === 0) {
      const std = STANDARD_SHIFT.close;
      const stdHrs = shiftHours(std, autoDeductLunch);
      const cap = lowestSeniorityFTHours(roster, autoDeductLunch);
      const pool = roster.filter(p =>
        isFlexible(p) && !p.isTeamLeader &&
        !(p.shifts[d] || '').trim() &&
        availableFor(p, d, std) &&
        roleFor(p.coverageStatus, std, defs) === 'close' &&
        daysWorked(p) < maxDaysFor(p) &&
        weeklyHoursOf(p, autoDeductLunch) + stdHrs <= MAX_HOURS
      );
      pool.sort(makeAssignComparator(d, stdHrs, cap, autoDeductLunch));
      const pick = pool[0];
      if (pick) {
        record(pick, d, '', std, `Team leader must not be the only closer on ${days[d]}`, 'add');
        pick.shifts[d] = std;
      } else {
        notes.push(`${days[d]}: team leader is the only closer and no one else is available to close.`);
      }
    }
  }

  // PASS 3 — trim to the labor budget (part-timers only).
  const budget = weeklyHoursAvailable;
  if (budget > 0) {
    let guard = 0;
    while (totalHours(roster, autoDeductLunch) > budget && guard < 800) {
      guard++;
      let removed = false;
      for (let d = 0; d < 7 && !removed; d++) {
        const need = neededFor(targets[d]);
        const counts = countRoles(roster, d, defs);
        const cInfo = closerInfo(roster, d, defs);
        const cands = roster
          .filter(p => isFlexible(p) && !isFullTime(p) && !p.isTeamLeader && (p.shifts[d] || '').trim())
          .map(p => {
            const role = roleFor(p.coverageStatus, p.shifts[d] || '', defs);
            return { p, role, hrs: shiftHours(p.shifts[d] || '', autoDeductLunch) };
          })
          .filter(({ p, role }) => {
            if (role === 'open' || role === 'close' || role === 'overnight') {
              if (counts[role] <= need[role]) return false; // would break coverage
            }
            // Don't leave the team leader as the only closer.
            if (role === 'close' && cInfo.hasLeader && cInfo.nonLeader - (p.isTeamLeader ? 0 : 1) <= 0) return false;
            return true;
          })
          .sort((a, b) => {
            // cut shifts on preferred days off first
            const aPref = a.p.preferredDaysOff?.[d] ? 1 : 0;
            const bPref = b.p.preferredDaysOff?.[d] ? 1 : 0;
            if (aPref !== bPref) return bPref - aPref;
            // protect mornings: cut open last
            const rank = (r: string) => (r === 'open' ? 2 : r === 'close' || r === 'overnight' ? 1 : 0);
            const rr = rank(a.role) - rank(b.role);
            if (rr !== 0) return rr;
            // least senior first
            const s = seniorityValue(b.p) - seniorityValue(a.p);
            if (s !== 0 && !Number.isNaN(s)) return s;
            return b.hrs - a.hrs;
          });
        if (cands.length > 0) {
          const { p } = cands[0];
          const from = p.shifts[d];
          record(p, d, from, '', `Trim labor to budget (${budget}h)`, 'remove');
          p.shifts[d] = '';
          removed = true;
        }
      }
      if (!removed) {
        const over = Math.round(totalHours(roster, autoDeductLunch) - budget);
        notes.push(`Still ${over}h over budget — no further safe part-time cuts (full-timers protected).`);
        break;
      }
    }
  }

  // PASS 4 — seniority non-inversion: a more senior person should not have
  // fewer hours than a junior in the same employment category when the
  // senior could have taken one of the junior's movable shifts.
  let balanceGuard = 0;
  let improved = true;
  while (improved && balanceGuard < 300) {
    balanceGuard++;
    improved = false;
    for (const senior of roster) {
      if (!isFlexible(senior)) continue;
      for (const junior of roster) {
        if (junior === senior || !isFlexible(junior)) continue;
        if (junior.status !== senior.status) continue; // FT/PT are separate
        if (!(seniorityValue(senior) < seniorityValue(junior))) continue;
        if (weeklyHoursOf(senior, autoDeductLunch) >= weeklyHoursOf(junior, autoDeductLunch)) continue;

        for (let d = 0; d < 7; d++) {
          const shift = junior.shifts[d];
          if (!shift || !shift.trim()) continue;
          if ((senior.shifts[d] || '').trim()) continue;
          if (!availableFor(senior, d, shift)) continue;
          if (daysWorked(senior) >= maxDaysFor(senior)) continue;
          if (weeklyHoursOf(senior, autoDeductLunch) + shiftHours(shift, autoDeductLunch) > MAX_HOURS) continue;
          // Coverage counts are unchanged (same shift moves junior -> senior),
          // so the leader-sole-closer state cannot worsen.
          record(junior, d, shift, '', `Seniority: ${senior.name} has priority over ${junior.name} for hours`, 'remove');
          junior.shifts[d] = '';
          record(senior, d, '', shift, `Seniority: ${senior.name} gets ${junior.name}'s ${days[d]} shift`, 'add');
          senior.shifts[d] = shift;
          improved = true;
          break;
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  return { changes, notes };
}
