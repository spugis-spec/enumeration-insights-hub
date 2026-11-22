import { 
  doc, 
  getDoc, 
  setDoc, 
  collection,
  getDocs,
  deleteDoc
} from 'firebase/firestore';
import { getFs } from '@/lib/firebase';

import { FeederLookup, SavedReport, SavedWeek } from './types';

// Same collections the standalone Feeder Dashboard used, prefixed `weekly_` because the shared
// project also holds the Field Manager's `users` collection. (Its own username/password
// `users` collection is gone: the single sign-in replaces it.)
const COLLECTIONS = {
  FEEDER_LOOKUP: 'weekly_feederLookup',
  CURRENT_REPORT: 'weekly_currentReport',
  PREVIOUS_REPORT: 'weekly_previousReport',
  SAVED_WEEKS: 'weekly_savedWeeks',
};

// ==================== FEEDER LOOKUP ====================

export async function saveFeederLookup(lookup: FeederLookup): Promise<void> {
  const docRef = doc(getFs(), COLLECTIONS.FEEDER_LOOKUP, 'main');
  await setDoc(docRef, { 
    data: lookup,
    updatedAt: new Date().toISOString()
  });
}

export async function getFeederLookup(): Promise<FeederLookup | null> {
  const docRef = doc(getFs(), COLLECTIONS.FEEDER_LOOKUP, 'main');
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    return docSnap.data()['data'] as FeederLookup;
  }
  return null;
}

export async function clearFeederLookup(): Promise<void> {
  const docRef = doc(getFs(), COLLECTIONS.FEEDER_LOOKUP, 'main');
  await deleteDoc(docRef);
}

// ==================== CURRENT REPORT ====================

export async function saveCurrentReport(report: SavedReport): Promise<void> {
  const docRef = doc(getFs(), COLLECTIONS.CURRENT_REPORT, 'main');
  await setDoc(docRef, {
    ...report,
    savedAt: new Date().toISOString()
  });
}

export async function getCurrentReport(): Promise<SavedReport | null> {
  const docRef = doc(getFs(), COLLECTIONS.CURRENT_REPORT, 'main');
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    return docSnap.data() as SavedReport;
  }
  return null;
}

// ==================== PREVIOUS WEEK REPORT ====================

export async function savePreviousReport(report: SavedReport): Promise<void> {
  const docRef = doc(getFs(), COLLECTIONS.PREVIOUS_REPORT, 'main');
  await setDoc(docRef, {
    ...report,
    savedAt: new Date().toISOString()
  });
}

export async function getPreviousReport(): Promise<SavedReport | null> {
  const docRef = doc(getFs(), COLLECTIONS.PREVIOUS_REPORT, 'main');
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    return docSnap.data() as SavedReport;
  }
  return null;
}

// ==================== SAVED WEEKS (Multiple Weeks) ====================

export async function saveWeekReport(week: SavedWeek): Promise<void> {
  const weekId = `week_${week.weekNumber}`;
  const docRef = doc(getFs(), COLLECTIONS.SAVED_WEEKS, weekId);
  await setDoc(docRef, {
    ...week,
    id: weekId,
    savedAt: new Date().toISOString()
  });
}

export async function getSavedWeeks(): Promise<SavedWeek[]> {
  const colRef = collection(getFs(), COLLECTIONS.SAVED_WEEKS);
  const snapshot = await getDocs(colRef);
  const weeks: SavedWeek[] = [];
  
  snapshot.forEach((docSnap) => {
    weeks.push({ id: docSnap.id, ...docSnap.data() } as SavedWeek);
  });
  
  // Sort by week number descending (newest first)
  return weeks.sort((a, b) => b.weekNumber - a.weekNumber);
}

export async function getWeekByNumber(weekNumber: number): Promise<SavedWeek | null> {
  const weekId = `week_${weekNumber}`;
  const docRef = doc(getFs(), COLLECTIONS.SAVED_WEEKS, weekId);
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as SavedWeek;
  }
  return null;
}

export async function deleteWeekReport(weekNumber: number): Promise<void> {
  const weekId = `week_${weekNumber}`;
  const docRef = doc(getFs(), COLLECTIONS.SAVED_WEEKS, weekId);
  await deleteDoc(docRef);
}

export async function weekExists(weekNumber: number): Promise<boolean> {
  const weekId = `week_${weekNumber}`;
  const docRef = doc(getFs(), COLLECTIONS.SAVED_WEEKS, weekId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists();
}
