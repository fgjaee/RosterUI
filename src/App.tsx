import { useState, useEffect, useCallback } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from './lib/firebase'
import { EditableRosterStaffingView } from './components/EditableRosterStaffingView'
import { LoginScreen } from './components/LoginScreen'
import { TopAppBar } from './components/TopAppBar'
import { SideNavBar } from './components/SideNavBar'
import { DashboardView } from './components/views/DashboardView'
import { LaborView } from './components/views/LaborView'
import { EmployeesView } from './components/views/EmployeesView'
import { ComplianceView } from './components/views/ComplianceView'
import { ViolationsView } from './components/views/ViolationsView'
import { LaborBudgetView } from './components/views/LaborBudgetView'
import { AuditLogView } from './components/views/AuditLogView'
import type { AuditEntry } from './components/views/AuditLogView'
import { TeamInfoView } from './components/views/TeamInfoView'
import type { TeamMember, Target, SummaryRow } from './types'
import {
  days, parseShift, roleFor, defaultRoster,
  defaultShiftDefinitions, toNumber, createDefaultTargets, emptyShifts,
  getSunday, formatDate
} from './lib/helpers'
import type { ShiftDefinitions } from './types'
import { 
  loadAppState, saveAppState, loadGlobalEmployees, saveGlobalEmployees 
} from './lib/persistence'

export type AppView =
  | 'schedule'
  | 'dashboard'
  | 'labor'
  | 'employees'
  | 'compliance'
  | 'violations'
  | 'labor-budget'
  | 'audit-log'
  | 'team-info';

// Shared roster state exposed to views via context props
export interface RosterState {
  roster: TeamMember[];
  targets: Target[];
  summary: SummaryRow[];
  weeklyHoursAvailable: string;
  minimumShiftLength: string;
  autoDeductLunch: boolean;
  department: string;
  shiftDefinitions: ShiftDefinitions;
  totals: {
    available: number;
    scheduled: number;
    coreScheduled: number;
    excludedScheduled: number;
    fullTime: number;
    partTime: number;
    difference: number;
    overage: number;
  };
}

function buildSummary(roster: TeamMember[], targets: Target[], shiftDefs: ShiftDefinitions, autoDeductLunch: boolean): SummaryRow[] {
  return days.map((day, i) => {
    const target = targets[i];
    let open = 0, close = 0, overnight = 0, scheduledHours = 0;
    roster.forEach(person => {
      if (person.rosterStatus === 'Inactive') return;
      const shift = person.shifts[i] ?? '';
      const parsed = parseShift(shift, autoDeductLunch);
      if (parsed) {
        scheduledHours += parsed.hours;
        const role = roleFor(person.coverageStatus, shift, shiftDefs);
        if (role === 'open') open++;
        else if (role === 'close') close++;
        else if (role === 'overnight') overnight++;
      }
    });
    const openNeeded = toNumber(target?.openNeeded ?? '0');
    const closeNeeded = toNumber(target?.closeNeeded ?? '0');
    const overnightNeeded = toNumber(target?.overnightNeeded ?? '0');
    return {
      day,
      date: target?.date ?? '',
      open, close, overnight,
      scheduledHours: Number(scheduledHours.toFixed(2)),
      openDelta: open - openNeeded,
      closeDelta: close - closeNeeded,
      overnightDelta: overnight - overnightNeeded,
    };
  });
}

function buildTotals(roster: TeamMember[], weeklyHoursAvailable: string, autoDeductLunch: boolean) {
  const available = parseFloat(weeklyHoursAvailable) || 0;
  let ftHours = 0, ptHours = 0, coreHours = 0, excludedHours = 0;
  roster.forEach(person => {
    if (person.rosterStatus === 'Inactive') return;
    const hrs = person.shifts.reduce((sum, s) => {
      const p = parseShift(s, autoDeductLunch);
      return sum + (p?.hours ?? 0);
    }, 0);
    if (person.status === 'FT') ftHours += hrs; else ptHours += hrs;
    if (person.coverageStatus === 'Excluded') excludedHours += hrs; else coreHours += hrs;
  });
  const scheduled = ftHours + ptHours;
  const difference = available - scheduled;
  return {
    available,
    scheduled,
    coreScheduled: coreHours,
    excludedScheduled: excludedHours,
    fullTime: ftHours,
    partTime: ptHours,
    difference: Math.max(0, difference),
    overage: Math.max(0, -difference),
  };
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentView, setCurrentView] = useState<AppView>('schedule')

  // Week & Department Context
  const [currentWeekId, setCurrentWeekId] = useState(() => {
    const today = new Date();
    const sun = getSunday(today);
    return formatDate(sun);
  });
  const [currentDepartment, setCurrentDepartment] = useState('Produce')

  // Shared roster state (synced from EditableRosterStaffingView via callbacks)
  const [roster, setRoster] = useState<TeamMember[]>([])
  const [globalEmployees, setGlobalEmployees] = useState<TeamMember[]>([])
  const [targets, setTargets] = useState<Target[]>(() => createDefaultTargets(currentWeekId))
  const [weeklyHoursAvailable, setWeeklyHoursAvailable] = useState('355')
  const [minimumShiftLength, setMinimumShiftLength] = useState('4')
  const [autoDeductLunch, setAutoDeductLunch] = useState(true)
  const [shiftDefinitions, setShiftDefinitions] = useState<ShiftDefinitions>(defaultShiftDefinitions)

  // Audit log (session-scoped)
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])

  const addAuditEntry = useCallback((entry: Omit<AuditEntry, 'timestamp'>) => {
    setAuditLog(prev => [...prev, { ...entry, timestamp: new Date() }])
  }, [])

  const [isSaving, setIsSaving] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)

  // Load data when user, week, or department changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser)
      if (currentUser) {
        setIsInitialLoading(true)
        setLoading(true)
        
        // 1. Load Global Employees First
        const globalEmps = await loadGlobalEmployees()
        setGlobalEmployees(globalEmps.length > 0 ? globalEmps : defaultRoster)

        // 2. Load Departmental/Weekly Data
        const data = await loadAppState(currentDepartment, currentWeekId)
        const savedRoster = data?.roster || []

        // Synchronize with globalEmployees to ensure names/status are current
        // 1. Members whose primary department is THIS department
        const deptMembers = globalEmps
          .filter(m => m.primaryDepartment === currentDepartment && m.rosterStatus !== 'Inactive')
          .map(m => {
            const saved = savedRoster.find(r => r.id === m.id)
            return {
              ...m,
              // Keep week-specific shifts/unavailability/coverage
              shifts: saved?.shifts || emptyShifts(),
              unavailable: saved?.unavailable || emptyShifts(),
              coverageStatus: saved?.coverageStatus || 'Included',
              isBorrowed: false
            }
          })

        // 2. Members who are borrowed (primary dept is NOT this one, but they have shifts saved here)
        const borrowedMembers = savedRoster
          .filter(r => {
            const global = globalEmps.find(g => g.id === r.id)
            const isPrimaryHere = global?.primaryDepartment === currentDepartment
            const hasShifts = r.shifts.some(s => s && s.trim() !== "")
            // Only keep if they have shifts OR were manually flagged as borrowed
            return !isPrimaryHere && (hasShifts || r.isBorrowed)
          })
          .map(r => {
            const global = globalEmps.find(g => g.id === r.id)
            return {
              ...(global || r), // Use global profile if available
              shifts: r.shifts,
              unavailable: r.unavailable,
              coverageStatus: r.coverageStatus || 'Included',
              isBorrowed: true
            }
          })

        const finalRoster = [...deptMembers, ...borrowedMembers]
        setRoster(finalRoster)

        if (data) {
          setTargets(data.targets)
          setWeeklyHoursAvailable(data.weeklyHoursAvailable)
          setMinimumShiftLength(data.minimumShiftLength)
          setAutoDeductLunch(data.autoDeductLunch)
          setShiftDefinitions(data.shiftDefinitions)
        } else {
          setTargets(createDefaultTargets(currentWeekId))
          setWeeklyHoursAvailable('355')
          setAutoDeductLunch(true)
          setMinimumShiftLength('4')
          setShiftDefinitions(defaultShiftDefinitions)
        }
        setIsInitialLoading(false)
        setLoading(false)
      } else {
        setLoading(false)
      }
    })
    return () => unsubscribe()
  }, [currentWeekId, currentDepartment])

  // Auto-save logic
  useEffect(() => {
    if (!user || isInitialLoading) return

    const timer = setTimeout(async () => {
      setIsSaving(true)
      // Save departmental week data
      await saveAppState(currentDepartment, currentWeekId, {
        roster,
        targets,
        weeklyHoursAvailable,
        minimumShiftLength,
        autoDeductLunch,
        shiftDefinitions
      })
      // Save global employee pool
      await saveGlobalEmployees(globalEmployees)
      setIsSaving(false)
    }, 2000)

    return () => clearTimeout(timer)
  }, [roster, targets, weeklyHoursAvailable, minimumShiftLength, autoDeductLunch, currentDepartment, currentWeekId, shiftDefinitions, user, isInitialLoading, globalEmployees])

  const handleSignOut = useCallback(async () => {
    try {
      await signOut(auth)
    } catch (err) {
      console.error("Sign out failed:", err)
    }
  }, [])

  const handleNavigate = useCallback((view: AppView) => {
    setCurrentView(view)
  }, [])

  // Derived data for view components
  const rosterSummary = buildSummary(roster, targets, shiftDefinitions, autoDeductLunch)
  const totals = buildTotals(roster, weeklyHoursAvailable, autoDeductLunch)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-surface-container-high border-t-primary"></div>
          <div className="font-headline-md text-headline-md text-on-surface-variant">Loading Smart Roster Planner...</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginScreen />
  }

  function renderView() {
    const sharedProps = { roster, targets, summary: rosterSummary, totals }
    switch (currentView) {
      case 'schedule':
        return (
          <EditableRosterStaffingView
            roster={roster}
            globalEmployees={globalEmployees}
            targets={targets}
            weeklyHoursAvailable={weeklyHoursAvailable}
            minimumShiftLength={minimumShiftLength}
            autoDeductLunch={autoDeductLunch}
            department={currentDepartment}
            shiftDefinitions={shiftDefinitions}
            isLoading={isInitialLoading}
            isSaving={isSaving}
            onRosterChange={setRoster}
            onGlobalEmployeesChange={setGlobalEmployees}
            onTargetsChange={setTargets}
            onWeeklyHoursChange={setWeeklyHoursAvailable}
            onMinShiftChange={setMinimumShiftLength}
            onAutoDeductChange={setAutoDeductLunch}
            onDepartmentChange={setCurrentDepartment}
            onShiftDefsChange={setShiftDefinitions}
            onAuditEntry={addAuditEntry}
          />
        )
      case 'dashboard':
        return <DashboardView {...sharedProps} weeklyHoursAvailable={weeklyHoursAvailable} />
      case 'labor':
        return <LaborView {...sharedProps} weeklyHoursAvailable={weeklyHoursAvailable} autoDeductLunch={autoDeductLunch} />
      case 'employees':
        return <EmployeesView roster={globalEmployees} autoDeductLunch={autoDeductLunch} />
      case 'compliance':
        return <ComplianceView {...sharedProps} />
      case 'violations':
        return <ViolationsView {...sharedProps} />
      case 'labor-budget':
        return (
          <LaborBudgetView
            {...sharedProps}
            weeklyHoursAvailable={weeklyHoursAvailable}
            minimumShiftLength={minimumShiftLength}
            autoDeductLunch={autoDeductLunch}
            department={currentDepartment}
            onWeeklyHoursChange={setWeeklyHoursAvailable}
            onMinShiftChange={setMinimumShiftLength}
            onAutoDeductChange={setAutoDeductLunch}
          />
        )
      case 'audit-log':
        return <AuditLogView entries={auditLog} />
      case 'team-info':
        return <TeamInfoView roster={roster} autoDeductLunch={autoDeductLunch} />
      default:
        return null
    }
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col relative">
      {isSaving && (
        <div className="absolute top-4 right-4 z-[100] flex items-center gap-2 bg-surface-container-highest/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-outline-variant/30 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse"></div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Saving...</span>
        </div>
      )}
      <TopAppBar 
        onSignOut={handleSignOut} 
        currentView={currentView} 
        onNavigate={handleNavigate}
        currentWeekId={currentWeekId}
        onWeekChange={setCurrentWeekId}
        currentDepartment={currentDepartment}
        onDepartmentChange={setCurrentDepartment}
        weeklyHoursAvailable={weeklyHoursAvailable}
        onWeeklyHoursChange={setWeeklyHoursAvailable}
      />
      <div className="flex flex-1 overflow-hidden">
        <SideNavBar currentView={currentView} onNavigate={handleNavigate} />
        <main className="flex-1 overflow-auto lg:ml-64 bg-surface">
          {renderView()}
        </main>
      </div>
    </div>
  )
}

export default App
