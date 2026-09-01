import type { VercelRequest, VercelResponse } from '@vercel/node';

interface RequestItem {
  originalName: string;
  cleanName: string;
  type: 'dimension' | 'measure' | 'field';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { items, geminiKey, domain = 'Tillverkning, Försäljning & Affärsverksamhet' } = req.body as {
    items: RequestItem[];
    geminiKey?: string;
    domain?: string;
  };

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Inga fält skickades med för analys.' });
  }

  const apiKey = geminiKey?.trim() || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ 
      error: 'Gemini API Key saknas. Ange din nyckel i inställningsrutan ovan.' 
    });
  }

  const prompt = `
Du är en ledande expert på Business Intelligence och Qlik Sense Insight Advisor (Natural Language Processing).
Din uppgift är att ta fram vardagliga, relevanta affärssynonymer på svenska för följande fält och mått inom kontexten "${domain}".

Regler:
1. Skapa 3–5 starka och relevanta synonymer/fraser per term på svenska.
2. Inkludera vardagliga uttryck som användare faktiskt skriver eller frågar efter (t.ex. "Lagersaldo" -> "lager", "på hyllan", "disponibelt antal", "saldo").
3. Svara ENDAST med ett strikt JSON-objekt med exakt denna struktur:
{
  "suggestions": [
    {
      "targetName": "Originalnamn",
      "suggestedSynonyms": ["synonym 1", "synonym 2", "synonym 3"]
    }
  ]
}

Fält och termer att analysera:
${JSON.stringify(items.map(i => ({ originalName: i.originalName, term: i.cleanName, typ: i.type })), null, 2)}
`;

  const modelsToTry = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];

  for (const modelName of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          }
        }),
      });

      if (response.status === 503 || response.status === 429) {
        console.warn(`Modell ${modelName} överbelastad (Status ${response.status}), testar nästa...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`Fel med ${modelName}: ${errText}`);
        continue;
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (rawText) {
        const parsedData = JSON.parse(rawText);
        return res.status(200).json({
          suggestions: parsedData.suggestions || [],
          source: 'gemini',
          modelUsed: modelName,
        });
      }
    } catch (err: any) {
      console.warn(`Internt anropsfel för ${modelName}:`, err.message);
    }
  }

  // Fallback
  console.info('Använder lokal intelligent synonym-generator som fallback.');
  const fallbackSuggestions = items.map(item => {
    const base = item.cleanName.toLowerCase();
    const syns = new Set<string>();
    syns.add(base);
    syns.add(`totalt ${base}`);
    syns.add(`${base} per månad`);
    if (item.type === 'measure') {
      syns.add(`summa ${base}`);
      syns.add(`antal ${base}`);
    } else {
      syns.add(`${base}kod`);
      syns.add(`${base}namn`);
    }
    return {
      targetName: item.originalName,
      suggestedSynonyms: Array.from(syns)
    };
  });

  return res.status(200).json({ 
    suggestions: fallbackSuggestions,
    source: 'fallback',
    modelUsed: 'Inbyggd lokal regelmotor (Fallback)',
  });
}