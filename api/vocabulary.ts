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
          // Öppna app (noData = false om vi ska spara, true om vi bara läser)
          const isSaveAction = action === 'save';
          const openRes = await send('OpenDoc', -1, [appId, '', '', '', !isSaveAction]);
          if (openRes.error) {
            throw new Error(openRes.error.message || 'Kunde inte öppna app');
          }
          const docHandle = openRes.result?.qReturn?.qHandle || 1;

          // ==========================================
          // LÄSA IN FÄLT, MÅTT OCH LOGICAL MODEL
          // ==========================================
          if (action === 'get') {
            // 1. Hämta alla fält från appen
            const fieldListObj = await send('CreateSessionObject', docHandle, [{
              qInfo: { qType: 'FieldList' },
              qFieldListDef: { qType: 'field', qData: { name: '/qName' } }
            }]);
            let fields: string[] = [];
            if (fieldListObj.result?.qReturn?.qHandle) {
              const fLayout = await send('GetLayout', fieldListObj.result.qReturn.qHandle, []);
              const rawFields = fLayout.result?.qLayout?.qFieldList?.qItems || [];
              fields = rawFields
                .map((f: any) => f.qName || f.qMeta?.title)
                .filter((name: string) => name && !name.startsWith('$')); // Filtrera bort systemfält
            }

            // 2. Hämta Master Measures
            const measureListObj = await send('CreateSessionObject', docHandle, [{
              qInfo: { qType: 'MeasureList' },
              qMeasureListDef: { qType: 'measure', qData: { title: '/qMetaDef/title', expression: '/qMeasure/qDef' } }
            }]);
            let measures: any[] = [];
            if (measureListObj.result?.qReturn?.qHandle) {
              const mLayout = await send('GetLayout', measureListObj.result.qReturn.qHandle, []);
              const rawMeasures = mLayout.result?.qLayout?.qMeasureList?.qItems || [];
              measures = rawMeasures.map((m: any) => ({
                id: m.qInfo?.qId,
                title: m.qMeta?.title || m.qData?.title || 'Mått',
                expression: m.qData?.expression || '',
              }));
            }

            // 3. Försök läsa befintlig Logical Model om det finns
            let existingVocab: any[] = [];
            try {
              const logicalModelRes = await send('GetLogicalModel', docHandle, []);
              if (logicalModelRes.result?.qLogicalModel) {
                const terms = logicalModelRes.result.qLogicalModel.qVocabulary?.qTerms || [];
                existingVocab = terms.map((t: any) => ({
                  targetName: t.qName || t.qDefinition?.qName,
                  synonyms: t.qSynonyms || [],
                }));
              }
            } catch {}

            clearTimeout(timeout);
            ws.close();
            return resolve({ fields, measures, existingVocab });
          }

          // ==========================================
          // SPARA LOGICAL MODEL (SYNONYMER)
          // ==========================================
          if (action === 'save') {
            // Skapa term-struktur för Qlik QIX Engine
            const qTerms = vocabulary.map((item: any) => ({
              qName: item.targetName,
              qSynonyms: Array.isArray(item.synonyms) ? item.synonyms : [],
            }));

            // Hämta eller skapa bas-LogicalModel
            let currentModel: any = { qVocabulary: { qTerms: [] } };
            try {
              const getRes = await send('GetLogicalModel', docHandle, []);
              if (getRes.result?.qLogicalModel) {
                currentModel = getRes.result.qLogicalModel;
              }
            } catch {}

            currentModel.qVocabulary = {
              ...(currentModel.qVocabulary || {}),
              qTerms: qTerms,
            };

            // Applicera och spara
            await send('SetLogicalModel', docHandle, [currentModel]);
            await send('DoSave', docHandle, []);

            clearTimeout(timeout);
            ws.close();
            return resolve({ success: true, count: qTerms.length });
          }

          throw new Error('Ogiltig åtgärd (action)');

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