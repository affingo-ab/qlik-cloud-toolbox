import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { items = [] } = req.body; // Array av fält- och måttnamn

  // Smart ordbok och mönstermatchare för svenska & engelska BI-termer
  const generateSuggestionsForTerm = (name: string): string[] => {
    const lower = name.toLowerCase().replace(/[_-]/g, ' ');
    const suggestions = new Set<string>();

    // 1. Datum & Tid
    if (lower.includes('år') || lower.includes('year')) {
      suggestions.add('År'); suggestions.add('Kalenderår'); suggestions.add('Year'); suggestions.add('Tidsperiod');
    }
    if (lower.includes('månad') || lower.includes('month')) {
      suggestions.add('Månad'); suggestions.add('Period'); suggestions.add('Month'); suggestions.add('Bokföringsperiod');
    }
    if (lower.includes('kvartal') || lower.includes('quarter') || lower.includes('qtr')) {
      suggestions.add('Kvartal'); suggestions.add('Quarter'); suggestions.add('Q');
    }
    if (lower.includes('vecka') || lower.includes('week')) {
      suggestions.add('Vecka'); suggestions.add('Week');
    }
    if (lower.includes('datum') || lower.includes('date')) {
      suggestions.add('Datum'); suggestions.add('Date'); suggestions.add('Dag'); suggestions.add('Tidpunkt');
    }

    // 2. Försäljning & Finans
    if (lower.includes('sales') || lower.includes('omsättning') || lower.includes('intäkt') || lower.includes('revenue')) {
      suggestions.add('Omsättning'); suggestions.add('Försäljning'); suggestions.add('Intäkt'); suggestions.add('Net Sales'); suggestions.add('Revenue');
    }
    if (lower.includes('profit') || lower.includes('vinst') || lower.includes('marginal') || lower.includes('margin')) {
      suggestions.add('Bruttovinst'); suggestions.add('Vinst'); suggestions.add('Marginal'); suggestions.add('Profit'); suggestions.add('TB');
    }
    if (lower.includes('cost') || lower.includes('kostnad') || lower.includes('cogs')) {
      suggestions.add('Kostnad'); suggestions.add('Utgift'); suggestions.add('Cost'); suggestions.add('Inköpskostnad');
    }
    if (lower.includes('order') || lower.includes('antal') || lower.includes('count') || lower.includes('qty') || lower.includes('quantity')) {
      suggestions.add('Antal'); suggestions.add('Volym'); suggestions.add('Kvantitet'); suggestions.add('Orderantal'); suggestions.add('Quantity');
    }
    if (lower.includes('budget') || lower.includes('target') || lower.includes('mål')) {
      suggestions.add('Budget'); suggestions.add('Mål'); suggestions.add('Target'); suggestions.add('Plan');
    }

    // 3. Kunder & Försäljning
    if (lower.includes('kund') || lower.includes('customer') || lower.includes('client')) {
      suggestions.add('Kund'); suggestions.add('Kundnamn'); suggestions.add('Customer'); suggestions.add('Klient'); suggestions.add('Köpare');
    }
    if (lower.includes('säljare') || lower.includes('sales rep') || lower.includes('rep') || lower.includes('agent')) {
      suggestions.add('Säljare'); suggestions.add('Säljansvarig'); suggestions.add('Sales Rep'); suggestions.add('Kontoansvarig');
    }

    // 4. Geografi
    if (lower.includes('land') || lower.includes('country') || lower.includes('nation')) {
      suggestions.add('Land'); suggestions.add('Country'); suggestions.add('Nation'); suggestions.add('Marknad');
    }
    if (lower.includes('region') || lower.includes('område') || lower.includes('distrikt') || lower.includes('area')) {
      suggestions.add('Region'); suggestions.add('Försäljningsregion'); suggestions.add('Område'); suggestions.add('Distrikt');
    }
    if (lower.includes('stad') || lower.includes('city') || lower.includes('ort')) {
      suggestions.add('Stad'); suggestions.add('Ort'); suggestions.add('City');
    }

    // 5. Produkter & Artiklar
    if (lower.includes('produkt') || lower.includes('product') || lower.includes('artikel') || lower.includes('item')) {
      suggestions.add('Produkt'); suggestions.add('Artikel'); suggestions.add('Produktnamn'); suggestions.add('Item'); suggestions.add('Vara');
    }
    if (lower.includes('kategori') || lower.includes('category') || lower.includes('grupp') || lower.includes('group')) {
      suggestions.add('Kategori'); suggestions.add('Produktgrupp'); suggestions.add('Huvudkategori'); suggestions.add('Category');
    }

    // Fallback: Dela upp camelCase (t.ex. CustomerCategory -> Customer, Category)
    if (suggestions.size === 0) {
      const parts = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
      parts.forEach(p => {
        if (p.length > 2) suggestions.add(p);
      });
    }

    return Array.from(suggestions).slice(0, 5);
  };

  const results = items.map((item: any) => ({
    targetName: item.name || item.title,
    type: item.type, // 'field' eller 'measure'
    suggestedSynonyms: generateSuggestionsForTerm(item.name || item.title),
  }));

  return res.status(200).json({ suggestions: results });
}