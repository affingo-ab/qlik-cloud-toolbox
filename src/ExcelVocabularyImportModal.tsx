import React, { useState, useRef } from 'react';
import { parseVocabularyExcel } from './excelVocabularyParser';
import type { VocabularyItem } from './excelVocabularyParser';
import { Upload, X, FileSpreadsheet, RefreshCw, AlertCircle, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (importedItems: VocabularyItem[], mode: 'replace' | 'merge') => void;
  existingCount: number;
}

export const ExcelVocabularyImportModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onImport,
  existingCount,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (selectedFile: File | null) => {
    if (!selectedFile) return;
    if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
      setError('Vänligen välj en giltig Excel-fil (.xlsx eller .xls)');
      return;
    }
    setError(null);
    setFile(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleExecuteImport = async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);

    const result = await parseVocabularyExcel(file);
    setIsProcessing(false);

    if (result.success && result.data.length > 0) {
      onImport(result.data, importMode);
      onClose();
    } else {
      setError(result.error || 'Inga giltiga fält eller termer hittades i filen.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
            <h3 className="font-semibold text-white text-base">
              Läs in Excel-ordbok (.xlsx)
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-emerald-500 bg-emerald-950/20'
                : 'border-slate-700 hover:border-slate-600 bg-slate-950/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            />
            <Upload className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
            {file ? (
              <div>
                <p className="font-medium text-emerald-300 text-sm">{file.name}</p>
                <p className="text-xs text-slate-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-slate-300">
                  Dra & släpp din Excel-fil här, eller klicka för att välja
                </p>
                <p className="text-xs text-slate-500 mt-1">Stödjer .xlsx exporterad från Qlik Sense</p>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-950/40 border border-rose-800 text-rose-300 text-xs rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Import Strategy */}
          {existingCount > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Import-strategi (Du har {existingCount} inlästa termer)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={`p-3 rounded-xl border text-left text-xs transition cursor-pointer ${
                    importMode === 'merge'
                      ? 'border-emerald-500 bg-emerald-950/30 text-emerald-300 font-semibold'
                      : 'border-slate-800 text-slate-400 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Slå ihop (Merge)</span>
                  </div>
                  <span className="block text-[11px] text-slate-500 font-normal">
                    Behåll befintliga och addera nya synonymer
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`p-3 rounded-xl border text-left text-xs transition cursor-pointer ${
                    importMode === 'replace'
                      ? 'border-amber-500 bg-amber-950/30 text-amber-300 font-semibold'
                      : 'border-slate-800 text-slate-400 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Ersätt allt</span>
                  </div>
                  <span className="block text-[11px] text-slate-500 font-normal">
                    Töm listan och ersätt helt med filen
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-slate-400 hover:text-white rounded-xl transition cursor-pointer"
          >
            Avbryt
          </button>
          <button
            onClick={handleExecuteImport}
            disabled={!file || isProcessing}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow transition flex items-center gap-1.5 cursor-pointer"
          >
            {isProcessing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {isProcessing ? 'Läser in...' : 'Läs in ordbok'}
          </button>
        </div>
      </div>
    </div>
  );
};