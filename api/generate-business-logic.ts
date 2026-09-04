import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { RawFieldInfo, FullBusinessLogicPlan } from '../src/types/businessLogic';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fields = [], appName = 'Qlik App', geminiKey, domain = 'Försäljning, Affärsverksamhet & Logistik' } = req.body as {
    fields: (string | RawFieldInfo)[];
    appName?: string;
    geminiKey?: string;
    domain?: string;
  };

  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: 'Inga fält skickades med för analys.' });
  }

  const apiKey = (geminiKey || '').trim() || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return res.status(400).json({
      error: 'Gemini API-nyckel saknas! Fyll i din API-nyckel i verktyget.'
    });
  }

  // Dataminimering: Rensa bort tekniska prefix och ändelser
  const sanitizedFieldNames = fields.map(f => {
    const raw = typeof f === 'string' ? f : f.name;
    return raw.replace(/^(tbl_|dim_|fct_|v_|%|_)/i, '').replace(/(_id|_kod|_code|_key)$/i, '').trim();
  }).filter(Boolean);

  // 1. Fråga Google vilka modeller som finns tillgängliga för API-nyckeln
  let availableModels: string[] = [];
  try {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (listRes.ok) {
      const listData = await listRes.json();
      availableModels = (listData.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace(/^models\//, ''));
    }
  } catch (err: any) {
    console.warn('Kunde inte lista modeller:', err.message);
  }

  // Googles officiella rekommenderade modeller (med gemini-3.6-flash överst)
  const preferredModels = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.0-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ];

  const candidateModels = [
    'gemini-3.6-flash',
    ...availableModels.filter(m => m.includes('3.') && m.includes('flash')),
    ...preferredModels.filter(m => availableModels.includes(m)),
    ...availableModels.filter(m => m.includes('flash')),
    ...preferredModels
  ].filter((v, i, a) => a.indexOf(v) === i);

  // 2. Dela upp fälten i batchar om max 25 fält för 100% täckning
  const BATCH_SIZE = 25;
  const batches: string[][] = [];
  for (let i = 0; i < sanitizedFieldNames.length; i += BATCH_SIZE) {
    batches.push(sanitizedFieldNames.slice(i, i + BATCH_SIZE));
  }

  // Funktion för att köra en batch mot Gemini med automatisk modell-fallback
  async function callGeminiWithFallback(prompt: string): Promise<{ data: FullBusinessLogicPlan; usedModel: string }> {
    let lastError = '';

    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
              maxOutputTokens: 8192,
            }
          }),
        });

        if (response.ok) {
          const resJson = await response.json();
          let rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
          rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
          const firstBrace = rawText.indexOf('{');
          const lastBrace = rawText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            rawText = rawText.substring(firstBrace, lastBrace + 1);
          }
          const parsed = JSON.parse(rawText) as FullBusinessLogicPlan;
          return { data: parsed, usedModel: model };
        } else {
          const errBody = await response.text();
          lastError = `${model} (${response.status}): ${errBody}`;
          console.warn(`Modell ${model} gav fel, provar nästa:`, lastError);
        }
      } catch (err: any) {
        lastError = `${model} anrop misslyckades: ${err.message}`;
        console.warn(lastError);
      }
    }

    throw new Error(`Alla Gemini-modeller misslyckades. Senaste: ${lastError}`);
  }

  async function processBatch(batchFields: string[]): Promise<{ plan: FullBusinessLogicPlan; usedModel: string }> {
    const prompt = `
Du är en ledande Qlik Cloud- och BI-expert specialiserad på Natural Language, Insight Advisor och Business Logic.
Din uppgift är att systematiskt analysera ALLA ${batchFields.length} fält nedan för appen "${appName}" inom branschen "${domain}".

Fält att analysera i denna batch:
${batchFields.join(', ')}

VIKTIGA REGLER FÖR 100% TÄCKNING:
Du får INTE hoppa över några fält! Varje affärsrelevant fält SKALL bli antingen ett mått eller en dimension:
1. MÅTT (MASTER MEASURES):
   - Skapa mått för ALLA fält som är mätbara (t.ex. "Beställd mängd", "Beställd kvantitet", "Levererad mängd", "Total tid", "Schemalagd tid", "Belopp", "Kostnad", "Antal", "Volym", "Duration", etc.).
   - Uttryck: t.ex. Sum([Beställd mängd]), Sum([Total tid]), Sum([Belopp]).
2. DIMENSIONER (MASTER DIMENSIONS):
   - Skapa dimensioner för ALLA beskrivande text- och attributfält (t.ex. "Benämning", "Artikel", "Kund", "Enhet", "Kategori", "Status", etc.).
3. VOCABULARY (SYNONYMER PÅ SVENSKA OCH ENGELSKA FÖR VARJE MÅTT OCH DIMENSION):
   - Skapa 4–7 naturliga synonymer per fält på svenska OCH engelska (korrekt affärsengelska!):
     * "Benämning" -> SV: ["benämning", "namn", "beskrivning", "titel", "beteckning"] | EN: ["description", "name", "title", "designation", "label"]
     * "Beställd mängd" -> SV: ["beställd mängd", "kvantitet", "volym", "antal beställt", "orderkvantitet"] | EN: ["ordered quantity", "order volume", "quantity ordered", "units ordered"]
     * "Total tid" -> SV: ["total tid", "tidsåtgång", "arbetstid", "timmar", "varaktighet"] | EN: ["total time", "total hours", "time spent", "duration", "work time"]
     * "Enhet" -> SV: ["enhet", "måttenhet", "enhetstyp"] | EN: ["unit", "unit of measure", "uom", "measurement unit"]
4. EXEMPELFRÅGOR:
   - Skapa 2–3 relevanta affärsfrågor på svenska och engelska för måtten i batchen.

Returnera ett strikt JSON-objekt med följande struktur:
{
  "masterItems": {
    "measures": [
      {
        "id": "meas_bestalld_mangd",
        "title": "Beställd mängd",
        "label": "Beställd mängd",
        "expression": "Sum([Beställd mängd])",
        "description": "Summan av beställd mängd",
        "format": "#,##0 st",
        "tags": ["AI-Generated"]
      }
    ],
    "dimensions": [
      {
        "id": "dim_benamning",
        "title": "Benämning",
        "label": "Benämning",
        "fieldDefs": ["Benämning"],
        "description": "Artikelbenämning",
        "tags": ["AI-Generated"]
      }
    ]
  },
  "logicalModel": {
    "groups": [],
    "hiddenFields": [],
    "packages": [],
    "hierarchies": []
  },
  "vocabulary": {
    "sv": {
      "terms": [
        {
          "targetName": "Beställd mängd",
          "type": "measure",
          "locale": "sv",
          "synonyms": ["kvantitet", "volym", "antal beställt", "orderkvantitet"]
        }
      ],
      "exampleQuestions": ["Hur stor är beställd mängd per månad?"]
    },
    "en": {
      "terms": [
        {
          "targetName": "Beställd mängd",
          "type": "measure",
          "locale": "en",
          "synonyms": ["ordered quantity", "order volume", "quantity ordered"]
        }
      ],
      "exampleQuestions": ["What is ordered quantity by month?"]
    }
  }
}
Svara ENDAST med ren JSON utan markdown-kodblock.
`;

    const { data, usedModel } = await callGeminiWithFallback(prompt);
    return { plan: data, usedModel };
  }

  try {
    // Kör batcharna parallellt med automatisk modellhantering
    const results = await Promise.all(batches.map(b => processBatch(b)));

    const usedModel = results[0]?.usedModel || 'gemini-3.6-flash';

    const mergedMeasures: any[] = [];
    const mergedDimensions: any[] = [];
    const mergedSvTerms: any[] = [];
    const mergedEnTerms: any[] = [];
    const mergedSvQuestions: string[] = [];
    const mergedEnQuestions: string[] = [];

    results.forEach(({ plan: res }) => {
      mergedMeasures.push(...(res.masterItems?.measures || []));
      mergedDimensions.push(...(res.masterItems?.dimensions || []));
      mergedSvTerms.push(...(res.vocabulary?.sv?.terms || []));
      mergedEnTerms.push(...(res.vocabulary?.en?.terms || []));
      mergedSvQuestions.push(...(res.vocabulary?.sv?.exampleQuestions || []));
      mergedEnQuestions.push(...(res.vocabulary?.en?.exampleQuestions || []));
    });

    const finalPlan: FullBusinessLogicPlan = {
      masterItems: {
        measures: mergedMeasures,
        dimensions: mergedDimensions
      },
      logicalModel: {
        groups: [
          {
            name: "Mått & Kvantiteter",
            type: "measure",
            items: mergedMeasures.map(m => m.title)
          },
          {
            name: "Attribut & Dimensioner",
            type: "dimension",
            items: mergedDimensions.map(d => d.title)
          }
        ],
        hiddenFields: [],
        packages: [
          {
            name: `${appName} Scope`,
            description: "Analysomfång",
            groups: ["Mått & Kvantiteter", "Attribut & Dimensioner"]
          }
        ],
        hierarchies: []
      },
      vocabulary: {
        sv: {
          terms: mergedSvTerms,
          exampleQuestions: Array.from(new Set(mergedSvQuestions)).slice(0, 6),
          customAnalyses: []
        },
        en: {
          terms: mergedEnTerms,
          exampleQuestions: Array.from(new Set(mergedEnQuestions)).slice(0, 6),
          customAnalyses: []
        }
      }
    };

    return res.status(200).json({ plan: finalPlan, source: 'gemini', modelUsed: usedModel });

  } catch (err: any) {
    console.error('Batchning misslyckades:', err.message);
    return res.status(502).json({
      error: `Kunde inte generera med Gemini: ${err.message}`
    });
  }
}