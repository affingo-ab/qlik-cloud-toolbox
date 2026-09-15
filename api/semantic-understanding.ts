import type { VercelRequest, VercelResponse } from '@vercel/node';

export interface ModelElementItem {
  id: string;
  name: string;
  tableName?: string;
  role?: string;
  type?: string;
  description?: string;
  overrideDescription?: boolean;
  classifications?: string[];
  synonyms?: string[];
  distinctCount?: number;
  valueRange?: { min: any; max: any };
}

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

  const { action, tenant, apiKey, webIntegrationId, appId, elementId, elementIds, description, overrideDescriptionFlag = true, updates = [] } = req.body;

  if (!tenant || !apiKey || !appId) {
    return res.status(400).json({ error: 'Missing parameters: tenant, apiKey or appId' });
  }

  const cleanHost = tenant.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
  };

  if (webIntegrationId && webIntegrationId.trim()) {
    headers['qlik-web-integration-id'] = webIntegrationId.trim();
  }

  try {
    // ==========================================
    // 1. HÄMTA ALLA MODELL-ELEMENT OCH APP-METADATA
    // ==========================================
    if (action === 'get') {
      const getUrl = `https://${cleanHost}/api/v1/nlsearch/apps/${appId}/modelElements`;
      const response = await fetch(getUrl, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Qlik API fel (${response.status}): ${errText || response.statusText}`);
      }

      const data: any = await response.json();
      return res.status(200).json({
        modelElements: data.model_elements || [],
        app: data.app || null,
      });
    }

    // ==========================================
    // 2. UPPDATERA EN ENSKILD BESKRIVNING
    // ==========================================
    if (action === 'update') {
      const targetIds = elementIds || (elementId ? [elementId] : []);
      if (targetIds.length === 0) {
        return res.status(400).json({ error: 'Missing elementId or elementIds' });
      }

      const postUrl = `https://${cleanHost}/api/v1/nlsearch/apps/${appId}/model-elements/description`;
      const payload = {
        elementIds: targetIds,
        overrideDescriptionFlag: Boolean(overrideDescriptionFlag),
        overrideDescriptionText: description || '',
      };

      const response = await fetch(postUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Qlik API fel vid uppdatering (${response.status}): ${errText || response.statusText}`);
      }

      return res.status(200).json({
        success: true,
        updatedCount: targetIds.length,
      });
    }

    // ==========================================
    // 3. BATCH-UPPDATERING AV FLERA FÄLT
    // ==========================================
    if (action === 'batch-update') {
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided in batch' });
      }

      const postUrl = `https://${cleanHost}/api/v1/nlsearch/apps/${appId}/model-elements/description`;
      let successCount = 0;
      const errors: string[] = [];

      for (const item of updates) {
        try {
          const payload = {
            elementIds: [item.id],
            overrideDescriptionFlag: item.overrideDescriptionFlag !== undefined ? Boolean(item.overrideDescriptionFlag) : true,
            overrideDescriptionText: item.description || '',
          };

          const response = await fetch(postUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });

          if (response.ok) {
            successCount++;
          } else {
            const errText = await response.text();
            errors.push(`Fält ID ${item.id} misslyckades: ${errText}`);
          }
        } catch (e: any) {
          errors.push(`Fält ID ${item.id}: ${e.message}`);
        }
      }

      return res.status(200).json({
        success: true,
        total: updates.length,
        updatedCount: successCount,
        errors,
      });
    }

    return res.status(400).json({ error: `Ogiltig åtgärd: ${action}` });
  } catch (error: any) {
    console.error('API Error in semantic-understanding:', error);
    return res.status(500).json({ error: error.message || 'Internt serverfel' });
  }
}