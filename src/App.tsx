import { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Clock, Server, Key, Play, Search, AlertCircle, LogOut, ShieldCheck } from 'lucide-react';

interface ReloadItem {
  id: string;
  appId: string;
  appName?: string;
  status: string;
  startTime: string;
  endTime?: string;
}

export default function App() {
  const [tenantInput, setTenantInput] = useState(() => localStorage.getItem('qlik_tenant_domain') || '');
  const [apiToken, setApiToken] = useState(() => localStorage.getItem('qlik_api_token') || '');
  const [webIntegrationId, setWebIntegrationId] = useState(() => localStorage.getItem('qlik_web_int_id') || '');
  const [reloads, setReloads] = useState<ReloadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Formatera tenant-URL dynamiskt och säkert
  const formatTenantUrl = (input: string) => {
    let clean = input.trim().replace(/\/$/, '');
    if (!clean) return '';
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      if (!clean.includes('.')) {
        clean = `${clean}.eu.qlikcloud.com`;
      }
      clean = `https://${clean}`;
    }
    return clean;
  };

  const saveSettings = () => {
    localStorage.setItem('qlik_tenant_domain', tenantInput.trim());
    localStorage.setItem('qlik_api_token', apiToken.trim());
    localStorage.setItem('qlik_web_int_id', webIntegrationId.trim());
  };

  const clearSettings = () => {
    localStorage.removeItem('qlik_tenant_domain');
    localStorage.removeItem('qlik_api_token');
    localStorage.removeItem('qlik_web_int_id');
    setTenantInput('');
    setApiToken('');
    setWebIntegrationId('');
    setReloads([]);
  };

  const fetchReloadsAndApps = async () => {
    const baseUrl = formatTenantUrl(tenantInput);

    if (!baseUrl || !apiToken) {
      setError('Vänligen ange både Tenant-domän och API-nyckel.');
      return;
    }

    saveSettings();
    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiToken.trim()}`,
        'Content-Type': 'application/json',
      };

      // Om Web Integration ID finns angett, skicka med det för CORS-validering
      if (webIntegrationId.trim()) {
        headers['qlik-web-integration-id'] = webIntegrationId.trim();
      }

      // 1. Dynamiska anrop mot angiven tenant
      const [reloadsRes, itemsRes, appsRes] = await Promise.all([
        fetch(`${baseUrl}/api/v1/reloads?limit=100`, { headers }),
        fetch(`${baseUrl}/api/v1/items?resourceType=app,qvapp&limit=100`, { headers }).catch(() => null),
        fetch(`${baseUrl}/api/v1/apps?limit=100`, { headers }).catch(() => null)
      ]);

      if (!reloadsRes.ok) {
        if (reloadsRes.status === 401) {
          throw new Error('Autentiseringen misslyckades (401). Kontrollera API-nyckeln och att Web Integration ID är ifyllt.');
        }
        if (reloadsRes.status === 403) {
          throw new Error('Åtkomst nekad (403). Kontrollera rättigheterna i Qlik Cloud.');
        }
        throw new Error(`API-fel (${reloadsRes.status}): ${reloadsRes.statusText}`);
      }

      const reloadsData = await reloadsRes.json();
      
      // 2. Lookup för appnamn
      const appNameMap: Record<string, string> = {};

      if (itemsRes && itemsRes.ok) {
        const itemsData = await itemsRes.json();
        const items = itemsData.data || [];
        items.forEach((item: any) => {
          const id = item.resourceId || item.id;
          const name = item.name || item.resourceAttributes?.name;
          if (id && name) appNameMap[id] = name;
        });
      }

      if (appsRes && appsRes.ok) {
        const appsData = await appsRes.json();
        const appList = appsData.data || appsData || [];
        if (Array.isArray(appList)) {
          appList.forEach((item: any) => {
            const id = item.id || item.resourceId;
            const name = item.attributes?.name || item.name;
            if (id && name) appNameMap[id] = name;
          });
        }
      }

      // 3. Filtrera senaste 24h
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const rawReloads: any[] = reloadsData.data || [];

      const enrichedReloads: ReloadItem[] = rawReloads
        .filter(r => new Date(r.startTime || r.createdAt) >= new Date(twentyFourHoursAgo))
        .map(r => ({
          id: r.id,
          appId: r.appId,
          appName: appNameMap[r.appId] || (r.appId ? `App (${r.appId.substring(0, 8)}...)` : 'Okänd app'),
          status: r.status,
          startTime: r.startTime || r.createdAt,
          endTime: r.endTime,
        }))
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

      setReloads(enrichedReloads);
    } catch (err: any) {
      setError(err.message || 'Kunde inte ansluta till Qlik Cloud.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantInput && apiToken) {
      fetchReloadsAndApps();
    }
  }, []);

  const totalCount = reloads.length;
  const successCount = reloads.filter(r => r.status === 'SUCCEEDED').length;
  const failedCount = reloads.filter(r => r.status === 'FAILED' || r.status === 'CANCELLED' || r.status === 'EXCEEDED_LIMIT').length;

  const successPercent = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;
  const failedPercent = totalCount > 0 ? Math.round((failedCount / totalCount) * 100) : 0;

  const filteredReloads = reloads.filter(r => 
    r.appName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.appId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.status.toLowerCase().includes(searchQuery.toLowerCase())
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
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
              <Play className="w-6 h-6 fill-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Qlik Cloud Reload Monitor</h1>
              <p className="text-sm text-slate-400">Övervakning av laddningar senaste 24 timmarna</p>
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
              onClick={fetchReloadsAndApps}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-5 py-2.5 rounded-xl shadow-lg transition active:scale-95 disabled:opacity-50 cursor-pointer text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Uppdaterar...' : 'Uppdatera status'}
            </button>
          </div>
        </div>

        {/* Anslutningsinställningar */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5" /> Tenant URL / Domän
              </label>
              <input
                type="text"
                placeholder="t.ex. affingo-ab.eu.qlikcloud.com"
                value={tenantInput}
                onChange={(e) => setTenantInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5" /> API Key (Personal Access Token)
              </label>
              <input
                type="password"
                placeholder="Klistra in token..."
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
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
                onChange={(e) => setWebIntegrationId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
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

        {/* KPI-Kort */}
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

        {/* Tabell */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Reload-logg</h2>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Filtrera på app eller status..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
    </div>
  );
}