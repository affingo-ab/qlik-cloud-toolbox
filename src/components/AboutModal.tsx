import React, { useEffect } from 'react';
import { Layers, X, ExternalLink, ShieldCheck, Sparkles, Sliders } from 'lucide-react';

export interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200"
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
        <div className="px-6 py-5 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-inner">
              <Layers className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="about-modal-title" className="font-bold text-white text-base tracking-tight">
                  Om Qlik Cloud Toolbox
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800/60 uppercase tracking-wider font-mono">
                  v1.1.0
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium">Enterprise Administration & AI Hub</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Stäng dialogruta"
            title="Stäng"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/60 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Innehåll */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs text-slate-300 leading-relaxed">
          <div className="space-y-2">
            <h4 className="font-semibold text-white text-sm">Vad är Qlik Cloud Toolbox?</h4>
            <p>
              Qlik Cloud Toolbox är en enterprise-administrativ svit för Qlik Cloud-administratörer,
              BI-arkitekter och utvecklare. Verktyget effektiviserar hantering och styrning av Qlik Cloud-miljöer
              genom avancerad automatisering, administration och AI-baserad affärslogik.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-1">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Semantic Layer</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Semantisk förståelse och ordförrådsberikning för Qlik Answers och generativ analys.
              </p>
            </div>

            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-1">
              <div className="flex items-center gap-2 text-sky-400 font-semibold text-xs">
                <Sliders className="w-3.5 h-3.5" />
                <span>Master Item Distribution</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Distribuera mått och dimensioner mellan appar med intelligent konflikthantering.
              </p>
            </div>

            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-1">
              <div className="flex items-center gap-2 text-teal-400 font-semibold text-xs">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Space & Governance</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Behörighetsmatris, användarrättigheter och säker styrning över tenantens spaces.
              </p>
            </div>

            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-1">
              <div className="flex items-center gap-2 text-indigo-400 font-semibold text-xs">
                <Layers className="w-3.5 h-3.5" />
                <span>Kapacitet & Reloads</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Övervakning av laddningar, minnesoptimering och QVD-beroendespårning.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/60 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Aktuell version</span>
              <span className="font-mono text-emerald-400 font-semibold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/50">
                v1.1.0
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Utvecklad av</span>
              <span className="text-slate-200 font-medium">Affingo AB</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <span className="text-slate-400 text-[11px]">
            &copy; 2026 Affingo AB. Alla rättigheter förbehållna.
          </span>
          <a
            href="https://affingo.se"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 font-medium transition cursor-pointer"
          >
            <span>Besök affingo.se</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};
