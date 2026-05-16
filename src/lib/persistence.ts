import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { TeamMember, Target, ShiftDefinitions } from '../types';

export interface AppData {
  roster: TeamMember[];
  targets: Target[];
  weeklyHoursAvailable: string;
  minimumShiftLength: string;
  autoDeductLunch: boolean;
  department: string;
  shiftDefinitions: ShiftDefinitions;
  lastUpdated: string;
}

const COLLECTION_NAME = 'appData';
const LS_PREFIX = 'rosterui:';

// Local mirror so data always survives a reload even when Firebase/network
// is unavailable (missing credentials, offline, blocked). Firebase stays
// the source of truth when it works; localStorage is the fallback.
function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch { /* quota/SSR */ }
}
function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export type SaveOutcome = 'cloud' | 'local';

export async function saveAppState(
  department: string, weekId: string, data: Omit<AppData, 'lastUpdated' | 'department'>
): Promise<SaveOutcome> {
  const docId = `${department}_${weekId}`;
  const payload: AppData = { ...data, department, lastUpdated: new Date().toISOString() };
  lsSet(`appData:${docId}`, payload);
  try {
    await setDoc(doc(db, COLLECTION_NAME, docId), payload);
    return 'cloud';
  } catch (error) {
    console.error('Cloud save failed; kept a local copy:', error);
    return 'local';
  }
}

export async function loadAppState(department: string, weekId: string): Promise<AppData | null> {
  const docId = `${department}_${weekId}`;
  try {
    const docSnap = await getDoc(doc(db, COLLECTION_NAME, docId));
    if (docSnap.exists()) {
      const remote = docSnap.data() as AppData;
      lsSet(`appData:${docId}`, remote);
      return remote;
    }
  } catch (error) {
    console.error('Cloud load failed; falling back to local copy:', error);
  }
  return lsGet<AppData>(`appData:${docId}`);
}

export async function saveGlobalEmployees(employees: TeamMember[]): Promise<SaveOutcome> {
  lsSet('globalEmployees', employees);
  try {
    await setDoc(doc(db, 'globalConfig', 'employees'), {
      list: employees, lastUpdated: new Date().toISOString()
    });
    return 'cloud';
  } catch (error) {
    console.error('Cloud save (global employees) failed; kept a local copy:', error);
    return 'local';
  }
}

export async function loadGlobalEmployees(): Promise<TeamMember[]> {
  try {
    const docSnap = await getDoc(doc(db, 'globalConfig', 'employees'));
    if (docSnap.exists()) {
      const list = (docSnap.data() as { list: TeamMember[] }).list || [];
      lsSet('globalEmployees', list);
      return list;
    }
  } catch (error) {
    console.error('Cloud load (global employees) failed; falling back to local copy:', error);
  }
  return lsGet<TeamMember[]>('globalEmployees') || [];
}
