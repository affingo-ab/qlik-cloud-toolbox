import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles, Layers, CheckCircle2, AlertCircle, EyeOff, Search, Download, HelpCircle, TrendingUp, Compass, Filter, CheckSquare, Square, ShieldCheck, Key, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { FullBusinessLogicPlan } from '../types/businessLogic';

interface AppInfo {
  id: string;
  name: string;
}

interface Props {
  tenantUrl: string;
  apiToken: string;
  geminiKey?: string;
  availableApps: AppInfo[];
}

export const AiBusinessLogicEnricher: React.FC<Props> = ({
  tenantUrl,
  apiToken,
  geminiKey: initialGeminiKey = '',
  availableApps,
}) => {
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    return initialGeminiKey || localStorage.getItem('gemini_api_key') || localStorage.getItem('qlik_gemini_api_key') || '';
  });

  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [appSearch, setAppSearch] = useState('');
  const [allFields, setAllFields] = useState<string[]>([]);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [fieldFilter, setFieldFilter] = useState('');
  const [domainContext, setDomainContext] = useState('Försäljning, Order, Kundanalys & Logistik');
  const [fetchingFields, setFetchingFields] = useState(false);

  // Sökfilter för Vocabulary
  const [vocabSearch, setVocabSearch] = useState('');

  // Konflikthantering för Master Items vid applicering
  const [conflictStrategy, setConflictStrategy] = useState<'overwrite' | 'skip' | 'copy'>('overwrite');

  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [plan, setPlan] = useState<FullBusinessLogicPlan | null>(null);
  const [activeTab, setActiveTab] = useState<'master' | 'vocab' | 'questions' | 'blueprint'>('master');
  const [statusLog, setStatusLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedApp = availableApps.find(a => a.id === selectedAppId);

  const handleGeminiKeyChange = (val: string) => {
    setGeminiApiKey(val);
    localStorage.setItem('gemini_api_key', val);
    localStorage.setItem('qlik_gemini_api_key', val);
  };

  const isTechnicalField = (name: string): boolean => {
    const l = name.toLowerCase();
    if (l.startsWith('%') || l.startsWith('_') || l.endsWith('_key') || l.endsWith('_id') || l.endsWith('id_fk')) {
      return true;
    }
    if (l.includes('exectime') || l.includes('reloadtime') || l.includes('timestamp') || l.includes('rowcount') || l === 'status_id') {
      return true;
    }
    return false;
  };

  // Läs in fält när app väljs
  useEffect(() => {
    if (!selectedAppId || !apiToken) {
      setAllFields([]);
      setSelectedFields(new Set());
      setPlan(null);
      return;
    }

    const loadFields = async () => {
      setFetchingFields(true);
      setError(null);
      try {
        const res = await fetch('/api/vocabulary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'get',
            tenant: tenantUrl,
            apiKey: apiToken.trim(),
            appId: selectedAppId,
          }),
        });
        const data = await res.json();
        const rawFields: string[] = data.fields || [];
        setAllFields(rawFields);

        const initialSelected = new Set<string>();
        rawFields.forEach(f => {
          if (!isTechnicalField(f)) {
            initialSelected.add(f);
          }
        });
        setSelectedFields(initialSelected);
      } catch (err: any) {
        setError('Kunde inte läsa in fält från appen: ' + err.message);
      } finally {
        setFetchingFields(false);
      }
    };

    loadFields();
  }, [selectedAppId, tenantUrl, apiToken]);

  const visibleFields = useMemo(() => {
    return allFields.filter(f => f.toLowerCase().includes(fieldFilter.toLowerCase()));
  }, [allFields, fieldFilter]);

  const toggleField = (field: string) => {
    const next = new Set(selectedFields);
    if (next.has(field)) {
      next.delete(field);
    } else {
      next.add(field);
    }
    setSelectedFields(next);
  };

  const selectAll = () => setSelectedFields(new Set(allFields));
  const deselectAll = () => setSelectedFields(new Set());

  const selectSmartBusinessFields = () => {
    const next = new Set<string>();
    allFields.forEach(f => {
      if (!isTechnicalField(f)) next.add(f);
    });
    setSelectedFields(next);
  };

  // Master Items: Markera / Avmarkera alla
  const setAllMeasuresSelected = (selected: boolean) => {
    if (!plan) return;
    const updated = plan.masterItems.measures.map(m => ({ ...m, selected }));
    setPlan({ ...plan, masterItems: { ...plan.masterItems, measures: updated } });
  };

  const setAllDimensionsSelected = (selected: boolean) => {
    if (!plan) return;
    const updated = plan.masterItems.dimensions.map(d => ({ ...d, selected }));
    setPlan({ ...plan, masterItems: { ...plan.masterItems, dimensions: updated } });
  };

  // Sammanställd lista av Vocabulary per Target Name (för gemensam rad & synkron rullist)
  const unifiedVocabList = useMemo(() => {
    if (!plan) return [];
    const map = new Map<string, {
      targetName: string;
      type: string;
      svIndex: number;
      enIndex: number;
      svSynonyms: string[];
      enSynonyms: string[];
      selected: boolean;
    }>();

    (plan.vocabulary.sv.terms || []).forEach((t, idx) => {
      map.set(t.targetName, {
        targetName: t.targetName,
        type: t.type || 'measure',
        svIndex: idx,
        enIndex: -1,
        svSynonyms: t.synonyms || [],
        enSynonyms: [],
        selected: t.selected !== false,
      });
    });

    (plan.vocabulary.en.terms || []).forEach((t, idx) => {
      const existing = map.get(t.targetName);
      if (existing) {
        existing.enIndex = idx;
        existing.enSynonyms = t.synonyms || [];
        if (t.selected === false) existing.selected = false;
      } else {
        map.set(t.targetName, {
          targetName: t.targetName,
          type: t.type || 'measure',
          svIndex: -1,
          enIndex: idx,
          svSynonyms: [],
          enSynonyms: t.synonyms || [],
          selected: t.selected !== false,
        });
      }
    });

    return Array.from(map.values());
  }, [plan]);

  // Filtrera vocabulary baserat på sökrutan
  const filteredVocabList = useMemo(() => {
    if (!vocabSearch.trim()) return unifiedVocabList;
    const q = vocabSearch.toLowerCase();
    return unifiedVocabList.filter(item => {
      const matchName = item.targetName.toLowerCase().includes(q);
      const matchSv = item.svSynonyms.some(s => s.toLowerCase().includes(q));
      const matchEn = item.enSynonyms.some(s => s.toLowerCase().includes(q));
      return matchName || matchSv || matchEn;
    });
  }, [unifiedVocabList, vocabSearch]);

  // Toggle selection för en term (både SV och EN)
  const toggleUnifiedTermSelected = (targetName: string) => {
    if (!plan) return;
    const currentItem = unifiedVocabList.find(i => i.targetName === targetName);
    const newSelected = currentItem ? !currentItem.selected : true;

    const updatedSv = plan.vocabulary.sv.terms.map(t =>
      t.targetName === targetName ? { ...t, selected: newSelected } : t
    );
    const updatedEn = plan.vocabulary.en.terms.map(t =>
      t.targetName === targetName ? { ...t, selected: newSelected } : t
    );

    setPlan({
      ...plan,
      vocabulary: {
        ...plan.vocabulary,
        sv: { ...plan.vocabulary.sv, terms: updatedSv },
        en: { ...plan.vocabulary.en, terms: updatedEn },
      },
    });
  };

  // Massval för filtrerade Vocabulary-termer
  const setSelectedForFilteredVocab = (selected: boolean) => {
    if (!plan) return;
    const targetNames = new Set(filteredVocabList.map(i => i.targetName));

    const updatedSv = plan.vocabulary.sv.terms.map(t =>
      targetNames.has(t.targetName) ? { ...t, selected } : t
    );
    const updatedEn = plan.vocabulary.en.terms.map(t =>
      targetNames.has(t.targetName) ? { ...t, selected } : t
    );

    setPlan({
      ...plan,
      vocabulary: {
        ...plan.vocabulary,
        sv: { ...plan.vocabulary.sv, terms: updatedSv },
        en: { ...plan.vocabulary.en, terms: updatedEn },
      },
    });
  };

  // Uppdatera synonymer inline för SV eller EN
  const updateUnifiedSynonyms = (targetName: string, locale: 'sv' | 'en', text: string) => {
    if (!plan) return;
    const synonyms = text.split(',').map(s => s.trim()).filter(Boolean);
    const updatedTerms = plan.vocabulary[locale].terms.map(t =>
      t.targetName === targetName ? { ...t, synonyms } : t
    );

    setPlan({
      ...plan,
      vocabulary: {
        ...plan.vocabulary,
        [locale]: { ...plan.vocabulary[locale], terms: updatedTerms },
      },
    });
  };

  // Generera plan med AI
  const handleGenerate = async () => {
    const key = geminiApiKey.trim();
    if (!key) {
      setError('Gemini API-nyckel saknas! Fyll i din API-nyckel i rutan ovan.');
      return;
    }

    const fieldsToAnalyze = Array.from(selectedFields);
    if (fieldsToAnalyze.length === 0) {
      setError('Välj minst ett fält att analysera.');
      return;
    }

    setLoading(true);
    setError(null);
    setStatusLog(`🤖 Analyserar ${fieldsToAnalyze.length} utvalda affärsfält med Gemini LLM inom "${domainContext}"...`);

    try {
      const res = await fetch('/api/generate-business-logic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: selectedApp?.name || 'Qlik App',
          fields: fieldsToAnalyze,
          domain: domainContext,
          geminiKey: key,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Serverfel vid generering');
      }

      if (data.plan) {
        data.plan.masterItems.measures = (data.plan.masterItems.measures || []).map((m: any) => ({ ...m, selected: true }));
        data.plan.masterItems.dimensions = (data.plan.masterItems.dimensions || []).map((d: any) => ({ ...d, selected: true }));
        data.plan.vocabulary.sv.terms = (data.plan.vocabulary.sv.terms || []).map((t: any) => ({ ...t, selected: true }));
        data.plan.vocabulary.en.terms = (data.plan.vocabulary.en.terms || []).map((t: any) => ({ ...t, selected: true }));
        setPlan(data.plan);
        setStatusLog(
          `✨ Business Logic-förslag framgångsrikt genererat via Google Gemini (${data.modelUsed})!\n` +
          `• ${data.plan.masterItems.measures.length} Master Measures & ${data.plan.masterItems.dimensions.length} Master Dimensions\n` +
          `• Tvåspråkigt Vocabulary: ${data.plan.vocabulary.sv.terms.length} svenska & ${data.plan.vocabulary.en.terms.length} engelska termer\n` +
          `• Exempelfrågor: ${data.plan.vocabulary.sv.exampleQuestions.length} svenska & ${data.plan.vocabulary.en.exampleQuestions.length} engelska frågor`
        );
      }
    } catch (err: any) {
      setError('AI-generering misslyckades: ' + err.message);
      setStatusLog(null);
    } finally {
      setLoading(false);
    }
  };

  // Exportera Vocabulary (Sheet1) och Example Questions (Example Questions) till officiell Excel
  const downloadVocabularyExcel = () => {
    if (!plan) return;

    // 1. Synonymer / Terms (Sheet1)
    const headers = ['Field', 'Locale', 'Terms', 'Condition Type', 'Condition Values', 'Master Item'];
    const rows: string[][] = [headers];

    // Svenska synonymer (Locale: Sv) - endast aktiva
    (plan.vocabulary?.sv?.terms || []).forEach(t => {
      if (t.selected !== false && t.synonyms && t.synonyms.length > 0) {
        rows.push([
          String(t.targetName || ''),
          'Sv',
          t.synonyms.join('||'),
          '',
          '',
          t.type === 'measure' || t.type === 'dimension' ? 'True' : 'False',
        ]);
      }
    });

    // Engelska synonymer (Locale: En) - endast aktiva
    (plan.vocabulary?.en?.terms || []).forEach(t => {
      if (t.selected !== false && t.synonyms && t.synonyms.length > 0) {
        rows.push([
          String(t.targetName || ''),
          'En',
          t.synonyms.join('||'),
          '',
          '',
          t.type === 'measure' || t.type === 'dimension' ? 'True' : 'False',
        ]);
      }
    });

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

    // 2. Exempelfrågor (Example Questions) som egen flik
    const svQuestions = plan.vocabulary?.sv?.exampleQuestions || [];
    const enQuestions = plan.vocabulary?.en?.exampleQuestions || [];

    const qHeaders = ['Question', 'Locale'];
    const qRows: string[][] = [qHeaders];

    svQuestions.forEach(q => {
      if (typeof q === 'string' && q.trim()) {
        qRows.push([q.trim(), 'Sv']);
      }
    });

    enQuestions.forEach(q => {
      if (typeof q === 'string' && q.trim()) {
        qRows.push([q.trim(), 'En']);
      }
    });

    // Skapa fliken Example Questions så länge det finns frågor
    if (qRows.length > 1) {
      const qWorksheet = XLSX.utils.aoa_to_sheet(qRows);
      XLSX.utils.book_append_sheet(workbook, qWorksheet, 'Example Questions');
    }

    const cleanAppName = (selectedApp?.name || 'Qlik_App').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `qlik_vocabulary_${cleanAppName}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  // Skapa Master Items i appen och ladda ner Excel
  const handleApplyMasterItems = async () => {
    if (!plan || !selectedAppId) return;
    setApplying(true);
    setError(null);
    setStatusLog('🚀 Skapar Master Items direkt i appen via QIX Engine WebSocket...');

    try {
      const res = await fetch('/api/apply-business-logic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantUrl,
          apiToken,
          appId: selectedAppId,
          plan,
          conflictStrategy,
        }),
      });

      const data = await res.json();
      downloadVocabularyExcel();

      setStatusLog(
        `🎉 Master Items processade i "${selectedApp?.name}"!\n` +
        `• Mått: nya skapade: ${data.summary?.createdMeasures ?? 0} st, uppdaterade: ${data.summary?.updatedMeasures ?? 0} st, överhoppade: ${data.summary?.skippedMeasures ?? 0} st\n` +
        `• Dimensioner: nya skapade: ${data.summary?.createdDimensions ?? 0} st, uppdaterade: ${data.summary?.updatedDimensions ?? 0} st, överhoppade: ${data.summary?.skippedDimensions ?? 0} st\n\n` +
        `📥 Officiell Qlik Vocabulary Excel-fil laddades ner med dina valda synonymer!\n` +
        `👉 Öppna Qlik Cloud: Prepare > Business logic > Vocabulary > Klicka på "Import" och välj filen.`
      );
    } catch (err: any) {
      setError('Ett fel uppstod vid applicering: ' + err.message);
    } finally {
      setApplying(false);
    }
  };

  const filteredApps = availableApps.filter(app =>
    app.name.toLowerCase().includes(appSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* 1. App- och Konfigurationssektion */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-800/80 pb-4">
          <label className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4" /> Välj App & Ange Konfiguration
          </label>
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/90 bg-emerald-950/40 border border-emerald-800/50 px-3 py-1 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>100% Dataminimering: Inga transaktioner eller kunddata skickas</span>
          </div>
        </div>

        {/* Gemini API Key-fält */}
        <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
              <Key className="w-3.5 h-3.5 text-emerald-400" /> Google Gemini API-nyckel
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${geminiApiKey.trim() ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'}`}>
              {geminiApiKey.trim() ? '🟢 Nyckel angiven' : '🔴 Nyckel saknas'}
            </span>
          </div>
          <input
            type="password"
            value={geminiApiKey}
            onChange={(e) => handleGeminiKeyChange(e.target.value)}
            placeholder="Klistra in din Gemini API-nyckel här (AIzaSy...)"
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <span className="text-xs text-slate-400 font-medium">Qlik Cloud App</span>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Sök app..."
                value={appSearch}
                onChange={(e) => setAppSearch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 mb-2"
              />
            </div>
            <select
              value={selectedAppId}
              onChange={(e) => setSelectedAppId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="">-- Välj app ({filteredApps.length} st) --</option>
              {filteredApps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs text-slate-400 font-medium">Bransch / Affärskontext (för LLM-precision)</span>
            <input
              type="text"
              value={domainContext}
              onChange={(e) => setDomainContext(e.target.value)}
              placeholder="t.ex. Grossistförsäljning, E-handel, Tillverkning, Logistik"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-slate-500">Hjälper AI:n att förstå förkortningar och branschtermer (t.ex. TB, Belopp, Beställd mängd, Total tid).</p>
          </div>
        </div>

        {/* Fältväljare */}
        {allFields.length > 0 && (
          <div className="pt-4 border-t border-slate-800/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-emerald-400" />
                Välj fält att skicka till AI ({selectedFields.size} av {allFields.length} valda)
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectSmartBusinessFields}
                  className="px-3 py-1.5 text-xs bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 rounded-lg hover:bg-emerald-900/60 transition cursor-pointer font-medium"
                >
                  ✨ Endast affärsfält
                </button>
                <button
                  type="button"
                  onClick={selectAll}
                  className="px-3 py-1.5 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition cursor-pointer"
                >
                  Markera alla ({allFields.length})
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="px-3 py-1.5 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition cursor-pointer"
                >
                  Avmarkera alla
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Filtrera fältlista..."
                value={fieldFilter}
                onChange={(e) => setFieldFilter(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Fältchips / Checkbox-grid */}
            <div className="max-h-56 overflow-y-auto p-3 bg-slate-950 border border-slate-800/90 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {visibleFields.map(field => {
                const isSelected = selectedFields.has(field);
                return (
                  <button
                    key={field}
                    type="button"
                    onClick={() => toggleField(field)}
                    className={`flex items-center gap-2 p-2 rounded-lg text-left transition border cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-200 font-medium'
                        : 'bg-slate-900/50 border-slate-800/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isSelected ? <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <Square className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
                    <span className="truncate" title={field}>{field}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Körknapp */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {fetchingFields ? 'Läser in fält...' : allFields.length > 0 ? `${selectedFields.size} fält redo för AI-analys.` : 'Välj en app ovan.'}
          </div>

          <button
            onClick={handleGenerate}
            disabled={selectedFields.size === 0 || loading || fetchingFields}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 px-6 py-2.5 rounded-xl text-xs font-bold transition disabled:opacity-40 shadow-lg cursor-pointer"
          >
            <Sparkles className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Analyserar med Google Gemini...' : '✨ Generera med Gemini LLM'}
          </button>
        </div>
      </div>

      {/* Felmeddelande */}
      {error && (
        <div className="flex items-center gap-3 bg-rose-950/40 border border-rose-800/60 rounded-xl p-4 text-rose-300 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Statuslogg */}
      {statusLog && (
        <div className="bg-emerald-950/30 border border-emerald-800/60 rounded-2xl p-5 text-emerald-300 text-xs whitespace-pre-line font-mono">
          {statusLog}
        </div>
      )}

      {/* Resultatvisare med 4 inre flikar */}
      {plan && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl p-6 space-y-6">
          {/* Flikar */}
          <div className="flex border-b border-slate-800 space-x-4">
            <button
              onClick={() => setActiveTab('master')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition cursor-pointer ${
                activeTab === 'master' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              1. Master Items ({plan.masterItems.measures.length + plan.masterItems.dimensions.length})
            </button>
            <button
              onClick={() => setActiveTab('vocab')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition cursor-pointer ${
                activeTab === 'vocab' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              2. Vocabulary Synonymer (SV/EN)
            </button>
            <button
              onClick={() => setActiveTab('questions')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition cursor-pointer ${
                activeTab === 'questions' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              3. Exempelfrågor & Analyser
            </button>
            <button
              onClick={() => setActiveTab('blueprint')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition cursor-pointer ${
                activeTab === 'blueprint' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              4. Logical Model Blueprint
            </button>
          </div>

          {/* Flik 1: Master Items */}
          {activeTab === 'master' && (
            <div className="space-y-6">
              {/* Measures Header & Snabbknappar */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                    🟢 Föreslagna Master Measures ({plan.masterItems.measures.filter(m => m.selected !== false).length} av {plan.masterItems.measures.length} valda)
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAllMeasuresSelected(true)}
                      className="px-2.5 py-1 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition cursor-pointer"
                    >
                      Markera alla mått
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllMeasuresSelected(false)}
                      className="px-2.5 py-1 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition cursor-pointer"
                    >
                      Avmarkera alla mått
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {plan.masterItems.measures.map((m, idx) => {
                    const isSelected = m.selected !== false;
                    return (
                      <div
                        key={idx}
                        className={`p-4 border rounded-xl flex items-start gap-3 transition ${
                          isSelected ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-950/30 border-slate-900 opacity-60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            const updated = [...plan.masterItems.measures];
                            updated[idx].selected = !isSelected;
                            setPlan({ ...plan, masterItems: { ...plan.masterItems, measures: updated } });
                          }}
                          className="mt-1 rounded border-slate-700 text-emerald-500 focus:ring-emerald-400 cursor-pointer"
                        />
                        <div className="flex-1">
                          <div className="font-semibold text-white text-sm flex items-center justify-between">
                            <span>{m.title}</span>
                            <span className="text-[11px] text-slate-400 font-normal">({m.label})</span>
                          </div>
                          <div className="font-mono text-xs text-emerald-300 bg-slate-900 px-2.5 py-1 rounded-lg my-1.5 border border-slate-800/80">
                            {m.expression}
                          </div>
                          <p className="text-xs text-slate-400">{m.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Dimensions Header & Snabbknappar */}
              <div className="pt-4 border-t border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <h4 className="text-xs font-semibold text-sky-400 uppercase tracking-wider">
                    🔷 Föreslagna Master Dimensions ({plan.masterItems.dimensions.filter(d => d.selected !== false).length} av {plan.masterItems.dimensions.length} valda)
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAllDimensionsSelected(true)}
                      className="px-2.5 py-1 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition cursor-pointer"
                    >
                      Markera alla dimensioner
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllDimensionsSelected(false)}
                      className="px-2.5 py-1 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition cursor-pointer"
                    >
                      Avmarkera alla dimensioner
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {plan.masterItems.dimensions.map((d, idx) => {
                    const isSelected = d.selected !== false;
                    return (
                      <div
                        key={idx}
                        className={`p-4 border rounded-xl flex items-start gap-3 transition ${
                          isSelected ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-950/30 border-slate-900 opacity-60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            const updated = [...plan.masterItems.dimensions];
                            updated[idx].selected = !isSelected;
                            setPlan({ ...plan, masterItems: { ...plan.masterItems, dimensions: updated } });
                          }}
                          className="mt-1 rounded border-slate-700 text-sky-500 focus:ring-sky-400 cursor-pointer"
                        />
                        <div className="flex-1">
                          <div className="font-semibold text-white text-sm">{d.title}</div>
                          <div className="font-mono text-xs text-sky-300 mt-1">Fält: {d.fieldDefs.join(' ➔ ')}</div>
                          <p className="text-xs text-slate-400 mt-1">{d.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Flik 2: Vocabulary med Sökruta och En gemensam scrollist */}
          {activeTab === 'vocab' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={vocabSearch}
                      onChange={(e) => setVocabSearch(e.target.value)}
                      placeholder="Sök på fältnamn eller synonym (t.ex. artikel, belopp, tid)..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-8 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                    {vocabSearch && (
                      <button
                        onClick={() => setVocabSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedForFilteredVocab(true)}
                      className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition cursor-pointer font-medium"
                    >
                      Markera visade ({filteredVocabList.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedForFilteredVocab(false)}
                      className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition cursor-pointer font-medium"
                    >
                      Avmarkera visade
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                  <span>
                    Visar <strong>{filteredVocabList.length}</strong> av <strong>{unifiedVocabList.length}</strong> termer
                    {vocabSearch && ` (filtrerat på "${vocabSearch}")`}
                  </span>
                  <span>
                    Aktiva för export: <strong>{unifiedVocabList.filter(i => i.selected).length}</strong> st
                  </span>
                </div>
              </div>

              {/* EN GEMENSAM SCROLLIST FÖR ALLA TERMER MED SV OCH EN SIDA VID SIDA */}
              <div className="max-h-[560px] overflow-y-auto pr-2 space-y-3">
                {filteredVocabList.map((item) => (
                  <div
                    key={item.targetName}
                    className={`p-4 border rounded-xl transition ${
                      item.selected
                        ? 'bg-slate-950/80 border-slate-800'
                        : 'bg-slate-950/30 border-slate-900 opacity-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => toggleUnifiedTermSelected(item.targetName)}
                          className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-400 cursor-pointer"
                        />
                        <span className="font-semibold text-white text-sm">{item.targetName}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase bg-slate-800 text-slate-400 border border-slate-700">
                          {item.type}
                        </span>
                      </label>
                      <span className="text-[11px] text-slate-500">
                        {item.selected ? '✅ Inkluderas i Excel' : '⚪ Utesluts från Excel'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {/* Svenska synonymer */}
                      <div className="space-y-1">
                        <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5">
                          🇸🇪 Svenska synonymer
                        </span>
                        <input
                          type="text"
                          disabled={!item.selected}
                          value={item.svSynonyms.join(', ')}
                          onChange={(e) => updateUnifiedSynonyms(item.targetName, 'sv', e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-40"
                          placeholder="Synonymer separerade med komma..."
                        />
                      </div>

                      {/* Engelska synonymer */}
                      <div className="space-y-1">
                        <span className="text-[11px] font-semibold text-sky-400 flex items-center gap-1.5">
                          🇬🇧 Engelska synonymer
                        </span>
                        <input
                          type="text"
                          disabled={!item.selected}
                          value={item.enSynonyms.join(', ')}
                          onChange={(e) => updateUnifiedSynonyms(item.targetName, 'en', e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 disabled:opacity-40"
                          placeholder="Synonyms separated by comma..."
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {filteredVocabList.length === 0 && (
                  <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                    Inga termer matchade sökningen "{vocabSearch}".
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Flik 3: Exempelfrågor & Custom Analyses */}
          {activeTab === 'questions' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" /> 🇸🇪 Svenska Exempelfrågor ({plan.vocabulary.sv.exampleQuestions.length})
                </h4>
                <div className="space-y-2">
                  {plan.vocabulary.sv.exampleQuestions.map((q, idx) => (
                    <div key={idx} className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-200">
                      💬 "{q}"
                    </div>
                  ))}
                </div>

                {plan.vocabulary.sv.customAnalyses?.length > 0 && (
                  <div className="pt-2">
                    <h5 className="text-xs font-semibold text-emerald-300 mb-2 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5" /> Anpassade Analyser (Custom Analyses)
                    </h5>
                    {plan.vocabulary.sv.customAnalyses.map((ca, idx) => (
                      <div key={idx} className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl text-xs text-slate-300 mb-2">
                        <strong>Term:</strong> "{ca.term}" ➔ <em>{ca.analysisType}</em> ({ca.targetMetric})
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" /> 🇬🇧 Engelska Exempelfrågor ({plan.vocabulary.en.exampleQuestions.length})
                </h4>
                <div className="space-y-2">
                  {plan.vocabulary.en.exampleQuestions.map((q, idx) => (
                    <div key={idx} className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-200">
                      💬 "{q}"
                    </div>
                  ))}
                </div>

                {plan.vocabulary.en.customAnalyses?.length > 0 && (
                  <div className="pt-2">
                    <h5 className="text-xs font-semibold text-sky-300 mb-2 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5" /> Custom Analyses
                    </h5>
                    {plan.vocabulary.en.customAnalyses.map((ca, idx) => (
                      <div key={idx} className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl text-xs text-slate-300 mb-2">
                        <strong>Term:</strong> "{ca.term}" ➔ <em>{ca.analysisType}</em> ({ca.targetMetric})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Flik 4: Logical Model Blueprint */}
          {activeTab === 'blueprint' && (
            <div className="space-y-5">
              <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl text-xs text-slate-300 flex items-start gap-3">
                <Compass className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <strong>Arkitekturguide för Qlik Cloud:</strong> Qlik Cloud stödjer ännu inte direkt API-import av den logiska modellen. Använd denna blueprint för att på under 2 minuter skapa grupperna under <em>Prepare &gt; Business logic &gt; Logical model</em>.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {plan.logicalModel.groups.map((g, idx) => (
                  <div key={idx} className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white text-sm">{g.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase bg-slate-800 text-emerald-300 border border-slate-700">
                        {g.type}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-2">
                      <strong className="text-slate-300">Inkludera:</strong> {g.items.join(', ')}
                    </div>
                  </div>
                ))}
              </div>

              {plan.logicalModel.hiddenFields.length > 0 && (
                <div className="p-4 bg-amber-950/30 border border-amber-800/40 rounded-xl text-xs text-amber-300 flex items-start gap-2">
                  <EyeOff className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                  <div>
                    <strong>Sätt som dolda (Hidden) i Qlik:</strong> {plan.logicalModel.hiddenFields.join(', ')}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Enda gemensamma åtgärdsraden i botten */}
          <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <button
              onClick={downloadVocabularyExcel}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-5 py-2.5 rounded-xl text-xs font-semibold transition border border-slate-700 cursor-pointer"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              Ladda ner Vocabulary Excel (.xlsx)
            </button>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs">
                <span className="text-slate-400">Vid dubblett:</span>
                <select
                  value={conflictStrategy}
                  onChange={(e) => setConflictStrategy(e.target.value as any)}
                  className="bg-transparent text-emerald-400 font-medium focus:outline-none cursor-pointer"
                >
                  <option value="overwrite" className="bg-slate-900 text-slate-200">Uppdatera / Skriv över (Overwrite)</option>
                  <option value="skip" className="bg-slate-900 text-slate-200">Hoppa över (Skip)</option>
                  <option value="copy" className="bg-slate-900 text-slate-200">Skapa kopia (_v2)</option>
                </select>
              </div>

              <button
                onClick={handleApplyMasterItems}
                disabled={applying}
                className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-6 py-3 rounded-xl text-xs font-bold transition disabled:opacity-40 shadow-xl cursor-pointer"
              >
                <CheckCircle2 className={`w-4 h-4 ${applying ? 'animate-spin' : ''}`} />
                {applying ? 'Processar Master Items...' : '🚀 Skapa Master Items i Qlik & Hämta Excel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};