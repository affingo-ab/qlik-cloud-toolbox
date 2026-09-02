import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Download, Search, Users, User, Folder, ShieldCheck, Shield } from 'lucide-react';

interface Props {
  tenantInput: string;
  apiToken: string;
  webIntegrationId?: string;
}

export interface SpaceAssignment {
  id: string;
  type: 'user' | 'group';
  assigneeId: string;
  roles: string[];
  spaceId: string;
  spaceName?: string;
  spaceType?: string;
  name?: string;
  email?: string;
}

export const SpacePermissionMatrix: React.FC<Props> = ({ 
  tenantInput, 
  apiToken, 
  webIntegrationId = '' 
}) => {
  const [spaces, setSpaces] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<SpaceAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [viewMode, setViewMode] = useState<'bySpace' | 'byMember'>('bySpace');
  const [searchTerm, setSearchTerm] = useState('');
  const [spaceTypeFilter, setSpaceTypeFilter] = useState('all');

  const formatTenantHost = (input: string) => {
    let clean = (input || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!clean) return '';
    if (!clean.includes('.')) {
      clean = `${clean}.eu.qlikcloud.com`;
    }
    return clean;
  };

  const getHeaders = () => {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${(apiToken || '').trim()}`,
      'Content-Type': 'application/json',
    };
    if (webIntegrationId && webIntegrationId.trim()) {
      headers['qlik-web-integration-id'] = webIntegrationId.trim();
    }
    return headers;
  };

  const loadMatrixData = async () => {
    const host = formatTenantHost(tenantInput);
    if (!host || !apiToken) return;

    setLoading(true);
    setProgressText('Hämtar spaces, användare och grupper...');

    const headers = getHeaders();
    const baseUrl = `https://${host}`;

    try {
      // 1. Hämta alla spaces
      const spacesRes = await fetch(`${baseUrl}/api/v1/spaces?limit=100`, { headers });
      let fetchedSpaces: any[] = [];
      if (spacesRes.ok) {
        const sData = await spacesRes.json();
        fetchedSpaces = sData.data || [];
        setSpaces(fetchedSpaces);
      }

      // 2. Hämta users och groups
      const [resUsers, resGroups] = await Promise.all([
        fetch(`${baseUrl}/api/v1/users?limit=100`, { headers }).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
        fetch(`${baseUrl}/api/v1/groups?limit=100`, { headers }).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] }))
      ]);

      const fetchedUsers = resUsers.data || [];
      const fetchedGroups = resGroups.data || [];

      const userMap = new Map(fetchedUsers.map((u: any) => [u.id, u.name || u.email || u.id]));
      const userEmailMap = new Map(fetchedUsers.map((u: any) => [u.id, u.email || '']));
      const groupMap = new Map(fetchedGroups.map((g: any) => [g.id, g.name || g.id]));

      // 3. Hämta assignments för alla spaces
      const allAssignments: SpaceAssignment[] = [];
      let count = 0;

      for (const space of fetchedSpaces) {
        count++;
        setProgressText(`Läser behörigheter för space ${count} av ${fetchedSpaces.length}: ${space.name}...`);
        try {
          const resA = await fetch(`${baseUrl}/api/v1/spaces/${space.id}/assignments?limit=100`, { headers });
          if (resA.ok) {
            const dataA = await resA.json();
            for (const sa of (dataA.data || [])) {
              allAssignments.push({
                ...sa,
                spaceName: space.name,
                spaceType: space.type,
                name: sa.type === 'user' ? (userMap.get(sa.assigneeId) || sa.assigneeId) : (groupMap.get(sa.assigneeId) || sa.assigneeId),
                email: sa.type === 'user' ? (userEmailMap.get(sa.assigneeId) as string) : undefined
              });
            }
          }
        } catch (e) {
          console.warn('Fel vid läsning av assignments:', e);
        }
      }

      setAssignments(allAssignments);
    } catch (err: any) {
      console.error('Fel vid laddning av Space Matrix:', err);
    } finally {
      setLoading(false);
      setProgressText('');
    }
  };

  useEffect(() => {
    if (tenantInput && apiToken) {
      loadMatrixData();
    }
  }, [tenantInput, apiToken, webIntegrationId]);

  const filteredSpaces = useMemo(() => {
    return spaces.filter(s => {
      if (spaceTypeFilter !== 'all' && s.type !== spaceTypeFilter) return false;
      if (searchTerm && !s.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [spaces, spaceTypeFilter, searchTerm]);

  const memberMatrix = useMemo(() => {
    const memberMap = new Map<string, { id: string; name: string; type: 'user' | 'group'; email?: string; spaces: { spaceName: string; spaceType: string; roles: string[] }[] }>();

    for (const a of assignments) {
      if (!memberMap.has(a.assigneeId)) {
        memberMap.set(a.assigneeId, {
          id: a.assigneeId,
          name: a.name || a.assigneeId,
          type: a.type,
          email: a.email,
          spaces: []
        });
      }
      memberMap.get(a.assigneeId)!.spaces.push({
        spaceName: a.spaceName || a.spaceId,
        spaceType: a.spaceType || 'shared',
        roles: a.roles
      });
    }

    return Array.from(memberMap.values()).filter(m => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return m.name.toLowerCase().includes(term) ||
               (m.email && m.email.toLowerCase().includes(term)) ||
               m.spaces.some(s => s.spaceName.toLowerCase().includes(term));
      }
      return true;
    });
  }, [assignments, searchTerm]);

  const exportToCsv = () => {
    const headersList = ['SpaceName', 'SpaceType', 'AssigneeType', 'AssigneeName', 'Email', 'Roles'];
    const rows = assignments.map(a => [
      `"${a.spaceName || ''}"`,
      `"${a.spaceType || ''}"`,
      `"${a.type}"`,
      `"${a.name || ''}"`,
      `"${a.email || ''}"`,
      `"${a.roles.join(', ')}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headersList.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `QlikCloud_Permissions_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const host = formatTenantHost(tenantInput);

  if (!host || !apiToken) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
        <ShieldCheck className="w-8 h-8 mx-auto text-slate-500" />
        <div className="text-base font-semibold text-slate-200">Ingen aktiv anslutning</div>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Fyll i din Tenant URL och Qlik API Key i toppen och klicka på <strong>Hämta data</strong> för att läsa in Space Matrix.
        </p>
      </div>
    );
  }

  // Hjälpare för snygga rollbrickor
  const renderRoleBadge = (role: string) => {
    let colorClass = 'bg-slate-800 text-slate-300 border-slate-700';
    if (role.toLowerCase().includes('facilitator') || role.toLowerCase().includes('admin')) {
      colorClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    } else if (role.toLowerCase().includes('edit') || role.toLowerCase().includes('contribute')) {
      colorClass = 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    } else if (role.toLowerCase().includes('view') || role.toLowerCase().includes('consume')) {
      colorClass = 'bg-slate-800 text-slate-300 border-slate-700';
    }
    return (
      <span key={role} className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${colorClass}`}>
        {role}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Verktygsfält & Filter */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Sök space, användare eller grupp..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1">
            <button
              onClick={() => setViewMode('bySpace')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'bySpace' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Folder className="w-3.5 h-3.5" /> Per Space
            </button>
            <button
              onClick={() => setViewMode('byMember')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'byMember' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <User className="w-3.5 h-3.5" /> Per Medlem
            </button>
          </div>

          {viewMode === 'bySpace' && (
            <select
              value={spaceTypeFilter}
              onChange={(e) => setSpaceTypeFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50"
            >
              <option value="all">Alla typer</option>
              <option value="shared">Shared</option>
              <option value="managed">Managed</option>
              <option value="data">Data</option>
            </select>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadMatrixData}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-4 py-2.5 rounded-xl border border-slate-700 transition cursor-pointer text-xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Uppdatera
          </button>
          <button
            onClick={exportToCsv}
            disabled={assignments.length === 0}
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-4 py-2.5 rounded-xl shadow-lg transition cursor-pointer text-xs disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> Exportera CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3 shadow-lg">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-400" />
          <div className="text-sm font-semibold text-slate-200">{progressText}</div>
        </div>
      ) : spaces.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-2 shadow-lg">
          <Folder className="w-8 h-8 mx-auto text-slate-500" />
          <div className="text-sm font-semibold text-slate-200">Inga spaces hittades</div>
          <p className="text-xs text-slate-500">Klicka på "Uppdatera" för att läsa in från din tenant.</p>
        </div>
      ) : (
        <>
          {/* VY 1: PER SPACE */}
          {viewMode === 'bySpace' && (
            <div className={`grid gap-6 ${
              filteredSpaces.length === 1 
                ? 'grid-cols-1' 
                : filteredSpaces.length === 2 
                ? 'grid-cols-1 lg:grid-cols-2' 
                : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'
            }`}>
              {filteredSpaces.map(space => {
                const spaceAssigns = assignments.filter(a => a.spaceId === space.id);
                const isSingleOrFiltered = filteredSpaces.length <= 2;

                return (
                  <div key={space.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-lg">
                    {/* Kortets Header */}
                    <div className="p-5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-3 truncate">
                        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                          <Folder className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-100 text-sm truncate">{space.name}</h3>
                          <p className="text-[11px] text-slate-400">{spaceAssigns.length} tilldelade medlemmar</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border ${
                        space.type === 'managed'
                          ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }`}>
                        {space.type}
                      </span>
                    </div>

                    {/* Kortets Innehåll */}
                    {isSingleOrFiltered ? (
                      /* Rymlig tabellvy när man filtrerat fram 1-2 spaces */
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-950/40 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800/80">
                            <tr>
                              <th className="py-3 px-5">Medlem</th>
                              <th className="py-3 px-5">Typ</th>
                              <th className="py-3 px-5 text-right">Roller & Rättigheter</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 text-slate-300">
                            {spaceAssigns.length === 0 ? (
                              <tr>
                                <td colSpan={3} className="py-8 text-center text-slate-500 italic">
                                  Inga tilldelningar i detta space
                                </td>
                              </tr>
                            ) : (
                              spaceAssigns.map(a => (
                                <tr key={a.id} className="hover:bg-slate-800/30 transition">
                                  <td className="py-3.5 px-5 font-semibold text-slate-200 flex items-center gap-2.5">
                                    {a.type === 'group' ? (
                                      <Users className="w-4 h-4 text-emerald-400 shrink-0" />
                                    ) : (
                                      <User className="w-4 h-4 text-emerald-400 shrink-0" />
                                    )}
                                    <div className="truncate">
                                      <div>{a.name}</div>
                                      {a.email && <div className="text-[11px] text-slate-500 font-normal">{a.email}</div>}
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-5 text-slate-400">
                                    {a.type === 'group' ? 'Grupp' : 'Användare'}
                                  </td>
                                  <td className="py-3.5 px-5 text-right">
                                    <div className="flex flex-wrap gap-1.5 justify-end">
                                      {a.roles.map(r => renderRoleBadge(r))}
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      /* Grid-listvy vid översikt av många spaces */
                      <div className="p-4 divide-y divide-slate-800/50 max-h-72 overflow-y-auto flex-1">
                        {spaceAssigns.length === 0 ? (
                          <div className="text-xs text-slate-500 italic py-4 text-center">Inga tilldelningar</div>
                        ) : (
                          spaceAssigns.map(a => (
                            <div key={a.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2 truncate text-slate-300">
                                {a.type === 'group' ? (
                                  <Users className="w-4 h-4 text-slate-500 shrink-0" />
                                ) : (
                                  <User className="w-4 h-4 text-slate-500 shrink-0" />
                                )}
                                <span className="truncate font-medium text-slate-200">{a.name}</span>
                              </div>
                              <div className="flex flex-wrap gap-1 justify-end shrink-0">
                                {a.roles.map(r => renderRoleBadge(r))}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* VY 2: PER MEMBER */}
          {viewMode === 'byMember' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-4">Medlem</th>
                    <th className="p-4">Typ</th>
                    <th className="p-4">Antal Spaces</th>
                    <th className="p-4">Tilldelade Spaces & Roller</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {memberMatrix.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-500 italic">
                        Inga medlemmar hittades eller matchar sökningen.
                      </td>
                    </tr>
                  ) : (
                    memberMatrix.map(m => (
                      <tr key={m.id} className="hover:bg-slate-800/40 transition">
                        <td className="p-4 font-semibold text-slate-200 flex items-center gap-2.5">
                          {m.type === 'group' ? (
                            <Users className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <User className="w-4 h-4 text-emerald-400 shrink-0" />
                          )}
                          <div>
                            <div>{m.name}</div>
                            {m.email && <div className="text-[11px] text-slate-500 font-normal">{m.email}</div>}
                          </div>
                        </td>
                        <td className="p-4 text-slate-400">{m.type === 'group' ? 'Grupp' : 'Användare'}</td>
                        <td className="p-4 font-semibold text-emerald-400">{m.spaces.length} st</td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-2">
                            {m.spaces.map((s, idx) => (
                              <div key={idx} className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] flex items-center gap-2">
                                <strong className="text-slate-200">{s.spaceName}</strong>
                                <div className="flex gap-1">
                                  {s.roles.map(r => renderRoleBadge(r))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};