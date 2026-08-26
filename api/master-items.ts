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
        reject(new Error('Timeout mot QIX Engine efter 10 sekunder'));
      }, 10000);

      let docHandle = -1;
      let parsedMeasures: any[] = [];
      let parsedDimensions: any[] = [];

      ws.on('open', () => {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'OpenDoc',
          handle: -1,
          params: [appId, '', '', '', true], // noData = true för snabb läsning
        }));
      });

      ws.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());

          // 1. OpenDoc
          if (msg.id === 1) {
            if (msg.error) {
              clearTimeout(timeout);
              ws.close();
              return reject(new Error(msg.error.message || 'Kunde inte öppna app'));
            }
            docHandle = msg.result?.qReturn?.qHandle || 1;

            // 2. Skapa MeasureList med fullt qMeasure-objekt
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'CreateSessionObject',
              handle: docHandle,
              params: [{
                qInfo: { qType: 'MeasureList' },
                qMeasureListDef: {
                  qType: 'measure',
                  qData: {
                    title: '/qMetaDef/title',
                    description: '/qMetaDef/description',
                    tags: '/qMetaDef/tags',
                    measure: '/qMeasure',
                  },
                },
              }],
            }));

            // 3. Skapa DimensionList med fullt qDim-objekt (innehåller qFieldDefs array)
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: 3,
              method: 'CreateSessionObject',
              handle: docHandle,
              params: [{
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
              }],
            }));
          }

          // Hämta Measure Layout
          if (msg.id === 2 && msg.result?.qReturn?.qHandle) {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: 20,
              method: 'GetLayout',
              handle: msg.result.qReturn.qHandle,
              params: [],
            }));
          }

          // Hämta Dimension Layout
          if (msg.id === 3 && msg.result?.qReturn?.qHandle) {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: 30,
              method: 'GetLayout',
              handle: msg.result.qReturn.qHandle,
              params: [],
            }));
          }

          // Mått
          if (msg.id === 20 && msg.result?.qLayout) {
            const rawItems = msg.result.qLayout.qMeasureList?.qItems || [];
            parsedMeasures = rawItems.map((m: any) => ({
              id: m.qInfo?.qId || Math.random().toString(),
              title: m.qMeta?.title || m.qData?.title || 'Mått',
              description: m.qMeta?.description || m.qData?.description || '',
              expression: m.qData?.measure?.qDef || m.qData?.expression || '',
              tags: m.qMeta?.tags || m.qData?.tags || [],
            }));
          }

          // Dimensioner med fulla fältdefinitioner
          if (msg.id === 30 && msg.result?.qLayout) {
            const rawItems = msg.result.qLayout.qDimensionList?.qItems || [];
            parsedDimensions = rawItems.map((d: any) => {
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

            clearTimeout(timeout);
            ws.close();
            resolve({ measures: parsedMeasures, dimensions: parsedDimensions });
          }

        } catch (err) {
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
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