export type Day = "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";
export type Role = "open" | "mid" | "close" | "overnight" | "excluded" | "none";
export type EmploymentStatus = "FT" | "PT";
export type RosterStatus = "Active" | "Starts Next Week" | "Inactive";

export type TimeOffRequest = {
  date: string; // ISO YYYY-MM-DD
  type: "Paid" | "Unpaid";
  note?: string;
};

export type TeamMember = {
  id: string;
  name: string;
  status: EmploymentStatus;
  rosterStatus: RosterStatus;
  shifts: string[];
  unavailable: string[];
  coverageStatus?: "Included" | "Excluded";
  primaryDepartment?: string;
  crossTrainedDepartments?: string[];
  isBorrowed?: boolean;
  scheduleLocked?: boolean;
  fixedSchedule?: string[];
  seniorityDate?: string;
  isTeamLeader?: boolean;
  role?: string;
  jobTitle?: string;
  birthday?: string;
  timeOff?: TimeOffRequest[];
  // Soft preference (Sun..Sat). Not a hard block — the scheduler tries to
  // honor it but may override when coverage requires it.
  preferredDaysOff?: boolean[];
};

export type WeekConfig = {
  id: string; // Sunday date YYYY-MM-DD
  label: string; // Last Week, Current Week, etc.
};

export type Target = {
  day: Day;
  date: string;
  truck: boolean;
  openNeeded: string;
  closeNeeded: string;
  overnightNeeded: string;
};

export type ParsedShift = {
  start: number;
  end: number;
  hours: number;
};

export type SummaryRow = {
  day: Day;
  date: string;
  open: number;
  close: number;
  overnight: number;
  scheduledHours: number;
  openDelta: number;
  closeDelta: number;
  overnightDelta: number;
};

export type AdditionSuggestion = {
  personId: string;
  name: string;
  roleNeeded: Role;
  suggestedShift: string;
};

export type DailyReduction = {
  dayIndex: number;
  day: Day;
  date: string;
  safeHours: number;
  candidates: {
    id: string;
    personId: string;
    name: string;
    shift: string;
    role: Role;
    originalHours: number;
    hoursToCut: number;
    suggestion: string;
    priority: number;
  }[];
  additions: AdditionSuggestion[];
};

export type TimeRange = { start: number; end: number };

export type ShiftDefinitions = {
  open: TimeRange;
  mid: TimeRange;
  close: TimeRange;
  overnight: TimeRange;
};

export type SavedRosterState = {
  roster?: TeamMember[];
  targets?: Target[];
  weeklyHoursAvailable?: string;
  minimumShiftLength?: string;
  department?: string;
  autoDeductLunch?: boolean;
  shiftDefinitions?: ShiftDefinitions;
};
