import { AiBusinessLogicEnricher } from './components/AiBusinessLogicEnricher';
import { Wand2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  RefreshCw, CheckCircle2, XCircle, Clock, Server, Key, Play, 
  Search, AlertCircle, LogOut, ShieldCheck, Layers, ArrowRight, 
  Download, CheckSquare, Square, Sliders, Database, Sparkles, Plus, X, BookOpen, FileSpreadsheet, FolderOpen,Folder
} from 'lucide-react';
import { ExcelVocabularyImportModal } from './ExcelVocabularyImportModal';
import { AiSanitizePreviewModal } from './AiSanitizePreviewModal';
import { prepareItemsForLLM } from './sanitizer';
import type { SanitizedItem } from './sanitizer';
import { SpacePermissionMatrix } from './SpacePermissionMatrix';

interface ReloadItem {
  id: string;
  appId: string;
  appName?: string;
  status: string;
  startTime: string;
  endTime?: string;
}

interface AppInfo {
  id: string;
  name: string;
  spaceId?: string;
}

interface MasterMeasure {
  id: string;
  title: string;
  description?: string;
  expression: string;
  tags: string[];
}

interface MasterDimension {
  id: string;
  title: string;
  description?: string;
  grouping: 'N' | 'H';
  fieldDefs: string[];
  tags: string[];
}

export interface VocabularyItem {
  targetName: string;
  type: 'dimension' | 'measure' | 'field';
  synonyms: string[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'ai-hub' | 'master-items' | 'space-matrix' | 'reloads'>('ai-hub');

  // Anslutningsinställningar
  const [tenantInput, setTenantInput] = useState(() => localStorage.getItem('qlik_tenant_domain') || '');
  const [apiToken, setApiToken] = useState(() => localStorage.getItem('qlik_api_token') || '');
  const [webIntegrationId, setWebIntegrationId] = useState(() => localStorage.getItem('qlik_web_int_id') || '');
  const [geminiKeyInput, setGeminiKeyInput] = useState(() => localStorage.getItem('gemini_api_key') || '');

  // Status & Laddning
  const [loading, setLoading] = useState(false);
  const [itemLoading, setItemLoading] = useState(false);
  const [vocabLoading, setVocabLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reloads State
  const [reloadsList, setReloadsList] = useState<ReloadItem[]>([]);
  const [reloadSearchQuery, setReloadSearchQuery] = useState('');

  // Master Items State
  const [availableApps, setAvailableApps] = useState<AppInfo[]>([]);
  const [sourceAppId, setSourceAppId] = useState<string>('');
  const [targetAppId, setTargetAppId] = useState<string>('');
  const [sourceAppSearch, setSourceAppSearch] = useState('');
  const [targetAppSearch, setTargetAppSearch] = useState('');
  
  const [measures, setMeasures] = useState<MasterMeasure[]>([]);
  const [dimensions, setDimensions] = useState<MasterDimension[]>([]);
  const [selectedMeasureIds, setSelectedMeasureIds] = useState<string[]>([]);
  const [selectedDimensionIds, setSelectedDimensionIds] = useState<string[]>([]);
  const [conflictStrategy, setConflictStrategy] = useState<'skip' | 'overwrite' | 'copy'>('overwrite');
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [syncStatusLog, setSyncStatusLog] = useState<string | null>(null);

  // AI Vocabulary Hub State
  const [vocabAppId, setVocabAppId] = useState<string>('');
  const [vocabAppSearch, setVocabAppSearch] = useState('');
  const [vocabularyList, setVocabularyList] = useState<VocabularyItem[]>([]);
  const [vocabSearchQuery, setVocabSearchQuery] = useState('');
  const [newSynonymInputs, setNewSynonymInputs] = useState<Record<string, string>>({});
  const [vocabStatusLog, setVocabStatusLog] = useState<string | null>(null);
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<SanitizedItem[]>([]);

  const formatTenantHost = (input: string) => {
    let clean = input.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!clean) return '';
    if (!clean.includes('.')) {
      clean = `${clean}.eu.qlikcloud.com`;
    }
    return clean;
  };

  const saveSettings = () => {
    localStorage.setItem('qlik_tenant_domain', tenantInput.trim());
    localStorage.setItem('qlik_api_token', apiToken.trim());
    localStorage.setItem('qlik_web_int_id', webIntegrationId.trim());
    localStorage.setItem('gemini_api_key', geminiKeyInput.trim());
  };

  const clearSettings = () => {
    localStorage.removeItem('qlik_tenant_domain');
    localStorage.removeItem('qlik_api_token');
    localStorage.removeItem('qlik_web_int_id');
    localStorage.removeItem('gemini_api_key');
    setTenantInput('');
    setApiToken('');
    setWebIntegrationId('');
    setGeminiKeyInput('');
    setReloadsList([]);
    setAvailableApps([]);
    setMeasures([]);
    setDimensions([]);
    setVocabularyList([]);
    setSourceAppId('');
    setTargetAppId('');
    setVocabAppId('');
  };

  const getHeaders = () => {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiToken.trim()}`,
      'Content-Type': 'application/json',
    };
    if (webIntegrationId.trim()) {
      headers['qlik-web-integration-id'] = webIntegrationId.trim();
    }
    return headers;
  };

  // 1. Hämta appar och reloads
  const fetchInitialData = async () => {
    const host = formatTenantHost(tenantInput);
    if (!host || !apiToken) {
      setError('Vänligen ange både Tenant-domän och API-nyckel.');
      return;
    }

    saveSettings();
    setLoading(true);
    setError(null);

    try {
      const headers = getHeaders();
      const appsMap: Record<string, AppInfo> = {};

      let nextUrl: string | null = `https://${host}/api/v1/items?resourceType=app&limit=100`;
      let pageCount = 0;

      while (nextUrl && pageCount < 10) {
        pageCount++;
        try {
          const itemsRes = await fetch(nextUrl, { headers });
          if (!itemsRes.ok) break;

          const itemsData: any = await itemsRes.json();
          const items: any[] = itemsData.data || [];
          
          items.forEach((item: any) => {
            const id = item.resourceId || item.id;
            const name = item.name || item.resourceAttributes?.name;
            if (id && name) {
              appsMap[id] = { id, name, spaceId: item.spaceId };
            }
          });

          const nextHref = itemsData.links?.next?.href;
          if (nextHref) {
            nextUrl = nextHref.startsWith('http') ? nextHref : `https://${host}${nextHref.startsWith('/') ? '' : '/'}${nextHref}`;
          } else {
            nextUrl = null;
          }
        } catch {
          break;
        }
      }

      const sortedApps = Object.values(appsMap).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      setAvailableApps(sortedApps);

      const reloadsRes = await fetch(`https://${host}/api/v1/reloads?limit=100`, { headers });
      if (reloadsRes.ok) {
        const reloadsData: any = await reloadsRes.json();
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const rawReloads: any[] = reloadsData.data || [];

        const enrichedReloads: ReloadItem[] = rawReloads
          .filter(r => new Date(r.startTime || r.createdAt) >= new Date(twentyFourHoursAgo))
          .map(r => ({
            id: r.id,
            appId: r.appId,
            appName: appsMap[r.appId]?.name || (r.appId ? `App (${r.appId.substring(0, 8)}...)` : 'Okänd app'),
            status: r.status,
            startTime: r.startTime || r.createdAt,
            endTime: r.endTime,
          }))
          .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

        setReloadsList(enrichedReloads);
      }

    } catch (err: any) {
      console.error('Fetch Error:', err);
      setError('Kunde inte läsa in data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 2. Hämta Master Items
  const fetchMasterItemsForApp = async (appId: string) => {
    if (!appId || !apiToken) return;
    const host = formatTenantHost(tenantInput);
    setItemLoading(true);
    setError(null);
    setSyncStatusLog(null);

    try {
      const response = await fetch('/api/master-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant: host,
          apiKey: apiToken.trim(),
          appId: appId,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Serverfel (${response.status})`);
      }

      const data = await response.json();
      const parsedMeasures: MasterMeasure[] = data.measures || [];
      const parsedDimensions: MasterDimension[] = data.dimensions || [];

      setMeasures(parsedMeasures);
      setDimensions(parsedDimensions);
      setSelectedMeasureIds(parsedMeasures.map(m => m.id));
      setSelectedDimensionIds(parsedDimensions.map(d => d.id));

    } catch (err: any) {
      console.error('Backend Fetch Error:', err);
      setError('Kunde inte läsa in Master Items: ' + err.message);
    } finally {
      setItemLoading(false);
    }
  };

  // 3. Hämta Fält, Dimensioner och Mått för AI Vocabulary Hub
  const fetchVocabularyForApp = async (appId: string) => {
    if (!appId || !apiToken) return;
    const host = formatTenantHost(tenantInput);
    setVocabLoading(true);
    setError(null);
    setVocabStatusLog(null);

    try {
      const response = await fetch('/api/vocabulary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get',
          tenant: host,
          apiKey: apiToken.trim(),
          appId: appId,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Kunde inte läsa fält (${response.status})`);
      }

      const data = await response.json();
      const rawDimensions: any[] = data.dimensions || [];
      const rawMeasures: any[] = data.measures || [];
      const rawFields: string[] = data.fields || [];
      const existingVocab: any[] = data.existingVocab || [];

      const existingMap: Record<string, string[]> = {};
      existingVocab.forEach((item: any) => {
        if (item.targetName) {
          existingMap[item.targetName.toLowerCase()] = item.synonyms || [];
        }
      });

      const combinedList: VocabularyItem[] = [
        ...rawDimensions.map(d => ({
          targetName: d.title,
          type: 'dimension' as const,
          synonyms: existingMap[d.title.toLowerCase()] || [],
        })),
        ...rawMeasures.map(m => ({
          targetName: m.title,
          type: 'measure' as const,
          synonyms: existingMap[m.title.toLowerCase()] || [],
        })),
        ...rawFields
          .filter(f => !rawDimensions.some(d => d.title.toLowerCase() === f.toLowerCase()))
          .map(f => ({
            targetName: f,
            type: 'field' as const,
            synonyms: existingMap[f.toLowerCase()] || [],
          })),
      ];

      setVocabularyList(combinedList);

    } catch (err: any) {
      console.error('Vocabulary Fetch Error:', err);
      setError('Kunde inte läsa in fält från appen: ' + err.message);
    } finally {
      setVocabLoading(false);
    }
  };

  // 4. Hantera Excel-import
  const handleImportVocabulary = (importedItems: VocabularyItem[], mode: 'replace' | 'merge') => {
    if (mode === 'replace') {
      setVocabularyList(importedItems);
      setVocabStatusLog(`📂 Läste in ${importedItems.length} st termer från Excel (Ersatte befintlig lista).`);
      return;
    }

    setVocabularyList((prev) => {
      const map = new Map<string, VocabularyItem>();
      prev.forEach(item => map.set(item.targetName.toLowerCase(), { ...item }));

      let newCount = 0;
      let enrichedCount = 0;

      importedItems.forEach(newItem => {
        const key = newItem.targetName.toLowerCase();
        if (map.has(key)) {
          const existing = map.get(key)!;
          const mergedSynonyms = Array.from(new Set([...existing.synonyms, ...newItem.synonyms]));
          if (mergedSynonyms.length > existing.synonyms.length) enrichedCount++;
          map.set(key, { ...existing, synonyms: mergedSynonyms });
        } else {
          newCount++;
          map.set(key, newItem);
        }
      });

      setVocabStatusLog(
        `🔄 Excel-import slutförd!\n` +
        `• Nya fält/termer tillagda: ${newCount} st\n` +
        `• Befintliga fält berikade med synonymer: ${enrichedCount} st\n` +
        `• Totalt antal termer i ordboken: ${map.size} st`
      );

      return Array.from(map.values());
    });
  };

  // 5. AI-generering (Öppna Säkerhets-preview)
  const handleOpenAiPreview = () => {
    if (vocabularyList.length === 0) return;
    const sanitized = prepareItemsForLLM(
      vocabularyList.map(v => ({ targetName: v.targetName, type: v.type }))
    );
    setPreviewItems(sanitized);
    setIsPreviewModalOpen(true);
  };

  // 6. Skarpt AI-anrop efter godkännande
  const handleExecuteAiGeneration = async (selectedItems: SanitizedItem[], domain: string) => {
    setIsPreviewModalOpen(false);
    setVocabLoading(true);
    setError(null);
    setVocabStatusLog('🤖 Skickar sanerad metadata till AI för synonymgenerering...');

    try {
      const response = await fetch('/api/generate-synonyms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          items: selectedItems,
          geminiKey: geminiKeyInput.trim(),
          domain: domain
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || 'Kunde inte generera synonymer');
      }

      const data = await response.json();
      const suggestions: any[] = data.suggestions || [];
      const source = data.source === 'gemini' ? `Google Gemini (${data.modelUsed})` : `Inbyggd lokal regelmotor (Fallback)`;
      const sugMap: Record<string, string[]> = {};

      suggestions.forEach((s: any) => {
        sugMap[s.targetName] = s.suggestedSynonyms || [];
      });

      const updatedList = vocabularyList.map(item => {
        const newSugs = sugMap[item.targetName] || [];
        const uniqueSet = new Set([...item.synonyms, ...newSugs]);
        return {
          ...item,
          synonyms: Array.from(uniqueSet),
        };
      });

      setVocabularyList(updatedList);
      setVocabStatusLog(
        `✨ AI-synonymer genererade och tillagda!\n` +
        `• Modell som användes: ${source}\n` +
        `• Antal analyserade fält: ${suggestions.length} st\n\n` +
        `👉 Klicka på "Exportera Qlik AI Excel (.xlsx)" för att ladda ner importfilen.`
      );

    } catch (err: any) {
      setError('AI-generering misslyckades: ' + err.message);
      setVocabStatusLog(null);
    } finally {
      setVocabLoading(false);
    }
  };

  // Lägg till synonym manuellt
  const addSynonymToItem = (targetName: string) => {
    const text = (newSynonymInputs[targetName] || '').trim();
    if (!text) return;

    setVocabularyList(prev => prev.map(item => {
      if (item.targetName === targetName && !item.synonyms.includes(text)) {
        return { ...item, synonyms: [...item.synonyms, text] };
      }
      return item;
    }));

    setNewSynonymInputs(prev => ({ ...prev, [targetName]: '' }));
  };

  // Ta bort synonym
  const removeSynonymFromItem = (targetName: string, synToRemove: string) => {
    setVocabularyList(prev => prev.map(item => {
      if (item.targetName === targetName) {
        return { ...item, synonyms: item.synonyms.filter(s => s !== synToRemove) };
      }
      return item;
    }));
  };

  // 7. Exportera Qlik-kompatibel Excel-fil (.xlsx)
  const exportVocabularyToExcel = () => {
    const targetApp = availableApps.find(a => a.id === vocabAppId);
    const activeVocab = vocabularyList.filter(v => v.synonyms && v.synonyms.length > 0);

    if (activeVocab.length === 0) {
      setError('Inga synonymer att exportera. Generera AI-synonymer eller lägg till manuellt först.');
      return;
    }

    const headers = ['Field', 'Locale', 'Terms', 'Condition Type', 'Condition Values', 'Master Item'];
    const rows: string[][] = [headers];

    activeVocab.forEach(item => {
      rows.push([
        String(item.targetName || ''),
        'Sv',
        item.synonyms.join('||'),
        '',
        '',
        item.type === 'measure' || item.type === 'dimension' ? 'True' : 'False'
      ]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

    const fileName = `qlik_vocabulary_${targetApp?.name ? targetApp.name.toLowerCase().replace(/\s+/g, '_') : 'export'}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    setVocabStatusLog(
      `📥 Excel-fil "${fileName}" har laddats ner!\n` +
      `• Innehåller ${activeVocab.length} st fält formaterade efter Qliks officiella mall.\n\n` +
      `💡 Importera i Qlik Sense: Prepare ➔ Business logic ➔ Vocabulary ➔ Import.`
    );
  };

  useEffect(() => {
    if (tenantInput && apiToken) {
      fetchInitialData();
    }
  }, []);

  useEffect(() => {
    if (sourceAppId) {
      fetchMasterItemsForApp(sourceAppId);
    } else {
      setMeasures([]);
      setDimensions([]);
    }
  }, [sourceAppId]);

  useEffect(() => {
    if (vocabAppId) {
      fetchVocabularyForApp(vocabAppId);
    } else {
      setVocabularyList([]);
    }
  }, [vocabAppId]);

  // Synka Master Items
  const handleSyncMasterItems = async () => {
    if (!targetAppId || !apiToken) {
      setError('Vänligen välj en Mål-app (Target App) att distribuera till.');
      return;
    }

    const host = formatTenantHost(tenantInput);
    const targetApp = availableApps.find(a => a.id === targetAppId);
    const selectedMeasuresList = measures.filter(m => selectedMeasureIds.includes(m.id));
    const selectedDimensionsList = dimensions.filter(d => selectedDimensionIds.includes(d.id));

    setLoading(true);
    setError(null);
    setSyncStatusLog('🚀 Skickar Master Items till motorn och sparar i mål-app...');

    try {
      const response = await fetch('/api/sync-master-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant: host,
          apiKey: apiToken.trim(),
          targetAppId: targetAppId,
          measures: selectedMeasuresList,
          dimensions: selectedDimensionsList,
          conflictStrategy: conflictStrategy,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Serverfel (${response.status})`);
      }

      const resData = await response.json();

      setSyncStatusLog(
        `✅ Synkning slutförd och permanent sparad i "${targetApp?.name}"!\n` +
        `• Nyskapade mått: ${resData.createdMeasures} st\n` +
        `• Nyskapade dimensioner: ${resData.createdDimensions} st\n` +
        `• Uppdaterade objekt: ${resData.updated} st\n` +
        `• Överhoppade objekt: ${resData.skipped} st`
      );
    } catch (err: any) {
      console.error('Sync Error:', err);
      setError('Synkningen misslyckades: ' + err.message);
      setSyncStatusLog(null);
    } finally {
      setLoading(false);
    }
  };

  // Exportera Master Items till JSON
  const exportMasterItemsToJson = () => {
    const selectedMeasuresList = measures.filter(m => selectedMeasureIds.includes(m.id));
    const selectedDimensionsList = dimensions.filter(d => selectedDimensionIds.includes(d.id));
    const sourceApp = availableApps.find(a => a.id === sourceAppId);

    const exportPackage = {
      sourceAppId,
      sourceAppName: sourceApp?.name || 'Qlik App',
      exportedAt: new Date().toISOString(),
      measures: selectedMeasuresList,
      dimensions: selectedDimensionsList,
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPackage, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `master_items_${sourceApp?.name ? sourceApp.name.toLowerCase().replace(/\s+/g, '_') : 'export'}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Filtreringar
  const filteredSourceApps = availableApps.filter(app => 
    app.name.toLowerCase().includes(sourceAppSearch.toLowerCase())
  );

  const filteredTargetApps = availableApps.filter(app => 
    app.id !== sourceAppId && app.name.toLowerCase().includes(targetAppSearch.toLowerCase())
  );

  const filteredVocabApps = availableApps.filter(app => 
    app.name.toLowerCase().includes(vocabAppSearch.toLowerCase())
  );

  const filteredVocabularyList = vocabularyList.filter(item => 
    item.targetName.toLowerCase().includes(vocabSearchQuery.toLowerCase()) ||
    item.synonyms.some(s => s.toLowerCase().includes(vocabSearchQuery.toLowerCase()))
  );

  const filteredMeasures = measures.filter(m => 
    m.title.toLowerCase().includes(itemSearchQuery.toLowerCase()) ||
    m.expression.toLowerCase().includes(itemSearchQuery.toLowerCase())
  );

  const filteredDimensions = dimensions.filter(d => 
    d.title.toLowerCase().includes(itemSearchQuery.toLowerCase()) ||
    d.fieldDefs.some(f => f.toLowerCase().includes(itemSearchQuery.toLowerCase()))
  );

  const totalCount = reloadsList.length;
  const successCount = reloadsList.filter(r => r.status === 'SUCCEEDED').length;
  const failedCount = reloadsList.filter(r => r.status === 'FAILED' || r.status === 'CANCELLED' || r.status === 'EXCEEDED_LIMIT').length;
  const successPercent = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;
  const failedPercent = totalCount > 0 ? Math.round((failedCount / totalCount) * 100) : 0;

  const filteredReloads = reloadsList.filter(r => 
    r.appName?.toLowerCase().includes(reloadSearchQuery.toLowerCase()) ||
    r.appId.toLowerCase().includes(reloadSearchQuery.toLowerCase()) ||
    r.status.toLowerCase().includes(reloadSearchQuery.toLowerCase())
  );

  const calculateDuration = (start?: string, end?: string) => {
    if (!start || !end) return '-';
    const diffMs = new Date(end).getTime() - new Date(start).getTime();
    if (diffMs < 0 || isNaN(diffMs)) return '-';
    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
<div className="flex items-center gap-3">
  {/* Modern diskret data-nod istället för det konstiga 'Å' */}
  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-inner">
    <Layers className="w-5 h-5 text-emerald-400" />
  </div>

  <div>
    <div className="flex items-center gap-2.5">
      <span className="text-xl font-bold tracking-tight text-white font-sans">
        affingo
      </span>
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800/60 uppercase tracking-wider">
        Toolbox
      </span>
    </div>
    <div className="text-[11px] text-slate-400 font-medium">
      Qlik Cloud Enterprise Administration & AI Hub
    </div>
  </div>
</div>

          <div className="flex items-center gap-2">
            <button
              onClick={clearSettings}
              title="Rensa sparade uppgifter"
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 rounded-xl border border-slate-700 transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
            <button
              onClick={fetchInitialData}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-4 py-2.5 rounded-xl shadow-lg transition active:scale-95 disabled:opacity-50 cursor-pointer text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Hämtar data...' : 'Uppdatera data'}
            </button>
          </div>
        </div>

        {/* Flikar */}
        <div className="flex border-b border-slate-800 space-x-2">
          <button
            onClick={() => setActiveTab('ai-hub')}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl transition cursor-pointer border-t border-x ${
              activeTab === 'ai-hub'
                ? 'bg-slate-900 text-emerald-400 border-slate-800 border-b-transparent shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-900/40'
            }`}
          >
            <Wand2 className="w-4 h-4 text-emerald-400" />
            AI Business Logic & Vocabulary Hub
          </button>
          <button
            onClick={() => setActiveTab('master-items')}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl transition cursor-pointer border-t border-x ${
              activeTab === 'master-items'
                ? 'bg-slate-900 text-emerald-400 border-slate-800 border-b-transparent shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-900/40'
            }`}
          >
            <Sliders className="w-4 h-4" />
            Master Item Distributor
          </button>
          <button
            onClick={() => setActiveTab('reloads')}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl transition cursor-pointer border-t border-x ${
              activeTab === 'reloads'
                ? 'bg-slate-900 text-emerald-400 border-slate-800 border-b-transparent shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-900/40'
            }`}
          >
            <Play className="w-4 h-4" />
            Reload Monitor
          </button>
          <button
            onClick={() => setActiveTab('spaces')}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl transition cursor-pointer border-t border-x ${
              activeTab === 'spaces'
                ? 'bg-slate-900 text-emerald-400 border-slate-800 border-b-transparent shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-900/40'
            }`}
          >
            <Folder className="w-4 h-4" />
            Space Matrix
          </button>          
        </div>

        {/* Anslutningsinställningar */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-emerald-400" /> Tenant URL / Domän
              </label>
              <input
                type="text"
                placeholder="t.ex. tenant.eu.qlikcloud.com"
                value={tenantInput}
                onChange={(e) => {
                  setTenantInput(e.target.value);
                  localStorage.setItem('qlik_tenant_domain', e.target.value.trim());
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-emerald-400" /> Qlik API Key (Personal Token)
              </label>
              <input
                type="password"
                placeholder="Klistra in token..."
                value={apiToken}
                onChange={(e) => {
                  setApiToken(e.target.value);
                  localStorage.setItem('qlik_api_token', e.target.value.trim());
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Web Integration ID
              </label>
              <input
                type="text"
                placeholder="Från QMC -> Web..."
                value={webIntegrationId}
                onChange={(e) => {
                  setWebIntegrationId(e.target.value);
                  localStorage.setItem('qlik_web_int_id', e.target.value.trim());
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Felmeddelande */}
        {error && (
          <div className="flex items-center gap-3 bg-rose-950/40 border border-rose-800/60 rounded-xl p-4 text-rose-300 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* ============================================================ */}
        {/* FLIK 1: AI VOCABULARY & BUSINESS LOGIC HUB */}
        {/* ============================================================ */}
        {/* ============================================================ */}
        {/* FLIK: AI BUSINESS LOGIC ENRICHER */}
        {/* ============================================================ */}
        {activeTab === 'ai-hub' && (
          <AiBusinessLogicEnricher
            tenantUrl={formatTenantHost(tenantInput)}
            apiToken={apiToken}
            geminiKey={geminiKeyInput}
            availableApps={availableApps}
          />
        )}


        {/* ============================================================ */}
        {/* FLIK 2: MASTER ITEM DISTRIBUTOR */}
        {/* ============================================================ */}
        {activeTab === 'master-items' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Käll-app */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                    <Database className="w-4 h-4" /> Steg 1: Välj Käll-app (Source)
                  </label>
                  <span className="text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                    {availableApps.length} appar inlästa
                  </span>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Filtrera lista (A–Ö)..."
                    value={sourceAppSearch}
                    onChange={(e) => setSourceAppSearch(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <select
                  value={sourceAppId}
                  onChange={(e) => setSourceAppId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="">-- Välj käll-app ({filteredSourceApps.length} st) --</option>
                  {filteredSourceApps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                    </option>
                  ))}
                </select>

                <p className="text-xs text-slate-500">
                  {itemLoading ? 'Läser in Master Items från motorn via backend...' : sourceAppId ? `Inläst: ${measures.length} mått, ${dimensions.length} dimensioner` : 'Välj app för att hämta dess mått och dimensioner.'}
                </p>
              </div>

              {/* Mål-app */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                    <ArrowRight className="w-4 h-4" /> Steg 2: Välj Mål-app (Target)
                  </label>
                  <span className="text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                    {filteredTargetApps.length} valbara
                  </span>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Filtrera lista (A–Ö)..."
                    value={targetAppSearch}
                    onChange={(e) => setTargetAppSearch(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <select
                  value={targetAppId}
                  onChange={(e) => setTargetAppId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="">-- Välj mål-app ({filteredTargetApps.length} st) --</option>
                  {filteredTargetApps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                    </option>
                  ))}
                </select>

                <p className="text-xs text-slate-500">
                  Appen dit valda Master Items kommer att distribueras.
                </p>
              </div>
            </div>

            {/* Konflikthantering & Exportknappar */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  Konflikthantering (Om objektet redan finns i mål-appen):
                </span>
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="conflict"
                      value="overwrite"
                      checked={conflictStrategy === 'overwrite'}
                      onChange={() => setConflictStrategy('overwrite')}
                      className="accent-emerald-500"
                    />
                    <span>Uppdatera / Skriv över (Overwrite)</span>
                  </label>
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="conflict"
                      value="skip"
                      checked={conflictStrategy === 'skip'}
                      onChange={() => setConflictStrategy('skip')}
                      className="accent-emerald-500"
                    />
                    <span>Hoppa över (Skip)</span>
                  </label>
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="conflict"
                      value="copy"
                      checked={conflictStrategy === 'copy'}
                      onChange={() => setConflictStrategy('copy')}
                      className="accent-emerald-500"
                    />
                    <span>Skapa kopia (_v2)</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={exportMasterItemsToJson}
                  disabled={!sourceAppId || (selectedMeasureIds.length === 0 && selectedDimensionIds.length === 0)}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-semibold border border-slate-700 transition disabled:opacity-40 cursor-pointer"
                >
                  <Download className="w-4 h-4 text-emerald-400" /> Exportera till JSON
                </button>
                <button
                  onClick={handleSyncMasterItems}
                  disabled={!targetAppId || (selectedMeasureIds.length === 0 && selectedDimensionIds.length === 0)}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-5 py-2 rounded-xl text-xs font-bold transition disabled:opacity-40 shadow-lg cursor-pointer"
                >
                  <ArrowRight className="w-4 h-4" /> Synka till mål-app ({selectedMeasureIds.length + selectedDimensionIds.length})
                </button>
              </div>
            </div>

            {/* Synklogg */}
            {syncStatusLog && (
              <div className="bg-emerald-950/30 border border-emerald-800/60 rounded-2xl p-5 text-emerald-300 text-xs whitespace-pre-line font-mono">
                {syncStatusLog}
              </div>
            )}

            {/* Master Item Listvy */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Master Items i käll-appen</h2>
                  <p className="text-xs text-slate-400">Välj vilka mått och dimensioner du vill distribuera</p>
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Sök formel eller namn..."
                    value={itemSearchQuery}
                    onChange={(e) => setItemSearchQuery(e.target.value)}
                    className="w-full sm:w-64 bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {!sourceAppId ? (
                <div className="p-12 text-center text-slate-500 text-sm">
                  Vänligen välj en käll-app ovan för att läsa in dess Master Items via motorn.
                </div>
              ) : itemLoading ? (
                <div className="p-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                  Öppnar app i QIX Engine och läser in Master Items...
                </div>
              ) : measures.length === 0 && dimensions.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-sm">
                  Inga Master Items hittades i den valda appen.
                </div>
              ) : (
                <div className="p-6 space-y-6">
                  
                  {/* Mått */}
                  <div>
                    <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
                      <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                        🟢 Mått / Measures ({measures.length})
                      </h3>
                      <button
                        onClick={() => {
                          if (selectedMeasureIds.length === measures.length) {
                            setSelectedMeasureIds([]);
                          } else {
                            setSelectedMeasureIds(measures.map(m => m.id));
                          }
                        }}
                        className="text-xs text-slate-400 hover:text-white cursor-pointer"
                      >
                        {selectedMeasureIds.length === measures.length ? 'Avmarkera alla mått' : 'Välj alla mått'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredMeasures.map((measure) => {
                        const isSelected = selectedMeasureIds.includes(measure.id);
                        return (
                          <div
                            key={measure.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedMeasureIds(selectedMeasureIds.filter(id => id !== measure.id));
                              } else {
                                setSelectedMeasureIds([...selectedMeasureIds, measure.id]);
                              }
                            }}
                            className={`p-4 rounded-xl border transition cursor-pointer flex items-start gap-3 ${
                              isSelected
                                ? 'bg-slate-800/80 border-emerald-500/50 shadow-sm'
                                : 'bg-slate-950/50 border-slate-800/80 opacity-60 hover:opacity-100'
                            }`}
                          >
                            <div className="mt-0.5 text-emerald-400">
                              {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-600" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-white text-sm truncate">{measure.title}</div>
                              <div className="font-mono text-xs text-emerald-300 bg-slate-900/90 px-2 py-1 rounded-lg mt-1 border border-slate-800 break-all">
                                {measure.expression || 'Inget uttryck definierat'}
                              </div>
                              {measure.description && (
                                <p className="text-xs text-slate-400 mt-1 truncate">{measure.description}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Dimensioner */}
                  <div className="pt-4">
                    <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
                      <h3 className="text-sm font-semibold text-sky-400 flex items-center gap-2">
                        🔷 Dimensioner / Dimensions ({dimensions.length})
                      </h3>
                      <button
                        onClick={() => {
                          if (selectedDimensionIds.length === dimensions.length) {
                            setSelectedDimensionIds([]);
                          } else {
                            setSelectedDimensionIds(dimensions.map(d => d.id));
                          }
                        }}
                        className="text-xs text-slate-400 hover:text-white cursor-pointer"
                      >
                        {selectedDimensionIds.length === dimensions.length ? 'Avmarkera alla dimensioner' : 'Välj alla dimensioner'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredDimensions.map((dimension) => {
                        const isSelected = selectedDimensionIds.includes(dimension.id);
                        return (
                          <div
                            key={dimension.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedDimensionIds(selectedDimensionIds.filter(id => id !== dimension.id));
                              } else {
                                setSelectedDimensionIds([...selectedDimensionIds, dimension.id]);
                              }
                            }}
                            className={`p-4 rounded-xl border transition cursor-pointer flex items-start gap-3 ${
                              isSelected
                                ? 'bg-slate-800/80 border-sky-500/50 shadow-sm'
                                : 'bg-slate-950/50 border-slate-800/80 opacity-60 hover:opacity-100'
                            }`}
                          >
                            <div className="mt-0.5 text-sky-400">
                              {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-600" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white text-sm truncate">{dimension.title}</span>
                                <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-sky-300 rounded font-mono">
                                  {dimension.grouping === 'H' ? 'Hierarki' : 'Enkel'}
                                </span>
                              </div>
                              <div className="font-mono text-xs text-sky-300 bg-slate-900/90 px-2 py-1 rounded-lg mt-1 border border-slate-800 truncate">
                                {dimension.fieldDefs?.join(' ➔ ') || 'Inga fält definierade'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              )}
            </div>

          </div>
        )}

        {/* ============================================================ */}
        {/* FLIK 3: RELOAD MONITOR */}
        {/* ============================================================ */}
        {activeTab === 'reloads' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-sm font-medium">Totalt körda</span>
                  <Clock className="w-4 h-4 text-slate-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-white">{totalCount}</span>
                  <span className="text-xs text-slate-500">senaste 24h</span>
                </div>
              </div>

              <div className="bg-slate-900 border border-emerald-900/40 rounded-2xl p-5">
                <div className="flex items-center justify-between text-emerald-400">
                  <span className="text-sm font-medium">Lyckade laddningar</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-emerald-400">{successCount}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                    {successPercent}%
                  </span>
                </div>
              </div>

              <div className="bg-slate-900 border border-rose-900/40 rounded-2xl p-5">
                <div className="flex items-center justify-between text-rose-400">
                  <span className="text-sm font-medium">Misslyckade laddningar</span>
                  <XCircle className="w-4 h-4 text-rose-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-rose-400">{failedCount}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-950 text-rose-400 border border-rose-800">
                    {failedPercent}%
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-white">Reload-logg</h2>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Filtrera på app eller status..."
                    value={reloadSearchQuery}
                    onChange={(e) => setReloadSearchQuery(e.target.value)}
                    className="w-full sm:w-64 bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-950/60 text-xs font-semibold uppercase text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-6 py-3.5">Status</th>
                      <th className="px-6 py-3.5">Appnamn</th>
                      <th className="px-6 py-3.5">Starttid (Lokal)</th>
                      <th className="px-6 py-3.5">Varaktighet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredReloads.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-10 text-center text-slate-500">
                          {loading ? 'Hämtar data...' : 'Inga reloads matchar sökningen.'}
                        </td>
                      </tr>
                    ) : (
                      filteredReloads.map((reload) => (
                        <tr key={reload.id} className="hover:bg-slate-800/30 transition">
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                              reload.status === 'SUCCEEDED'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : 'bg-rose-950 text-rose-400 border border-rose-800'
                            }`}>
                              {reload.status === 'SUCCEEDED' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                              )}
                              {reload.status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-semibold text-white">{reload.appName}</div>
                            <div className="font-mono text-xs text-slate-500">{reload.appId}</div>
                          </td>
                          <td className="px-6 py-4 text-slate-300 text-xs">
                            {new Date(reload.startTime).toLocaleString('sv-SE')}
                          </td>
                          <td className="px-6 py-4 text-slate-400 text-xs font-medium">
                            {calculateDuration(reload.startTime, reload.endTime)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
{/* LÄGG IN SPACE MATRIX DIREKT HÄR: */}
{activeTab === 'spaces' && (
    <SpacePermissionMatrix 
      tenantInput={tenantInput} 
      apiToken={apiToken} 
      webIntegrationId={webIntegrationId} 
    />
)}
      </div>
    </div>
  );
}