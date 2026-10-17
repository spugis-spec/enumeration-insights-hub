import { useRef } from 'react';
import { cn } from '@/lib/weekly/cn';

interface FileUploadProps {
  label: string;
  file: File | null;
  onFileSelect: (file: File | null) => void;
  accept?: string;
  className?: string;
  description?: string;
}

export function FileUpload({ 
  label, 
  file, 
  onFileSelect, 
  accept = '.xlsx,.xls,.csv',
  className,
  description 
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    onFileSelect(selectedFile);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFileSelect(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div className={cn('space-y-1', className)}>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      <div
        onClick={handleClick}
        className={cn(
          'relative flex items-center justify-between px-4 py-3 rounded-lg border-2 border-dashed cursor-pointer transition-all',
          file 
            ? 'border-green-400 bg-green-50' 
            : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />
        <div className="flex items-center gap-3">
          {file ? (
            <>
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-green-700 font-medium truncate max-w-[200px]">{file.name}</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span className="text-sm text-gray-500">Click to upload</span>
            </>
          )}
        </div>
        {file && (
          <button
            onClick={handleClear}
            className="p-1 rounded-full hover:bg-red-100 text-red-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
