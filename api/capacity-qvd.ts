import type { VercelRequest, VercelResponse } from '@vercel/node';

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

interface LineageEntry {
  discriminator?: string;
  statement?: string;
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
    // 1. Hämta Spaces
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
          const nextHref = spaceData.links?.next?.href;
          spaceUrl = nextHref ? (nextHref.startsWith('http') ? nextHref : `${baseUrl}${nextHref.startsWith('/') ? '' : '/'}${nextHref}`) : null;
        } else {
          spaceUrl = null;
        }
      }
    } catch {}

    // 2. Hämta alla QVD-filer i tenanten
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

      const nextHref = itemsData.links?.next?.href;
      itemsUrl = nextHref ? (nextHref.startsWith('http') ? nextHref : `${baseUrl}${nextHref.startsWith('/') ? '' : '/'}${nextHref}`) : null;
    }

    // Registrera kända QVD:er
    const qvdUsage: Record<string, { readers: Set<string>; writers: Set<string> }> = {};
    for (const qvd of qvdItems) {
      const lower = qvd.name.toLowerCase().trim();
      qvdUsage[lower] = { readers: new Set(), writers: new Set() };
    }

    // 3. Hämta alla appar i tenanten med korrekt paginering
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

      const nextHref = appData.links?.next?.href;
      appUrl = nextHref ? (nextHref.startsWith('http') ? nextHref : `${baseUrl}${nextHref.startsWith('/') ? '' : '/'}${nextHref}`) : null;
    }

    const qvdExtractRegex = /([a-zA-Z0-9_\-\.\s]+\.qvd)/gi;
    let appsSuccessfullyRead = 0;
    let appsFailed = 0;

    // 4. Analysera Lineage via REST för alla appar i batcher om 8
    const BATCH_SIZE = 8;
    for (let i = 0; i < appItems.length; i += BATCH_SIZE) {
      const batch = appItems.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (app) => {
          try {
            const lineageRes = await fetch(`${baseUrl}/api/v1/apps/${app.id}/data/lineage`, { headers });
            if (lineageRes.ok) {
              appsSuccessfullyRead++;
              const entries: LineageEntry[] = await lineageRes.json();

              for (const entry of entries) {
                const disc = (entry.discriminator || '').toLowerCase();
                const stmt = (entry.statement || '').toLowerCase();
                const combined = `${disc} ${stmt}`;

                // Är detta en STORE-sats?
                const isStore = disc.includes('{store -') || stmt.startsWith('store ');

                let match;
                qvdExtractRegex.lastIndex = 0;
                while ((match = qvdExtractRegex.exec(combined)) !== null) {
                  const fullMatch = match[1].trim();
                  const cleanFileName = (fullMatch.split(/[\/\\]/).pop() || fullMatch).toLowerCase().trim();

                  if (qvdUsage[cleanFileName]) {
                    if (isStore) {
                      qvdUsage[cleanFileName].writers.add(app.name);
                    } else {
                      qvdUsage[cleanFileName].readers.add(app.name);
                    }
                  }
                }
              }
            } else {
              appsFailed++;
            }
          } catch {
            appsFailed++;
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
      scriptsRead: appsSuccessfullyRead,
      scriptsFailed: appsFailed,
    };

    return res.status(200).json({ summary, qvds: results });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internt fel vid analys' });
  }
}