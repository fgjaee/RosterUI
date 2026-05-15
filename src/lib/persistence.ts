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

export async function saveAppState(department: string, weekId: string, data: Omit<AppData, 'lastUpdated' | 'department'>) {
  try {
    const docId = `${department}_${weekId}`;
    const docRef = doc(db, COLLECTION_NAME, docId);
    await setDoc(docRef, {
      ...data,
      department,
      lastUpdated: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error saving app state:', error);
    return false;
  }
}

export async function loadAppState(department: string, weekId: string): Promise<AppData | null> {
  try {
    const docId = `${department}_${weekId}`;
    const docRef = doc(db, COLLECTION_NAME, docId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as AppData;
    }
    return null;
  } catch (error) {
    console.error('Error loading app state:', error);
    return null;
  }
}

export async function saveGlobalEmployees(employees: TeamMember[]) {
  try {
    const docRef = doc(db, 'globalConfig', 'employees');
    await setDoc(docRef, { list: employees, lastUpdated: new Date().toISOString() });
    return true;
  } catch (error) {
    console.error('Error saving global employees:', error);
    return false;
  }
}

export async function loadGlobalEmployees(): Promise<TeamMember[]> {
  try {
    const docRef = doc(db, 'globalConfig', 'employees');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data() as { list: TeamMember[] };
      return data.list || [];
    }
    return [];
  } catch (error) {
    console.error('Error loading global employees:', error);
    return [];
  }
}
