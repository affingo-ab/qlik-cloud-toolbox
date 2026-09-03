import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { RawFieldInfo, FullBusinessLogicPlan } from '../src/types/businessLogic';

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

  const { fields = [], appName = 'Qlik App', geminiKey, domain = 'Försäljning, Affärsverksamhet & Logistik' } = req.body as {
    fields: (string | RawFieldInfo)[];
    appName?: string;
    geminiKey?: string;
    domain?: string;
  };

  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: 'Inga fält skickades med för analys.' });
  }

  const apiKey = geminiKey?.trim() || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  const normalizedFields: RawFieldInfo[] = fields.map(f => {
    if (typeof f === 'string') {
      const isKey = f.toLowerCase().endsWith('id') || f.toLowerCase().endsWith('key') || f.startsWith('%');
      const isDate = f.toLowerCase().includes('date') || f.toLowerCase().includes('datum') || f.toLowerCase() === 'year' || f.toLowerCase() === 'month';
      return {
        name: f,
        type: isKey ? 'key' : isDate ? 'date' : 'unknown'
      };
    }
    return f;
  });

  const prompt = `
Du är en ledande Qlik Sense- och Qlik Cloud AI-expert (Natural Language & Business Logic).
Din uppgift är att ta fram en komplett, produktionsredo Business Logic-konfiguration för appen "${appName}" inom domänen "${domain}".

Följande fält finns i appens datamodell:
${JSON.stringify(normalizedFields, null, 2)}

Skapa en komplett berikning i JSON med EXAKT denna struktur:
{
  "masterItems": {
    "measures": [
      {
        "id": "meas_total_sales",
        "title": "Total Sales",
        "label": "Total Försäljning",
        "expression": "Sum(Sales)",
        "description": "Summan av total försäljning.",
        "format": "#,##0 kr",
        "tags": ["AI-Generated", "Core"]
      }
    ],
    "dimensions": [
      {
        "id": "dim_customer",
        "title": "Customer",
        "label": "Kund",
        "fieldDefs": ["Customer"],
        "description": "Kundnamn/konto.",
        "tags": ["AI-Generated"]
      }
    ]
  },
  "logicalModel": {
    "groups": [
      {
        "name": "Sales Measures",
        "type": "measure",
        "items": ["Total Sales"]
      },
      {
        "name": "Customers",
        "type": "dimension",
        "items": ["Customer", "City", "Country"]
      },
      {
        "name": "Order Calendar",
        "type": "calendar",
        "items": ["OrderDate", "Year", "Month"],
        "defaultGrain": "Month"
      }
    ],
    "hiddenFields": ["OrderID", "CustomerID", "ProductID"],
    "packages": [
      {
        "name": "Commercial Scope",
        "description": "Huvudsaklig analys för försäljning och kunder",
        "groups": ["Sales Measures", "Customers", "Order Calendar"]
      }
    ],
    "hierarchies": [
      {
        "name": "Geografi",
        "levels": ["Country", "City", "Customer"]
      }
    ],
    "behaviors": [
      {
        "type": "prefer",
        "description": "Föredra kund framför stad vid försäljningsanalys",
        "measureGroup": "Sales Measures",
        "preferredGroup": "Customers"
      }
    ]
  },
  "vocabulary": {
    "sv": {
      "terms": [
        {
          "targetName": "Total Sales",
          "type": "measure",
          "locale": "sv",
          "synonyms": ["omsättning", "intäkt", "försäljning", "top line"]
        }
      ],
      "exampleQuestions": [
        "Hur stor är total försäljning per kund i år?",
        "Visa försäljning per månad"
      ]
    },
    "en": {
      "terms": [
        {
          "targetName": "Total Sales",
          "type": "measure",
          "locale": "en",
          "synonyms": ["revenue", "turnover", "total sales", "gross sales"]
        }
      ],
      "exampleQuestions": [
        "What is the total sales by customer this year?",
        "Show sales trend by month"
      ]
    }
  }
}

Regler:
1. Identifiera alla tekniska ID/nycklar och lägg dem i "hiddenFields" så att AI inte försöker visualisera dem.
2. Skapa relevanta Master Measures med riktiga Qlik-formler (Sum, Avg, Count(DISTINCT ...)).
3. Skapa synonymer på BÅDE svenska ("sv") och engelska ("en").
4. Returnera ENDAST giltigt JSON utan markdown-kodblock.
`;

  if (apiKey) {
    const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash'];
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

        if (response.ok) {
          const data = await response.json();
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText) as FullBusinessLogicPlan;
            return res.status(200).json({ plan: parsed, source: 'gemini', modelUsed: modelName });
          }
        }
      } catch (err: any) {
        console.warn(`Fel vid anrop till ${modelName}:`, err.message);
      }
    }
  }

  // Lokal intelligent regelmotor som fallback
  const fallbackPlan: FullBusinessLogicPlan = generateFallbackPlan(normalizedFields, appName);
  return res.status(200).json({ plan: fallbackPlan, source: 'fallback', modelUsed: 'Inbyggd regelmotor' });
}

function generateFallbackPlan(fields: RawFieldInfo[], appName: string): FullBusinessLogicPlan {
  const hiddenFields: string[] = [];
  const dimItems: string[] = [];
  const calendarItems: string[] = [];
  const measures: any[] = [];
  const dimensions: any[] = [];
  const vocabSv: any[] = [];
  const vocabEn: any[] = [];

  for (const f of fields) {
    const name = f.name;
    const lower = name.toLowerCase();

    if (lower.endsWith('id') || lower.endsWith('key') || lower.startsWith('%') || lower.startsWith('_')) {
      hiddenFields.push(name);
      continue;
    }

    if (lower.includes('date') || lower.includes('datum') || lower === 'year' || lower === 'month') {
      calendarItems.push(name);
      continue;
    }

    if (lower.includes('sales') || lower.includes('amount') || lower.includes('cost') || lower.includes('margin') || lower.includes('quantity') || lower.includes('price')) {
      const measTitle = `Total ${name}`;
      measures.push({
        id: `meas_${lower}`,
        title: measTitle,
        label: measTitle,
        expression: `Sum([${name}])`,
        description: `Summa av ${name}`,
        format: '#,##0 kr',
        tags: ['Auto-Generated']
      });

      vocabSv.push({
        targetName: measTitle,
        type: 'measure',
        locale: 'sv',
        synonyms: [lower, `totalt ${lower}`, `summa ${lower}`]
      });

      vocabEn.push({
        targetName: measTitle,
        type: 'measure',
        locale: 'en',
        synonyms: [lower, `total ${lower}`, `sum of ${lower}`]
      });
      continue;
    }

    dimItems.push(name);
    dimensions.push({
      id: `dim_${lower}`,
      title: name,
      label: name,
      fieldDefs: [name],
      description: `Dimension för ${name}`,
      tags: ['Auto-Generated']
    });

    vocabSv.push({
      targetName: name,
      type: 'dimension',
      locale: 'sv',
      synonyms: [lower, `${lower}namn`]
    });

    vocabEn.push({
      targetName: name,
      type: 'dimension',
      locale: 'en',
      synonyms: [lower, `${lower} name`]
    });
  }

  return {
    masterItems: { measures, dimensions },
    logicalModel: {
      groups: [
        { name: 'Measures', type: 'measure', items: measures.map(m => m.title) },
        { name: 'Dimensions', type: 'dimension', items: dimItems },
        ...(calendarItems.length > 0 ? [{ name: 'Calendar', type: 'calendar' as const, items: calendarItems, defaultGrain: 'Month' as const }] : [])
      ],
      hiddenFields,
      packages: [
        { name: `${appName} Scope`, description: 'Standard analysomfång', groups: ['Measures', 'Dimensions', ...(calendarItems.length > 0 ? ['Calendar'] : [])] }
      ],
      hierarchies: [],
      behaviors: []
    },
    vocabulary: {
      sv: { terms: vocabSv, exampleQuestions: ['Visa total försäljning per månad'] },
      en: { terms: vocabEn, exampleQuestions: ['Show total sales by month'] }
    }
  };
}