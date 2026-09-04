import type { VercelRequest, VercelResponse } from '@vercel/node';
import WebSocket from 'ws';
import type { FullBusinessLogicPlan } from '../src/types/businessLogic';

interface ApplyPayload {
  tenantUrl: string;
  apiToken: string;
  appId: string;
  plan: FullBusinessLogicPlan;
  conflictStrategy?: 'overwrite' | 'skip' | 'copy';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tenantUrl, apiToken, appId, plan, conflictStrategy = 'overwrite' } = req.body as ApplyPayload;

  if (!tenantUrl || !apiToken || !appId || !plan) {
    return res.status(400).json({ error: 'tenantUrl, apiToken, appId och plan krävs.' });
  }

  let cleanedTenant = tenantUrl.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const wsUrl = `wss://${cleanedTenant}/app/${encodeURIComponent(appId)}`;

  const ws = new WebSocket(wsUrl, {
    headers: { Authorization: `Bearer ${apiToken.trim()}` },
  });

  let msgId = 1;
  const pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

  function sendRpc(handle: number, method: string, params: any[]): Promise<any> {
    const id = msgId++;
    const payload = { jsonrpc: '2.0', id, handle, method, params };
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify(payload));
    });
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout mot Qlik Engine')), 12000);
      ws.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.id && pendingRequests.has(parsed.id)) {
          const { resolve, reject } = pendingRequests.get(parsed.id)!;
          pendingRequests.delete(parsed.id);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          } else {
            resolve(parsed.result);
          }
        }
      } catch (e) {
        console.error('Error parsing WS message:', e);
      }
    });

    // 1. Öppna appen
    const openDocRes = await sendRpc(-1, 'OpenDoc', [appId, '', '', '', false]);
    const docHandle = openDocRes?.qReturn?.qHandle || 1;

    // 2. Läs in befintliga Master Measures och Dimensions för konflikthantering
    const existingMeasuresMap: Record<string, string> = {};
    const existingDimensionsMap: Record<string, string> = {};

    const mListObj = await sendRpc(docHandle, 'CreateSessionObject', [{
      qInfo: { qType: 'MeasureList' },
      qMeasureListDef: { qType: 'measure', qData: { title: '/qMetaDef/title' } }
    }]);
    if (mListObj?.qReturn?.qHandle) {
      const layout = await sendRpc(mListObj.qReturn.qHandle, 'GetLayout', []);
      (layout?.qLayout?.qMeasureList?.qItems || []).forEach((item: any) => {
        const title = item.qMeta?.title || item.qData?.title;
        const id = item.qInfo?.qId;
        if (title && id) existingMeasuresMap[title.toLowerCase()] = id;
      });
    }

    const dListObj = await sendRpc(docHandle, 'CreateSessionObject', [{
      qInfo: { qType: 'DimensionList' },
      qDimensionListDef: { qType: 'dimension', qData: { title: '/qMetaDef/title' } }
    }]);
    if (dListObj?.qReturn?.qHandle) {
      const layout = await sendRpc(dListObj.qReturn.qHandle, 'GetLayout', []);
      (layout?.qLayout?.qDimensionList?.qItems || []).forEach((item: any) => {
        const title = item.qMeta?.title || item.qData?.title;
        const id = item.qInfo?.qId;
        if (title && id) existingDimensionsMap[title.toLowerCase()] = id;
      });
    }

    let createdMeasures = 0;
    let updatedMeasures = 0;
    let skippedMeasures = 0;

    let createdDimensions = 0;
    let updatedDimensions = 0;
    let skippedDimensions = 0;

    // 3. Skapa/Uppdatera Master Measures
    if (plan.masterItems?.measures?.length) {
      for (const m of plan.masterItems.measures) {
        if (m.selected === false) continue;
        const lowerTitle = (m.title || '').toLowerCase();
        const existsId = existingMeasuresMap[lowerTitle];

        let titleToUse = m.title;
        if (existsId) {
          if (conflictStrategy === 'skip') {
            skippedMeasures++;
            continue;
          }
          if (conflictStrategy === 'copy') {
            titleToUse = `${m.title}_v2`;
          }
        }

        const measureDef = {
          qInfo: { qType: 'measure' },
          qMeasure: {
            qLabel: m.label || titleToUse,
            qDef: m.expression,
            qGrouping: 'N',
            qExpressions: [],
            qActiveExpression: 0
          },
          qMetaDef: {
            title: titleToUse,
            description: m.description,
            tags: m.tags || ['AI-Generated']
          }
        };

        if (existsId && conflictStrategy === 'overwrite') {
          try {
            const mObj = await sendRpc(docHandle, 'GetMeasure', [existsId]);
            const mHandle = mObj?.qReturn?.qHandle;
            if (mHandle) {
              await sendRpc(mHandle, 'SetProperties', [{ ...measureDef, qInfo: { qId: existsId, qType: 'measure' } }]);
              updatedMeasures++;
            } else {
              await sendRpc(docHandle, 'CreateMeasure', [measureDef]);
              createdMeasures++;
            }
          } catch {
            await sendRpc(docHandle, 'CreateMeasure', [measureDef]);
            createdMeasures++;
          }
        } else {
          await sendRpc(docHandle, 'CreateMeasure', [measureDef]);
          createdMeasures++;
        }
      }
    }

    // 4. Skapa/Uppdatera Master Dimensions
    if (plan.masterItems?.dimensions?.length) {
      for (const d of plan.masterItems.dimensions) {
        if (d.selected === false) continue;
        const lowerTitle = (d.title || '').toLowerCase();
        const existsId = existingDimensionsMap[lowerTitle];

        let titleToUse = d.title;
        if (existsId) {
          if (conflictStrategy === 'skip') {
            skippedDimensions++;
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
            qGrouping: 'N',
            qFieldDefs: fields,
            qFieldLabels: [d.label || titleToUse]
          },
          qMetaDef: {
            title: titleToUse,
            description: d.description,
            tags: d.tags || ['AI-Generated']
          }
        };

        if (existsId && conflictStrategy === 'overwrite') {
          try {
            const dObj = await sendRpc(docHandle, 'GetDimension', [existsId]);
            const dHandle = dObj?.qReturn?.qHandle;
            if (dHandle) {
              await sendRpc(dHandle, 'SetProperties', [{ ...dimDef, qInfo: { qId: existsId, qType: 'dimension' } }]);
              updatedDimensions++;
            } else {
              await sendRpc(docHandle, 'CreateDimension', [dimDef]);
              createdDimensions++;
            }
          } catch {
            await sendRpc(docHandle, 'CreateDimension', [dimDef]);
            createdDimensions++;
          }
        } else {
          await sendRpc(docHandle, 'CreateDimension', [dimDef]);
          createdDimensions++;
        }
      }
    }

    // 5. Spara appen
    await sendRpc(docHandle, 'DoSave', []);
    ws.close();

    return res.status(200).json({
      success: true,
      summary: {
        createdMeasures,
        updatedMeasures,
        skippedMeasures,
        createdDimensions,
        updatedDimensions,
        skippedDimensions,
      }
    });

  } catch (err: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    console.error('Fel vid apply-business-logic:', err);
    return res.status(500).json({ error: err.message || 'Internt fel vid applicering.' });
  }
}