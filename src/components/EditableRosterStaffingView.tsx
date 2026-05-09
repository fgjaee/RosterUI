import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Card, CardContent, AppButton, AppInput, AppSelect } from './ui';
import type {
  Role, EmploymentStatus, RosterStatus, TeamMember, Target,
  SummaryRow, DailyReduction,
  ShiftDefinitions, SavedRosterState
} from '../types';
import {
  days, storageKey, defaultShiftDefinitions, defaultRoster, defaultTargets,
  emptyShifts, parseShift, checkAvailabilityViolation,
  roleFor, roleLabel, cellClass, toNumber, formatHours, formatTimeText,
  createTeamMember, applyOvernightFromMorningTrucks, defaultTruckForDate
} from '../lib/helpers';

// OCR via CDN (loaded in index.html)
declare const Tesseract: any;
    





















export function EditableRosterStaffingView() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [roster, setRoster] = useState<TeamMember[]>(() => defaultRoster.map(person => ({
    ...person,
    coverageStatus: person.coverageStatus || (["john", "james"].includes(person.name.trim().toLowerCase()) ? "Excluded" : "Included"),
  })));
  const [targets, setTargets] = useState<Target[]>(defaultTargets);
  const [weeklyHoursAvailable, setWeeklyHoursAvailable] = useState("355");
  const [minimumShiftLength, setMinimumShiftLength] = useState("4");
  const [department, setDepartment] = useState("Produce");
  const [autoDeductLunch, setAutoDeductLunch] = useState(true);
  const [shiftDefinitions, setShiftDefinitions] = useState<ShiftDefinitions>(defaultShiftDefinitions);
  const [showShiftRulesSettings, setShowShiftRulesSettings] = useState(false);
  const [_showUnsafeCuts, _setShowUnsafeCuts] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  
  useEffect(() => {
    async function fetchState() {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('roster_state')
          .select('state_data')
          .eq('department', department)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') {
          console.error("Error fetching state:", error);
        } else if (data && data.state_data) {
          const savedState = data.state_data;
          
          if (Array.isArray(savedState?.roster) && savedState.roster.length > 0) {
            setRoster(savedState.roster.map((person: TeamMember) => {
              const unavailable = Array.isArray(person.unavailable) ? person.unavailable.map((u: string) => 
                u.includes("Unpaid") || u.includes("Paid Day Off") ? "Unavailable" : u
              ) : emptyShifts();
              return {
                ...person,
                unavailable,
                coverageStatus: person.coverageStatus || (["john", "james"].includes(person.name.trim().toLowerCase()) ? "Excluded" : "Included"),
              };
            }));
          } else {
            setRoster(defaultRoster.map(person => ({
              ...person,
              coverageStatus: person.coverageStatus || (["john", "james"].includes(person.name.trim().toLowerCase()) ? "Excluded" : "Included"),
            })));
          }
          if (Array.isArray(savedState?.targets) && savedState.targets.length === days.length) setTargets(savedState.targets);
          if (savedState?.weeklyHoursAvailable) setWeeklyHoursAvailable(savedState.weeklyHoursAvailable);
          if (savedState?.minimumShiftLength) setMinimumShiftLength(savedState.minimumShiftLength);
          if (savedState?.autoDeductLunch !== undefined) setAutoDeductLunch(savedState.autoDeductLunch);
          if (savedState?.shiftDefinitions) setShiftDefinitions(savedState.shiftDefinitions);
        }
      } catch (err) {
        console.error("Failed to load from Supabase:", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchState();
  }, [department]);

  useEffect(() => {
    if (typeof window === "undefined" || isLoading) return;

    const payload: SavedRosterState = {
      roster,
      targets,
      weeklyHoursAvailable,
      minimumShiftLength,
      department,
      autoDeductLunch,
      shiftDefinitions,
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));

    const timeoutId = setTimeout(async () => {
      setIsSaving(true);
      try {
        const { error } = await supabase
          .from('roster_state')
          .upsert(
            { department: department, state_data: payload },
            { onConflict: 'department' }
          );
        if (error) console.error("Error saving to Supabase:", error);
      } catch (err) {
        console.error("Failed to save to Supabase:", err);
      } finally {
        setIsSaving(false);
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [roster, targets, weeklyHoursAvailable, minimumShiftLength, department, autoDeductLunch, shiftDefinitions, isLoading]);

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

  const rosterCounts = useMemo(() => {
    const active = roster.filter((person) => person.rosterStatus === "Active").length;
    const startingNextWeek = roster.filter((person) => person.rosterStatus === "Starts Next Week").length;
    const inactive = roster.filter((person) => person.rosterStatus === "Inactive").length;
    const scheduled = roster.filter((person) => person.rosterStatus !== "Inactive" && person.shifts.some((shift) => parseShift(shift, autoDeductLunch))).length;

    return {
      active,
      startingNextWeek,
      inactive,
      scheduled,
      total: roster.length,
      activeNextWeek: active + startingNextWeek,
    };
  }, [roster, autoDeductLunch]);

  const personHours = useMemo(() => roster.map((person) => {
    const weeklyHours = person.rosterStatus === "Inactive" ? 0 : person.shifts.reduce((total, shift) => {
      const parsed = parseShift(shift, autoDeductLunch);
      return total + (parsed ? parsed.hours : 0);
    }, 0);

    return {
      id: person.id,
      hours: Number(weeklyHours.toFixed(2)),
    };
  }), [roster, autoDeductLunch]);

  const totals = useMemo(() => {
    let scheduled = 0;
    let coreScheduled = 0;
    let excludedScheduled = 0;
    let fullTime = 0;
    let partTime = 0;

    roster.forEach((person) => {
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
  }, [roster, weeklyHoursAvailable, autoDeductLunch]);

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

      const ptShifts = roster
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
  }, [roster, summary, targets, minimumShiftLength, autoDeductLunch, shiftDefinitions]);

  const safeReductionTotal = useMemo(() => {
    return dailyReductions.reduce((total, day) => total + day.safeHours, 0);
  }, [dailyReductions]);
  const coverageHasShortage = summary.some((row) => row.openDelta < 0 || row.closeDelta < 0 || row.overnightDelta < 0);

  function updateShift(rowIndex: number, dayIndex: number, value: string) {
    setRoster((prev) => prev.map((person, index) => {
      if (index !== rowIndex) return person;

      return {
        ...person,
        shifts: person.shifts.map((shift, shiftIndex) => shiftIndex === dayIndex ? value : shift),
      };
    }));
  }

  function updateUnavailable(rowIndex: number, dayIndex: number, value: string) {
    setRoster((prev) => prev.map((person, index) => {
      if (index !== rowIndex) return person;

      return {
        ...person,
        unavailable: person.unavailable.map((reason, reasonIndex) => reasonIndex === dayIndex ? value : reason),
      };
    }));
  }

  function updateName(rowIndex: number, value: string) {
    setRoster((prev) => prev.map((person, index) => index === rowIndex ? { ...person, name: value } : person));
  }

  function updateStatus(rowIndex: number, value: EmploymentStatus) {
    setRoster((prev) => prev.map((person, index) => index === rowIndex ? { ...person, status: value } : person));
  }

  function updateRosterStatus(rowIndex: number, value: RosterStatus) {
    setRoster((prev) => prev.map((person, index) => index === rowIndex ? { ...person, rosterStatus: value } : person));
  }

  function updateCoverageStatus(rowIndex: number, value: "Included" | "Excluded") {
    setRoster((prev) => prev.map((person, index) => index === rowIndex ? { ...person, coverageStatus: value } : person));
  }

  function updateTarget<K extends keyof Target>(dayIndex: number, key: K, value: Target[K]) {
    setTargets((prev) => {
      const updated = prev.map((target, index) => {
        if (index !== dayIndex) return target;

        const updatedTarget = { ...target, [key]: value } as Target;
        if (key === "truck") updatedTarget.openNeeded = value === true ? "5" : "4";

        return updatedTarget;
      });

      return key === "truck" ? applyOvernightFromMorningTrucks(updated) : updated;
    });
  }

  function updateTargetDate(dayIndex: number, value: string) {
    setTargets((prev) => {
      const updated = prev.map((target, index) => {
        if (index !== dayIndex) return target;

        const truck = defaultTruckForDate(target.day, value);

        return {
          ...target,
          date: value,
          truck,
          openNeeded: truck ? "5" : "4",
        };
      });

      return applyOvernightFromMorningTrucks(updated);
    });
  }

  function addPerson() {
    setRoster((prev) => [...prev, createTeamMember(prev.length)]);
  }

  function removePerson(id: string) {
    setRoster((prev) => prev.filter((person) => person.id !== id));
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
          setRoster(parsed.roster);
          if (Array.isArray(parsed.targets)) setTargets(parsed.targets);
          if (parsed.weeklyHoursAvailable) setWeeklyHoursAvailable(parsed.weeklyHoursAvailable);
          if (parsed.minimumShiftLength) setMinimumShiftLength(parsed.minimumShiftLength);
          if (parsed.department) setDepartment(parsed.department);
          if (parsed.autoDeductLunch !== undefined) setAutoDeductLunch(parsed.autoDeductLunch);
          alert("Roster successfully loaded from backup!");
        } else {
          alert("Invalid file format.");
        }
      } catch (err) {
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
           setRoster(prev => [...prev, ...parsedMembers]);
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

    if (value < 0) return <span className={`${base} bg-red-100 text-red-700`}>{value}</span>;
    if (value > 0) return <span className={`${base} bg-amber-100 text-amber-700`}>+{value}</span>;

    return <span className={`${base} bg-emerald-100 text-emerald-700`}>0</span>;
  }

  function applyAddition(personId: string, dayIndex: number, suggestedShift: string) {
    setRoster(prev => {
      const newRoster = [...prev];
      const pIdx = newRoster.findIndex(p => p.id === personId);
      if (pIdx === -1) return prev;
      
      const p = { ...newRoster[pIdx] };
      const shifts = [...p.shifts];
      shifts[dayIndex] = suggestedShift;
      p.shifts = shifts;
      newRoster[pIdx] = p;
      return newRoster;
    });
  }

  function applyReduction(personId: string, dayIndex: number, originalHours: number, hoursToCut: number, role: string, shift: string) {
    setRoster(prev => {
      const newRoster = [...prev];
      const pIdx = newRoster.findIndex(p => p.id === personId);
      if (pIdx === -1) return prev;
      
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
      return newRoster;
    });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-500"></div>
          <div className="text-lg font-medium text-slate-600">Loading Roster Data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Editable</h1>
              <AppSelect value={department} onChange={(event) => setDepartment(event.target.value)} className="h-10 border-slate-300 bg-white px-3 text-2xl font-bold tracking-tight text-slate-900 shadow-sm transition-all focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg">
                <option value="Produce">Produce</option>
                <option value="Bakery">Bakery</option>
                <option value="Deli">Deli</option>
                <option value="Meat">Meat</option>
                <option value="Grocery">Grocery</option>
                <option value="Dairy/Frozen">Dairy/Frozen</option>
                <option value="Front End">Front End</option>
              </AppSelect>
              <h1 className="text-2xl font-bold tracking-tight">Roster</h1>
              {isSaving && (
                <div className="ml-4 flex items-center gap-2 text-sm text-slate-500">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-500"></div>
                  Saving...
                </div>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">Weekly labor budget, full time and part time settings, roster size, opener coverage, closer coverage, overnight coverage, and week-specific delivery rules are checked together.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <AppButton onClick={handleSaveToFile} className="rounded-2xl border border-slate-300" variant="ghost">
              Save Roster
            </AppButton>
            <div>
              <input type="file" id="file-upload" accept=".json" className="hidden" onChange={handleLoadFromFile} />
              <AppButton onClick={() => document.getElementById('file-upload')?.click()} className="rounded-2xl border border-slate-300" variant="ghost">
                Load Roster
              </AppButton>
            </div>
            <div>
              <input type="file" id="ocr-upload" accept="image/*" className="hidden" onChange={handleOcrImport} disabled={ocrLoading} />
              <AppButton onClick={() => document.getElementById('ocr-upload')?.click()} className="rounded-2xl border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50" variant="ghost" disabled={ocrLoading}>
                {ocrLoading ? "Scanning Image..." : "Import from Image (OCR)"}
              </AppButton>
            </div>
            <AppButton onClick={addPerson} className="rounded-2xl">
              <span className="mr-2 text-lg leading-none">+</span>
              Add Team Member
            </AppButton>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Weekly Labor Budget</h2>
                  <p className="text-sm text-slate-600">Hours available is weekly. Hours scheduled is calculated from the roster.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-stretch gap-3">
                <label className="flex-1 min-w-[140px] space-y-1 text-sm font-semibold">
                  <span>Weekly Budget</span>
                  <AppInput type="number" value={weeklyHoursAvailable} onChange={(event) => setWeeklyHoursAvailable(event.target.value)} className="h-10 rounded-xl" />
                </label>
                <label className="flex-1 min-w-[140px] space-y-1 text-sm font-semibold">
                  <span>Min Shift Length</span>
                  <AppInput type="number" value={minimumShiftLength} onChange={(event) => setMinimumShiftLength(event.target.value)} className="h-10 rounded-xl" />
                </label>
                <label className="flex-1 min-w-[140px] space-y-1 text-sm font-semibold flex flex-col justify-center gap-1">
                  <span>Auto-deduct Lunch</span>
                  <div className="flex items-center gap-2 h-10">
                    <input type="checkbox" checked={autoDeductLunch} onChange={(e) => setAutoDeductLunch(e.target.checked)} className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" />
                    <span className="text-xs text-slate-500 font-normal">-0.5h for &ge; 6h shifts</span>
                  </div>
                </label>
                <div className="flex-1 min-w-[140px] space-y-1 text-sm font-semibold flex flex-col justify-center gap-1">
                  <span>Shift Rules</span>
                  <button onClick={() => setShowShiftRulesSettings(!showShiftRulesSettings)} className="flex items-center gap-2 h-10 rounded border border-slate-300 px-3 hover:bg-slate-50">
                    <span>⚙️ Configure</span>
                  </button>
                </div>
                
                <div className="flex-1 min-w-[120px] rounded-xl border bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Core Hours</div>
                  <div className="text-2xl font-bold">{formatHours(totals.coreScheduled)}</div>
                </div>
                <div className="flex-1 min-w-[120px] rounded-xl border bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Excluded Hours</div>
                  <div className="text-2xl font-bold text-slate-600">{formatHours(totals.excludedScheduled)}</div>
                </div>
                <div className="flex-1 min-w-[120px] rounded-xl border bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Total Hours</div>
                  <div className="text-2xl font-bold">{formatHours(totals.scheduled)}</div>
                </div>
                <div className="flex-1 min-w-[120px] rounded-xl border bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Full Time</div>
                  <div className="text-2xl font-bold">{formatHours(totals.fullTime)}</div>
                </div>
                <div className="flex-1 min-w-[120px] rounded-xl border bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Part Time</div>
                  <div className="text-2xl font-bold">{formatHours(totals.partTime)}</div>
                </div>
              </div>

              {showShiftRulesSettings && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="mb-3 text-sm font-bold text-slate-800">Shift Time Definitions (24hr start times)</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(["open", "mid", "close", "overnight"] as const).map(r => (
                      <div key={r} className="rounded border border-slate-200 bg-white p-2">
                        <div className="mb-1 text-xs font-bold capitalize text-slate-700">{r}</div>
                        <div className="flex items-center gap-1 text-sm">
                           <AppInput 
                              type="number" step="0.01" 
                              value={shiftDefinitions[r].start} 
                              onChange={e => setShiftDefinitions(prev => ({ ...prev, [r]: { ...prev[r], start: Number(e.target.value) } }))}
                              className="h-7 px-1 w-full text-center"
                           />
                           <span className="text-xs text-slate-400">to</span>
                           <AppInput 
                              type="number" step="0.01" 
                              value={shiftDefinitions[r].end} 
                              onChange={e => setShiftDefinitions(prev => ({ ...prev, [r]: { ...prev[r], end: Number(e.target.value) } }))}
                              className="h-7 px-1 w-full text-center"
                           />
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setShiftDefinitions(defaultShiftDefinitions)} className="mt-2 text-xs text-blue-600 hover:underline">Reset to Defaults</button>
                </div>
              )}
              
              <div className={`mt-4 rounded-xl border p-3 ${totals.difference < 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
                <div className="text-sm font-semibold">Weekly Result</div>
                <div className="text-xl font-bold">{totals.difference < 0 ? `${formatHours(Math.abs(totals.difference))} hours over` : `${formatHours(totals.difference)} hours left`}</div>
                <div className="mt-1 text-sm text-slate-600">Safe part time reduction available: {formatHours(safeReductionTotal)} hours</div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardContent className="overflow-x-auto p-4">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Team Information</h2>
                  <p className="text-sm text-slate-600">Your roster is saved locally in this browser as you edit.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
                  <div className="rounded-xl border bg-slate-50 px-3 py-2">
                    <div className="text-xs font-semibold uppercase text-slate-500">Active</div>
                    <div className="text-xl font-bold">{rosterCounts.active}</div>
                  </div>
                  <div className="rounded-xl border bg-slate-50 px-3 py-2">
                    <div className="text-xs font-semibold uppercase text-slate-500">Next Week</div>
                    <div className="text-xl font-bold">{rosterCounts.startingNextWeek}</div>
                  </div>
                  <div className="rounded-xl border bg-slate-50 px-3 py-2">
                    <div className="text-xs font-semibold uppercase text-slate-500">Next Total</div>
                    <div className="text-xl font-bold">{rosterCounts.activeNextWeek}</div>
                  </div>
                  <div className="rounded-xl border bg-slate-50 px-3 py-2">
                    <div className="text-xs font-semibold uppercase text-slate-500">Scheduled</div>
                    <div className="text-xl font-bold">{rosterCounts.scheduled}</div>
                  </div>
                  <div className="rounded-xl border bg-slate-50 px-3 py-2">
                    <div className="text-xs font-semibold uppercase text-slate-500">Total</div>
                    <div className="text-xl font-bold">{rosterCounts.total}</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {roster.map((person, rowIndex) => (
                  <div key={person.id} className={`flex flex-col gap-3 rounded-xl border p-3 shadow-sm transition-all hover:shadow-md ${person.rosterStatus === "Starts Next Week" ? "border-blue-200 bg-blue-50" : person.rosterStatus === "Inactive" ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <AppInput value={person.name} onChange={(event) => updateName(rowIndex, event.target.value)} className="h-10 border-none bg-transparent text-lg font-bold transition-colors hover:bg-white focus:bg-white" placeholder="Name" />
                      <button type="button" onClick={() => removePerson(person.id)} className="flex-shrink-0 rounded-full p-2 text-red-500 transition-colors hover:bg-red-100 focus:outline-none" title="Remove Person">
                        ✕
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <div className="flex-1 min-w-[80px]">
                        <div className="mb-1 ml-1 text-[10px] font-bold uppercase text-slate-500">Status</div>
                        <AppSelect value={person.status} onChange={(event) => updateStatus(rowIndex, event.target.value as EmploymentStatus)} className="h-9 rounded-lg text-sm px-1">
                          <option value="FT">FT</option>
                          <option value="PT">PT</option>
                        </AppSelect>
                      </div>
                      <div className="flex-1 min-w-[100px]">
                        <div className="mb-1 ml-1 text-[10px] font-bold uppercase text-slate-500">Roster</div>
                        <AppSelect value={person.rosterStatus} onChange={(event) => updateRosterStatus(rowIndex, event.target.value as RosterStatus)} className="h-9 rounded-lg text-sm px-1">
                          <option value="Active">Active</option>
                          <option value="Starts Next Week">Next Week</option>
                          <option value="Inactive">Inactive</option>
                        </AppSelect>
                      </div>
                      <div className="flex-1 min-w-[90px]">
                        <div className="mb-1 ml-1 text-[10px] font-bold uppercase text-slate-500">Coverage</div>
                        <AppSelect value={person.coverageStatus || "Included"} onChange={(event) => updateCoverageStatus(rowIndex, event.target.value as "Included" | "Excluded")} className="h-9 rounded-lg text-sm px-1">
                          <option value="Included">Counts</option>
                          <option value="Excluded">Excluded</option>
                        </AppSelect>
                      </div>
                    </div>
                    <div className="mt-auto flex items-center justify-between border-t border-slate-200/60 pt-3 text-sm">
                      <span className="font-semibold text-slate-500">Weekly Hours</span>
                      <span className="text-xl font-bold">{formatHours(weeklyHoursFor(person.id))}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="overflow-x-auto p-3">
            <table className="w-full min-w-[1450px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 w-72 border bg-white p-2 text-left">Name</th>
                  {days.map((day, dayIndex) => (
                    <th key={day} className="border bg-white p-2 text-center align-top">
                      <AppInput type="date" value={targets[dayIndex].date} onChange={(event) => updateTargetDate(dayIndex, event.target.value)} className="mb-1 h-8 rounded-xl text-xs" />
                      <div className="font-bold">{day}</div>
                      <div className="mt-1 grid gap-1 text-[11px] font-normal leading-tight">
                        <span>Openers {summary[dayIndex].open}/{targets[dayIndex].openNeeded}</span>
                        <span>Closers {summary[dayIndex].close}/{targets[dayIndex].closeNeeded}</span>
                        <span>Overnight Tonight {summary[dayIndex].overnight}/{targets[dayIndex].overnightNeeded}</span>
                      </div>
                    </th>
                  ))}
                  <th className="w-12 border bg-white p-2" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {roster.map((person, rowIndex) => (
                  <tr key={person.id} className={person.rosterStatus === "Starts Next Week" ? "bg-blue-50" : person.rosterStatus === "Inactive" ? "bg-slate-50 text-slate-500" : "bg-white"}>
                    <td className="sticky left-0 z-10 border bg-white p-2">
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
                      </div>
                    </td>
                    {days.map((day, dayIndex) => {
                      const shift = person.shifts[dayIndex] || "";
                      const role = person.rosterStatus === "Inactive" ? "none" : roleFor(person.coverageStatus, shift, shiftDefinitions);
                      const availReason = person.unavailable[dayIndex] || "";
                      const check = checkAvailabilityViolation(shift, availReason);
                      
                      let finalClass = person.rosterStatus === "Inactive" ? "bg-slate-50 border-slate-200" : cellClass(role);
                      
                      if (check.isViolation) {
                        finalClass = "bg-red-100 border-red-300";
                      } else if (check.isHardBlock) {
                        finalClass = "bg-rose-50 border-rose-100";
                      }

                      return (
                        <td key={day} className={`border p-1 align-top transition-colors ${finalClass}`}>
                          {check.message && (
                            <div className={`mb-1 text-[10px] font-bold leading-tight ${check.isViolation || check.isHardBlock ? "text-red-600" : "text-slate-500"}`}>
                              {check.message}
                            </div>
                          )}
                          <AppInput
                            value={shift}
                            onChange={(event) => updateShift(rowIndex, dayIndex, event.target.value)}
                            placeholder=""
                            className={`h-9 rounded-xl text-xs ${check.isViolation ? 'bg-white/60 border-red-300 text-red-900 focus:border-red-500' : 'bg-white/80'}`}
                          />
                          {role !== "none" && <div className="mt-1 text-[11px] font-semibold uppercase text-slate-600">{roleLabel(role)}</div>}
                        </td>
                      );
                    })}
                    <td className="border bg-white p-1 text-center">
                      <AppButton variant="ghost" size="icon" onClick={() => removePerson(person.id)} className="rounded-xl text-red-600" aria-label={`Remove ${person.name || "team member"}`}>
                        <span className="text-lg leading-none">×</span>
                      </AppButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="overflow-x-auto p-3">
            <div className="mb-3">
              <h2 className="text-lg font-bold">Availability Dashboard</h2>
              <p className="text-sm text-slate-600">Set specific availability (e.g., &quot;7am-3pm, 12:30pm-9pm&quot;) or patterns (e.g., &quot;Unavailable&quot;, &quot;No mornings&quot;). Shifts scheduled outside these times will turn red.</p>
            </div>
            <table className="w-full min-w-[1200px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 w-72 border bg-white p-2 text-left">Name</th>
                  {days.map((day) => (
                    <th key={day} className="border bg-white p-2 text-center align-top font-bold">{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((person, rowIndex) => (
                  <tr key={person.id} className={person.rosterStatus === "Starts Next Week" ? "bg-blue-50" : person.rosterStatus === "Inactive" ? "bg-slate-50 text-slate-500" : "bg-white"}>
                    <td className="sticky left-0 z-10 border bg-white p-2 font-semibold">
                      {person.name} {person.rosterStatus !== "Active" && <span className="ml-1 text-[10px] font-normal uppercase text-slate-500">({person.rosterStatus})</span>}
                    </td>
                    {days.map((day, dayIndex) => {
                      const reason = person.unavailable[dayIndex] || "";
                      return (
                        <td key={day} className={`border p-1 ${reason ? "bg-red-50" : ""}`}>
                          <AppInput
                            value={reason}
                            onChange={(event) => updateUnavailable(rowIndex, dayIndex, event.target.value)}
                            placeholder="Available"
                            className={`h-8 text-xs rounded-xl ${reason ? "bg-white border-red-300 text-red-900 placeholder:text-red-300" : "bg-white border-slate-200 placeholder:text-slate-300"}`}
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

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="overflow-x-auto p-3">
            <h2 className="mb-2 text-lg font-bold">Coverage Summary</h2>
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border p-2 text-left">Day</th>
                  <th className="border p-2">Date</th>
                  <th className="border p-2">Morning Truck?</th>
                  <th className="border p-2">Openers Needed</th>
                  <th className="border p-2">Openers Have</th>
                  <th className="border p-2">Openers Extra or Short</th>
                  <th className="border p-2">Closers Needed</th>
                  <th className="border p-2">Closers Have</th>
                  <th className="border p-2">Closers Extra or Short</th>
                  <th className="border p-2">Overnight Tonight Needed</th>
                  <th className="border p-2">Overnight Tonight Have</th>
                  <th className="border p-2">Overnight Tonight Extra or Short</th>
                  <th className="border p-2">Scheduled Hours</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((daySummary, dayIndex) => {
                  const isProblemDay = daySummary.openDelta < 0 || daySummary.closeDelta < 0 || daySummary.overnightDelta < 0;

                  return (
                    <tr key={daySummary.day} className={isProblemDay ? "bg-red-50" : "bg-white"}>
                      <td className="border p-2 font-bold">{daySummary.day}</td>
                      <td className="border p-1">
                        <AppInput type="date" value={targets[dayIndex].date} onChange={(event) => updateTargetDate(dayIndex, event.target.value)} className="h-8 rounded-xl text-xs" />
                      </td>
                      <td className="border p-2 text-center">
                        <input type="checkbox" checked={targets[dayIndex].truck} onChange={(event) => updateTarget(dayIndex, "truck", event.target.checked)} />
                      </td>
                      <td className="border p-1">
                        <AppInput type="number" value={targets[dayIndex].openNeeded} onChange={(event) => updateTarget(dayIndex, "openNeeded", event.target.value)} className="h-8 rounded-xl" />
                      </td>
                      <td className="border p-2 text-center font-semibold">{daySummary.open}</td>
                      <td className="border p-2 text-center">{renderBadge(daySummary.openDelta)}</td>
                      <td className="border p-1">
                        <AppInput type="number" value={targets[dayIndex].closeNeeded} onChange={(event) => updateTarget(dayIndex, "closeNeeded", event.target.value)} className="h-8 rounded-xl" />
                      </td>
                      <td className="border p-2 text-center font-semibold">{daySummary.close}</td>
                      <td className="border p-2 text-center">{renderBadge(daySummary.closeDelta)}</td>
                      <td className="border p-1">
                        <AppInput type="number" value={targets[dayIndex].overnightNeeded} onChange={(event) => updateTarget(dayIndex, "overnightNeeded", event.target.value)} className="h-8 rounded-xl" />
                      </td>
                      <td className="border p-2 text-center font-semibold">{daySummary.overnight}</td>
                      <td className="border p-2 text-center">{renderBadge(daySummary.overnightDelta)}</td>
                      <td className="border p-2 text-center font-semibold">{formatHours(daySummary.scheduledHours)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="overflow-x-auto p-4">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Part Time Reduction Helper</h2>
                <p className="text-sm text-slate-600">Only active part time shifts are listed. Safe means removing or shortening that shift will not break opener, closer, or overnight minimums.</p>
              </div>
              <div className={`rounded-xl border px-3 py-2 text-sm font-semibold ${coverageHasShortage ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                {coverageHasShortage ? "Coverage shortages exist" : "Coverage rules currently met"}
              </div>
            </div>

            {totals.overage > 0 ? (
              <div className="mb-6">
                <div className="mb-1 flex justify-between text-sm font-semibold">
                  <span className="text-slate-700">Overage Resolution</span>
                  <span className="text-slate-700">
                    {formatHours(safeReductionTotal)} hrs safe cuts / {formatHours(totals.overage)} hrs over budget
                  </span>
                </div>
                <div className="flex h-4 w-full overflow-hidden rounded-full bg-red-100">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500 ease-in-out"
                    style={{ width: `${Math.min(100, (safeReductionTotal / totals.overage) * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 font-semibold">
                Under budget! No reductions needed based on total hours.
              </div>
            )}

            {totals.overage > 0 && safeReductionTotal < totals.overage && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Safe part time reductions do not cover the full weekly overage. You need replacement coverage, shorter shifts that still preserve role coverage, or a higher hour budget.
              </div>
            )}

            <div className="mb-2 font-bold text-slate-800">Daily Reductions</div>
            {dailyReductions.length > 0 ? (
              <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {dailyReductions.map((day) => (
                  <div key={day.dayIndex} className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 p-3">
                      <div>
                        <div className="font-bold text-slate-800">{day.day}</div>
                        <div className="text-xs text-slate-500">{day.date}</div>
                      </div>
                      <div className="rounded bg-emerald-100 px-2 py-1 text-sm font-bold text-emerald-800">
                        {formatHours(day.safeHours)} hrs safe to cut
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 p-3">
                      {day.additions.map((a, i) => (
                        <div key={a.personId + i + "add"} className="rounded border border-blue-100 bg-blue-50 p-2">
                          <div className="mb-1 flex items-start justify-between">
                            <div className="text-sm font-semibold text-slate-800">
                              Shortage: {roleLabel(a.roleNeeded)}
                            </div>
                            <button onClick={() => applyAddition(a.personId, day.dayIndex, a.suggestedShift)} className="flex h-5 w-5 items-center justify-center rounded bg-blue-200 text-blue-700 hover:bg-blue-300 transition-colors" title="Add this shift">
                               +
                            </button>
                          </div>
                          <div className="text-xs text-blue-700">Recommend adding: <span className="font-bold">{a.name}</span> ({a.suggestedShift})</div>
                        </div>
                      ))}
                      {day.candidates.map((c, i) => (
                        <div key={c.id + i} className={`rounded border p-2 ${c.hoursToCut > 0 ? 'border-emerald-100 bg-emerald-50' : 'border-slate-100 bg-slate-50'}`}>
                          <div className="mb-1 flex items-start justify-between">
                            <div className="text-sm font-semibold text-slate-800">
                              {c.name} <span className="text-xs font-normal text-slate-500">({c.shift})</span>
                            </div>
                            {c.hoursToCut > 0 && (
                               <div className="flex items-center gap-2">
                                  <div className="text-xs font-bold text-emerald-700">-{formatHours(c.hoursToCut)} hrs</div>
                                  <button onClick={() => applyReduction(c.personId, day.dayIndex, c.originalHours, c.hoursToCut, c.role, c.shift)} className="flex h-5 w-5 items-center justify-center rounded bg-emerald-200 text-emerald-700 hover:bg-emerald-300 transition-colors" title="Apply this reduction">
                                     -
                                  </button>
                               </div>
                            )}
                          </div>
                          <div className={`text-xs ${c.hoursToCut > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>{c.suggestion}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mb-6 rounded-xl border bg-slate-50 p-4 text-center text-sm text-slate-500">
                No safe part-time reductions found.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-4 text-sm text-slate-700">
            <div className="font-bold text-slate-900">Rules Used</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Weekly hours available is treated as the total labor budget for the full week.</li>
              <li>Wednesday night overnight is not required when Thursday morning has no truck.</li>
              <li>Starting with the week of 2026-05-17, daily truck delivery is assumed and Wednesday night overnight becomes required again.</li>
              <li>Team members with Coverage set to "Excluded" are not counted in the opener, closer, or overnight coverage rules.</li>
              <li>Inactive team members are kept on the roster but excluded from scheduled hours and coverage counts.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}




