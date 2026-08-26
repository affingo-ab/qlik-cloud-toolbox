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

  const { tenant, apiKey, appId } = req.body;

  if (!tenant || !apiKey || !appId) {
    return res.status(400).json({ error: 'Missing parameters: tenant, apiKey or appId' });
  }

  const cleanHost = tenant.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const wsUrl = `wss://${cleanHost}/app/${appId}`;

  try {
    const items = await new Promise<{ measures: any[]; dimensions: any[] }>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
      });

      const timeout = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error('Timeout mot QIX Engine efter 15 sekunder'));
      }, 15000);

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
          // 1. Öppna käll-appen i snabbläge
          const openRes = await send('OpenDoc', -1, [appId, '', '', '', true]);
          if (openRes.error) {
            throw new Error(openRes.error.message || 'Kunde inte öppna app');
          }
          const docHandle = openRes.result?.qReturn?.qHandle || 1;

          // 2. Hämta Mått (Measures) garanterat först
          let parsedMeasures: any[] = [];
          const mListObj = await send('CreateSessionObject', docHandle, [{
            qInfo: { qType: 'MeasureList' },
            qMeasureListDef: {
              qType: 'measure',
              qData: {
                title: '/qMetaDef/title',
                description: '/qMetaDef/description',
                tags: '/qMetaDef/tags',
                expression: '/qMeasure/qDef',
                measure: '/qMeasure',
              },
            },
          }]);

          if (mListObj.result?.qReturn?.qHandle) {
            const mLayout = await send('GetLayout', mListObj.result.qReturn.qHandle, []);
            const rawMeasures = mLayout.result?.qLayout?.qMeasureList?.qItems || [];
            parsedMeasures = rawMeasures.map((m: any) => ({
              id: m.qInfo?.qId || Math.random().toString(),
              title: m.qMeta?.title || m.qData?.title || 'Mått',
              description: m.qMeta?.description || m.qData?.description || '',
              expression: m.qData?.expression || m.qData?.measure?.qDef || '',
              tags: m.qMeta?.tags || m.qData?.tags || [],
            }));
          }

          // 3. Hämta Dimensioner (Dimensions) därefter
          let parsedDimensions: any[] = [];
          const dListObj = await send('CreateSessionObject', docHandle, [{
            qInfo: { qType: 'DimensionList' },
            qDimensionListDef: {
              qType: 'dimension',
              qData: {
                title: '/qMetaDef/title',
                description: '/qMetaDef/description',
                tags: '/qMetaDef/tags',
                dim: '/qDim',
              },
            },
          }]);

          if (dListObj.result?.qReturn?.qHandle) {
            const dLayout = await send('GetLayout', dListObj.result.qReturn.qHandle, []);
            const rawDimensions = dLayout.result?.qLayout?.qDimensionList?.qItems || [];
            parsedDimensions = rawDimensions.map((d: any) => {
              const dimObj = d.qData?.dim || {};
              const fieldDefs = Array.isArray(dimObj.qFieldDefs) ? dimObj.qFieldDefs : [];
              return {
                id: d.qInfo?.qId || Math.random().toString(),
                title: d.qMeta?.title || d.qData?.title || 'Dimension',
                description: d.qMeta?.description || d.qData?.description || '',
                grouping: dimObj.qGrouping || 'N',
                fieldDefs: fieldDefs,
                tags: d.qMeta?.tags || d.qData?.tags || [],
              };
            });
          }

          // 4. Klart! Både mått och dimensioner är garanterat inlästa
          clearTimeout(timeout);
          ws.close();
          resolve({ measures: parsedMeasures, dimensions: parsedDimensions });

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

    return res.status(200).json(items);

  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Serverfel vid hämtning av Master Items' });
  }
}