import { useState } from 'react';
import type { FeederReportRow } from '@/lib/weekly/types';

interface ReportTableProps {
  data: FeederReportRow[];
  title: string;
  allFeeders?: string[];
  onFeederNameEdit?: (index: number, newFeederName: string) => void;
  onDataUpdate?: (newData: FeederReportRow[]) => void;
  editable?: boolean;
}

export function ReportTable({ 
  data, 
  title, 
  allFeeders = [],
  onFeederNameEdit,
  onDataUpdate,
  editable = false 
}: ReportTableProps) {
  const [editingFeeder, setEditingFeeder] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; field: keyof FeederReportRow } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const totalWeek = {
    mappedDT: data.reduce((sum, r) => sum + r.mappedDTWeek, 0),
    htPoles: data.reduce((sum, r) => sum + r.htPolesWeek, 0),
    ltPoles: data.reduce((sum, r) => sum + r.ltPolesWeek, 0),
    consumerPoints: data.reduce((sum, r) => sum + r.consumerPointsWeek, 0),
    issueLog: data.reduce((sum, r) => sum + r.issueLogWeek, 0),
  };

  const totalAll = {
    mappedDT: data.reduce((sum, r) => sum + r.mappedDTTotal, 0),
    htPoles: data.reduce((sum, r) => sum + r.htPolesTotal, 0),
    ltPoles: data.reduce((sum, r) => sum + r.ltPolesTotal, 0),
    consumerPoints: data.reduce((sum, r) => sum + r.consumerPointsTotal, 0),
    issueLog: data.reduce((sum, r) => sum + r.issueLogTotal, 0),
  };

  const handleFeederEdit = (index: number, newName: string) => {
    if (!onDataUpdate) {
      if (onFeederNameEdit) {
        onFeederNameEdit(index, newName);
      }
      setEditingFeeder(null);
      setSearchTerm('');
      return;
    }

    const currentRow = data[index];
    
    // Check if there's already a row with this feeder name (excluding current row)
    const existingIndex = data.findIndex((row, i) => 
      i !== index && row.feederName.toLowerCase().trim() === newName.toLowerCase().trim()
    );

    if (existingIndex !== -1 && existingIndex !== index) {
      // Merge the rows - sum all numeric values
      const existingRow = data[existingIndex];
      const mergedRow: FeederReportRow = {
        feederName: newName,
        rawFeederName: existingRow.rawFeederName,
        mappedDTWeek: (existingRow.mappedDTWeek || 0) + (currentRow.mappedDTWeek || 0),
        mappedDTTotal: (existingRow.mappedDTTotal || 0) + (currentRow.mappedDTTotal || 0),
        htPolesWeek: (existingRow.htPolesWeek || 0) + (currentRow.htPolesWeek || 0),
        htPolesTotal: (existingRow.htPolesTotal || 0) + (currentRow.htPolesTotal || 0),
        ltPolesWeek: (existingRow.ltPolesWeek || 0) + (currentRow.ltPolesWeek || 0),
        ltPolesTotal: (existingRow.ltPolesTotal || 0) + (currentRow.ltPolesTotal || 0),
        consumerPointsWeek: (existingRow.consumerPointsWeek || 0) + (currentRow.consumerPointsWeek || 0),
        consumerPointsTotal: (existingRow.consumerPointsTotal || 0) + (currentRow.consumerPointsTotal || 0),
        issueLogWeek: (existingRow.issueLogWeek || 0) + (currentRow.issueLogWeek || 0),
        issueLogTotal: (existingRow.issueLogTotal || 0) + (currentRow.issueLogTotal || 0),
        isEdited: true
      };

      // Create new data array: remove the current row and update the existing one with merged data
      const newData = data.filter((_, i) => i !== index);
      const adjustedExistingIndex = existingIndex > index ? existingIndex - 1 : existingIndex;
      newData[adjustedExistingIndex] = mergedRow;
      
      onDataUpdate(newData);
    } else {
      // No merge needed, just update the feeder name
      const newData = [...data];
      newData[index] = {
        ...newData[index],
        feederName: newName,
        isEdited: true
      };
      onDataUpdate(newData);
    }
    
    setEditingFeeder(null);
    setSearchTerm('');
  };

  const handleCellEdit = (row: number, field: keyof FeederReportRow, value: number | string) => {
    setEditingCell({ row, field });
    setEditValue(String(value));
  };

  const saveCellEdit = () => {
    if (!editingCell || !onDataUpdate) return;
    
    const newData = [...data];
    const { row, field } = editingCell;
    
    const numericFields: (keyof FeederReportRow)[] = [
      'mappedDTWeek', 'mappedDTTotal', 'htPolesWeek', 'htPolesTotal',
      'ltPolesWeek', 'ltPolesTotal', 'consumerPointsWeek', 'consumerPointsTotal',
      'issueLogWeek', 'issueLogTotal'
    ];
    
    if (numericFields.includes(field)) {
      const rowData = newData[row];
      switch (field) {
        case 'mappedDTWeek': rowData.mappedDTWeek = Number(editValue) || 0; break;
        case 'mappedDTTotal': rowData.mappedDTTotal = Number(editValue) || 0; break;
        case 'htPolesWeek': rowData.htPolesWeek = Number(editValue) || 0; break;
        case 'htPolesTotal': rowData.htPolesTotal = Number(editValue) || 0; break;
        case 'ltPolesWeek': rowData.ltPolesWeek = Number(editValue) || 0; break;
        case 'ltPolesTotal': rowData.ltPolesTotal = Number(editValue) || 0; break;
        case 'consumerPointsWeek': rowData.consumerPointsWeek = Number(editValue) || 0; break;
        case 'consumerPointsTotal': rowData.consumerPointsTotal = Number(editValue) || 0; break;
        case 'issueLogWeek': rowData.issueLogWeek = Number(editValue) || 0; break;
        case 'issueLogTotal': rowData.issueLogTotal = Number(editValue) || 0; break;
      }
    }
    
    onDataUpdate(newData);
    setEditingCell(null);
    setEditValue('');
  };

  const getFilteredFeeders = () => {
    if (!searchTerm) return allFeeders.slice(0, 20);
    return allFeeders.filter(f => 
      f.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 20);
  };

  // Check if a feeder name already exists in the data (for merge indication)
  const feederExistsInData = (feederName: string, excludeIndex: number): boolean => {
    return data.some((row, i) => 
      i !== excludeIndex && row.feederName.toLowerCase().trim() === feederName.toLowerCase().trim()
    );
  };

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
        <p className="text-gray-500 text-center py-8">No data available. Upload asset files and generate report.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        <p className="text-sm text-gray-500 mt-1">
          Showing {data.length} feeders • All 11KV and 33KV data combined by feeder name
        </p>
        {editable && (
          <p className="text-xs text-blue-600 mt-1">
            💡 Click feeder name to edit. Selecting an existing feeder will merge values automatically.
          </p>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-semibold text-gray-700 sticky left-0 bg-gray-50 min-w-[350px] z-10">
                Feeder Name
                {editable && <span className="text-xs font-normal text-gray-400 ml-2">(click to edit)</span>}
              </th>
              <th className="text-center px-4 py-3 font-semibold text-blue-700 bg-blue-50">Mapped DT (Week)</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-700">Mapped DT (Total)</th>
              <th className="text-center px-4 py-3 font-semibold text-green-700 bg-green-50">HT Poles (Week)</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-700">HT Poles (Total)</th>
              <th className="text-center px-4 py-3 font-semibold text-orange-700 bg-orange-50">LT Poles (Week)</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-700">LT Poles (Total)</th>
              <th className="text-center px-4 py-3 font-semibold text-pink-700 bg-pink-50">Consumer Pts (Week)</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-700">Consumer Pts (Total)</th>
              <th className="text-center px-4 py-3 font-semibold text-red-700 bg-red-50">Issue Log (Week)</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-700">Issue Log (Total)</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={`${row.feederName}-${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className={`px-4 py-3 font-medium text-gray-900 sticky left-0 z-10 min-w-[350px] ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  {editingFeeder === idx ? (
                    <div className="space-y-2 bg-white p-2 rounded-lg shadow-lg border border-blue-200">
                      <input
                        type="text"
                        placeholder="Search feeders..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        autoFocus
                      />
                      <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg">
                        {/* Keep current option */}
                        <div
                          onClick={() => handleFeederEdit(idx, row.feederName)}
                          className="px-3 py-2 bg-yellow-50 border-b border-gray-200 cursor-pointer hover:bg-yellow-100"
                        >
                          <div className="text-xs text-gray-500 mb-1">Keep current:</div>
                          <div className="font-medium text-gray-800 break-all">{row.feederName}</div>
                        </div>
                        
                        {/* Lookup options */}
                        {getFilteredFeeders().filter(f => f !== row.feederName).map(f => {
                          const willMerge = feederExistsInData(f, idx);
                          return (
                            <div
                              key={f}
                              onClick={() => handleFeederEdit(idx, f)}
                              className={`px-3 py-2 cursor-pointer border-b border-gray-100 hover:bg-blue-50 ${
                                willMerge ? 'bg-green-50 border-l-4 border-l-green-400' : ''
                              }`}
                            >
                              <div className="break-all">{f}</div>
                              {willMerge && (
                                <div className="text-xs text-green-600 mt-1 font-medium">
                                  ⚡ Will merge with existing feeder
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => { setEditingFeeder(null); setSearchTerm(''); }}
                        className="w-full px-3 py-2 text-sm bg-gray-200 rounded-lg hover:bg-gray-300 font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div 
                      className={`flex items-start gap-2 ${editable ? 'cursor-pointer hover:text-blue-600 group' : ''}`}
                      onClick={() => editable && setEditingFeeder(idx)}
                      title={row.rawFeederName !== row.feederName ? `Original: ${row.rawFeederName}` : row.feederName}
                    >
                      <span className="break-all leading-relaxed flex-1">{row.feederName}</span>
                      <div className="flex gap-1 flex-shrink-0 pt-0.5">
                        {row.isEdited && (
                          <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded whitespace-nowrap">edited</span>
                        )}
                        {row.rawFeederName !== row.feederName && !row.isEdited && (
                          <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded whitespace-nowrap">matched</span>
                        )}
                        {editable && (
                          <span className="px-1.5 py-0.5 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                        )}
                      </div>
                    </div>
                  )}
                </td>
                {renderEditableCell(idx, 'mappedDTWeek', row.mappedDTWeek, 'bg-blue-50/50', 'text-blue-600')}
                {renderEditableCell(idx, 'mappedDTTotal', row.mappedDTTotal, '', 'text-gray-600')}
                {renderEditableCell(idx, 'htPolesWeek', row.htPolesWeek, 'bg-green-50/50', 'text-green-600')}
                {renderEditableCell(idx, 'htPolesTotal', row.htPolesTotal, '', 'text-gray-600')}
                {renderEditableCell(idx, 'ltPolesWeek', row.ltPolesWeek, 'bg-orange-50/50', 'text-orange-600')}
                {renderEditableCell(idx, 'ltPolesTotal', row.ltPolesTotal, '', 'text-gray-600')}
                {renderEditableCell(idx, 'consumerPointsWeek', row.consumerPointsWeek, 'bg-pink-50/50', 'text-pink-600')}
                {renderEditableCell(idx, 'consumerPointsTotal', row.consumerPointsTotal, '', 'text-gray-600')}
                {renderEditableCell(idx, 'issueLogWeek', row.issueLogWeek, 'bg-red-50/50', 'text-red-600')}
                {renderEditableCell(idx, 'issueLogTotal', row.issueLogTotal, '', 'text-gray-600')}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
              <td className="px-4 py-3 text-gray-800 sticky left-0 bg-gray-100 z-10">TOTAL</td>
              <td className="text-center px-4 py-3 text-blue-700">{totalWeek.mappedDT}</td>
              <td className="text-center px-4 py-3 text-gray-700">{totalAll.mappedDT}</td>
              <td className="text-center px-4 py-3 text-green-700">{totalWeek.htPoles}</td>
              <td className="text-center px-4 py-3 text-gray-700">{totalAll.htPoles}</td>
              <td className="text-center px-4 py-3 text-orange-700">{totalWeek.ltPoles}</td>
              <td className="text-center px-4 py-3 text-gray-700">{totalAll.ltPoles}</td>
              <td className="text-center px-4 py-3 text-pink-700">{totalWeek.consumerPoints}</td>
              <td className="text-center px-4 py-3 text-gray-700">{totalAll.consumerPoints}</td>
              <td className="text-center px-4 py-3 text-red-700">{totalWeek.issueLog}</td>
              <td className="text-center px-4 py-3 text-gray-700">{totalAll.issueLog}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  function renderEditableCell(
    rowIndex: number, 
    field: keyof FeederReportRow, 
    value: number, 
    bgClass: string, 
    textClass: string
  ) {
    const isEditing = editingCell?.row === rowIndex && editingCell?.field === field;
    
    if (isEditing) {
      return (
        <td className={`text-center px-4 py-3 ${bgClass}`}>
          <input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={saveCellEdit}
            onKeyDown={(e) => e.key === 'Enter' && saveCellEdit()}
            className="w-20 px-2 py-1 text-center border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
        </td>
      );
    }
    
    return (
      <td 
        className={`text-center px-4 py-3 ${bgClass} ${textClass} ${editable ? 'cursor-pointer hover:bg-blue-100' : ''} font-semibold`}
        onClick={() => editable && handleCellEdit(rowIndex, field, value)}
      >
        {value}
      </td>
    );
  }
}
