import React, { useEffect } from 'react';
import { 
  X, 
  Layers, 
  ExternalLink, 
  ShieldCheck, 
  Brain, 
  Sliders, 
  HardDrive, 
  Play, 
  Folder 
} from 'lucide-react';

export interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-modal-title"
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden text-slate-100 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-inner">
              <Layers className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="about-modal-title" className="font-bold text-white text-base tracking-tight">
                  Om Qlik Cloud Toolbox
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800/60 uppercase tracking-wider">
                  v1.1.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">
                Enterprise Administration & AI Hub
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
            aria-label="Stäng dialogruta"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Innehåll / Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Beskrivning */}
          <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
            <p>
              <strong className="text-white">Qlik Cloud Toolbox</strong> är en kraftfull administrativ svit och AI-berikningsplattform utvecklad av <strong className="text-white">Affingo AB</strong>. Verktyget effektiviserar drift, förvaltning, semantisk förståelse och optimering av organisationens Qlik Cloud-miljöer.
            </p>
          </div>

          {/* Ingående moduler */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Inkluderade moduler
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <Brain className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-slate-200">AI Semantic Understanding</span>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <Sliders className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-slate-200">Master Items Distributor</span>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <HardDrive className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-slate-200">Kapacitet & QVD-analys</span>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <Play className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-slate-200">Reload Monitor</span>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 sm:col-span-2">
                <Folder className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-slate-200">Space Permission Matrix</span>
              </div>
            </div>
          </div>

          {/* Säkerhetsbanner */}
          <div className="flex items-start gap-3 p-3.5 bg-emerald-950/20 border border-emerald-800/40 rounded-xl text-emerald-300 text-xs leading-relaxed">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <div>
              <strong>Säkerhet & Dataintegritet:</strong> Utvecklat enligt principen om minsta behörighet och strikt dataminimering. Inga affärstransaktioner eller känsliga data exponeras externt.
            </div>
          </div>

          {/* Versions- och utvecklarinfo */}
          <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400">
            <div>
              <div>© 2026 Affingo AB. Alla rättigheter förbehållna.</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Version 1.1.0 • Enterprise Edition</div>
            </div>
            <a
              href="https://affingo.se"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 font-medium transition hover:underline"
            >
              <span>Besök affingo.se</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-950/80 border-t border-slate-800 flex justify-end items-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition cursor-pointer"
          >
            Stäng
          </button>
        </div>
      </div>
    </div>
  );
};
