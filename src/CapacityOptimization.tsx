import React, { useState } from 'react';
import { 
  Database, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  Download, 
  Search, 
  FileText,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

interface QvdItem {
  id: string;
  name: string;
  spaceId: string;
  spaceName: string;
  updatedAt: string;
  createdAt: string;
  readers: string[];
  writers: string[];
  isOrphan: boolean;
  status: 'UNREAD' | 'ACTIVE';
}

interface SummaryData {
  totalQvds: number;
  orphanQvds: number;
  activeQvds: number;
  totalAppsScanned: number;
  scriptsRead?: number;
}

type SortField = 'name' | 'spaceName' | 'status' | 'readers' | 'writers' | 'updatedAt';

interface Props {
  tenantUrl: string;
  apiKey: string;
}

export const CapacityOptimization: React.FC<Props> = ({ tenantUrl, apiKey }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [qvds, setQvds] = useState<QvdItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [onlyOrphans, setOnlyOrphans] = useState(false);
  
  const [sortField, setSortField] = useState<SortField>('status');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === 'updatedAt' ? false : true);
    }
  };

  const runAnalysis = async () => {
    if (!tenantUrl || !apiKey) {
      setError('Ange Tenant URL och API Key under Anslutning.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/capacity-qvd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantUrl, apiKey }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Kunde inte slutföra QVD-analysen.');
      }

      const data = await response.json();
      setSummary(data.summary);
      setQvds(data.qvds);
    } catch (err: any) {
      setError(err.message || 'Ett fel uppstod vid analysen.');
    } finally {
      setLoading(false);
    }
  };

  const filteredQvds = qvds
    .filter((item) => {
      const matchesSearch = 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.spaceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.writers.some(w => w.toLowerCase().includes(searchTerm.toLowerCase())) ||
        item.readers.some(r => r.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesOrphan = onlyOrphans ? item.isOrphan : true;
      return matchesSearch && matchesOrphan;
    })
    .sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name, 'sv');
          break;
        case 'spaceName':
          comparison = a.spaceName.localeCompare(b.spaceName, 'sv');
          break;
        case 'status':
          comparison = (a.isOrphan === b.isOrphan) ? a.name.localeCompare(b.name, 'sv') : a.isOrphan ? -1 : 1;
          break;
        case 'readers':
          comparison = a.readers.join(', ').localeCompare(b.readers.join(', '), 'sv');
          break;
        case 'writers':
          comparison = a.writers.join(', ').localeCompare(b.writers.join(', '), 'sv');
          break;
        case 'updatedAt':
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }

      return sortAsc ? comparison : -comparison;
    });

  const exportToCsv = () => {
    if (!qvds.length) return;

    const headers = ['QVD Namn', 'Space', 'Status', 'Laddas av (Appar)', 'Skapas av (Appar)', 'Senast uppdaterad'];
    const rows = filteredQvds.map((q) => [
      `"${q.name}"`,
      `"${q.spaceName}"`,
      `"${q.isOrphan ? 'Oanvänd (Orphan)' : 'Aktiv'}"`,
      `"${q.readers.join(', ')}"`,
      `"${q.writers.join(', ')}"`,
      `"${new Date(q.updatedAt).toLocaleDateString('sv-SE')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `qvd-capacity-analysis-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-600 group-hover:text-slate-400 transition" />;
    }
    return sortAsc ? (
      <ArrowUp className="w-3 h-3 text-emerald-400" />
    ) : (
      <ArrowDown className="w-3 h-3 text-emerald-400" />
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-400" />
            Kapacitet & QVD-analys
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Identifiera föräldralösa QVD-filer som inte konsumeras av någon app i tenanten.
          </p>
        </div>

        <button
          onClick={runAnalysis}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-950/80 disabled:border disabled:border-emerald-700/60 disabled:text-emerald-300 text-slate-950 font-bold rounded-xl text-xs transition cursor-pointer shadow-lg disabled:cursor-not-allowed shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-300' : 'text-slate-950'}`} />
          <span>{loading ? 'Scannar lineage...' : 'Starta analys'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 flex items-center gap-2 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
          {error}
        </div>
      )}

      {/* KPI-kort */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Totalt QVD-filer</span>
            <div className="text-xl font-bold text-white mt-0.5">{summary.totalQvds}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">I alla spaces</div>
          </div>

          <div className="bg-slate-900 border border-amber-900/40 p-4 rounded-xl shadow-sm">
            <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Oanvända QVD:er</span>
            <div className="text-xl font-bold text-amber-400 mt-0.5">{summary.orphanQvds}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Läses inte av någon app</div>
          </div>

          <div className="bg-slate-900 border border-emerald-900/40 p-4 rounded-xl shadow-sm">
            <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Aktiva QVD:er</span>
            <div className="text-xl font-bold text-emerald-400 mt-0.5">{summary.activeQvds}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Konsumeras i produktion</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
            <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">Analyserade appar</span>
            <div className="text-xl font-bold text-indigo-400 mt-0.5">{summary.scriptsRead || summary.totalAppsScanned}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Av {summary.totalAppsScanned} appar i tenanten</div>
          </div>
        </div>
      )}

      {/* Filter & Tabellsektion */}
      {qvds.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          
          <div className="p-4 border-b border-slate-800/80 flex flex-col sm:flex-row justify-between items-center gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Sök QVD, app eller space..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-300">
                <input
                  type="checkbox"
                  checked={onlyOrphans}
                  onChange={(e) => setOnlyOrphans(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-emerald-500 h-3.5 w-3.5"
                />
                Visa endast oanvända ({summary?.orphanQvds})
              </label>

              <button
                onClick={exportToCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                Exportera CSV
              </button>
            </div>
          </div>

          <div className="max-h-[620px] overflow-y-auto overflow-x-hidden">
            <table className="w-full table-fixed text-left border-collapse text-xs">
              <thead className="bg-slate-950 sticky top-0 z-10 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[11px] font-semibold select-none">
                <tr>
                  <th 
                    onClick={() => handleSort('name')}
                    className="py-2.5 px-3 w-[22%] cursor-pointer hover:text-white transition group"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">QVD Namn</span>
                      {renderSortIcon('name')}
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort('spaceName')}
                    className="py-2.5 px-2.5 w-[14%] cursor-pointer hover:text-white transition group"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">Space</span>
                      {renderSortIcon('spaceName')}
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort('status')}
                    className="py-2.5 px-2 w-[12%] cursor-pointer hover:text-white transition group"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Status</span>
                      {renderSortIcon('status')}
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort('readers')}
                    className="py-2.5 px-2.5 w-[24%] cursor-pointer hover:text-white transition group"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">Konsumeras av</span>
                      {renderSortIcon('readers')}
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort('writers')}
                    className="py-2.5 px-2.5 w-[16%] cursor-pointer hover:text-white transition group"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">Genereras av</span>
                      {renderSortIcon('writers')}
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort('updatedAt')}
                    className="py-2.5 px-3 w-[12%] text-right cursor-pointer hover:text-white transition group"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Uppdaterad</span>
                      {renderSortIcon('updatedAt')}
                    </div>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredQvds.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-slate-500">
                      Inga QVD-filer matchar filtreringen.
                    </td>
                  </tr>
                ) : (
                  filteredQvds.map((qvd) => (
                    <tr key={qvd.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-2 px-3 font-medium text-white overflow-hidden text-ellipsis whitespace-nowrap" title={qvd.name}>
                        <div className="flex items-center gap-1.5 truncate">
                          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{qvd.name}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2.5 text-slate-400 overflow-hidden text-ellipsis whitespace-nowrap" title={qvd.spaceName}>
                        {qvd.spaceName}
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        {qvd.isOrphan ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-950/90 text-amber-400 border border-amber-800/80">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            Oanvänd
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-950/90 text-emerald-400 border border-emerald-800/80">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            Aktiv
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2.5 overflow-hidden">
                        {qvd.readers.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
                            {qvd.readers.map((app, idx) => (
                              <span key={idx} className="bg-slate-800/90 text-slate-300 text-[10px] px-1.5 py-0.5 rounded border border-slate-700/80 truncate max-w-full" title={app}>
                                {app}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">Ingen app</span>
                        )}
                      </td>
                      <td className="py-2 px-2.5 overflow-hidden">
                        {qvd.writers.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
                            {qvd.writers.map((app, idx) => (
                              <span key={idx} className="bg-slate-800/90 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded border border-slate-700/80 truncate max-w-full" title={app}>
                                {app}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">Okänd källa</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-400 text-right font-mono text-[11px] whitespace-nowrap">
                        {new Date(qvd.updatedAt).toLocaleDateString('sv-SE')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          <div className="p-3 bg-slate-950/50 border-t border-slate-800 text-[11px] text-slate-500 flex justify-between items-center">
            <span>Visar {filteredQvds.length} av {qvds.length} QVD-filer</span>
            <span>Sorterad efter: <strong className="text-slate-400 font-medium">{sortField} ({sortAsc ? 'Stigande' : 'Fallande'})</strong></span>
          </div>
        </div>
      )}
    </div>
  );
};