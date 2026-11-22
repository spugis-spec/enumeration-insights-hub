import { useState } from 'react';
import type { UnmatchedFeeder } from '@/lib/weekly/types';

interface FeederCorrectionModalProps {
  unmatchedFeeders: UnmatchedFeeder[];
  allFeeders: string[];
  onCorrect: (corrections: UnmatchedFeeder[]) => void;
  onClose: () => void;
}

export function FeederCorrectionModal({
  unmatchedFeeders,
  allFeeders,
  onCorrect,
  onClose,
}: FeederCorrectionModalProps) {
  const [corrections, setCorrections] = useState<UnmatchedFeeder[]>(
    unmatchedFeeders.map(f => ({ ...f }))
  );
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});

  const handleCorrectionChange = (index: number, correctedName: string) => {
    const newCorrections = [...corrections];
    newCorrections[index].correctedName = correctedName;
    setCorrections(newCorrections);
  };

  const handleSearchChange = (originalName: string, term: string) => {
    setSearchTerms(prev => ({ ...prev, [originalName]: term }));
  };

  const getFilteredFeeders = (originalName: string) => {
    const term = (searchTerms[originalName] || '').toLowerCase();
    if (!term) return allFeeders.slice(0, 20); // Show first 20 by default
    return allFeeders.filter(f => f.toLowerCase().includes(term)).slice(0, 20);
  };

  const handleSubmit = () => {
    onCorrect(corrections);
  };

  const handleSkip = () => {
    // Mark all as skipped (no correction)
    const skipped = corrections.map(c => ({ ...c, correctedName: '' }));
    onCorrect(skipped);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-800">⚠️ Feeder Name Correction Required</h2>
              <p className="text-sm text-gray-600 mt-1">
                The following Issue Log feeders could not be matched to known feeders. Please select the correct feeder name.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {corrections.map((feeder, index) => (
              <div key={feeder.originalName} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-sm font-medium">
                        Original: {feeder.originalName}
                      </span>
                      <span className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-sm">
                        {feeder.count} record{feeder.count > 1 ? 's' : ''}
                      </span>
                    </div>
                    
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Search feeders..."
                        value={searchTerms[feeder.originalName] || ''}
                        onChange={(e) => handleSearchChange(feeder.originalName, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      
                      <select
                        value={feeder.correctedName}
                        onChange={(e) => handleCorrectionChange(index, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">-- Select correct feeder --</option>
                        {getFilteredFeeders(feeder.originalName).map(f => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </div>
                    
                    {feeder.correctedName && (
                      <p className="mt-2 text-sm text-green-600">
                        ✓ Will be corrected to: <strong>{feeder.correctedName}</strong>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between gap-4">
          <button
            onClick={handleSkip}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium transition-colors"
          >
            Skip All (Don't correct)
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Apply Corrections
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
