import React, { useState } from 'react';
import { ShieldCheck, Sparkles, X, CheckSquare, Square, AlertCircle } from 'lucide-react';
import type { SanitizedItem } from './sanitizer';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  items: SanitizedItem[];
  onConfirm: (selectedItems: SanitizedItem[], domain: string) => void;
  isGenerating: boolean;
}

export const AiSanitizePreviewModal: React.FC<Props> = ({
  isOpen,
  onClose,
  items,
  onConfirm,
  isGenerating,
}) => {
  const [selectedIndices, setSelectedIndices] = useState<number[]>(() => items.map((_, i) => i));
  const [domain, setDomain] = useState('Bryggeri, Tillverkning & Försäljning');

  if (!isOpen) return null;

  const toggleSelectAll = () => {
    if (selectedIndices.length === items.length) {
      setSelectedIndices([]);
    } else {
      setSelectedIndices(items.map((_, i) => i));
    }
  };

  const toggleItem = (index: number) => {
    if (selectedIndices.includes(index)) {
      setSelectedIndices(selectedIndices.filter(i => i !== index));
    } else {
      setSelectedIndices([...selectedIndices, index]);
    }
  };

  const handleExecute = () => {
    const itemsToSend = items.filter((_, i) => selectedIndices.includes(i));
    onConfirm(itemsToSend, domain);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden text-slate-100 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base">
                Säkerhetsgranskning före AI-anrop
              </h3>
              <p className="text-xs text-slate-400">Verifiera sanerad metadata som skickas till LLM</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          
          {/* Info Banner */}
          <div className="flex items-start gap-3 p-3.5 bg-emerald-950/20 border border-emerald-800/40 rounded-xl text-emerald-300 text-xs leading-relaxed">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <div>
              <strong>100% Dataminimering:</strong> Inga transaktioner, personuppgifter eller kunddata skickas. Tekniska prefix och systemkoder har rensats bort automatiskt.
            </div>
          </div>

          {/* Bransch / Domän */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Affärskontext / Bransch (Hjälper AI att välja rätt synonymer)
            </label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="t.ex. Tillverkning, Försäljning, Ekonomi..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Fältlista */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Fält att analysera ({selectedIndices.length} av {items.length} valda)
              </label>
              <button
                onClick={toggleSelectAll}
                className="text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer"
              >
                {selectedIndices.length === items.length ? 'Avmarkera alla' : 'Välj alla'}
              </button>
            </div>

            <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/60 max-h-60 overflow-y-auto bg-slate-950/50">
              {items.map((item, index) => {
                const isSelected = selectedIndices.includes(index);
                return (
                  <div
                    key={item.originalName}
                    onClick={() => toggleItem(index)}
                    className={`p-3 flex items-center justify-between text-xs transition cursor-pointer ${
                      isSelected ? 'bg-slate-800/40 hover:bg-slate-800/60' : 'opacity-40 hover:opacity-75'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600 shrink-0" />
                      )}
                      <div className="truncate">
                        <span className="font-mono text-slate-400 text-[11px] block truncate">
                          Qlik: {item.originalName}
                        </span>
                        <span className="text-white font-medium">
                          Sanerat: <span className="text-emerald-300">"{item.cleanName}"</span>
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono uppercase">
                      {item.type}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex justify-between items-center">
          <div className="text-xs text-slate-500">
            {selectedIndices.length} termer redo att analyseras
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-400 hover:text-white rounded-xl transition cursor-pointer"
            >
              Avbryt
            </button>
            <button
              onClick={handleExecute}
              disabled={selectedIndices.length === 0 || isGenerating}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow transition flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isGenerating ? 'Genererar...' : `Godkänn & Skicka (${selectedIndices.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};