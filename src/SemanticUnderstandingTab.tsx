import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Brain,
  Search,
  RefreshCw,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  Save,
  RotateCcw,
  Sparkles,
  Database
} from 'lucide-react';

export interface ModelElement {
  id: string;
  name: string;
  tableName?: string;
  role?: string;
  type?: string;
  description?: string;
  overrideDescription?: boolean;
  classifications?: string[];
  synonyms?: string[];
  distinctCount?: number;
  valueRange?: { min: any; max: any };
}

interface AppInfo {
  id: string;
  name: string;
  spaceId?: string;
}

interface AppDetails {
  id: string;
  name: string;
  description?: string;
  overrideDescription?: boolean;
}

interface SemanticUnderstandingTabProps {
  tenant: string;
  apiKey: string;
  webIntegrationId?: string;
  availableApps: AppInfo[];
  selectedAppId: string;
  onSelectAppId: (appId: string) => void;
}

export const SemanticUnderstandingTab: React.FC<SemanticUnderstandingTabProps> = ({
  tenant,
  apiKey,
  webIntegrationId,
  availableApps,
  selectedAppId,
  onSelectAppId,
}) => {
  const [elements, setElements] = useState<ModelElement[]>([]);
  const [appDetails, setAppDetails] = useState<AppDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string | null>(null);

  // Redigering
  const [editedDescriptions, setEditedDescriptions] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  // Sök & filter
  const [searchQuery, setSearchQuery] = useState('');
  const [tableFilter, setTableFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OVERRIDDEN' | 'AI_GENERATED'>('ALL');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 1. Hämta model elements från Qlik Cloud
  const fetchModelElements = async (appId: string) => {
    if (!appId || !apiKey || !tenant) return;
    setLoading(true);
    setError(null);
    setStatusLog(null);

    try {
      const response = await fetch('/api/semantic-understanding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get',
          tenant,
          apiKey,
          webIntegrationId,
          appId,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Kunde inte hämta semantiska element (${response.status})`);
      }

      const data = await response.json();
      const rawElements: ModelElement[] = data.modelElements || [];
      setElements(rawElements);
      setAppDetails(data.app || null);

      // Nollställ redigeringar
      const initialEdits: Record<string, string> = {};
      rawElements.forEach((el) => {
        initialEdits[el.id] = el.description || '';
      });
      setEditedDescriptions(initialEdits);

    } catch (err: any) {
      console.error('Fetch Semantic Elements Error:', err);
      setError(err.message || 'Fel vid inläsning av semantiska definitioner');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAppId) {
      fetchModelElements(selectedAppId);
    } else {
      setElements([]);
      setAppDetails(null);
    }
  }, [selectedAppId]);

  // 2. Spara en fältbeskrivning (Override)
  const handleSaveDescription = async (el: ModelElement) => {
    const newText = (editedDescriptions[el.id] || '').trim();
    if (!newText) {
      setError('Beskrivningen kan inte vara tom.');
      return;
    }

    setSavingId(el.id);
    setError(null);

    try {
      const response = await fetch('/api/semantic-understanding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          tenant,
          apiKey,
          webIntegrationId,
          appId: selectedAppId,
          elementId: el.id,
          description: newText,
          overrideDescriptionFlag: true,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Kunde inte spara (${response.status})`);
      }

      // Uppdatera lokal state
      setElements((prev) =>
        prev.map((item) =>
          item.id === el.id
            ? { ...item, description: newText, overrideDescription: true }
            : item
        )
      );

      setEditingId(null);
      setStatusLog(`✅ Beskrivningen för fältet "${el.name}" har sparats och uppdaterats i Qlik Cloud!`);
    } catch (err: any) {
      console.error('Save Error:', err);
      setError(err.message || 'Kunde inte spara beskrivning');
    } finally {
      setSavingId(null);
    }
  };

  // 3. Återställ till Qliks standardbeskrivning
  const handleResetToDefault = async (el: ModelElement) => {
    if (!window.confirm(`Vill du återställa "${el.name}" till Qliks automatiskt genererade AI-beskrivning?`)) {
      return;
    }

    setSavingId(el.id);
    setError(null);

    try {
      const response = await fetch('/api/semantic-understanding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          tenant,
          apiKey,
          webIntegrationId,
          appId: selectedAppId,
          elementId: el.id,
          description: '',
          overrideDescriptionFlag: false,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Kunde inte återställa (${response.status})`);
      }

      // Läs om appens element för att få den färska standardbeskrivningen
      await fetchModelElements(selectedAppId);
      setStatusLog(`🔄 Fältet "${el.name}" har återställts till Qlik AI-standard.`);
    } catch (err: any) {
      console.error('Reset Error:', err);
      setError(err.message || 'Kunde inte återställa');
    } finally {
      setSavingId(null);
    }
  };

  // 4. Exportera till Excel
  const handleExportToExcel = () => {
    if (elements.length === 0) return;

    const currentApp = availableApps.find((a) => a.id === selectedAppId);
    const rows = elements.map((el) => ({
      'Element ID': el.id,
      'Fältnamn': el.name,
      'Tabell': el.tableName || '',
      'Roll': el.role || '',
      'Typ': el.type || '',
      'Semantisk Beskrivning': el.description || '',
      'Manuell Anpassning (Override)': el.overrideDescription ? 'JA' : 'NEJ',
      'Unika Värden': el.distinctCount !== undefined ? el.distinctCount : '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Semantic Fields');

    const appSlug = currentApp?.name ? currentApp.name.toLowerCase().replace(/\s+/g, '_') : 'app';
    const filename = `semantic_fields_${appSlug}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    XLSX.writeFile(workbook, filename);
    setStatusLog(`📥 Exporterade ${elements.length} st fält till Excel: "${filename}"`);
  };

  // 5. Importera från Excel
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      setError(null);
      setStatusLog('Läser Excel-fil...');

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData: any[] = XLSX.utils.sheet_to_json(sheet);

      if (rawData.length === 0) {
        throw new Error('Excel-filen är tom.');
      }

      // Matcha antingen på 'Element ID' eller 'Fältnamn'
      const updates: Array<{ id: string; description: string; overrideDescriptionFlag: boolean }> = [];
      const elementMapById = new Map<string, ModelElement>();
      const elementMapByName = new Map<string, ModelElement>();

      elements.forEach((el) => {
        elementMapById.set(el.id, el);
        elementMapByName.set(el.name.toLowerCase(), el);
      });

      rawData.forEach((row) => {
        const id = row['Element ID'] || row['id'] || row['ID'];
        const name = (row['Fältnamn'] || row['name'] || row['Name'] || '').toString().toLowerCase();
        const desc = (row['Semantisk Beskrivning'] || row['description'] || row['Beskrivning'] || '').toString().trim();

        let matchedEl: ModelElement | undefined;
        if (id && elementMapById.has(id)) {
          matchedEl = elementMapById.get(id);
        } else if (name && elementMapByName.has(name)) {
          matchedEl = elementMapByName.get(name);
        }

        if (matchedEl && desc && desc !== matchedEl.description) {
          updates.push({
            id: matchedEl.id,
            description: desc,
            overrideDescriptionFlag: true,
          });
        }
      });

      if (updates.length === 0) {
        setStatusLog('ℹ️ Inga förändrade beskrivningar hittades i Excel-filen jämfört med nuvarande läge i Qlik Cloud.');
        setLoading(false);
        return;
      }

      setStatusLog(`🚀 Skickar ${updates.length} st uppdaterade fältbeskrivningar till Qlik Cloud...`);

      const batchRes = await fetch('/api/semantic-understanding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch-update',
          tenant,
          apiKey,
          webIntegrationId,
          appId: selectedAppId,
          updates,
        }),
      });

      if (!batchRes.ok) {
        const errJson = await batchRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Batch-uppdatering misslyckades (${batchRes.status})`);
      }

      const batchResult = await batchRes.json();
      await fetchModelElements(selectedAppId);

      setStatusLog(
        `🎉 Batch-import slutförd!\n` +
        `• Uppdaterade fält: ${batchResult.updatedCount} av ${updates.length} st.\n` +
        (batchResult.errors?.length > 0 ? `⚠️ Varningar: ${batchResult.errors.join(', ')}` : '')
      );

    } catch (err: any) {
      console.error('Import Error:', err);
      setError(err.message || 'Fel vid import av Excel-fil');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Extrahera unika tabeller
  const tableNames = Array.from(new Set(elements.map((e) => e.tableName).filter(Boolean))) as string[];

  // Filtrering
  const filteredElements = elements.filter((el) => {
    const matchesSearch =
      el.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (el.tableName && el.tableName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (el.description && el.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesTable = tableFilter === 'ALL' || el.tableName === tableFilter;

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'OVERRIDDEN' && el.overrideDescription === true) ||
      (statusFilter === 'AI_GENERATED' && !el.overrideDescription);

    return matchesSearch && matchesTable && matchesStatus;
  });

  const overriddenCount = elements.filter((e) => e.overrideDescription).length;
  const aiGeneratedCount = elements.length - overriddenCount;

  return (
    <div className="space-y-6">
      
      {/* Informations-banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
        <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-400" /> Qlik Cloud AI Optimization & Semantic Understanding:
        </h3>
        <p className="text-xs text-slate-300 leading-relaxed">
          Här hanterar du Qlik Answers semantiska ordbok och AI-optimerade fältförståelse. Alla fält analyseras automatiskt av Qliks kognitiva mikrotjänster. Du kan granska, redigera och kvalitetssäkra beskrivningarna manuellt eller arbeta i bulk via Excel.
        </p>
      </div>

      {/* Appväljare & Snabbstatistik */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1">
            <label className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2 mb-2">
              <Database className="w-4 h-4" /> Välj App för Semantisk Optimering
            </label>
            <select
              value={selectedAppId}
              onChange={(e) => onSelectAppId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="">-- Välj app ({availableApps.length} st tillgängliga) --</option>
              {availableApps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </div>

          {selectedAppId && (
            <div className="flex items-center gap-2 pt-2 md:pt-6">
              <button
                onClick={() => fetchModelElements(selectedAppId)}
                disabled={loading}
                className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Läs om
              </button>
              
              <button
                onClick={handleExportToExcel}
                disabled={elements.length === 0 || loading}
                className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer disabled:opacity-40"
              >
                <FileSpreadsheet className="w-4 h-4" /> Exportera till Excel (.xlsx)
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={elements.length === 0 || loading}
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-40 shadow"
              >
                <Upload className="w-4 h-4" /> Importera från Excel
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".xlsx,.xls"
                className="hidden"
              />
            </div>
          )}
        </div>

        {/* Statistik över appens semantik */}
        {selectedAppId && elements.length > 0 && (
          <div className="pt-4 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
              <span className="text-[11px] text-slate-400 block">Totalt antal fält</span>
              <span className="text-lg font-bold text-white">{elements.length}</span>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
              <span className="text-[11px] text-slate-400 block">Kvalitetssäkrade (Override)</span>
              <span className="text-lg font-bold text-emerald-400">{overriddenCount} st</span>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
              <span className="text-[11px] text-slate-400 block">Qlik AI-standard</span>
              <span className="text-lg font-bold text-sky-400">{aiGeneratedCount} st</span>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
              <span className="text-[11px] text-slate-400 block">Antal tabeller</span>
              <span className="text-lg font-bold text-purple-400">{tableNames.length} st</span>
            </div>
          </div>
        )}

        {/* App-beskrivning (AI generated for app) */}
        {appDetails?.description && (
          <div className="p-4 bg-slate-950/40 border border-slate-800/80 rounded-xl text-xs text-slate-300">
            <span className="font-bold text-slate-400 uppercase tracking-wider block mb-1 flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5 text-emerald-400" /> Appens Övergripande AI-Beskrivning i Qlik Answers:
            </span>
            <p className="italic text-slate-400 leading-relaxed">"{appDetails.description}"</p>
          </div>
        )}
      </div>

      {/* Fel & Statusmeddelanden */}
      {error && (
        <div className="flex items-center gap-3 bg-rose-950/40 border border-rose-800/60 rounded-xl p-4 text-rose-300 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {statusLog && (
        <div className="bg-emerald-950/30 border border-emerald-800/60 rounded-2xl p-5 text-emerald-300 text-xs whitespace-pre-line font-mono">
          {statusLog}
        </div>
      )}

      {/* Filterbar & Fältlista */}
      {selectedAppId && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-5 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <span>Fält och Semantiska Definitioner</span>
                <span className="text-xs text-slate-400 font-normal">({filteredElements.length} av {elements.length})</span>
              </h2>
              <p className="text-xs text-slate-400">Klicka på pennan eller textrutan för att redigera och spara direkt till Qlik</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Sökruta */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Sök fält, tabell, text..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-48 sm:w-60 bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Tabellfilter */}
              <select
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="ALL">Alla tabeller ({tableNames.length})</option>
                {tableNames.map((t) => (
                  <option key={t} value={t}>
                    Tabell: {t}
                  </option>
                ))}
              </select>

              {/* Statusfilter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="ALL">Alla statusar</option>
                <option value="OVERRIDDEN">Endast manuellt anpassade ({overriddenCount})</option>
                <option value="AI_GENERATED">Endast AI-genererade ({aiGeneratedCount})</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="p-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
              Läser in semantiska fältdefinitioner från Qlik Cloud...
            </div>
          ) : filteredElements.length === 0 ? (
            <div className="p-16 text-center text-slate-500 text-sm">
              {elements.length === 0
                ? 'Inga fält hittades i appen.'
                : 'Inga fält matchar sök- eller filterkriterierna.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {filteredElements.map((el) => {
                const isSaving = savingId === el.id;
                const isOverridden = Boolean(el.overrideDescription);
                const currentText = editedDescriptions[el.id] ?? el.description ?? '';
                const hasUnsavedChanges = currentText !== (el.description || '');

                return (
                  <div key={el.id} className="p-5 hover:bg-slate-800/20 transition flex flex-col gap-3">
                    
                    {/* Header per fält: Namn, Tabell, Badges */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-white text-sm tracking-wide">{el.name}</span>
                        {el.tableName && (
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60">
                            Tabell: {el.tableName}
                          </span>
                        )}
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-bold tracking-wider ${
                          el.role === 'Measure'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : 'bg-sky-500/10 text-sky-400 border border-sky-500/30'
                        }`}>
                          {el.role || el.type || 'Field'}
                        </span>
                      </div>

                      {/* Status-badge */}
                      <div className="flex items-center gap-2">
                        {isOverridden ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs font-semibold border border-emerald-500/30">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Anpassad (Override)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-sky-500/10 text-sky-400 rounded-full text-xs font-semibold border border-sky-500/30">
                            <Sparkles className="w-3.5 h-3.5" /> Qlik AI-genererad
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Beskrivningstext & Redigeringsfält */}
                    <div className="space-y-2">
                      <textarea
                        value={editedDescriptions[el.id] ?? ''}
                        onChange={(e) => {
                          setEditedDescriptions((prev) => ({ ...prev, [el.id]: e.target.value }));
                          if (editingId !== el.id) setEditingId(el.id);
                        }}
                        placeholder="Skriv en verksamhetsanpassad förklaring av fältet..."
                        rows={2}
                        className={`w-full bg-slate-950 border rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none transition leading-relaxed ${
                          hasUnsavedChanges
                            ? 'border-emerald-500 ring-1 ring-emerald-500/40 bg-slate-950/90'
                            : 'border-slate-800/80 focus:border-slate-700'
                        }`}
                      />

                      {/* Knappar för raden */}
                      <div className="flex items-center justify-between text-xs">
                        <div className="text-[11px] text-slate-500 font-mono">
                          ID: {el.id} {el.distinctCount !== undefined && `• ${el.distinctCount} unika värden`}
                        </div>

                        <div className="flex items-center gap-2">
                          {isOverridden && (
                            <button
                              onClick={() => handleResetToDefault(el)}
                              disabled={isSaving}
                              title="Återställ till Qliks ursprungliga AI-beskrivning"
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs font-medium border border-slate-700 transition cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3 text-slate-400" /> Återställ till AI
                            </button>
                          )}

                          <button
                            onClick={() => handleSaveDescription(el)}
                            disabled={!hasUnsavedChanges || isSaving}
                            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shadow-sm ${
                              hasUnsavedChanges
                                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-950'
                                : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed opacity-60'
                            }`}
                          >
                            <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
                            {isSaving ? 'Sparar...' : 'Spara till Qlik'}
                          </button>
                        </div>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
};