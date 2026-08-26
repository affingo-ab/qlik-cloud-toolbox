import type { VercelRequest, VercelResponse } from '@vercel/node';
import WebSocket from 'ws';
import crypto from 'crypto';

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

  const { action, tenant, apiKey, appId, vocabulary = [] } = req.body;

  if (!tenant || !apiKey || !appId) {
    return res.status(400).json({ error: 'Missing parameters: tenant, apiKey or appId' });
  }

  const cleanHost = tenant.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const wsUrl = `wss://${cleanHost}/app/${appId}`;

  try {
    const result = await new Promise<any>((resolve, reject) => {
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
        return new Promise((resCallback) => {
          const id = ++msgId;
          pendingCallbacks[id] = resCallback;
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, handle, params }));
        });
      };

      ws.on('open', async () => {
        try {
          // Öppna alltid i standardläge
          const openRes = await send('OpenDoc', -1, [appId, '', '', '', false]);
          if (openRes.error) {
            throw new Error(openRes.error.message || 'Kunde inte öppna app');
          }
          const docHandle = openRes.result?.qReturn?.qHandle || 1;

          // ==========================================
          // 1. LÄSA IN DIMENSIONER, MÅTT OCH FÄLT
          // ==========================================
          if (action === 'get') {
            // A. Master Dimensions
            let dimensions: any[] = [];
            const dListObj = await send('CreateSessionObject', docHandle, [{
              qInfo: { qType: 'DimensionList' },
              qDimensionListDef: {
                qType: 'dimension',
                qData: { title: '/qMetaDef/title', dim: '/qDim' },
              },
            }]);
            if (dListObj.result?.qReturn?.qHandle) {
              const dLayout = await send('GetLayout', dListObj.result.qReturn.qHandle, []);
              const rawDims = dLayout.result?.qLayout?.qDimensionList?.qItems || [];
              dimensions = rawDims.map((d: any) => ({
                id: d.qInfo?.qId,
                title: d.qMeta?.title || d.qData?.title || 'Dimension',
                fieldDefs: d.qData?.dim?.qFieldDefs || [],
              }));
            }

            // B. Master Measures
            let measures: any[] = [];
            const mListObj = await send('CreateSessionObject', docHandle, [{
              qInfo: { qType: 'MeasureList' },
              qMeasureListDef: {
                qType: 'measure',
                qData: { title: '/qMetaDef/title', measure: '/qMeasure' },
              },
            }]);
            if (mListObj.result?.qReturn?.qHandle) {
              const mLayout = await send('GetLayout', mListObj.result.qReturn.qHandle, []);
              const rawMeasures = mLayout.result?.qLayout?.qMeasureList?.qItems || [];
              measures = rawMeasures.map((m: any) => ({
                id: m.qInfo?.qId,
                title: m.qMeta?.title || m.qData?.title || 'Mått',
                expression: m.qData?.measure?.qDef || m.qData?.expression || '',
              }));
            }

            // C. Fält från datamodellen
            let fields: string[] = [];
            try {
              const fieldListObj = await send('CreateSessionObject', docHandle, [{
                qInfo: { qType: 'FieldList' },
                qFieldListDef: { qShowSystem: false, qShowHidden: false },
              }]);
              if (fieldListObj.result?.qReturn?.qHandle) {
                const fLayout = await send('GetLayout', fieldListObj.result.qReturn.qHandle, []);
                const rawFields = fLayout.result?.qLayout?.qFieldList?.qItems || [];
                fields = rawFields
                  .map((f: any) => f.qName)
                  .filter((name: string) => name && !name.startsWith('$') && !name.startsWith('='));
              }
            } catch {}

            // D. Läs befintliga synonymer
            let existingVocab: any[] = [];
            try {
              const logicalModelRes = await send('GetLogicalModel', docHandle, []);
              console.log('Befintlig Logical Model från Qlik:', JSON.stringify(logicalModelRes.result?.qLogicalModel, null, 2));

              if (logicalModelRes.result?.qLogicalModel) {
                const terms = logicalModelRes.result.qLogicalModel.qVocabulary?.qTerms || [];
                existingVocab = terms.map((t: any) => ({
                  targetName: t.qDefinition?.qName || t.qName || t.qText,
                  synonyms: t.qSynonyms || [],
                }));
              }
            } catch {}

            clearTimeout(timeout);
            ws.close();
            return resolve({ dimensions, measures, fields, existingVocab });
          }

          // ==========================================
          // 2. SPARA LOGICAL MODEL (SYNONYMER)
          // ==========================================
          if (action === 'save') {
            // Hämta befintlig modell som bas
            let currentModel: any = {};
            try {
              const getRes = await send('GetLogicalModel', docHandle, []);
              if (getRes.result?.qLogicalModel) {
                currentModel = getRes.result.qLogicalModel;
              }
            } catch {}

            // Skapa term-struktur med qDefinition och GUID:s
            const qTerms = vocabulary.map((item: any) => {
              const termId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
              const typeStr = item.type === 'measure' ? 'Measure' : item.type === 'dimension' ? 'Dimension' : 'Field';

              return {
                qId: termId,
                qName: item.targetName,
                qText: item.targetName,
                qDefinition: {
                  qType: typeStr,
                  qName: item.targetName,
                  qFieldName: item.targetName,
                },
                qSynonyms: Array.isArray(item.synonyms) ? item.synonyms : [],
              };
            });

            // VIKTIGT: Aktivera Custom Business Logic och sätt qVocabulary
            const updatedModel = {
              ...currentModel,
              qCustomBusinessLogicEnabled: true,
              qVocabulary: {
                ...(currentModel.qVocabulary || {}),
                qTerms: qTerms,
              },
            };

            console.log('Skickar uppdaterad Logical Model till QIX:', JSON.stringify(updatedModel, null, 2));

            const setRes = await send('SetLogicalModel', docHandle, [updatedModel]);
            if (setRes.error) {
              throw new Error(setRes.error.message || 'Kunde inte sätta Logical Model');
            }

            // Spara permanent i appen
            await send('DoSave', docHandle, []);

            clearTimeout(timeout);
            ws.close();
            return resolve({ success: true, count: qTerms.length });
          }

          throw new Error('Ogiltig åtgärd');

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
    return res.status(500).json({ error: error.message || 'Fel vid hantering av Business Logic' });
  }
}