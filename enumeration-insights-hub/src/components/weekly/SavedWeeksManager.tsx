import { useState } from 'react';
import type { SavedWeek } from '@/lib/weekly/types';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { ReportTable } from './ReportTable';
import { exportReportToExcel } from '@/lib/weekly/excelUtils';

interface SavedWeeksManagerProps {
  savedWeeks: SavedWeek[];
  allFeeders: string[];
  onDelete: (weekNumber: number) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelectForComparison: (week: SavedWeek, role: 'current' | 'previous') => void;
  currentWeekForComparison?: SavedWeek | null;
  previousWeekForComparison?: SavedWeek | null;
}

export function SavedWeeksManager({
  savedWeeks,
  allFeeders,
  onDelete,
  onRefresh,
  onSelectForComparison,
  currentWeekForComparison,
  previousWeekForComparison,
}: SavedWeeksManagerProps) {
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [deletingWeek, setDeletingWeek] = useState<number | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showComparisonModal, setShowComparisonModal] = useState<SavedWeek | null>(null);

  const handleDeleteClick = (weekNumber: number) => {
    setDeletingWeek(weekNumber);
    setDeletePassword('');
    setDeleteError('');
  };

  const handleDeleteConfirm = async () => {
    if (!deletingWeek) return;
    
    setDeleteError('');
    setIsDeleting(true);
    
    try {
      const fbUser = getFirebaseAuth().currentUser;
      if (!fbUser?.email) {
        setDeleteError('You must be logged in to delete weeks');
        setIsDeleting(false);
        return;
      }

      let isValid = true;
      try {
        await reauthenticateWithCredential(fbUser, EmailAuthProvider.credential(fbUser.email, deletePassword));
      } catch {
        isValid = false;
      }
      
      if (!isValid) {
        setDeleteError('Incorrect password. Delete cancelled.');
        setIsDeleting(false);
        return;
      }

      await onDelete(deletingWeek);
      await onRefresh();
      
      setDeletingWeek(null);
      setDeletePassword('');
    } catch (err) {
      console.error('Delete error:', err);
      setDeleteError('Failed to delete. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setDeletingWeek(null);
    setDeletePassword('');
    setDeleteError('');
  };

  const handleExportWeek = (week: SavedWeek) => {
    const filename = `Week_${week.weekNumber}_Report_${week.dateRange.start}_to_${week.dateRange.end}.xlsx`;
    exportReportToExcel(week.data, filename, week.dateRange);
  };

  const handleSelectForComparison = (week: SavedWeek, role: 'current' | 'previous') => {
    onSelectForComparison(week, role);
    setShowComparisonModal(null);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatShortDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric'
    });
  };

  if (savedWeeks.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <div className="text-gray-400 mb-4">
          <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Saved Weeks</h3>
        <p className="text-gray-500">
          Generate a report and click "💾 Save as Current Week" to save it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Comparison Selection Modal */}
      {showComparisonModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-3">
                <span className="text-2xl">🔄</span>
              </div>
              <h3 className="text-lg font-bold text-gray-800">Use for Comparison</h3>
              <p className="text-gray-600 text-sm mt-1">
                Use Week {showComparisonModal.weekNumber} ({formatShortDate(showComparisonModal.dateRange.start)} - {formatShortDate(showComparisonModal.dateRange.end)}) as:
              </p>
            </div>

            <div className="space-y-3 mb-4">
              <button
                onClick={() => handleSelectForComparison(showComparisonModal, 'current')}
                className="w-full px-4 py-4 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg font-medium hover:from-green-600 hover:to-emerald-600 transition-all flex items-center justify-center gap-2"
              >
                <span className="text-xl">📊</span>
                <div className="text-left">
                  <div className="font-semibold">Current Week</div>
                  <div className="text-xs opacity-80">Use as the current/newer week</div>
                </div>
              </button>
              
              <button
                onClick={() => handleSelectForComparison(showComparisonModal, 'previous')}
                className="w-full px-4 py-4 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-lg font-medium hover:from-purple-600 hover:to-indigo-600 transition-all flex items-center justify-center gap-2"
              >
                <span className="text-xl">📅</span>
                <div className="text-left">
                  <div className="font-semibold">Previous Week</div>
                  <div className="text-xs opacity-80">Use as the previous/older week</div>
                </div>
              </button>
            </div>

            <button
              onClick={() => setShowComparisonModal(null)}
              className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingWeek !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <div className="text-center mb-4">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-red-100 rounded-full mb-3">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-800">Delete Week {deletingWeek}?</h3>
              <p className="text-gray-600 text-sm mt-1">
                Enter your password to confirm deletion. This action cannot be undone.
              </p>
            </div>

            {deleteError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">
                {deleteError}
              </div>
            )}

            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 mb-4"
              disabled={isDeleting}
            />

            <div className="flex gap-3">
              <button
                onClick={handleCancelDelete}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={isDeleting || !deletePassword}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Deleting...
                  </>
                ) : (
                  '🗑️ Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Currently Selected for Comparison */}
      {(currentWeekForComparison || previousWeekForComparison) && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-4 mb-4">
          <h3 className="font-semibold text-blue-800 mb-3 flex items-center gap-2">
            <span>🔄</span> Selected for Comparison
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div className={`p-3 rounded-lg ${currentWeekForComparison ? 'bg-green-100 border border-green-300' : 'bg-gray-100 border border-gray-300'}`}>
              <div className="text-sm font-medium text-gray-600">Current Week:</div>
              {currentWeekForComparison ? (
                <div className="font-semibold text-green-800">
                  Week {currentWeekForComparison.weekNumber} ({formatShortDate(currentWeekForComparison.dateRange.start)} - {formatShortDate(currentWeekForComparison.dateRange.end)})
                </div>
              ) : (
                <div className="text-gray-500 italic">Not selected</div>
              )}
            </div>
            <div className={`p-3 rounded-lg ${previousWeekForComparison ? 'bg-purple-100 border border-purple-300' : 'bg-gray-100 border border-gray-300'}`}>
              <div className="text-sm font-medium text-gray-600">Previous Week:</div>
              {previousWeekForComparison ? (
                <div className="font-semibold text-purple-800">
                  Week {previousWeekForComparison.weekNumber} ({formatShortDate(previousWeekForComparison.dateRange.start)} - {formatShortDate(previousWeekForComparison.dateRange.end)})
                </div>
              ) : (
                <div className="text-gray-500 italic">Not selected</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Week Cards */}
      <div className="grid gap-4">
        {savedWeeks.sort((a, b) => b.weekNumber - a.weekNumber).map((week) => (
          <div
            key={week.weekNumber}
            className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            {/* Card Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-gray-200">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-600 rounded-lg text-white font-bold text-lg">
                    W{week.weekNumber}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800 text-lg">Week {week.weekNumber}</h3>
                    <p className="text-sm text-gray-600">
                      📅 {formatDate(week.dateRange.start)} - {formatDate(week.dateRange.end)}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {week.data.length} feeders • Saved: {new Date(week.savedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setShowComparisonModal(week)}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-1"
                  >
                    🔄 Use for Comparison
                  </button>
                  <button
                    onClick={() => setExpandedWeek(expandedWeek === week.weekNumber ? null : week.weekNumber)}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors flex items-center gap-1"
                  >
                    {expandedWeek === week.weekNumber ? '▲ Hide' : '▼ View Details'}
                  </button>
                  <button
                    onClick={() => handleDeleteClick(week.weekNumber)}
                    className="px-3 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors flex items-center gap-1"
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            </div>

            {/* Expanded Details */}
            {expandedWeek === week.weekNumber && (
              <div className="p-4">
                {/* Export Button */}
                <div className="mb-4 flex justify-end">
                  <button
                    onClick={() => handleExportWeek(week)}
                    className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg font-medium hover:from-green-600 hover:to-emerald-600 transition-all flex items-center gap-2 shadow-md"
                  >
                    📥 Export to Excel
                  </button>
                </div>
                
                <ReportTable
                  data={week.data}
                  title={`Week ${week.weekNumber} Report (${formatShortDate(week.dateRange.start)} - ${formatShortDate(week.dateRange.end)})`}
                  allFeeders={allFeeders}
                  editable={false}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
