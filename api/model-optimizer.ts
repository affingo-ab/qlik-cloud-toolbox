import type { VercelRequest, VercelResponse } from '@vercel/node';
import WebSocket from 'ws';

interface FieldAnalysisItem {
  name: string;
  table: string;
  distinctValues: number;
  totalCount: number;
  memoryBytes: number;
  memoryKB: number;
  isKey: boolean;
  isUnused: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tenantUrl, apiKey, appId, action } = req.body;
  if (!tenantUrl || !apiKey) {
    return res.status(400).json({ error: 'Missing tenantUrl or apiKey' });
  }

  const cleanHost = tenantUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const baseUrl = `https://${cleanHost}`;
  const restHeaders = {
    'Authorization': `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
  };

  try {
    // -------------------------------------------------------------
    // A. HÄMTA APPAR FÖR DROPDOWN
    // -------------------------------------------------------------
    if (action === 'get-apps') {
      const appItems: { id: string; name: string }[] = [];
      let appUrl: string | null = `${baseUrl}/api/v1/items?resourceType=app&limit=100`;

      while (appUrl) {
        const appRes = await fetch(appUrl, { headers: restHeaders });
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

      appItems.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      return res.status(200).json({ apps: appItems });
    }

    // -------------------------------------------------------------
    // B. FULLSTÄNDIG FÄLT- & MODELLOPTIMERING VIA QIX ENGINE
    // -------------------------------------------------------------
    if (!appId) {
      return res.status(400).json({ error: 'Missing appId' });
    }

    const wsUrl = `wss://${cleanHost}/app/${appId}`;

    const analysisResult = await new Promise<any>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { 'Authorization': `Bearer ${apiKey.trim()}` },
      });

      const timeout = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error('Timeout mot QIX Engine efter 40 sekunder'));
      }, 40000);

      let msgId = 1;
      const pendingCallbacks: Record<number, (msg: any) => void> = {};

      const send = (method: string, handle: number, params: any[]): Promise<any> => {
        return new Promise((res) => {
          const id = ++msgId;
          pendingCallbacks[id] = res;
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, handle, params }));
        });
      };

      ws.on('open', async () => {
        try {
          // 1. Öppna appen med data (false = normalt läge så att tabeller finns)
          const openRes = await send('OpenDoc', -1, [appId, '', '', '', false]);
          if (openRes.error) {
            throw new Error(openRes.error.message || 'Kunde inte öppna appen');
          }
          const docHandle = openRes.result?.qReturn?.qHandle || 1;

          // 2. Hämta datamodellen (tabeller, fält, distinkta värden, symbolminne)
          const tkRes = await send('GetTablesAndKeys', docHandle, [{ qcx: 0, qcy: 0 }, { qcx: 0, qcy: 0 }, 0, false, false]);
          const tables = tkRes.result?.qtr || [];
          const fieldsMap = new Map<string, FieldAnalysisItem>();
          let totalMemoryBytes = 0;

          for (const table of tables) {
            for (const f of table.qFields || []) {
              const name: string = f.qName;
              if (!name) continue;

              // Rätta egenskapsnamn från QIX Engine:
              const distinct = f.qnTotalDistinctValues || f.qnPresentDistinctValues || 0;
              const total = f.qnRows || f.qnNonNulls || table.qNoOfRows || 0;

              // Beräkna realistiskt RAM-minne för fältet (Symbolminne + Bit-index):
              // 1. Symboltabell: ~28 bytes i overhead per unikt värde
              // 2. Pekartabell: Pekare per rad baserat på kardinalitet (minst 1-2 bytes per rad)
              const bitsNeeded = distinct > 0 ? Math.ceil(Math.log2(distinct + 1)) : 1;
              const bytesPerRow = Math.max(1, Math.ceil(bitsNeeded / 8));
              const estimatedBytes = (distinct * 28) + (total * bytesPerRow);

              totalMemoryBytes += estimatedBytes;

              if (!fieldsMap.has(name)) {
                fieldsMap.set(name, {
                  name,
                  table: table.qName || 'Okänd tabell',
                  distinctValues: distinct,
                  totalCount: total,
                  memoryBytes: estimatedBytes,
                  memoryKB: +(estimatedBytes / 1024).toFixed(1),
                  isKey: f.qKeyType !== 'NOT_KEY',
                  isUnused: false,
                });
              }
            }
          }

          // 3. Samla ALL text och definitioner från hela appens presentationslager
          let fullAppCorpus = '';

          // A. Master Measures
          try {
            const mListObj = await send('CreateSessionObject', docHandle, [{
              qInfo: { qType: 'MeasureList' },
              qMeasureListDef: {
                qType: 'measure',
                qData: { title: '/qMetaDef/title', expression: '/qMeasure/qDef' },
              },
            }]);
            if (mListObj.result?.qReturn?.qHandle) {
              const mLayout = await send('GetLayout', mListObj.result.qReturn.qHandle, []);
              fullAppCorpus += ' ' + JSON.stringify(mLayout.result?.qLayout?.qMeasureList?.qItems || []);
            }
          } catch {}

          // B. Master Dimensions
          try {
            const dListObj = await send('CreateSessionObject', docHandle, [{
              qInfo: { qType: 'DimensionList' },
              qDimensionListDef: {
                qType: 'dimension',
                qData: { title: '/qMetaDef/title', dim: '/qDim' },
              },
            }]);
            if (dListObj.result?.qReturn?.qHandle) {
              const dLayout = await send('GetLayout', dListObj.result.qReturn.qHandle, []);
              fullAppCorpus += ' ' + JSON.stringify(dLayout.result?.qLayout?.qDimensionList?.qItems || []);
            }
          } catch {}

          // C. Variabler
          try {
            const vListObj = await send('CreateSessionObject', docHandle, [{
              qInfo: { qType: 'VariableList' },
              qVariableListDef: { qType: 'variable', qShowReserved: false },
            }]);
            if (vListObj.result?.qReturn?.qHandle) {
              const vLayout = await send('GetLayout', vListObj.result.qReturn.qHandle, []);
              fullAppCorpus += ' ' + JSON.stringify(vLayout.result?.qLayout?.qVariableList?.qItems || []);
            }
          } catch {}

          // D. Hämta ALLA objekt i appen (diagram, filterpaneler, listboxar, containrar, master objects)
          try {
            const allInfosRes = await send('GetAllInfos', docHandle, []);
            const allInfos: any[] = allInfosRes.result?.qInfos || [];

            // Exkludera endast rena systemgrejer som inte kan innehålla fältreferenser
            const ignoreTypes = new Set(['bookmark', 'snapshot', 'appprops', 'loadmodel', 'story']);
            const relevantObjects = allInfos.filter(info => !ignoreTypes.has(info.qType?.toLowerCase()));

            // Hämta properties i batcher om 20 för hög prestanda
            const BATCH_SIZE = 20;
            for (let i = 0; i < relevantObjects.length; i += BATCH_SIZE) {
              const batch = relevantObjects.slice(i, i + BATCH_SIZE);
              const batchResults = await Promise.all(
                batch.map(async (item) => {
                  try {
                    const handleRes = await send('GetObject', docHandle, [item.qId]);
                    const handle = handleRes.result?.qReturn?.qHandle;
                    if (handle) {
                      const propRes = await send('GetProperties', handle, []);
                      return JSON.stringify(propRes.result?.qProp || {});
                    }
                  } catch {}
                  return '';
                })
              );
              fullAppCorpus += ' ' + batchResults.join(' ');
            }
          } catch {}

          // 4. Analysera vilka fält som används vs oanvända
          const fieldList: FieldAnalysisItem[] = [];
          let unusedMemoryBytes = 0;

          fieldsMap.forEach((field) => {
            const name = field.name;
            const escaped = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

            // Fältet används om det nämns i ark/diagram/mått/filter/containrar
            const mentionedInApp = 
              fullAppCorpus.includes(`[${name}]`) ||
              fullAppCorpus.includes(`"${name}"`) ||
              fullAppCorpus.includes(`'${name}'`) ||
              new RegExp(`(?<=^|[^a-zA-Z0-9_])${escaped}(?=[^a-zA-Z0-9_]|$)`, 'i').test(fullAppCorpus);

            // Nycklar och systemfält betraktas som aktiva
            const isUsed = name.startsWith('$') || field.isKey || mentionedInApp;

            field.isUnused = !isUsed;

            // Räkna bara med fält som säkert kan droppas i besparingen
            if (!isUsed && !field.isKey) {
              unusedMemoryBytes += field.memoryBytes;
            }
            fieldList.push(field);
          });

          // Sortera: Oanvända först (störst minne överst)
          fieldList.sort((a, b) => {
            if (a.isUnused === b.isUnused) {
              return b.memoryBytes - a.memoryBytes;
            }
            return a.isUnused ? -1 : 1;
          });

          // Definiera fälten som är oanvända (både med och utan nycklar för UI och skript)
          const unusedOnly = fieldList.filter((f) => f.isUnused);
          const droppableFields = fieldList.filter((f) => f.isUnused && !f.isKey);

          const dropFieldsScript = droppableFields.length > 0
            ? `// --- GENERERAT AV QLIK CLOUD TOOLBOX ---\n` +
              `// Beräknad potentiell minnesbesparing: ${(unusedMemoryBytes / (1024 * 1024)).toFixed(2)} MB\n` +
              `// (Nyckelfält exkluderade för att skydda datamodellens relationer)\n` +
              `Drop Fields\n  ` +
              droppableFields.map((f) => `[${f.name}]`).join(',\n  ') +
              `;\n`
            : '// Inga säkra fält att droppa identifierades i denna app.';

          clearTimeout(timeout);
          ws.close();

          resolve({
            summary: {
              totalFields: fieldList.length,
              unusedFieldsCount: unusedOnly.length,
              usedFieldsCount: fieldList.length - unusedOnly.length,
              totalMemoryMB: +(totalMemoryBytes / (1024 * 1024)).toFixed(2),
              unusedMemoryMB: +(unusedMemoryBytes / (1024 * 1024)).toFixed(2),
              unusedPercentage: totalMemoryBytes > 0 ? +((unusedMemoryBytes / totalMemoryBytes) * 100).toFixed(1) : 0,
            },
            dropFieldsScript,
            fields: fieldList,
          });

        } catch (err) {
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      });

      ws.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id && pendingCallbacks[msg.id]) {
            pendingCallbacks[msg.id](msg);
            delete pendingCallbacks[msg.id];
          }
        } catch {}
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        ws.close();
        reject(err);
      });
    });

    return res.status(200).json(analysisResult);

  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internt fel vid fältanalys' });
  }
}