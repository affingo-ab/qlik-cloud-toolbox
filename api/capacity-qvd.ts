import type { VercelRequest, VercelResponse } from '@vercel/node';
import WebSocket from 'ws';

interface QlikItem {
  id: string;
  name: string;
  spaceId?: string;
  createdAt: string;
  updatedAt: string;
}

interface SpaceInfo {
  id: string;
  name: string;
}

function fetchAppScriptViaEngine(host: string, apiKey: string, appId: string): Promise<string> {
  return new Promise((resolve) => {
    const wsUrl = `wss://${host}/app/${appId}`;
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    let docHandle = -1;
    let script = '';
    const timeout = setTimeout(() => {
      try { ws.terminate(); } catch {}
      resolve('');
    }, 7000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'OpenDoc',
        handle: -1,
        params: [appId, '', '', '', false],
      }));
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.id === 1) {
          if (msg.error) {
            clearTimeout(timeout);
            ws.close();
            resolve('');
            return;
          }
          docHandle = msg.result?.qReturn?.qHandle;
          if (docHandle) {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'GetScript',
              handle: docHandle,
              params: [],
            }));
          } else {
            clearTimeout(timeout);
            ws.close();
            resolve('');
          }
        } else if (msg.id === 2) {
          script = msg.result?.qScript || '';
          clearTimeout(timeout);
          ws.close();
          resolve(script);
        }
      } catch {
        clearTimeout(timeout);
        ws.close();
        resolve('');
      }
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      resolve('');
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      resolve(script);
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tenantUrl, apiKey } = req.body;
  if (!tenantUrl || !apiKey) {
    return res.status(400).json({ error: 'Missing tenantUrl or apiKey' });
  }

  const cleanTenant = tenantUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const baseUrl = `https://${cleanTenant}`;
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Spaces
    const spacesMap: Record<string, string> = { personal: 'Personal Space' };
    try {
      let spaceUrl: string | null = `${baseUrl}/api/v1/spaces?limit=100`;
      while (spaceUrl) {
        const spaceRes = await fetch(spaceUrl, { headers });
        if (spaceRes.ok) {
          const spaceData = await spaceRes.json();
          (spaceData.data || []).forEach((s: SpaceInfo) => {
            spacesMap[s.id] = s.name;
          });
          spaceUrl = spaceData.links?.next?.href || null;
        } else {
          spaceUrl = null;
        }
      }
    } catch {}

    // 2. Hämta alla QVD-filer via Items API
    const qvdItems: QlikItem[] = [];
    let itemsUrl: string | null = `${baseUrl}/api/v1/items?limit=100`;
    let page = 0;

    while (itemsUrl && page < 40) {
      page++;
      const itemsRes = await fetch(itemsUrl, { headers });
      if (!itemsRes.ok) break;

      const itemsData = await itemsRes.json();
      const items: any[] = itemsData.data || [];

      for (const item of items) {
        const itemName = item.name || item.resourceAttributes?.name || '';
        const itemType = item.resourceType || '';
        const subType = item.resourceSubType || '';

        if (
          itemName.toLowerCase().endsWith('.qvd') || 
          subType.toLowerCase() === 'qvd' ||
          itemType.toLowerCase() === 'qvd'
        ) {
          qvdItems.push({
            id: item.resourceId || item.id,
            name: itemName,
            spaceId: item.spaceId || 'personal',
            createdAt: item.createdAt || new Date().toISOString(),
            updatedAt: item.updatedAt || new Date().toISOString(),
          });
        }
      }
      itemsUrl = itemsData.links?.next?.href || null;
    }

    // Uppslag
    const qvdUsage: Record<string, { readers: Set<string>; writers: Set<string> }> = {};
    for (const qvd of qvdItems) {
      const lower = qvd.name.toLowerCase().trim();
      qvdUsage[lower] = { readers: new Set(), writers: new Set() };
    }

    // 3. Hämta appar
    const appItems: { id: string; name: string }[] = [];
    let appUrl: string | null = `${baseUrl}/api/v1/items?resourceType=app&limit=100`;

    while (appUrl) {
      const appRes = await fetch(appUrl, { headers });
      if (!appRes.ok) break;

      const appData = await appRes.json();
      const apps: any[] = appData.data || [];
      apps.forEach((a: any) => {
        appItems.push({
          id: a.resourceId || a.id,
          name: a.name || a.resourceAttributes?.name || 'Namnlös app',
        });
      });
      appUrl = appData.links?.next?.href || null;
    }

    let scriptsRead = 0;
    let scriptsFailed = 0;

    // 4. Scanna skript via QIX WebSocket
    const BATCH_SIZE = 5;
    for (let i = 0; i < appItems.length; i += BATCH_SIZE) {
      const batch = appItems.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (app) => {
          try {
            const script = await fetchAppScriptViaEngine(cleanTenant, apiKey, app.id);
            if (script && script.trim().length > 0) {
              scriptsRead++;
              const scriptLower = script.toLowerCase();
              const appNameLower = app.name.toLowerCase();
              
              // Är detta en typisk generator/extrakt-app?
              const isGeneratorApp = /extract|generator|creator|skapa|staging|stage|raw|källa/i.test(appNameLower);
              const scriptHasStore = scriptLower.includes('store ') && (scriptLower.includes(' into ') || scriptLower.includes('into[') || scriptLower.includes('into '));

              for (const qvd of qvdItems) {
                const qvdFullName = qvd.name.toLowerCase().trim(); // t.ex. "mhpicd.qvd"
                const qvdBaseName = qvdFullName.replace(/\.qvd$/, ''); // t.ex. "mhpicd"

                // Leta efter träff: antingen exakt filnamn ("mhpicd.qvd") eller tabellnamn i ordgräns ("mhpicd")
                const hasFullMatch = scriptLower.includes(qvdFullName);
                const hasBaseMatch = new RegExp(`\\b${qvdBaseName}\\b`, 'i').test(scriptLower);

                if (hasFullMatch || (isGeneratorApp && hasBaseMatch)) {
                  let isWriter = false;
                  let isReader = false;

                  // 1. Kolla om tabellen/filen nämns i närheten av STORE
                  if (scriptHasStore) {
                    const storePos = scriptLower.indexOf('store ');
                    // Om appen har STORE och nämner tabellnamnet (t.ex. i en extrakt-app)
                    if (isGeneratorApp || scriptLower.includes(`store [${qvdBaseName}]`) || scriptLower.includes(`store ${qvdBaseName} `)) {
                      isWriter = true;
                    }
                  }

                  // 2. Kolla om filen läses med FROM
                  if (scriptLower.includes(`from [`) || scriptLower.includes(`from `)) {
                    if (hasFullMatch && !isGeneratorApp) {
                      isReader = true;
                    }
                  }

                  // Fallback: Om det är en generator-app är den writer, annars reader
                  if (!isWriter && !isReader) {
                    if (isGeneratorApp) {
                      isWriter = true;
                    } else {
                      isReader = true;
                    }
                  }

                  if (isWriter) {
                    qvdUsage[qvdFullName].writers.add(app.name);
                  }
                  if (isReader) {
                    qvdUsage[qvdFullName].readers.add(app.name);
                  }
                }
              }
            } else {
              scriptsFailed++;
            }
          } catch {
            scriptsFailed++;
          }
        })
      );
    }

    // 5. Sammanställ svar
    const results = qvdItems.map((qvd) => {
      const lower = qvd.name.toLowerCase().trim();
      const usage = qvdUsage[lower] || { readers: new Set(), writers: new Set() };
      const readers = Array.from(usage.readers);
      const writers = Array.from(usage.writers);
      const isOrphan = readers.length === 0;

      return {
        id: qvd.id,
        name: qvd.name,
        spaceId: qvd.spaceId || 'personal',
        spaceName: spacesMap[qvd.spaceId || 'personal'] || 'Personal Space',
        updatedAt: qvd.updatedAt,
        createdAt: qvd.createdAt,
        readers,
        writers,
        isOrphan,
        status: (isOrphan ? 'UNREAD' : 'ACTIVE') as 'UNREAD' | 'ACTIVE',
      };
    });

    const summary = {
      totalQvds: results.length,
      orphanQvds: results.filter((r) => r.isOrphan).length,
      activeQvds: results.filter((r) => !r.isOrphan).length,
      totalAppsScanned: appItems.length,
      scriptsRead,
      scriptsFailed,
    };

    return res.status(200).json({ summary, qvds: results });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internt fel vid analys' });
  }
}