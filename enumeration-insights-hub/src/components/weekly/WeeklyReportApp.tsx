import { useState, useCallback, useEffect } from 'react';
import { FileUpload } from './FileUpload';
import { ReportTable } from './ReportTable';
import { ComparisonView } from './ComparisonView';
import { SummaryCards } from './SummaryCards';
import { FeederCorrectionModal } from './FeederCorrectionModal';
import { SavedWeeksManager } from './SavedWeeksManager';
import { useAuth } from '@/lib/auth';
import {
  parseFeederLookup,
  parseAssetFile,
  getFeederFromRow,
  getTimeFromRow,
  isDateInRange,
  exportReportToExcel,
  getAllFeederNames,
  getWeekLabel,
} from '@/lib/weekly/excelUtils';
import {
  saveFeederLookup as saveFeederLookupToFirebase,
  getFeederLookup as getFeederLookupFromFirebase,
  clearFeederLookup as clearFeederLookupFromFirebase,
  saveCurrentReport,
  getCurrentReport,
  saveWeekReport,
  getSavedWeeks,
  deleteWeekReport,
  weekExists,
} from '@/lib/weekly/dataService';
import type { FeederLookup, FeederReportRow, UnmatchedFeeder, SavedReport, SavedWeek } from '@/lib/weekly/types';

type Tab = 'upload' | 'report' | 'previous' | 'comparison';

export function WeeklyReportApp() {
  // Authentication: the app-wide Firebase sign-in (top bar) replaces the old username/password screen.
  const { user, ready, logout } = useAuth();
  const isAuthenticated = !!user;
  const currentUser = user?.email ?? null;
  const authChecking = !ready;

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('upload');

  // File states
  const [feederLookupFile, setFeederLookupFile] = useState<File | null>(null);
  const [mappedDTFile, setMappedDTFile] = useState<File | null>(null);
  const [htPolesFile, setHtPolesFile] = useState<File | null>(null);
  const [ltPolesFile, setLtPolesFile] = useState<File | null>(null);
  const [consumerPointsFile, setConsumerPointsFile] = useState<File | null>(null);
  const [issueLogFile, setIssueLogFile] = useState<File | null>(null);

  // Parsed data states
  const [feederLookup, setFeederLookup] = useState<FeederLookup>({});
  const [allFeederNames, setAllFeederNames] = useState<string[]>([]);
  const [reportData, setReportData] = useState<FeederReportRow[]>([]);
  
  // Multiple weeks storage
  const [savedWeeks, setSavedWeeks] = useState<SavedWeek[]>([]);
  const [selectedCurrentWeek, setSelectedCurrentWeek] = useState<SavedWeek | null>(null);
  const [selectedPreviousWeek, setSelectedPreviousWeek] = useState<SavedWeek | null>(null);
  
  // Firebase loading states
  const [firebaseLoading, setFirebaseLoading] = useState(true);
  
  // Current report metadata
  const [currentDateRange, setCurrentDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  
  // Unmatched feeders for correction
  const [unmatchedFeeders, setUnmatchedFeeders] = useState<UnmatchedFeeder[]>([]);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);

  // Date range
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Loading & error states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Saved current week report state
  const [savedCurrentReport, setSavedCurrentReport] = useState<SavedReport | null>(null);

  // Load saved weeks from Firebase
  const loadSavedWeeks = useCallback(async () => {
    try {
      const weeks = await getSavedWeeks();
      setSavedWeeks(weeks);
      // Set default weeks for comparison if not already set
      if (weeks.length >= 2 && !selectedCurrentWeek && !selectedPreviousWeek) {
        // Sort by week number descending
        const sorted = [...weeks].sort((a, b) => b.weekNumber - a.weekNumber);
        setSelectedCurrentWeek(sorted[0]);
        setSelectedPreviousWeek(sorted[1]);
      } else if (weeks.length === 1 && !selectedCurrentWeek) {
        setSelectedCurrentWeek(weeks[0]);
      }
    } catch (err) {
      console.error('Error loading saved weeks:', err);
    }
  }, [selectedCurrentWeek, selectedPreviousWeek]);

  // Load data from Firebase when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    
    async function loadFromFirebase() {
      setFirebaseLoading(true);
      try {
        // Load feeder lookup
        const lookup = await getFeederLookupFromFirebase();
        if (lookup) {
          setFeederLookup(lookup);
          setAllFeederNames(getAllFeederNames(lookup));
        }
        
        // Load current report
        const current = await getCurrentReport();
        if (current) {
          setReportData(current.data);
          setCurrentDateRange(current.dateRange);
          setSavedCurrentReport(current);
        }
        
        // Load saved weeks
        await loadSavedWeeks();
        
      } catch (err) {
        console.error('Error loading from Firebase:', err);
        showError('Failed to load data from Firebase. Check your connection.');
      } finally {
        setFirebaseLoading(false);
      }
    }
    
    loadFromFirebase();
  }, [isAuthenticated, loadSavedWeeks]);

  // Handle logout
  const handleLogout = () => {
    void logout();
    setReportData([]);
    setFeederLookup({});
    setAllFeederNames([]);
    setSavedWeeks([]);
    setSelectedCurrentWeek(null);
    setSelectedPreviousWeek(null);
  };

  // Clear messages after timeout
  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setError(null);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const showError = (msg: string) => {
    setError(msg);
    setSuccessMessage(null);
    setTimeout(() => setError(null), 5000);
  };

  // Handle feeder lookup upload
  const handleFeederLookupUpload = async () => {
    if (!feederLookupFile) {
      showError('Please select a feeder lookup file');
      return;
    }
    setIsLoading(true);
    try {
      const lookup = await parseFeederLookup(feederLookupFile);
      const feeders = getAllFeederNames(lookup);
      
      // Save to Firebase
      await saveFeederLookupToFirebase(lookup);
      
      setFeederLookup(lookup);
      setAllFeederNames(feeders);
      
      showSuccess(`Loaded and saved ${Object.keys(lookup).length} feeder mappings to Firebase (persists permanently)`);
    } catch (err) {
      showError('Failed to parse feeder lookup file or save to Firebase');
      console.error(err);
    }
    setIsLoading(false);
  };
  
  // Clear saved feeder lookup
  const clearFeederLookup = async () => {
    try {
      await clearFeederLookupFromFirebase();
      setFeederLookup({});
      setAllFeederNames([]);
      setFeederLookupFile(null);
      showSuccess('Feeder lookup cleared from Firebase');
    } catch (err) {
      showError('Failed to clear feeder lookup from Firebase');
      console.error(err);
    }
  };

  // Generate report from asset files
  const generateReport = useCallback(async () => {
    if (!startDate || !endDate) {
      showError('Please select date range');
      return;
    }

    const dtStart = new Date(startDate);
    const dtEnd = new Date(endDate);

    if (dtStart > dtEnd) {
      showError('Start date must be before end date');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Parse all asset files
      const [mappedDT, htPoles, ltPoles, consumerPoints, issueLog] = await Promise.all([
        mappedDTFile ? parseAssetFile(mappedDTFile) : Promise.resolve([]),
        htPolesFile ? parseAssetFile(htPolesFile) : Promise.resolve([]),
        ltPolesFile ? parseAssetFile(ltPolesFile) : Promise.resolve([]),
        consumerPointsFile ? parseAssetFile(consumerPointsFile) : Promise.resolve([]),
        issueLogFile ? parseAssetFile(issueLogFile) : Promise.resolve([]),
      ]);

      // Aggregate data by feeder
      const feederData: Record<string, FeederReportRow> = {};
      const unmatchedIssues: Record<string, UnmatchedFeeder> = {};

      const getOrCreateFeeder = (name: string, rawName: string): FeederReportRow => {
        if (!feederData[name]) {
          feederData[name] = {
            feederName: name,
            rawFeederName: rawName,
            mappedDTWeek: 0,
            mappedDTTotal: 0,
            htPolesWeek: 0,
            htPolesTotal: 0,
            ltPolesWeek: 0,
            ltPolesTotal: 0,
            consumerPointsWeek: 0,
            consumerPointsTotal: 0,
            issueLogWeek: 0,
            issueLogTotal: 0,
          };
        }
        return feederData[name];
      };

      // Process Mapped DT by GIS
      mappedDT.forEach((row) => {
        const { matched, raw } = getFeederFromRow(row, feederLookup, allFeederNames);
        if (!matched) return;
        
        const feederRow = getOrCreateFeeder(matched, raw);
        const time = getTimeFromRow(row);
        const isWeek = isDateInRange(time, dtStart, dtEnd);
        
        feederRow.mappedDTTotal += 1;
        if (isWeek) feederRow.mappedDTWeek += 1;
      });

      // Process HT Poles (combines 11kv and 33kv)
      htPoles.forEach((row) => {
        const { matched, raw } = getFeederFromRow(row, feederLookup, allFeederNames);
        if (!matched) return;
        
        const feederRow = getOrCreateFeeder(matched, raw);
        const time = getTimeFromRow(row);
        const isWeek = isDateInRange(time, dtStart, dtEnd);
        
        feederRow.htPolesTotal += 1;
        if (isWeek) feederRow.htPolesWeek += 1;
      });

      // Process LT Poles
      ltPoles.forEach((row) => {
        const { matched, raw } = getFeederFromRow(row, feederLookup, allFeederNames);
        if (!matched) return;
        
        const feederRow = getOrCreateFeeder(matched, raw);
        const time = getTimeFromRow(row);
        const isWeek = isDateInRange(time, dtStart, dtEnd);
        
        feederRow.ltPolesTotal += 1;
        if (isWeek) feederRow.ltPolesWeek += 1;
      });

      // Process Consumer Points
      consumerPoints.forEach((row) => {
        const { matched, raw } = getFeederFromRow(row, feederLookup, allFeederNames);
        if (!matched) return;
        
        const feederRow = getOrCreateFeeder(matched, raw);
        const time = getTimeFromRow(row);
        const isWeek = isDateInRange(time, dtStart, dtEnd);
        
        feederRow.consumerPointsTotal += 1;
        if (isWeek) feederRow.consumerPointsWeek += 1;
      });

      // Process Issue Log - track unmatched feeders
      issueLog.forEach((row) => {
        const { matched, raw } = getFeederFromRow(row, feederLookup, allFeederNames);
        if (!matched) return;
        
        const time = getTimeFromRow(row);
        const isWeek = isDateInRange(time, dtStart, dtEnd);
        
        if (!isWeek) return;
        
        // Check if feeder is in known feeders list
        const isKnown = allFeederNames.some(f => f.toLowerCase() === matched.toLowerCase());
        
        if (isKnown || Object.keys(feederData).some(f => f.toLowerCase() === matched.toLowerCase())) {
          const feederRow = getOrCreateFeeder(matched, raw);
          feederRow.issueLogTotal += 1;
          feederRow.issueLogWeek += 1;
        } else {
          // Track unmatched for correction
          if (!unmatchedIssues[raw]) {
            unmatchedIssues[raw] = {
              originalName: raw,
              correctedName: '',
              count: 0,
            };
          }
          unmatchedIssues[raw].count += 1;
        }
      });

      const reportRows = Object.values(feederData).sort((a, b) => 
        a.feederName.localeCompare(b.feederName)
      );

      const unmatchedList = Object.values(unmatchedIssues);

      setReportData(reportRows);
      setCurrentDateRange({ start: startDate, end: endDate });
      setUnmatchedFeeders(unmatchedList);
      
      if (unmatchedList.length > 0) {
        setShowCorrectionModal(true);
      }
      
      showSuccess(`Report generated with ${reportRows.length} feeders${unmatchedList.length > 0 ? ` (${unmatchedList.length} unmatched issue log feeders need correction)` : ''}`);
      setActiveTab('report');
    } catch (err) {
      showError('Failed to generate report');
      console.error(err);
    }

    setIsLoading(false);
  }, [startDate, endDate, mappedDTFile, htPolesFile, ltPolesFile, consumerPointsFile, issueLogFile, feederLookup, allFeederNames]);

  // Handle feeder correction from modal
  const handleFeederCorrection = (corrections: UnmatchedFeeder[]) => {
    const newReportData = [...reportData];
    
    corrections.forEach(correction => {
      if (correction.correctedName) {
        const existingRow = newReportData.find(r => r.feederName.toLowerCase() === correction.correctedName.toLowerCase());
        if (existingRow) {
          existingRow.issueLogWeek += correction.count;
          existingRow.issueLogTotal += correction.count;
        } else {
          newReportData.push({
            feederName: correction.correctedName,
            rawFeederName: correction.originalName,
            mappedDTWeek: 0,
            mappedDTTotal: 0,
            htPolesWeek: 0,
            htPolesTotal: 0,
            ltPolesWeek: 0,
            ltPolesTotal: 0,
            consumerPointsWeek: 0,
            consumerPointsTotal: 0,
            issueLogWeek: correction.count,
            issueLogTotal: correction.count,
          });
        }
      }
    });
    
    setReportData(newReportData.sort((a, b) => a.feederName.localeCompare(b.feederName)));
    setUnmatchedFeeders([]);
    setShowCorrectionModal(false);
    showSuccess('Feeder corrections applied');
  };

  // Handle feeder name edit in report table
  const handleFeederNameEdit = (index: number, newFeederName: string) => {
    const newData = [...reportData];
    newData[index] = {
      ...newData[index],
      feederName: newFeederName,
      isEdited: true,
    };
    setReportData(newData);
  };

  // Handle data update from report table
  const handleReportDataUpdate = (newData: FeederReportRow[]) => {
    setReportData(newData);
  };

  // Save current report as "Current Week" with week number prompt
  const saveAsCurrentWeek = async () => {
    if (reportData.length === 0) {
      showError('No report data to save');
      return;
    }
    
    // Prompt for week number
    const weekNumInput = prompt('Enter week number (e.g., 5 for Week 5):');
    if (!weekNumInput) return;
    
    const weekNum = parseInt(weekNumInput.trim(), 10);
    if (isNaN(weekNum) || weekNum < 1 || weekNum > 53) {
      showError('Please enter a valid week number (1-53)');
      return;
    }
    
    try {
      // Check if week already exists
      const exists = await weekExists(weekNum);
      
      if (exists) {
        const confirmOverride = confirm(`Week ${weekNum} already exists. Do you want to override it?`);
        if (!confirmOverride) return;
      } else {
        const confirmSave = confirm(`Save as Week ${weekNum}?`);
        if (!confirmSave) return;
      }
      
      const weekData: SavedWeek = {
        weekNumber: weekNum,
        data: reportData,
        dateRange: currentDateRange,
        savedAt: new Date().toISOString(),
        weekLabel: getWeekLabel(currentDateRange.start, currentDateRange.end),
      };
      
      await saveWeekReport(weekData);
      
      // Also save as current report
      const report: SavedReport = {
        data: reportData,
        dateRange: currentDateRange,
        savedAt: new Date().toISOString(),
        weekLabel: getWeekLabel(currentDateRange.start, currentDateRange.end),
      };
      await saveCurrentReport(report);
      setSavedCurrentReport(report);
      
      // Refresh saved weeks list
      await loadSavedWeeks();
      
      showSuccess(`Report saved as Week ${weekNum}!`);
    } catch (err) {
      showError('Failed to save week report to Firebase');
      console.error(err);
    }
  };

  // Delete a saved week
  const handleDeleteWeek = async (weekNumber: number) => {
    try {
      await deleteWeekReport(weekNumber);
      await loadSavedWeeks();
      showSuccess(`Week ${weekNumber} deleted successfully`);
    } catch (err) {
      showError('Failed to delete week');
      console.error(err);
    }
  };

  // Select week for comparison with role selection
  const handleSelectWeekForComparison = (week: SavedWeek, role: 'current' | 'previous') => {
    if (role === 'current') {
      // Check if this week is older than selected previous week
      if (selectedPreviousWeek && new Date(week.dateRange.end) < new Date(selectedPreviousWeek.dateRange.start)) {
        showError(`Warning: Week ${week.weekNumber} is older than the currently selected previous week. Consider swapping roles.`);
      }
      setSelectedCurrentWeek(week);
      showSuccess(`Selected Week ${week.weekNumber} as Current Week for comparison`);
    } else {
      // Check if this week is newer than selected current week
      if (selectedCurrentWeek && new Date(week.dateRange.start) > new Date(selectedCurrentWeek.dateRange.end)) {
        showError(`Warning: Week ${week.weekNumber} is newer than the currently selected current week. Previous week should be older!`);
      }
      setSelectedPreviousWeek(week);
      showSuccess(`Selected Week ${week.weekNumber} as Previous Week for comparison`);
    }
    setActiveTab('comparison');
  };

  // Export current report
  const exportCurrentReport = () => {
    if (reportData.length === 0) {
      showError('No report data to export');
      return;
    }
    
    const filename = `Feeder_Report_${currentDateRange.start}_to_${currentDateRange.end}.xlsx`;
    exportReportToExcel(reportData, filename, currentDateRange);
    showSuccess('Report exported successfully');
  };

  // Show login if not authenticated
  if (authChecking) {
    return (
      <div className="weekly-root min-h-[calc(100vh-3.5rem)] bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-xl flex items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          Loading...
        </div>
      </div>
    );
  }

  // Show loading while fetching from Firebase
  if (firebaseLoading) {
    return (
      <div className="weekly-root min-h-[calc(100vh-3.5rem)] bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading data from Firebase...</p>
          <p className="text-gray-500 text-sm mt-1">Please wait while we fetch your saved data</p>
        </div>
      </div>
    );
  }

  // Convert selected weeks to SavedReport format for comparison
  const currentReportForComparison: SavedReport | null = selectedCurrentWeek ? {
    data: selectedCurrentWeek.data,
    dateRange: selectedCurrentWeek.dateRange,
    savedAt: selectedCurrentWeek.savedAt,
    weekLabel: `Week ${selectedCurrentWeek.weekNumber}: ${selectedCurrentWeek.weekLabel}`,
  } : null;

  const previousReportForComparison: SavedReport | null = selectedPreviousWeek ? {
    data: selectedPreviousWeek.data,
    dateRange: selectedPreviousWeek.dateRange,
    savedAt: selectedPreviousWeek.savedAt,
    weekLabel: `Week ${selectedPreviousWeek.weekNumber}: ${selectedPreviousWeek.weekLabel}`,
  } : null;

  return (
    <div className="weekly-root min-h-[calc(100vh-3.5rem)] bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* Feeder Correction Modal */}
      {showCorrectionModal && unmatchedFeeders.length > 0 && (
        <FeederCorrectionModal
          unmatchedFeeders={unmatchedFeeders}
          allFeeders={allFeederNames}
          onCorrect={handleFeederCorrection}
          onClose={() => setShowCorrectionModal(false)}
        />
      )}

      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Feeder Capture Dashboard</h1>
                <p className="text-sm text-gray-500">Upload, analyze, and compare feeder capture data</p>
              </div>
            </div>
            
            {/* User info & logout */}
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-700">Welcome, {currentUser}</p>
                <p className="text-xs text-green-600 flex items-center gap-1 justify-end">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  Signed in · shared Firebase
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </div>
          </div>
          
          {/* Tab Navigation */}
          <nav className="flex gap-2 flex-wrap mt-4">
            {[
              { id: 'upload', label: 'Upload & Config', icon: '📁' },
              { id: 'report', label: 'Generated Report', icon: '📊', badge: reportData.length > 0 ? reportData.length : undefined },
              { id: 'previous', label: 'Saved Weeks', icon: '📋', badge: savedWeeks.length > 0 ? savedWeeks.length : undefined },
              { id: 'comparison', label: 'Comparison', icon: '🔄' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab.icon} {tab.label}
                {tab.badge !== undefined && (
                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                    activeTab === tab.id ? 'bg-white/20' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Messages */}
      {(error || successMessage) && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}
          {successMessage && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {successMessage}
            </div>
          )}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="space-y-6">
            {/* Feeder Lookup Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="p-1.5 bg-purple-100 rounded-lg">🔗</span>
                Feeder Lookup (Saved to Firebase Permanently)
              </h2>
              
              {/* Show saved lookup status */}
              {Object.keys(feederLookup).length > 0 ? (
                <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="text-green-800 font-medium flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Feeder Lookup Loaded from Firebase
                      </p>
                      <p className="text-green-600 text-sm mt-1">
                        {Object.keys(feederLookup).length} mappings • {allFeederNames.length} unique feeders • Stored in Cloud
                      </p>
                    </div>
                    <button
                      onClick={clearFeederLookup}
                      className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                    >
                      Clear & Re-upload
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-amber-800 text-sm">
                    ⚠️ No feeder lookup loaded. Upload a lookup file to enable feeder name matching.
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FileUpload
                  label="Feeder Lookup File"
                  description="Map feeder codes to readable names"
                  file={feederLookupFile}
                  onFileSelect={setFeederLookupFile}
                />
                <div className="flex items-end">
                  <button
                    onClick={handleFeederLookupUpload}
                    disabled={!feederLookupFile || isLoading}
                    className="px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isLoading ? 'Loading...' : Object.keys(feederLookup).length > 0 ? 'Update Lookup' : 'Load Lookup'}
                  </button>
                </div>
              </div>
            </div>

            {/* Asset Files Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="p-1.5 bg-blue-100 rounded-lg">📂</span>
                Asset Files (Upload Separately)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FileUpload
                  label="Mapped DT by GIS"
                  description="Distribution Transformer mapping data"
                  file={mappedDTFile}
                  onFileSelect={setMappedDTFile}
                />
                <FileUpload
                  label="HT Poles"
                  description="High Tension poles (11kv + 33kv combined)"
                  file={htPolesFile}
                  onFileSelect={setHtPolesFile}
                />
                <FileUpload
                  label="LT Poles"
                  description="Low Tension poles data"
                  file={ltPolesFile}
                  onFileSelect={setLtPolesFile}
                />
                <FileUpload
                  label="Consumer Points Captured"
                  description="Consumer enumeration data"
                  file={consumerPointsFile}
                  onFileSelect={setConsumerPointsFile}
                />
                <FileUpload
                  label="Issue Log"
                  description="Reported issues data"
                  file={issueLogFile}
                  onFileSelect={setIssueLogFile}
                />
              </div>
            </div>

            {/* Date Range & Generate Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="p-1.5 bg-green-100 rounded-lg">📅</span>
                Date Range & Generate Report
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    onClick={generateReport}
                    disabled={isLoading}
                    className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Generating...
                      </span>
                    ) : (
                      '🚀 Generate Report'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Generated Report Tab */}
        {activeTab === 'report' && (
          <div className="space-y-6">
            {/* Action buttons */}
            {reportData.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-gray-800">
                      Generated Report: {currentDateRange.start && getWeekLabel(currentDateRange.start, currentDateRange.end)}
                    </h3>
                    <p className="text-sm text-gray-500">{reportData.length} feeders captured</p>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <button
                      onClick={saveAsCurrentWeek}
                      className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-medium hover:from-indigo-700 hover:to-purple-700 transition-all shadow-md hover:shadow-lg flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      💾 Save as Current Week
                    </button>
                    <button
                      onClick={exportCurrentReport}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Export Excel
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            <SummaryCards data={reportData} />
            
            <ReportTable 
              data={reportData} 
              title="Generated Feeder Summary Report"
              allFeeders={allFeederNames}
              onFeederNameEdit={handleFeederNameEdit}
              onDataUpdate={handleReportDataUpdate}
              editable={true}
            />
            
            {unmatchedFeeders.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h3 className="text-amber-800 font-semibold mb-2">⚠️ Unmatched Issue Log Feeders</h3>
                <p className="text-amber-700 text-sm mb-3">
                  {unmatchedFeeders.length} feeders from Issue Log could not be matched. Click below to correct them.
                </p>
                <button
                  onClick={() => setShowCorrectionModal(true)}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                >
                  Correct Feeder Names
                </button>
              </div>
            )}
          </div>
        )}

        {/* Saved Weeks Tab (Previously "Previous Week") */}
        {activeTab === 'previous' && (
          <SavedWeeksManager
            savedWeeks={savedWeeks}
            allFeeders={allFeederNames}
            onDelete={handleDeleteWeek}
            onRefresh={loadSavedWeeks}
            onSelectForComparison={handleSelectWeekForComparison}
            currentWeekForComparison={selectedCurrentWeek}
            previousWeekForComparison={selectedPreviousWeek}
          />
        )}

        {/* Comparison Tab */}
        {activeTab === 'comparison' && (
          <div className="space-y-6">
            {/* Week Selection for Comparison */}
            {savedWeeks.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <h3 className="font-semibold text-gray-800 mb-4">Select Weeks to Compare</h3>
                
                {/* Date Validation Warning */}
                {selectedCurrentWeek && selectedPreviousWeek && 
                  new Date(selectedPreviousWeek.dateRange.start) > new Date(selectedCurrentWeek.dateRange.end) && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>
                      <strong>Warning:</strong> Previous week ({new Date(selectedPreviousWeek.dateRange.start).toLocaleDateString()}) is newer than Current week ({new Date(selectedCurrentWeek.dateRange.end).toLocaleDateString()})! 
                      Previous week should be older than Current week.
                    </span>
                  </div>
                )}
                
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Current Week Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">📊 Current Week (Newer):</label>
                    <select
                      value={selectedCurrentWeek?.weekNumber || ''}
                      onChange={(e) => {
                        const weekNum = parseInt(e.target.value, 10);
                        const week = savedWeeks.find(w => w.weekNumber === weekNum);
                        if (week) setSelectedCurrentWeek(week);
                      }}
                      className="w-full px-4 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-green-50"
                    >
                      <option value="">-- Select current week --</option>
                      {savedWeeks.map(week => (
                        <option key={week.weekNumber} value={week.weekNumber}>
                          Week {week.weekNumber}: {week.weekLabel}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Previous Week Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">📅 Previous Week (Older):</label>
                    <select
                      value={selectedPreviousWeek?.weekNumber || ''}
                      onChange={(e) => {
                        const weekNum = parseInt(e.target.value, 10);
                        const week = savedWeeks.find(w => w.weekNumber === weekNum);
                        if (week) setSelectedPreviousWeek(week);
                      }}
                      className="w-full px-4 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-purple-50"
                    >
                      <option value="">-- Select previous week --</option>
                      {savedWeeks.map(week => (
                        <option key={week.weekNumber} value={week.weekNumber}>
                          Week {week.weekNumber}: {week.weekLabel}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
            
            <ComparisonView
              currentReport={currentReportForComparison?.data || savedCurrentReport?.data || reportData}
              currentDateRange={currentReportForComparison?.dateRange || savedCurrentReport?.dateRange || currentDateRange}
              currentWeekLabel={currentReportForComparison?.weekLabel || savedCurrentReport?.weekLabel}
              previousReport={previousReportForComparison}
              onExport={(data, filename) => {
                exportReportToExcel(data, filename, currentDateRange);
                showSuccess('Comparison report exported');
              }}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-8">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500">
            Feeder Capture Dashboard • Data stored securely in Firebase • Built for efficient asset data management
          </p>
        </div>
      </footer>
    </div>
  );
}
