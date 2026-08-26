import type { VercelRequest, VercelResponse } from '@vercel/node';
import WebSocket from 'ws';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tenant, apiKey, targetAppId, measures = [], dimensions = [], conflictStrategy = 'overwrite' } = req.body;

  if (!tenant || !apiKey || !targetAppId) {
    return res.status(400).json({ error: 'Missing parameters: tenant, apiKey or targetAppId' });
  }

  const cleanHost = tenant.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const wsUrl = `wss://${cleanHost}/app/${targetAppId}`;

  try {
    const result = await new Promise<{ createdMeasures: number; createdDimensions: number; updated: number; skipped: number }>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
      });

      const timeout = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error('Timeout mot mål-app i QIX Engine efter 15 sekunder'));
      }, 15000);

      let docHandle = -1;
      let existingMeasuresMap: Record<string, string> = {};
      let existingDimensionsMap: Record<string, string> = {};

      let createdMeasures = 0;
      let createdDimensions = 0;
      let updated = 0;
      let skipped = 0;

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
          // 1. Öppna mål-appen i redigerbart läge
          const openRes = await send('OpenDoc', -1, [targetAppId, '', '', '', false]);
          if (openRes.error) {
            throw new Error(openRes.error.message || 'Kunde inte öppna mål-app');
          }
          docHandle = openRes.result?.qReturn?.qHandle || 1;

          // 2. Läs in befintliga mått och dimensioner för konflikthantering
          const mListObj = await send('CreateSessionObject', docHandle, [{
            qInfo: { qType: 'MeasureList' },
            qMeasureListDef: { qType: 'measure', qData: { title: '/qMetaDef/title' } }
          }]);
          if (mListObj.result?.qReturn?.qHandle) {
            const layout = await send('GetLayout', mListObj.result.qReturn.qHandle, []);
            (layout.result?.qLayout?.qMeasureList?.qItems || []).forEach((item: any) => {
              const title = item.qMeta?.title || item.qData?.title;
              const id = item.qInfo?.qId;
              if (title && id) existingMeasuresMap[title.toLowerCase()] = id;
            });
          }

          const dListObj = await send('CreateSessionObject', docHandle, [{
            qInfo: { qType: 'DimensionList' },
            qDimensionListDef: { qType: 'dimension', qData: { title: '/qMetaDef/title' } }
          }]);
          if (dListObj.result?.qReturn?.qHandle) {
            const layout = await send('GetLayout', dListObj.result.qReturn.qHandle, []);
            (layout.result?.qLayout?.qDimensionList?.qItems || []).forEach((item: any) => {
              const title = item.qMeta?.title || item.qData?.title;
              const id = item.qInfo?.qId;
              if (title && id) existingDimensionsMap[title.toLowerCase()] = id;
            });
          }

          // 3. Skapa/Uppdatera Mått (Measures)
          for (const m of measures) {
            const lowerTitle = (m.title || '').toLowerCase();
            const exists = existingMeasuresMap[lowerTitle];

            let titleToUse = m.title;
            if (exists) {
              if (conflictStrategy === 'skip') {
                skipped++;
                continue;
              }
              if (conflictStrategy === 'copy') {
                titleToUse = `${m.title}_v2`;
              }
            }

            const measureDef = {
              qInfo: { qType: 'measure' },
              qMeasure: {
                qDef: m.expression || '',
                qLabel: titleToUse,
              },
              qMetaDef: {
                title: titleToUse,
                description: m.description || '',
                tags: m.tags || [],
              },
            };

            if (exists && conflictStrategy === 'overwrite') {
              const getObjRes = await send('GetMeasure', docHandle, [exists]);
              const mHandle = getObjRes.result?.qReturn?.qHandle;
              if (mHandle) {
                await send('SetProperties', mHandle, [{ ...measureDef, qInfo: { qId: exists, qType: 'measure' } }]);
                updated++;
              } else {
                await send('CreateMeasure', docHandle, [measureDef]);
                createdMeasures++;
              }
            } else {
              await send('CreateMeasure', docHandle, [measureDef]);
              createdMeasures++;
            }
          }

          // 4. Skapa/Uppdatera Dimensioner (Dimensions med fulla fält)
          for (const d of dimensions) {
            const lowerTitle = (d.title || '').toLowerCase();
            const exists = existingDimensionsMap[lowerTitle];

            let titleToUse = d.title;
            if (exists) {
              if (conflictStrategy === 'skip') {
                skipped++;
                continue;
              }
              if (conflictStrategy === 'copy') {
                titleToUse = `${d.title}_v2`;
              }
            }

            const fields = Array.isArray(d.fieldDefs) && d.fieldDefs.length > 0 ? d.fieldDefs : [d.title];

            const dimDef = {
              qInfo: { qType: 'dimension' },
              qDim: {
                qGrouping: d.grouping === 'H' ? 'H' : 'N',
                qFieldDefs: fields,
                qFieldLabels: fields,
              },
              qMetaDef: {
                title: titleToUse,
                description: d.description || '',
                tags: d.tags || [],
              },
            };

            if (exists && conflictStrategy === 'overwrite') {
              const getObjRes = await send('GetDimension', docHandle, [exists]);
              const dHandle = getObjRes.result?.qReturn?.qHandle;
              if (dHandle) {
                await send('SetProperties', dHandle, [{ ...dimDef, qInfo: { qId: exists, qType: 'dimension' } }]);
                updated++;
              } else {
                await send('CreateDimension', docHandle, [dimDef]);
                createdDimensions++;
              }
            } else {
              await send('CreateDimension', docHandle, [dimDef]);
              createdDimensions++;
            }
          }

          // 5. Spara ändringarna permanent i mål-appen
          await send('DoSave', docHandle, []);

          clearTimeout(timeout);
          ws.close();
          resolve({ createdMeasures, createdDimensions, updated, skipped });

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

    return res.status(200).json(result);

  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Fel vid synkronisering' });
  }
}