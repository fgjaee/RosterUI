import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent, AppButton, AppInput, AppSelect } from './ui';
import { CompactRosterPanels, PrintableRoster } from './RosterPanels';
import { DashboardSummary } from './DashboardSummary';
import { reviseSchedule, type RevisionResult, type ScheduleChange } from '../lib/optimizer';
import type {
  Role, EmploymentStatus, RosterStatus, TeamMember, Target,
  SummaryRow, DailyReduction,
  ShiftDefinitions, SavedRosterState
} from '../types';
import {
  days, parseShift, roleFor, formatHours, formatTimeText,
  createTeamMember, emptyShifts, defaultTruckForDate,
  applyOvernightFromMorningTrucks,
  defaultShiftDefinitions, toNumber, checkAvailabilityViolation,
  checkSixthDayViolation, roleLabel, cellClass
} from '../lib/helpers';

// OCR via CDN (loaded in index.html)
interface TesseractGlobal {
  recognize: (
    image: File | string,
    lang: string,
    options?: { logger?: (m: unknown) => void }
  ) => Promise<{ data: { text: string } }>;
}
declare const Tesseract: TesseractGlobal | undefined;
    





















import type { AuditEntry } from './views/AuditLogView';

interface EditableRosterStaffingViewProps {
  roster: TeamMember[];
  targets: Target[];
  weeklyHoursAvailable: string;
  minimumShiftLength: string;
  autoDeductLunch: boolean;
  department: string;
  shiftDefinitions: ShiftDefinitions;
  isLoading: boolean;
  isSaving: boolean;
  onRosterChange: (roster: TeamMember[]) => void;
  onTargetsChange: (targets: Target[]) => void;
  onWeeklyHoursChange: (v: string) => void;
  onMinShiftChange: (v: string) => void;
  onAutoDeductChange: (v: boolean) => void;
  onDepartmentChange: (v: string) => void;
  onShiftDefsChange: (v: ShiftDefinitions) => void;
  onAuditEntry: (entry: Omit<AuditEntry, 'timestamp'>) => void;
  globalEmployees: TeamMember[];
  onGlobalEmployeesChange: (v: TeamMember[]) => void;
}

export function EditableRosterStaffingView({
  roster,
  targets,
  weeklyHoursAvailable,
  minimumShiftLength,
  autoDeductLunch,
  department,
  shiftDefinitions,
  isLoading,
  isSaving,
  onRosterChange,
  onTargetsChange,
  onWeeklyHoursChange,
  onMinShiftChange,
  onAutoDeductChange,
  onDepartmentChange,
  onShiftDefsChange,
  globalEmployees,
  onGlobalEmployeesChange,
}: EditableRosterStaffingViewProps) {
  const [showShiftRulesSettings, setShowShiftRulesSettings] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [showAddMemberPicker, setShowAddMemberPicker] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState('');

  // Mobile / fold-friendly compact layout. Auto-tracks viewport width
  // (cover screen vs unfolded inner screen) until the user manually overrides.
  const compactQuery = '(max-width: 1024px)';
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(compactQuery).matches
  );
  const compactOverridden = useRef(false);

  useEffect(() => {
    const mql = window.matchMedia(compactQuery);
    const onChange = (e: MediaQueryListEvent) => {
      if (!compactOverridden.current) setCompact(e.matches);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Print: render a clean read-only layout into a body-level portal, then
  // trigger the browser print dialog (which doubles as "Save as PDF").
  const [printMode, setPrintMode] = useState<null | 'schedule' | 'availability'>(null);

  useEffect(() => {
    if (!printMode) return;
    const done = () => setPrintMode(null);
    window.addEventListener('afterprint', done);
    const timer = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
    };
  }, [printMode]);

  const summary = useMemo<SummaryRow[]>(() => days.map((day, dayIndex) => {
    let open = 0;
    let close = 0;
    let overnight = 0;
    let scheduledHours = 0;

    roster.forEach((person) => {
      if (person.rosterStatus === "Inactive") return;

      const shift = person.shifts[dayIndex] || "";
      const parsed = parseShift(shift, autoDeductLunch);
      const role = roleFor(person.coverageStatus, shift, shiftDefinitions);

      if (parsed) scheduledHours += parsed.hours;
      if (role === "open") open += 1;
      if (role === "close") close += 1;
      if (role === "overnight") overnight += 1;
    });

    const target = targets[dayIndex];
    const openNeeded = toNumber(target.openNeeded);
    const closeNeeded = toNumber(target.closeNeeded);
    const overnightNeeded = toNumber(target.overnightNeeded);

    return {
      day,
      date: target.date,
      open,
      close,
      overnight,
      scheduledHours: Number(scheduledHours.toFixed(2)),
      openDelta: open - openNeeded,
      closeDelta: close - closeNeeded,
      overnightDelta: overnight - overnightNeeded,
    };
  }), [roster, targets, autoDeductLunch, shiftDefinitions]);

  const displayedRoster = useMemo(() => {
    return roster.filter(p => {
      // Show if in this department
      if (p.primaryDepartment === department) return true;
      
      // Show if explicitly cross-trained for this department
      if (p.crossTrainedDepartments?.includes(department)) return true;
      
      // Show if manually borrowed or has shifts in this department
      if (p.isBorrowed) return true;
      const hasShifts = p.shifts.some(s => s && s.trim() !== "");
      if (hasShifts) return true;
      
      return false;
    });
  }, [roster, department]);

  const rosterCounts = useMemo(() => {
    const active = displayedRoster.filter((person) => person.rosterStatus === "Active").length;
    const startingNextWeek = displayedRoster.filter((person) => person.rosterStatus === "Starts Next Week").length;
    const inactive = displayedRoster.filter((person) => person.rosterStatus === "Inactive").length;
    const scheduled = displayedRoster.filter((person) => person.rosterStatus !== "Inactive" && person.shifts.some((shift) => parseShift(shift, autoDeductLunch))).length;

    return {
      active,
      startingNextWeek,
      inactive,
      scheduled,
      total: displayedRoster.length,
      activeNextWeek: active + startingNextWeek,
    };
  }, [displayedRoster, autoDeductLunch]);

  const personHours = useMemo(() => displayedRoster.map((person) => {
    const weeklyHours = person.rosterStatus === "Inactive" ? 0 : person.shifts.reduce((total, shift) => {
      const parsed = parseShift(shift, autoDeductLunch);
      return total + (parsed ? parsed.hours : 0);
    }, 0);

    return {
      id: person.id,
      hours: Number(weeklyHours.toFixed(2)),
    };
  }), [displayedRoster, autoDeductLunch]);

  const totals = useMemo(() => {
    let scheduled = 0;
    let coreScheduled = 0;
    let excludedScheduled = 0;
    let fullTime = 0;
    let partTime = 0;

    displayedRoster.forEach((person) => {
      if (person.rosterStatus === "Inactive") return;

      const hours = person.shifts.reduce((total, shift) => {
        const parsed = parseShift(shift, autoDeductLunch);
        return total + (parsed ? parsed.hours : 0);
      }, 0);

      scheduled += hours;
      
      if (person.coverageStatus === "Excluded") {
        excludedScheduled += hours;
      } else {
        coreScheduled += hours;
      }

      if (person.status === "FT") fullTime += hours;
      if (person.status === "PT") partTime += hours;
    });

    const available = toNumber(weeklyHoursAvailable);

    return {
      available,
      scheduled: Number(scheduled.toFixed(2)),
      coreScheduled: Number(coreScheduled.toFixed(2)),
      excludedScheduled: Number(excludedScheduled.toFixed(2)),
      fullTime: Number(fullTime.toFixed(2)),
      partTime: Number(partTime.toFixed(2)),
      difference: Number((available - scheduled).toFixed(2)),
      overage: Math.max(0, Number((scheduled - available).toFixed(2))),
    };
  }, [displayedRoster, weeklyHoursAvailable, autoDeductLunch]);

  const dailyReductions = useMemo<DailyReduction[]>(() => {
    const daily: DailyReduction[] = days.map((day, index) => ({
      dayIndex: index,
      day,
      date: targets[index].date,
      safeHours: 0,
      candidates: [],
      additions: [],
    }));

    days.forEach((_day, dayIndex) => {
      const daySummary = summary[dayIndex];
      const target = targets[dayIndex];
      const d = daily[dayIndex];

      const ptShifts = displayedRoster
        .filter((p) => p.status === "PT" && p.rosterStatus !== "Inactive")
        .map((p) => {
          const shift = p.shifts[dayIndex] || "";
          const parsed = parseShift(shift, autoDeductLunch);
          if (!parsed) return null;
          return {
            id: `${p.id}-${dayIndex}`,
            personId: p.id,
            name: p.name,
            shift,
            hours: parsed.hours,
            role: roleFor(p.coverageStatus, shift, shiftDefinitions),
          };
        })
        .filter(Boolean) as { id: string; personId: string; name: string; shift: string; hours: number; role: Role }[];

      ptShifts.filter((s) => s.role === "mid" || s.role === "excluded").forEach((s) => {
        d.safeHours += s.hours;
        d.candidates.push({
          id: s.id,
          personId: s.personId,
          name: s.name,
          shift: s.shift,
          role: s.role,
          originalHours: s.hours,
          hoursToCut: s.hours,
          suggestion: "Safe to remove completely",
          priority: 1,
        });
      });

      const processRole = (role: Role, have: number, needed: number, priority: number) => {
        let surplus = have - needed;
        const shifts = ptShifts.filter((s) => s.role === role).sort((a, b) => b.hours - a.hours);

        shifts.forEach((s) => {
          if (surplus > 0) {
            d.safeHours += s.hours;
            d.candidates.push({
              id: s.id,
              personId: s.personId,
              name: s.name,
              shift: s.shift,
              role,
              originalHours: s.hours,
              hoursToCut: s.hours,
              suggestion: "Safe to remove completely (Surplus)",
              priority,
            });
            surplus--;
          } else {
            if (role === "overnight") {
              d.candidates.push({
                id: s.id,
                personId: s.personId,
                name: s.name,
                shift: s.shift,
                role,
                originalHours: s.hours,
                hoursToCut: 0,
                suggestion: "Not safe to reduce (Overnight)",
                priority: priority + 2,
              });
            } else {
              const minShift = toNumber(minimumShiftLength);
              const cuttable = Math.max(0, s.hours - minShift);
              if (cuttable > 0) {
                d.safeHours += cuttable;
                d.candidates.push({
                  id: s.id,
                  personId: s.personId,
                  name: s.name,
                  shift: s.shift,
                  role,
                  originalHours: s.hours,
                  hoursToCut: cuttable,
                  suggestion: `Shorten to ${minShift} hours (-${cuttable} hrs)`,
                  priority: priority + 1,
                });
              } else {
                d.candidates.push({
                  id: s.id,
                  personId: s.personId,
                  name: s.name,
                  shift: s.shift,
                  role,
                  originalHours: s.hours,
                  hoursToCut: 0,
                  suggestion: `At minimum ${minShift} hours length`,
                  priority: priority + 2,
                });
              }
            }
          }
        });
      };

      processRole("open", daySummary.open, toNumber(target.openNeeded), 3);
      processRole("close", daySummary.close, toNumber(target.closeNeeded), 2);
      processRole("overnight", daySummary.overnight, toNumber(target.overnightNeeded), 4);
      
      if (daySummary.openDelta < 0) {
        let missing = Math.abs(daySummary.openDelta);
        roster.forEach(p => {
          if (missing <= 0 || p.rosterStatus !== "Active" || p.coverageStatus === "Excluded" || (p.shifts[dayIndex] || "").trim() !== "") return;
          const scheduledDaysCount = p.shifts.filter(s => s.trim() !== "").length;
          if (scheduledDaysCount >= 5) return;
          const avail = p.unavailable[dayIndex] || "";
          if (checkAvailabilityViolation("6:00 AM - 2:00 PM", avail).isHardBlock || checkAvailabilityViolation("6:00 AM - 2:00 PM", avail).isViolation) return;
          d.additions.push({ personId: p.id, name: p.name, roleNeeded: "open", suggestedShift: "6:00 AM - 2:00 PM" });
          missing--;
        });
      }
      
      if (daySummary.closeDelta < 0) {
        let missing = Math.abs(daySummary.closeDelta);
        roster.forEach(p => {
          if (missing <= 0 || p.rosterStatus !== "Active" || p.coverageStatus === "Excluded" || (p.shifts[dayIndex] || "").trim() !== "") return;
          const scheduledDaysCount = p.shifts.filter(s => s.trim() !== "").length;
          if (scheduledDaysCount >= 5) return;
          const avail = p.unavailable[dayIndex] || "";
          if (checkAvailabilityViolation("1:00 PM - 9:00 PM", avail).isHardBlock || checkAvailabilityViolation("1:00 PM - 9:00 PM", avail).isViolation) return;
          if (d.additions.some(a => a.personId === p.id)) return;
          d.additions.push({ personId: p.id, name: p.name, roleNeeded: "close", suggestedShift: "1:00 PM - 9:00 PM" });
          missing--;
        });
      }

      if (daySummary.overnightDelta < 0) {
        let missing = Math.abs(daySummary.overnightDelta);
        roster.forEach(p => {
          if (missing <= 0 || p.rosterStatus !== "Active" || p.coverageStatus === "Excluded" || (p.shifts[dayIndex] || "").trim() !== "") return;
          const scheduledDaysCount = p.shifts.filter(s => s.trim() !== "").length;
          if (scheduledDaysCount >= 5) return;
          const avail = p.unavailable[dayIndex] || "";
          if (checkAvailabilityViolation("10:00 PM - 6:00 AM", avail).isHardBlock || checkAvailabilityViolation("10:00 PM - 6:00 AM", avail).isViolation) return;
          if (d.additions.some(a => a.personId === p.id)) return;
          d.additions.push({ personId: p.id, name: p.name, roleNeeded: "overnight", suggestedShift: "10:00 PM - 6:00 AM" });
          missing--;
        });
      }

      d.candidates.sort((a, b) => a.priority - b.priority || b.hoursToCut - a.hoursToCut);
    });

    return daily.filter(d => d.candidates.length > 0 || d.additions.length > 0);
  }, [roster, displayedRoster, summary, targets, minimumShiftLength, autoDeductLunch, shiftDefinitions]);

  const safeReductionTotal = useMemo(() => {
    return dailyReductions.reduce((total, day) => total + day.safeHours, 0);
  }, [dailyReductions]);
  const coverageHasShortage = summary.some((row) => row.openDelta < 0 || row.closeDelta < 0 || row.overnightDelta < 0);

  function updateShift(rowIndex: number, dayIndex: number, value: string) {
    onRosterChange(roster.map((person, index) => {
      if (index !== rowIndex) return person;

      return {
        ...person,
        shifts: person.shifts.map((shift, shiftIndex) => shiftIndex === dayIndex ? value : shift),
      };
    }));
  }

  function updateUnavailable(rowIndex: number, dayIndex: number, value: string) {
    onRosterChange(roster.map((person, index) => {
      if (index !== rowIndex) return person;

      return {
        ...person,
        unavailable: person.unavailable.map((reason, reasonIndex) => reasonIndex === dayIndex ? value : reason),
      };
    }));
  }

  function updateName(rowIndex: number, value: string) {
    const updatedRoster = roster.map((person, index) => index === rowIndex ? { ...person, name: value } : person);
    onRosterChange(updatedRoster);
    
    // Sync to global pool if this person exists there
    const personToSync = updatedRoster[rowIndex];
    if (personToSync) {
      onGlobalEmployeesChange(globalEmployees.map(p => p.id === personToSync.id ? { ...p, name: value } : p));
    }
  }

  function updateStatus(rowIndex: number, value: EmploymentStatus) {
    const updatedRoster = roster.map((person, index) => index === rowIndex ? { ...person, status: value } : person);
    onRosterChange(updatedRoster);
    
    // Sync to global pool if this person exists there
    const personToSync = updatedRoster[rowIndex];
    if (personToSync) {
      onGlobalEmployeesChange(globalEmployees.map(p => p.id === personToSync.id ? { ...p, status: value } : p));
    }
  }

  function updateRosterStatus(rowIndex: number, value: RosterStatus) {
    onRosterChange(roster.map((person, index) => index === rowIndex ? { ...person, rosterStatus: value } : person));
  }

  function updateCoverageStatus(rowIndex: number, value: "Included" | "Excluded") {
    onRosterChange(roster.map((person, index) => index === rowIndex ? { ...person, coverageStatus: value } : person));
  }

  function updateTarget<K extends keyof Target>(dayIndex: number, key: K, value: Target[K]) {
    const updated = targets.map((target, index) => {
      if (index !== dayIndex) return target;

      const updatedTarget = { ...target, [key]: value } as Target;
      if (key === "truck") updatedTarget.openNeeded = value === true ? "5" : "4";

      return updatedTarget;
    });

    onTargetsChange(key === "truck" ? applyOvernightFromMorningTrucks(updated) : updated);
  }

  function updateTargetDate(dayIndex: number, value: string) {
    const updated = targets.map((target, index) => {
      if (index !== dayIndex) return target;

      const truck = defaultTruckForDate(target.day, value);

      return {
        ...target,
        date: value,
        truck,
        openNeeded: truck ? "5" : "4",
      };
    });

    onTargetsChange(applyOvernightFromMorningTrucks(updated));
  }

  function addExistingMember(person: TeamMember) {
    if (roster.some(p => p.id === person.id)) {
      alert(`${person.name} is already in this week's roster.`);
      return;
    }
    const isBorrowed = person.primaryDepartment !== department;
    const newMember = {
      ...person,
      shifts: emptyShifts(),
      unavailable: emptyShifts(),
      coverageStatus: "Included" as const,
      isBorrowed
    };
    onRosterChange([...roster, newMember]);
    setShowAddMemberPicker(false);
    setAddMemberSearch('');
  }

  function createAndAddMember() {
    const newPerson = createTeamMember(globalEmployees.length);
    newPerson.primaryDepartment = department;
    onGlobalEmployeesChange([...globalEmployees, newPerson]);
    addExistingMember(newPerson);
  }

  function removePerson(id: string) {
    onRosterChange(roster.filter((person) => person.id !== id));
  }

  // ── Recurring schedule patterns ────────────────────────────────
  function setLockState(personId: string, locked: boolean, capturePattern: boolean) {
    const current = roster.find(p => p.id === personId);
    const pattern = capturePattern ? [...(current?.shifts ?? emptyShifts())] : undefined;
    const patch = <T extends TeamMember>(p: T): T => ({
      ...p,
      scheduleLocked: locked,
      ...(pattern ? { fixedSchedule: pattern } : {}),
    });
    onRosterChange(roster.map(p => (p.id === personId ? patch(p) : p)));
    if (globalEmployees.some(e => e.id === personId)) {
      onGlobalEmployeesChange(globalEmployees.map(e => (e.id === personId ? patch(e) : e)));
    }
  }

  function toggleLock(personId: string) {
    const person = roster.find(p => p.id === personId);
    const next = !person?.scheduleLocked;
    setLockState(personId, next, next);
  }

  function savePatternFromWeek(personId: string) {
    setLockState(personId, true, true);
  }

  function applyPattern(personId: string) {
    const person = roster.find(p => p.id === personId);
    if (!person?.fixedSchedule || person.fixedSchedule.length !== 7) return;
    const pattern = person.fixedSchedule;
    onRosterChange(roster.map(p => (p.id === personId ? { ...p, shifts: [...pattern] } : p)));
  }

  function applyAllPatterns() {
    onRosterChange(
      roster.map(p =>
        p.scheduleLocked && Array.isArray(p.fixedSchedule) && p.fixedSchedule.length === 7
          ? { ...p, shifts: [...(p.fixedSchedule as string[])] }
          : p
      )
    );
  }

  const lockedCount = roster.filter(p => p.scheduleLocked && p.fixedSchedule?.length === 7).length;

  // ── Smart schedule revision (rule-based; LLM-swappable) ─────────
  const [revision, setRevision] = useState<RevisionResult | null>(null);

  function runRevision() {
    setRevision(
      reviseSchedule({
        roster,
        targets,
        shiftDefinitions,
        autoDeductLunch,
        minimumShiftLength: toNumber(minimumShiftLength),
        weeklyHoursAvailable: toNumber(weeklyHoursAvailable),
      })
    );
  }

  function applyChange(change: ScheduleChange) {
    onRosterChange(
      roster.map(p =>
        p.id === change.personId
          ? { ...p, shifts: p.shifts.map((s, i) => (i === change.dayIndex ? change.to : s)) }
          : p
      )
    );
    setRevision(prev => (prev ? { ...prev, changes: prev.changes.filter(c => c !== change) } : prev));
  }

  function applyAllChanges() {
    if (!revision) return;
    const next = roster.map(p => ({ ...p, shifts: [...p.shifts] }));
    for (const change of revision.changes) {
      const person = next.find(p => p.id === change.personId);
      if (person) person.shifts[change.dayIndex] = change.to;
    }
    onRosterChange(next);
    setRevision(prev => (prev ? { ...prev, changes: [] } : prev));
  }

  function handleSaveToFile() {
    const payload: SavedRosterState = {
      roster,
      targets,
      weeklyHoursAvailable,
      minimumShiftLength,
      department,
      autoDeductLunch,
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `roster_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  function handleLoadFromFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string) as SavedRosterState;
        if (parsed && Array.isArray(parsed.roster)) {
          onRosterChange(parsed.roster);
          if (Array.isArray(parsed.targets)) onTargetsChange(parsed.targets);
          if (parsed.weeklyHoursAvailable) onWeeklyHoursChange(parsed.weeklyHoursAvailable);
          if (parsed.minimumShiftLength) onMinShiftChange(parsed.minimumShiftLength);
          if (parsed.department) onDepartmentChange(parsed.department);
          if (parsed.autoDeductLunch !== undefined) onAutoDeductChange(parsed.autoDeductLunch);
          alert("Roster successfully loaded from backup!");
        } else {
          alert("Invalid file format.");
        }
      } catch {
        alert("Error parsing the file.");
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  async function handleOcrImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (typeof Tesseract === "undefined") {
      alert("OCR engine (Tesseract.js) is not loaded. Please ensure you are connected to the internet.");
      return;
    }

    setOcrLoading(true);
    try {
      const { data: { text } } = await Tesseract.recognize(file, 'eng', {
        logger: (m: unknown) => console.log(m)
      });
      
      console.log("Raw OCR Result:", text);
      
      const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      const shiftRegex = /(\d{1,2}(?::\d{2})?[a|p|A|P]?[m|M]?\s*-\s*\d{1,2}(?::\d{2})?[a|p|A|P]?[m|M]?)|(OFF|Off|off|REQ|Req)/g;
      
      const parsedMembers: TeamMember[] = [];
      
      for (const line of lines) {
        const shiftsFound = (Array.from(line.matchAll(shiftRegex)) as RegExpMatchArray[]).map(m => m[0] as string);
        
        if (shiftsFound.length > 0) {
           const possibleName = line.replace(shiftRegex, '').replace(/[^a-zA-Z\s]/g, '').trim();
           if (possibleName && possibleName.split(' ').length <= 4) {
              const currentMember = createTeamMember(parsedMembers.length + roster.length);
              currentMember.name = possibleName;
              currentMember.shifts = emptyShifts();
              
              for (let i = 0; i < Math.min(shiftsFound.length, 7); i++) {
                const s = shiftsFound[i].toLowerCase();
                if (s.includes('off') || s.includes('req')) {
                  currentMember.shifts[i] = "";
                } else {
                  currentMember.shifts[i] = shiftsFound[i];
                }
              }
              parsedMembers.push(currentMember);
           }
        }
      }
      
      if (parsedMembers.length > 0) {
        if (confirm(`Found ${parsedMembers.length} team members from image. Append to current roster?`)) {
           onRosterChange([...roster, ...parsedMembers]);
        }
      } else {
        alert("Could not detect any clear schedule rows in the image. Please try a clearer image or a different format.");
      }

    } catch (err) {
      console.error(err);
      alert("Error processing image.");
    } finally {
      setOcrLoading(false);
      event.target.value = '';
    }
  }

  function weeklyHoursFor(id: string): number {
    return personHours.find((person) => person.id === id)?.hours || 0;
  }

  function renderBadge(value: number) {
    const base = "inline-flex min-w-[2rem] justify-center rounded-full px-2 py-1 text-xs font-semibold";

    if (value < 0) return <span className={`${base} bg-error-container text-on-error-container`}>{value}</span>;
    if (value > 0) return <span className={`${base} bg-status-opener-bg text-status-opener-text`}>+{value}</span>;

    return <span className={`${base} bg-surface-container-high text-on-surface-variant`}>0</span>;
  }

  function badgeClass(role: Role) {
    const classes: Record<Role, string> = {
      open: "bg-status-opener-bg text-status-opener-text",
      close: "bg-status-closer-bg text-status-closer-text",
      overnight: "bg-status-overnight-bg text-status-overnight-text",
      mid: "bg-status-mid-bg text-status-mid-text",
      excluded: "bg-surface-container-high text-on-surface-variant",
      none: "bg-surface-container-lowest text-on-surface-variant",
    };
    return classes[role] || classes.none;
  }

  function applyAddition(personId: string, dayIndex: number, suggestedShift: string) {
    const newRoster = [...roster];
    const pIdx = newRoster.findIndex(p => p.id === personId);
    if (pIdx === -1) return;
    
    const p = { ...newRoster[pIdx] };
    const shifts = [...p.shifts];
    shifts[dayIndex] = suggestedShift;
    p.shifts = shifts;
    newRoster[pIdx] = p;
    onRosterChange(newRoster);
  }

  function applyReduction(personId: string, dayIndex: number, originalHours: number, hoursToCut: number, role: string, shift: string) {
    const newRoster = [...roster];
    const pIdx = newRoster.findIndex(p => p.id === personId);
    if (pIdx === -1) return;
    
    const p = { ...newRoster[pIdx] };
    const shifts = [...p.shifts];
    
    if (hoursToCut >= originalHours) {
      shifts[dayIndex] = "";
    } else {
      const parsed = parseShift(shift, false); 
      if (parsed) {
        const newLength = originalHours - hoursToCut; 
        const clockLength = newLength >= 6 && autoDeductLunch ? newLength + 0.5 : newLength;
        let newStart = parsed.start;
        let newEnd = parsed.start + clockLength;
        if (role === "close") {
          newEnd = parsed.end;
          newStart = parsed.end - clockLength;
        }
        shifts[dayIndex] = `${formatTimeText(newStart)} - ${formatTimeText(newEnd)}`;
      }
    }
    p.shifts = shifts;
    newRoster[pIdx] = p;
    onRosterChange(newRoster);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-surface-container-high border-t-primary"></div>
          <div className="font-headline-md text-headline-md text-on-surface-variant">Loading Roster Data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="text-on-surface">
      {/* Dashboard Summary Strip */}
      <DashboardSummary totals={totals} />

      {/* Main Content */}
      <div className="p-4 space-y-4 max-w-[1700px] mx-auto">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <AppSelect value={department} onChange={(event) => onDepartmentChange(event.target.value)} className="h-10 border-outline-variant bg-surface px-3 text-headline-md font-headline-md text-on-surface shadow-sm transition-all focus:border-primary focus:ring-1 focus:ring-primary rounded-lg">
                <option value="Produce">Produce</option>
                <option value="Bakery">Bakery</option>
                <option value="Deli">Deli</option>
                <option value="Meat">Meat</option>
                <option value="Grocery">Grocery</option>
                <option value="Dairy/Frozen">Dairy/Frozen</option>
                <option value="Front End">Front End</option>
              </AppSelect>
              <span className="font-headline-md text-headline-md text-on-surface">Weekly Roster</span>
              {isSaving && (
                <div className="ml-3 flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-surface-container-high border-t-primary"></div>
                  Saving...
                </div>
              )}
            </div>
            <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">Weekly labor budget, coverage rules, and delivery schedules are validated together.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <AppButton
              onClick={() => { compactOverridden.current = true; setCompact(v => !v); }}
              className="rounded-lg border border-outline-variant hover:bg-surface-container-low"
              variant="ghost"
              title={compact ? 'Switch to full table view' : 'Switch to compact mobile view'}
            >
              <span className="material-symbols-outlined text-[16px] mr-1.5">{compact ? 'table_rows' : 'smartphone'}</span>
              {compact ? 'Full View' : 'Compact'}
            </AppButton>
            <AppButton onClick={() => setPrintMode('schedule')} className="rounded-lg border border-outline-variant hover:bg-surface-container-low" variant="ghost">
              <span className="material-symbols-outlined text-[16px] mr-1.5">print</span>
              Print Schedule
            </AppButton>
            <AppButton onClick={() => setPrintMode('availability')} className="rounded-lg border border-outline-variant hover:bg-surface-container-low" variant="ghost">
              <span className="material-symbols-outlined text-[16px] mr-1.5">print</span>
              Print Availability
            </AppButton>
            <AppButton
              onClick={applyAllPatterns}
              disabled={lockedCount === 0}
              title={lockedCount === 0 ? 'No team members have a locked recurring schedule yet' : 'Copy every locked pattern into this week'}
              className="rounded-lg border border-outline-variant hover:bg-surface-container-low disabled:opacity-50"
              variant="ghost"
            >
              <span className="material-symbols-outlined text-[16px] mr-1.5">event_repeat</span>
              Apply Patterns{lockedCount > 0 ? ` (${lockedCount})` : ''}
            </AppButton>
            <AppButton onClick={handleSaveToFile} className="rounded-lg border border-outline-variant hover:bg-surface-container-low" variant="ghost">
              <span className="material-symbols-outlined text-[16px] mr-1.5">download</span>
              Save
            </AppButton>
            <div>
              <input type="file" id="file-upload" accept=".json" className="hidden" onChange={handleLoadFromFile} />
              <AppButton onClick={() => document.getElementById('file-upload')?.click()} className="rounded-lg border border-outline-variant hover:bg-surface-container-low" variant="ghost">
                <span className="material-symbols-outlined text-[16px] mr-1.5">upload</span>
                Load
              </AppButton>
            </div>
            <div>
              <input type="file" id="ocr-upload" accept="image/*" className="hidden" onChange={handleOcrImport} disabled={ocrLoading} />
              <AppButton onClick={() => document.getElementById('ocr-upload')?.click()} className="rounded-lg border border-primary-fixed text-primary bg-primary-fixed/30 hover:bg-primary-fixed/50 disabled:opacity-50" variant="ghost" disabled={ocrLoading}>
                <span className="material-symbols-outlined text-[16px] mr-1.5">document_scanner</span>
                {ocrLoading ? "Scanning..." : "OCR Import"}
              </AppButton>
            </div>
            <AppButton onClick={() => setShowAddMemberPicker(!showAddMemberPicker)} className="rounded-lg bg-primary text-on-primary hover:opacity-90">
              <span className="material-symbols-outlined text-[16px] mr-1.5">{showAddMemberPicker ? 'close' : 'person_add'}</span>
              {showAddMemberPicker ? 'Close Picker' : 'Add Member'}
            </AppButton>
          </div>
        </div>

        {showAddMemberPicker && (
          <Card className="mb-6 rounded-xl shadow-lg border-primary/30 bg-primary/5 animate-in fade-in slide-in-from-top-4 duration-300">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-headline-md font-bold text-primary">Add Member to {department}</h2>
                <div className="flex gap-2">
                  <AppButton variant="tonal" size="sm" onClick={createAndAddMember}>
                    <span className="material-symbols-outlined text-[18px] mr-1">person_add</span>
                    Create New Profile
                  </AppButton>
                  <AppButton variant="ghost" size="sm" onClick={() => setShowAddMemberPicker(false)}>
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </AppButton>
                </div>
              </div>
              
              <div className="relative mb-6">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
                <AppInput 
                  placeholder="Search existing team members by name or department..." 
                  value={addMemberSearch}
                  onChange={e => setAddMemberSearch(e.target.value)}
                  className="pl-10 h-12 text-body-md rounded-2xl border-outline-variant focus:border-primary shadow-sm"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {globalEmployees
                  .filter(p => !roster.some(r => r.id === p.id))
                  .filter(p => {
                    const search = addMemberSearch.toLowerCase();
                    return !search || 
                           p.name.toLowerCase().includes(search) || 
                           (p.primaryDepartment && p.primaryDepartment.toLowerCase().includes(search));
                  })
                  .sort((a, b) => {
                    if (a.primaryDepartment === department && b.primaryDepartment !== department) return -1;
                    if (a.primaryDepartment !== department && b.primaryDepartment === department) return 1;
                    const deptA = a.primaryDepartment || 'Unassigned';
                    const deptB = b.primaryDepartment || 'Unassigned';
                    if (deptA !== deptB) return deptA.localeCompare(deptB);
                    return a.name.localeCompare(b.name);
                  })
                  .reduce((acc: { dept: string, members: TeamMember[] }[], person) => {
                    const dept = person.primaryDepartment || 'Unassigned';
                    const lastGroup = acc[acc.length - 1];
                    if (lastGroup && lastGroup.dept === dept) {
                      lastGroup.members.push(person);
                    } else {
                      acc.push({ dept, members: [person] });
                    }
                    return acc;
                  }, [])
                  .map(group => (
                    <div key={group.dept} className="col-span-full mb-2">
                      <div className="sticky top-0 z-10 flex items-center gap-2 py-1.5 px-3 bg-surface-container-high rounded-lg mb-2 text-label-bold uppercase tracking-widest text-on-surface-variant shadow-sm border border-outline-variant/30">
                        <span className="material-symbols-outlined text-[16px]">{group.dept === department ? 'home' : 'groups'}</span>
                        {group.dept} {group.dept === department && '(Primary)'}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {group.members.map(person => (
                          <button
                            key={person.id}
                            onClick={() => addExistingMember(person)}
                            className={`flex items-center gap-3 p-3 rounded-xl border transition-all hover:shadow-md hover:scale-[1.02] active:scale-[0.98]
                              ${person.primaryDepartment === department 
                                ? 'border-primary/20 bg-surface-container-highest hover:bg-primary/10' 
                                : 'border-outline-variant/30 bg-surface-container-low hover:bg-surface-container-high'
                              }`}
                          >
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-[12px]
                              ${person.status === 'FT' ? 'bg-primary text-on-primary' : 'bg-secondary text-on-secondary'}`}>
                              {person.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <div className="font-bold text-on-surface text-body-md leading-tight truncate">{person.name}</div>
                              <div className="text-body-sm text-on-surface-variant flex items-center gap-1">
                                <span className="material-symbols-outlined text-[14px]">badge</span>
                                <span className="truncate">{person.status}</span>
                              </div>
                            </div>
                            <div className="shrink-0">
                              <span className="material-symbols-outlined text-primary opacity-0 group-hover:opacity-100 transition-opacity">add_circle</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                }
              </div>
              
              {globalEmployees.filter(p => !roster.some(r => r.id === p.id)).length === 0 && (
                <div className="text-center py-12 border-2 border-dashed border-outline-variant/30 rounded-2xl bg-surface-container-low/50">
                  <span className="material-symbols-outlined text-[48px] text-on-surface-variant/20 block mb-2">person_off</span>
                  <p className="text-on-surface-variant font-medium">All existing members are already on the roster.</p>
                  <AppButton variant="tonal" size="sm" onClick={createAndAddMember} className="mt-4">
                    Create New Profile
                  </AppButton>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <Card className="rounded-xl shadow-sm border-outline-variant">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-headline-md text-on-surface">Weekly Labor Budget</h2>
                  <p className="text-body-md text-on-surface-variant">Hours available is weekly. Hours scheduled is calculated from the roster.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-stretch gap-3">
                <label className="flex-1 min-w-[140px] space-y-1 text-body-md font-semibold text-on-surface">
                  <span>Weekly Budget</span>
                  <AppInput type="number" value={weeklyHoursAvailable} onChange={(event) => onWeeklyHoursChange(event.target.value)} className="h-10 rounded-xl" />
                </label>
                <label className="flex-1 min-w-[140px] space-y-1 text-body-md font-semibold text-on-surface">
                  <span>Min Shift Length</span>
                  <AppInput type="number" value={minimumShiftLength} onChange={(event) => onMinShiftChange(event.target.value)} className="h-10 rounded-xl" />
                </label>
                <label className="flex-1 min-w-[140px] space-y-1 text-body-md font-semibold text-on-surface flex flex-col justify-center gap-1">
                  <span>Auto-deduct Lunch</span>
                  <div className="flex items-center gap-2 h-10">
                    <input type="checkbox" checked={autoDeductLunch} onChange={(e) => onAutoDeductChange(e.target.checked)} className="h-5 w-5 rounded border-outline-variant text-primary focus:ring-primary/30 cursor-pointer" />
                    <span className="text-body-sm text-on-surface-variant font-normal">-0.5h for &ge; 6h shifts</span>
                  </div>
                </label>
                <div className="flex-1 min-w-[140px] space-y-1 text-body-md font-semibold text-on-surface flex flex-col justify-center gap-1">
                  <span>Shift Rules</span>
                  <AppButton onClick={() => setShowShiftRulesSettings(!showShiftRulesSettings)} variant="ghost" className="h-10">
                    <span className="material-symbols-outlined text-[18px]">settings</span>
                    <span>Configure</span>
                  </AppButton>
                </div>
                
                <div className="flex-1 min-w-[120px] rounded-xl border border-outline-variant bg-surface-container-low p-3">
                  <div className="text-label-bold uppercase text-on-surface-variant">Core Hours</div>
                  <div className="text-2xl font-bold font-data-tabular tabular-nums text-on-surface">{formatHours(totals.coreScheduled)}</div>
                </div>
                <div className="flex-1 min-w-[120px] rounded-xl border border-outline-variant bg-surface-container-low p-3">
                  <div className="text-label-bold uppercase text-on-surface-variant">Excluded Hours</div>
                  <div className="text-2xl font-bold font-data-tabular tabular-nums text-on-surface-variant">{formatHours(totals.excludedScheduled)}</div>
                </div>
                <div className="flex-1 min-w-[120px] rounded-xl border border-outline-variant bg-surface-container-low p-3">
                  <div className="text-label-bold uppercase text-on-surface-variant">Total Hours</div>
                  <div className="text-2xl font-bold font-data-tabular tabular-nums text-on-surface">{formatHours(totals.scheduled)}</div>
                </div>
                <div className="flex-1 min-w-[120px] rounded-xl border border-outline-variant bg-surface-container-low p-3">
                  <div className="text-label-bold uppercase text-on-surface-variant">Full Time</div>
                  <div className="text-2xl font-bold font-data-tabular tabular-nums text-on-surface">{formatHours(totals.fullTime)}</div>
                </div>
                <div className="flex-1 min-w-[120px] rounded-xl border border-outline-variant bg-surface-container-low p-3">
                  <div className="text-label-bold uppercase text-on-surface-variant">Part Time</div>
                  <div className="text-2xl font-bold font-data-tabular tabular-nums text-on-surface">{formatHours(totals.partTime)}</div>
                </div>
              </div>

              {showShiftRulesSettings && (
                <div className="mt-4 rounded-xl border border-outline-variant bg-surface-container-low p-4">
                  <h3 className="mb-3 text-body-md font-bold text-on-surface">Shift Time Definitions (24hr start times)</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(["open", "mid", "close", "overnight"] as const).map(r => (
                      <div key={r} className="rounded-lg border border-outline-variant bg-surface-container-lowest p-2">
                        <div className="mb-1 text-label-bold capitalize text-on-surface-variant">{r}</div>
                        <div className="flex items-center gap-1 text-body-md">
                           <AppInput 
                              type="number" step="0.01" 
                              value={shiftDefinitions[r].start} 
                              onChange={e => onShiftDefsChange({ ...shiftDefinitions, [r]: { ...shiftDefinitions[r], start: Number(e.target.value) } })}
                              className="h-7 px-1 w-full text-center"
                           />
                           <span className="text-body-sm text-on-surface-variant">to</span>
                           <AppInput 
                              type="number" step="0.01" 
                              value={shiftDefinitions[r].end} 
                              onChange={e => onShiftDefsChange({ ...shiftDefinitions, [r]: { ...shiftDefinitions[r], end: Number(e.target.value) } })}
                              className="h-7 px-1 w-full text-center"
                           />
                        </div>
                      </div>
                    ))}
                  </div>
                  <AppButton onClick={() => onShiftDefsChange(defaultShiftDefinitions)} variant="ghost" size="sm" className="mt-2 border-transparent text-primary hover:text-primary hover:bg-primary-fixed/10">
                    Reset to Defaults
                  </AppButton>
                </div>
              )}
              
              <div className={`mt-4 rounded-xl border p-3 ${totals.difference < 0 ? "border-error/20 bg-error-container text-on-error-container" : "border-status-opener-text/20 bg-status-opener-bg text-status-opener-text"}`}>
                <div className="text-body-md font-semibold">Weekly Result</div>
                <div className="text-xl font-bold font-data-tabular tabular-nums">{totals.difference < 0 ? `${formatHours(Math.abs(totals.difference))} hours over` : `${formatHours(totals.difference)} hours left`}</div>
                <div className="mt-1 text-body-md opacity-90">Safe part time reduction available: {formatHours(safeReductionTotal)} hours</div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-sm border-outline-variant">
            <CardContent className="overflow-x-auto p-4">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-headline-md text-on-surface">Team Information</h2>
                  <p className="text-body-md text-on-surface-variant">Your roster is saved locally in this browser as you edit.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
                  <div className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2">
                    <div className="text-label-bold uppercase text-on-surface-variant">Active</div>
                    <div className="text-xl font-bold font-data-tabular tabular-nums text-on-surface">{rosterCounts.active}</div>
                  </div>
                  <div className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2">
                    <div className="text-label-bold uppercase text-on-surface-variant">Next Week</div>
                    <div className="text-xl font-bold font-data-tabular tabular-nums text-on-surface">{rosterCounts.startingNextWeek}</div>
                  </div>
                  <div className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2">
                    <div className="text-label-bold uppercase text-on-surface-variant">Next Total</div>
                    <div className="text-xl font-bold font-data-tabular tabular-nums text-on-surface">{rosterCounts.activeNextWeek}</div>
                  </div>
                  <div className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2">
                    <div className="text-label-bold uppercase text-on-surface-variant">Scheduled</div>
                    <div className="text-xl font-bold font-data-tabular tabular-nums text-on-surface">{rosterCounts.scheduled}</div>
                  </div>
                  <div className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2">
                    <div className="text-label-bold uppercase text-on-surface-variant">Total</div>
                    <div className="text-xl font-bold font-data-tabular tabular-nums text-on-surface">{rosterCounts.total}</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {displayedRoster.map((person) => {
                  const rowIndex = roster.findIndex(r => r.id === person.id);
                  const hrs = weeklyHoursFor(person.id);
                  const initials = person.name.trim().split(/\s+/).map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
                  const isInactive = person.rosterStatus === 'Inactive';
                  const isNextWeek = person.rosterStatus === 'Starts Next Week';
                  const isFT = person.status === 'FT';
                  const barPct = Math.min(100, (hrs / 40) * 100);
                  const isBorrowed = person.isBorrowed || (person.primaryDepartment && person.primaryDepartment !== department);
                  const isCrossTrained = person.crossTrainedDepartments?.includes(department);
                  
                  return (
                    <div 
                      key={person.id} 
                      className={`group relative flex flex-col rounded-2xl border transition-all duration-300 hover:shadow-xl hover:-translate-y-1 
                        ${isNextWeek 
                          ? 'border-primary/20 bg-gradient-to-br from-primary/5 to-transparent' 
                          : isInactive 
                            ? 'border-outline-variant/30 bg-surface-container-low grayscale-[0.5] opacity-80' 
                            : 'border-outline-variant/40 bg-surface-container-lowest'
                        }`}
                    >
                      {/* Status indicator glow */}
                      {!isInactive && !isNextWeek && hrs > 0 && (
                        <div className="absolute -top-1 -right-1 h-3 w-3">
                           <div className="absolute inset-0 rounded-full bg-status-opener-text animate-ping opacity-20" />
                           <div className="relative h-full w-full rounded-full bg-status-opener-text border-2 border-white" />
                        </div>
                      )}

                      {/* Header Section */}
                      <div className="p-4 pb-3 flex items-start gap-3">
                        {/* Enhanced Avatar */}
                        <div className="relative shrink-0">
                          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl text-[14px] font-extrabold tracking-widest shadow-inner transition-transform group-hover:scale-105 duration-300
                            ${isFT 
                              ? 'bg-gradient-to-br from-primary to-primary-container text-on-primary' 
                              : 'bg-gradient-to-br from-secondary to-secondary-fixed-dim text-on-secondary'
                            }`}
                          >
                            {initials}
                          </div>
                          {isFT && (
                            <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-tertiary text-on-tertiary shadow-sm border-2 border-surface-container-lowest">
                              <span className="material-symbols-outlined text-[10px] font-bold">star</span>
                            </div>
                          )}
                        </div>

                        {/* Name + Primary Badges */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <AppInput
                            value={person.name}
                            onChange={(event) => updateName(rowIndex, event.target.value)}
                            className="h-7 w-full border-none bg-transparent px-0 font-headline-md text-headline-md text-on-surface hover:bg-surface-container-low/50 focus:ring-0 focus:bg-surface-container-low rounded-md transition-colors"
                            placeholder="Full Name"
                          />
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border shadow-sm
                              ${isFT 
                                ? 'bg-primary/5 text-primary border-primary/20' 
                                : 'bg-secondary/5 text-secondary border-secondary/20'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[12px]">{isFT ? 'workspace_premium' : 'person'}</span>
                              {person.status}
                            </span>
                            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border shadow-sm
                              ${isInactive 
                                ? 'bg-surface-container-high text-on-surface-variant border-outline-variant/30' 
                                : isNextWeek 
                                  ? 'bg-primary/5 text-primary border-primary/20' 
                                  : 'bg-status-opener-bg text-status-opener-text border-status-opener-text/10'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[12px]">{isInactive ? 'block' : isNextWeek ? 'event_upcoming' : 'check_circle'}</span>
                              {isInactive ? 'Inactive' : isNextWeek ? 'Next Week' : 'Active'}
                            </span>
                             {(isBorrowed || isCrossTrained) && (
                               <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-tertiary-fixed/20 text-tertiary-fixed border border-tertiary-fixed/30 shadow-sm">
                                 <span className="material-symbols-outlined text-[12px]">sync</span>
                                 {isBorrowed ? 'Borrowed' : 'Cross-Trained'} ({person.primaryDepartment})
                               </span>
                             )}
                             {checkSixthDayViolation(person) && (
                               <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-error-container text-on-error-container border border-error/20 shadow-md animate-pulse">
                                 <span className="material-symbols-outlined text-[12px]">warning</span>
                                 6th Day Warning
                               </span>
                             )}
                          </div>
                        </div>

                        {/* Remove Action */}
                        <button
                          onClick={() => removePerson(person.id)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110 p-1.5 rounded-xl text-error hover:bg-error-container/50 active:scale-95"
                          title="Remove team member"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>

                      {/* Controls Grid */}
                      <div className="px-4 py-4 bg-surface-container-low/30 border-y border-outline-variant/10">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/70">
                              <span className="material-symbols-outlined text-[12px]">badge</span>Type
                            </label>
                            <AppSelect 
                              value={person.status} 
                              onChange={(e) => updateStatus(rowIndex, e.target.value as EmploymentStatus)}
                              className="w-full h-9 rounded-xl text-[11px] font-semibold bg-surface-container-lowest border-outline-variant/20 shadow-sm hover:border-primary/30 transition-colors"
                            >
                              <option value="FT">Full Time</option>
                              <option value="PT">Part Time</option>
                            </AppSelect>
                          </div>
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/70">
                              <span className="material-symbols-outlined text-[12px]">groups</span>Roster
                            </label>
                            <AppSelect 
                              value={person.rosterStatus} 
                              onChange={(e) => updateRosterStatus(rowIndex, e.target.value as RosterStatus)}
                              className="w-full h-9 rounded-xl text-[11px] font-semibold bg-surface-container-lowest border-outline-variant/20 shadow-sm hover:border-primary/30 transition-colors"
                            >
                              <option value="Active">Active</option>
                              <option value="Starts Next Week">Next Wk</option>
                              <option value="Inactive">Inactive</option>
                            </AppSelect>
                          </div>
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/70">
                              <span className="material-symbols-outlined text-[12px]">visibility</span>View
                            </label>
                            <AppSelect 
                              value={person.coverageStatus || 'Included'} 
                              onChange={(e) => updateCoverageStatus(rowIndex, e.target.value as 'Included' | 'Excluded')}
                              className="w-full h-9 rounded-xl text-[11px] font-semibold bg-surface-container-lowest border-outline-variant/20 shadow-sm hover:border-primary/30 transition-colors"
                            >
                              <option value="Included">Counts</option>
                              <option value="Excluded">Excluded</option>
                            </AppSelect>
                          </div>
                        </div>
                      </div>

                      {/* Footer: Hours Visualization */}
                      <div className="p-4 pt-3 mt-auto bg-surface-container-low/20 rounded-b-2xl border-t border-outline-variant/10">
                        <div className="flex items-end justify-between mb-2">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-0.5">Weekly Load</span>
                            <div className="flex items-baseline gap-1">
                              <span className={`text-2xl font-black font-data-tabular tracking-tighter transition-colors duration-500 ${hrs >= 40 ? 'text-primary' : hrs > 0 ? 'text-on-surface' : 'text-on-surface-variant/30'}`}>
                                {formatHours(hrs)}
                              </span>
                              <span className="text-[11px] font-bold text-on-surface-variant/40">h</span>
                            </div>
                          </div>
                          <div
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors duration-500 ${hrs > 40
                              ? 'bg-error-container text-on-error-container border-error/20'
                              : hrs === 40
                                ? 'bg-status-opener-bg text-status-opener-text border-status-opener-text/20'
                                : 'bg-surface-container-high text-on-surface-variant border-outline-variant/20'
                            }`}
                          >
                            {hrs > 40 ? 'Over' : hrs === 40 ? 'Target' : 'Under'}
                          </div>
                        </div>
                        
                        {/* Smooth Progress Bar */}
                        <div className="relative h-2.5 w-full rounded-full bg-surface-container-highest/50 overflow-hidden shadow-inner">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ease-out shadow-sm
                              ${hrs > 40 
                                ? 'bg-gradient-to-r from-error to-[#ff6b6b]' 
                                : hrs >= 38 
                                  ? 'bg-gradient-to-r from-status-opener-text to-[#34d399]' 
                                  : hrs >= 20 
                                    ? 'bg-gradient-to-r from-secondary to-secondary-fixed' 
                                    : 'bg-outline/40'
                              }`}
                            style={{ width: `${barPct}%` }}
                          />
                          {/* 40hr marker */}
                          <div className="absolute left-[100%] -translate-x-full h-full w-0.5 bg-white/30" title="40hr Mark" />
                        </div>
                        
                        <div className="mt-2 flex justify-between text-[10px] font-bold text-on-surface-variant/30 font-mono tracking-tighter uppercase">
                          <span>0h</span>
                          <span>20h</span>
                          <span>40h</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {compact ? (
          <CompactRosterPanels
            roster={roster}
            targets={targets}
            summary={summary}
            shiftDefinitions={shiftDefinitions}
            onUpdateShift={updateShift}
            onUpdateUnavailable={updateUnavailable}
            onUpdateName={updateName}
            onUpdateStatus={updateStatus}
            onUpdateRosterStatus={updateRosterStatus}
            onRemovePerson={removePerson}
            onToggleLock={toggleLock}
            onApplyPattern={applyPattern}
          />
        ) : (
        <>
        <Card className="rounded-xl shadow-sm border-outline-variant">
          <CardContent className="overflow-x-auto p-3">
            <table className="w-full min-w-[1450px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 w-[200px] min-w-[200px] border border-outline-variant bg-surface-container-high p-2 text-left text-on-surface shadow-sm">Name</th>
                  {days.map((day, dayIndex) => (
                    <th key={day} className="sticky top-0 z-20 border border-outline-variant bg-surface-container-high p-2 text-center align-top text-on-surface shadow-sm">
                      <AppInput type="date" value={targets[dayIndex].date} onChange={(event) => updateTargetDate(dayIndex, event.target.value)} className="mb-1 h-9 rounded-xl text-xs font-data-tabular tabular-nums bg-surface-container-lowest/80" />
                      <div className="font-bold">{day}</div>
                      <div className="mt-1 grid gap-1 text-[11px] font-normal leading-tight font-data-tabular tabular-nums">
                        <span>Openers {summary[dayIndex].open}/{targets[dayIndex].openNeeded}</span>
                        <span>Closers {summary[dayIndex].close}/{targets[dayIndex].closeNeeded}</span>
                        <span>Overnight Tonight {summary[dayIndex].overnight}/{targets[dayIndex].overnightNeeded}</span>
                      </div>
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 w-12 border border-outline-variant bg-surface-container-high p-2 shadow-sm" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {roster.map((person, rowIndex) => (
                  <tr key={person.id} className={person.rosterStatus === "Starts Next Week" ? "bg-primary-fixed/10" : person.rosterStatus === "Inactive" ? "bg-surface-container text-on-surface-variant" : "bg-surface-container-lowest"}>
                    <td className="sticky left-0 z-10 border border-outline-variant bg-surface-container-lowest p-2">
                      <div className="grid gap-2">
                        <AppInput value={person.name} onChange={(event) => updateName(rowIndex, event.target.value)} className="h-9 rounded-xl" />
                        <div className="grid grid-cols-[80px_1fr] gap-2">
                          <AppSelect value={person.status} onChange={(event) => updateStatus(rowIndex, event.target.value as EmploymentStatus)} className="h-9 rounded-xl">
                            <option value="FT">FT</option>
                            <option value="PT">PT</option>
                          </AppSelect>
                          <AppSelect value={person.rosterStatus} onChange={(event) => updateRosterStatus(rowIndex, event.target.value as RosterStatus)} className="h-9 rounded-xl">
                            <option value="Active">Active</option>
                            <option value="Starts Next Week">Starts Next Week</option>
                            <option value="Inactive">Inactive</option>
                          </AppSelect>
                        </div>
                        <div className="flex items-center gap-1">
                          <AppButton
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleLock(person.id)}
                            title={person.scheduleLocked ? 'Unlock recurring schedule' : 'Lock as recurring weekly schedule'}
                            className={`h-8 w-8 rounded-lg ${person.scheduleLocked ? 'text-primary bg-primary-fixed/40' : 'text-on-surface-variant'}`}
                          >
                            <span className="material-symbols-outlined text-[18px]">{person.scheduleLocked ? 'lock' : 'lock_open'}</span>
                          </AppButton>
                          {person.scheduleLocked && (
                            <>
                              <AppButton variant="ghost" size="icon" onClick={() => applyPattern(person.id)} title="Reset this week to the saved pattern" className="h-8 w-8 rounded-lg text-on-surface-variant">
                                <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                              </AppButton>
                              <AppButton variant="ghost" size="icon" onClick={() => savePatternFromWeek(person.id)} title="Save this week's shifts as the new pattern" className="h-8 w-8 rounded-lg text-on-surface-variant">
                                <span className="material-symbols-outlined text-[18px]">bookmark_add</span>
                              </AppButton>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Fixed</span>
                            </>
                          )}
                        </div>
                        <div className="text-[10px] leading-tight text-on-surface-variant" title="Edit seniority and team leader on the Employees page">
                          {person.isTeamLeader ? (
                            <span className="font-semibold text-primary">★ Team Leader</span>
                          ) : (
                            <>
                              {person.status}
                              {person.seniorityDate ? ` · Sr ${person.seniorityDate}` : ' · Sr —'}
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                    {days.map((day, dayIndex) => {
                      const shift = person.shifts[dayIndex] || "";
                      const role = person.rosterStatus === "Inactive" ? "none" : roleFor(person.coverageStatus, shift, shiftDefinitions);
                      const availReason = person.unavailable[dayIndex] || "";
                      const check = checkAvailabilityViolation(shift, availReason);
                      
                      let finalClass = person.rosterStatus === "Inactive" ? "bg-surface-container border-outline-variant" : cellClass(role);
                      
                      if (check.isViolation) {
                        finalClass = "bg-error-container border-error/30";
                      } else if (check.isHardBlock) {
                        finalClass = "bg-error-container/80 border-error/10";
                      }

                      return (
                        <td key={day} className={`border p-1 align-top transition-colors ${finalClass}`}>
                          {check.message && (
                            <div className={`mb-1 text-label-bold leading-tight ${check.isViolation || check.isHardBlock ? "text-on-error-container" : "text-on-surface-variant"}`}>
                              {check.message}
                            </div>
                          )}
                          <AppInput
                            value={shift}
                            onChange={(event) => updateShift(rowIndex, dayIndex, event.target.value)}
                            placeholder=""
                            className={`h-9 rounded-xl text-xs font-data-tabular tabular-nums ${check.isViolation ? 'bg-surface-container-lowest/60 border-error/40 text-error focus:border-error' : 'bg-surface-container-lowest/80'}`}
                          />
                          {role !== "none" && <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass(role)}`}>{roleLabel(role)}</div>}
                        </td>
                      );
                    })}
                    <td className="border border-outline-variant bg-surface-container-lowest p-1 text-center">
                      <AppButton variant="ghost" size="icon" onClick={() => removePerson(person.id)} className="rounded-xl text-error" aria-label={`Remove ${person.name || "team member"}`}>
                        <span className="text-lg leading-none">×</span>
                      </AppButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-sm border-outline-variant">
          <CardContent className="overflow-x-auto p-3">
            <div className="mb-3">
              <h2 className="text-headline-md text-on-surface">Availability Dashboard</h2>
              <p className="text-body-md text-on-surface-variant">Set specific availability (e.g., &quot;7am-3pm, 12:30pm-9pm&quot;) or patterns (e.g., &quot;Unavailable&quot;, &quot;No mornings&quot;). Shifts scheduled outside these times will turn red.</p>
            </div>
            <table className="w-full min-w-[1200px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 w-[200px] min-w-[200px] border border-outline-variant bg-surface-container-high p-2 text-left text-on-surface shadow-sm">Name</th>
                  {days.map((day) => (
                    <th key={day} className="sticky top-0 z-20 border border-outline-variant bg-surface-container-high p-2 text-center align-top font-bold text-on-surface shadow-sm">{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((person, rowIndex) => (
                  <tr key={person.id} className={person.rosterStatus === "Starts Next Week" ? "bg-primary-fixed/10" : person.rosterStatus === "Inactive" ? "bg-surface-container text-on-surface-variant" : "bg-surface-container-lowest"}>
                    <td className="sticky left-0 z-10 border border-outline-variant bg-surface-container-lowest p-2 font-semibold text-on-surface">
                      {person.name} {person.rosterStatus !== "Active" && <span className="ml-1 text-label-bold font-normal uppercase text-on-surface-variant">({person.rosterStatus})</span>}
                    </td>
                    {days.map((day, dayIndex) => {
                      const reason = person.unavailable[dayIndex] || "";
                      return (
                        <td key={day} className={`border p-1 transition-colors ${reason ? "bg-error-container border-error/30" : "bg-surface-container-lowest border-outline-variant"}`}>
                          <AppInput
                            value={reason}
                            onChange={(event) => updateUnavailable(rowIndex, dayIndex, event.target.value)}
                            placeholder="Available"
                            className={`h-9 text-xs rounded-xl font-data-tabular tabular-nums ${reason ? "bg-surface-container-lowest/60 border-error/40 text-error placeholder:text-error/30 focus:border-error" : "bg-surface-container-lowest/80 border-transparent placeholder:text-on-surface-variant/30"}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-sm border-outline-variant">
          <CardContent className="overflow-x-auto p-3">
            <h2 className="mb-2 text-headline-md text-on-surface">Coverage Summary</h2>
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-left text-on-surface shadow-sm">Day</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Date</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Morning Truck?</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Openers Needed</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Openers Have</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Openers Extra/Short</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Closers Needed</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Closers Have</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Closers Extra/Short</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Overnight Needed</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Overnight Have</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Overnight Extra/Short</th>
                  <th className="sticky top-0 z-20 bg-surface-container-high border border-outline-variant p-2 text-on-surface shadow-sm">Scheduled Hours</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((daySummary, dayIndex) => {
                  const isProblemDay = daySummary.openDelta < 0 || daySummary.closeDelta < 0 || daySummary.overnightDelta < 0;

                  return (
                    <tr key={daySummary.day} className={isProblemDay ? "bg-error-container text-on-error-container" : "bg-surface-container-lowest text-on-surface"}>
                      <td className="border border-outline-variant p-2 font-bold">{daySummary.day}</td>
                      <td className="border border-outline-variant p-1">
                        <AppInput type="date" value={targets[dayIndex].date} onChange={(event) => updateTargetDate(dayIndex, event.target.value)} className="h-9 rounded-xl text-xs font-data-tabular tabular-nums bg-surface-container-lowest/80" />
                      </td>
                      <td className="border border-outline-variant p-2 text-center">
                        <input type="checkbox" checked={targets[dayIndex].truck} onChange={(event) => updateTarget(dayIndex, "truck", event.target.checked)} className="h-5 w-5 rounded border-outline-variant text-primary focus:ring-primary/30 cursor-pointer" />
                      </td>
                      <td className="border border-outline-variant p-1">
                        <div className="flex items-center gap-1">
                          <button onClick={() => updateTarget(dayIndex, "openNeeded", Math.max(0, toNumber(targets[dayIndex].openNeeded) - 1).toString())} className="h-9 w-7 flex items-center justify-center rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant transition-colors">-</button>
                          <AppInput type="number" value={targets[dayIndex].openNeeded} onChange={(event) => updateTarget(dayIndex, "openNeeded", event.target.value)} className="h-9 w-16 rounded-xl font-data-tabular tabular-nums text-center" />
                          <button onClick={() => updateTarget(dayIndex, "openNeeded", (toNumber(targets[dayIndex].openNeeded) + 1).toString())} className="h-9 w-7 flex items-center justify-center rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant transition-colors">+</button>
                        </div>
                      </td>
                      <td className="border border-outline-variant p-2 text-center font-semibold font-data-tabular tabular-nums">{daySummary.open}</td>
                      <td className="border border-outline-variant p-2 text-center font-data-tabular tabular-nums">{renderBadge(daySummary.openDelta)}</td>
                      <td className="border border-outline-variant p-1">
                        <div className="flex items-center gap-1">
                          <button onClick={() => updateTarget(dayIndex, "closeNeeded", Math.max(0, toNumber(targets[dayIndex].closeNeeded) - 1).toString())} className="h-9 w-7 flex items-center justify-center rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant transition-colors">-</button>
                          <AppInput type="number" value={targets[dayIndex].closeNeeded} onChange={(event) => updateTarget(dayIndex, "closeNeeded", event.target.value)} className="h-9 w-16 rounded-xl font-data-tabular tabular-nums text-center" />
                          <button onClick={() => updateTarget(dayIndex, "closeNeeded", (toNumber(targets[dayIndex].closeNeeded) + 1).toString())} className="h-9 w-7 flex items-center justify-center rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant transition-colors">+</button>
                        </div>
                      </td>
                      <td className="border border-outline-variant p-2 text-center font-semibold font-data-tabular tabular-nums">{daySummary.close}</td>
                      <td className="border border-outline-variant p-2 text-center font-data-tabular tabular-nums">{renderBadge(daySummary.closeDelta)}</td>
                      <td className="border border-outline-variant p-1">
                        <div className="flex items-center gap-1">
                          <button onClick={() => updateTarget(dayIndex, "overnightNeeded", Math.max(0, toNumber(targets[dayIndex].overnightNeeded) - 1).toString())} className="h-9 w-7 flex items-center justify-center rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant transition-colors">-</button>
                          <AppInput type="number" value={targets[dayIndex].overnightNeeded} onChange={(event) => updateTarget(dayIndex, "overnightNeeded", event.target.value)} className="h-9 w-16 rounded-xl font-data-tabular tabular-nums text-center" />
                          <button onClick={() => updateTarget(dayIndex, "overnightNeeded", (toNumber(targets[dayIndex].overnightNeeded) + 1).toString())} className="h-9 w-7 flex items-center justify-center rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant transition-colors">+</button>
                        </div>
                      </td>
                      <td className="border border-outline-variant p-2 text-center font-semibold font-data-tabular tabular-nums">{daySummary.overnight}</td>
                      <td className="border border-outline-variant p-2 text-center font-data-tabular tabular-nums">{renderBadge(daySummary.overnightDelta)}</td>
                      <td className="border border-outline-variant p-2 text-center font-semibold font-data-tabular tabular-nums">{formatHours(daySummary.scheduledHours)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
        </>
        )}

        <Card className="rounded-xl shadow-sm border-outline-variant">
          <CardContent className="overflow-x-auto p-4">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-headline-md text-on-surface">Part Time Reduction Helper</h2>
                <p className="text-body-md text-on-surface-variant">Only active part time shifts are listed. Safe means removing or shortening that shift will not break opener, closer, or overnight minimums.</p>
              </div>
              <div className={`rounded-xl border px-3 py-2 text-body-md font-semibold ${coverageHasShortage ? "border-error/20 bg-error-container text-on-error-container" : "border-status-opener-text/20 bg-status-opener-bg text-status-opener-text"}`}>
                {coverageHasShortage ? "Coverage shortages exist" : "Coverage rules currently met"}
              </div>
            </div>

            {totals.overage > 0 ? (
              <div className="mb-6">
                <div className="mb-1 flex justify-between text-body-md font-semibold">
                  <span className="text-on-surface">Overage Resolution</span>
                  <span className="text-on-surface-variant">
                    {formatHours(safeReductionTotal)} hrs safe cuts / {formatHours(totals.overage)} hrs over budget
                  </span>
                </div>
                <div className="flex h-4 w-full overflow-hidden rounded-full bg-error-container">
                  <div
                    className="h-full bg-status-opener-text transition-all duration-500 ease-in-out"
                    style={{ width: `${Math.min(100, (safeReductionTotal / totals.overage) * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="mb-6 rounded-xl border border-status-opener-text/20 bg-status-opener-bg p-3 text-body-md text-status-opener-text font-semibold">
                Under budget! No reductions needed based on total hours.
              </div>
            )}

            {totals.overage > 0 && safeReductionTotal < totals.overage && (
              <div className="mb-6 rounded-xl border border-error/20 bg-error-container p-3 text-body-md text-on-error-container">
                Safe part time reductions do not cover the full weekly overage. You need replacement coverage, shorter shifts that still preserve role coverage, or a higher hour budget.
              </div>
            )}

            <div className="mb-2 font-bold text-on-surface">Daily Reductions</div>
            {dailyReductions.length > 0 ? (
              <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {dailyReductions.map((day) => (
                  <div key={day.dayIndex} className="flex flex-col rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between border-b border-outline-variant/50 bg-surface-container-low p-3">
                      <div>
                        <div className="font-bold text-on-surface">{day.day}</div>
                        <div className="text-body-sm text-on-surface-variant">{day.date}</div>
                      </div>
                      <div className="rounded-lg bg-status-opener-bg px-2 py-1 text-body-md font-bold text-status-opener-text">
                        {formatHours(day.safeHours)} hrs safe to cut
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 p-3">
                      {day.additions.map((a, i) => (
                        <div key={a.personId + i + "add"} className="rounded-lg border border-primary/20 bg-primary-fixed/10 p-2">
                          <div className="mb-1 flex items-start justify-between">
                            <div className="text-body-md font-semibold text-on-surface">
                              Shortage: {roleLabel(a.roleNeeded)}
                            </div>
                            <AppButton onClick={() => applyAddition(a.personId, day.dayIndex, a.suggestedShift)} variant="tonal" size="icon" title="Add this shift" className="h-6 w-6 rounded-md text-sm font-bold">
                               +
                            </AppButton>
                          </div>
                          <div className="text-body-sm text-primary">Recommend adding: <span className="font-bold">{a.name}</span> ({a.suggestedShift})</div>
                        </div>
                      ))}
                      {day.candidates.map((c, i) => (
                        <div key={c.id + i} className={`rounded-lg border p-2 ${c.hoursToCut > 0 ? 'border-status-opener-text/20 bg-status-opener-bg' : 'border-outline-variant bg-surface-container-low'}`}>
                          <div className="mb-1 flex items-start justify-between">
                            <div className="text-body-md font-semibold text-on-surface">
                              {c.name} <span className="text-body-sm font-normal text-on-surface-variant">({c.shift})</span>
                            </div>
                            {c.hoursToCut > 0 && (
                               <div className="flex items-center gap-2">
                                  <div className="text-body-sm font-bold text-status-opener-text">-{formatHours(c.hoursToCut)} hrs</div>
                                  <AppButton onClick={() => applyReduction(c.personId, day.dayIndex, c.originalHours, c.hoursToCut, c.role, c.shift)} variant="ghost" size="icon" title="Apply this reduction" className="h-6 w-6 rounded-md border-status-opener-text/30 text-status-opener-text hover:bg-status-opener-bg text-sm font-bold">
                                      -
                                   </AppButton>
                               </div>
                            )}
                          </div>
                          <div className={`text-body-sm ${c.hoursToCut > 0 ? 'text-status-opener-text' : 'text-on-surface-variant'}`}>{c.suggestion}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mb-6 rounded-xl border border-outline-variant bg-surface-container-low p-4 text-center text-body-md text-on-surface-variant">
                No safe part-time reductions found.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-sm border-outline-variant">
          <CardContent className="p-4">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-headline-md text-on-surface">Smart Schedule Revision</h2>
                <p className="text-body-md text-on-surface-variant">
                  Auto-revises the schedule to hit coverage minimums and the weekly labor budget. Full-timers and locked recurring schedules are never trimmed &mdash; cuts come from part-timers, least senior first, and coverage gaps go to the most senior available part-timer. Review each change before applying.
                </p>
              </div>
              <div className="flex gap-2">
                {revision && revision.changes.length > 0 && (
                  <AppButton onClick={applyAllChanges} className="rounded-lg bg-primary text-on-primary hover:opacity-90">
                    <span className="material-symbols-outlined text-[16px] mr-1.5">done_all</span>
                    Apply All ({revision.changes.length})
                  </AppButton>
                )}
                <AppButton onClick={runRevision} variant="ghost" className="rounded-lg border border-primary-fixed text-primary bg-primary-fixed/30 hover:bg-primary-fixed/50">
                  <span className="material-symbols-outlined text-[16px] mr-1.5">auto_fix_high</span>
                  {revision ? 'Regenerate' : 'Generate Revision'}
                </AppButton>
              </div>
            </div>

            {!revision && (
              <div className="rounded-lg border border-dashed border-outline-variant bg-surface-container-low p-4 text-body-md text-on-surface-variant">
                Click <span className="font-semibold text-on-surface">Generate Revision</span> to compute a proposed set of changes.
              </div>
            )}

            {revision && revision.changes.length === 0 && (
              <div className="rounded-lg border border-status-opener-text/30 bg-status-opener-bg p-4 text-body-md text-status-opener-text">
                {revision.notes.length === 0
                  ? 'No changes needed — coverage and labor budget are already met with flexible staff.'
                  : 'No further changes can be applied safely. See notes below.'}
              </div>
            )}

            {revision && revision.changes.length > 0 && (
              <div className="space-y-2">
                {revision.changes.map((change, i) => (
                  <div key={`${change.personId}-${change.dayIndex}-${i}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${change.kind === 'add' ? 'bg-status-opener-bg text-status-opener-text' : 'bg-error-container text-on-error-container'}`}>
                        <span className="material-symbols-outlined text-[16px]">{change.kind === 'add' ? 'add' : 'remove'}</span>
                      </span>
                      <div>
                        <div className="font-semibold text-on-surface">
                          {change.name || '—'} <span className="font-normal text-on-surface-variant">· {change.day}</span>
                        </div>
                        <div className="text-body-sm text-on-surface-variant font-data-tabular tabular-nums">
                          {change.from ? change.from : 'OFF'} → {change.to ? change.to : 'OFF'} <span className="not-italic">· {change.reason}</span>
                        </div>
                      </div>
                    </div>
                    <AppButton onClick={() => applyChange(change)} variant="tonal" size="sm" className="rounded-lg">
                      Apply
                    </AppButton>
                  </div>
                ))}
              </div>
            )}

            {revision && revision.notes.length > 0 && (
              <div className="mt-3 rounded-lg border border-error/30 bg-error-container/40 p-3">
                <div className="mb-1 text-label-bold font-bold uppercase tracking-wider text-on-error-container">Notes</div>
                <ul className="list-disc space-y-1 pl-5 text-body-sm text-on-error-container">
                  {revision.notes.map((note, i) => <li key={i}>{note}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-sm border-outline-variant">
          <CardContent className="p-4 font-body-sm text-body-sm text-on-surface-variant">
            <div className="font-bold text-on-surface">Rules Used</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Weekly hours available is treated as the total labor budget for the full week.</li>
              <li>Wednesday night overnight is not required when Thursday morning has no truck.</li>
              <li>Starting with the week of 2026-05-17, daily truck delivery is assumed and Wednesday night overnight becomes required again.</li>
              <li>Team members with Coverage set to "Excluded" are not counted in the opener, closer, or overnight coverage rules.</li>
              <li>Inactive team members are kept on the roster but excluded from scheduled hours and coverage counts.</li>
              <li>Smart Revision never trims full-timers or locked recurring schedules; labor cuts come from part-timers, least senior first.</li>
              <li>Smart Revision fills coverage gaps with the most senior available part-timer, avoiding pushing a part-timer above the lowest-seniority full-timer's weekly hours.</li>
              <li>The team leader's seniority date is not used when ranking who is cut or who gains hours.</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {printMode && createPortal(
        <div className="print-portal">
          <PrintableRoster
            mode={printMode}
            roster={roster}
            targets={targets}
            shiftDefinitions={shiftDefinitions}
            department={department}
          />
        </div>,
        document.body
      )}
    </div>
  );
}




