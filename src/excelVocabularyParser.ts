import * as XLSX from 'xlsx';

export interface VocabularyItem {
  targetName: string;
  type: 'dimension' | 'measure' | 'field';
  synonyms: string[];
}

export interface ParseResult {
  success: boolean;
  data: VocabularyItem[];
  rowCount: number;
  error?: string;
}

export const parseVocabularyExcel = async (file: File): Promise<ParseResult> => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const buffer = e.target?.result;
        const workbook = XLSX.read(buffer, { type: 'binary' });

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!rawRows || rawRows.length === 0) {
          resolve({ success: false, data: [], rowCount: 0, error: 'Excel-filen är tom eller saknar data.' });
          return;
        }

        const items: VocabularyItem[] = [];

        rawRows.forEach((row) => {
          const keys = Object.keys(row);
          const findVal = (possibleKeys: string[]) => {
            const key = keys.find(k => possibleKeys.includes(k.trim().toLowerCase()));
            return key ? String(row[key]).trim() : '';
          };

          // Stödjer både Qlik Sense exports (Field, Terms, Master Item) och vanliga Excel-mallar
          const targetName = findVal(['field', 'term', 'fält', 'fältnamn', 'name', 'namn', 'targetname']);
          if (!targetName) return;

          const rawType = findVal(['type', 'typ', 'master item', 'kategori']).toLowerCase();
          let type: VocabularyItem['type'] = 'field';
          if (rawType.includes('measure') || rawType.includes('mått')) {
            type = 'measure';
          } else if (rawType.includes('dimension')) {
            type = 'dimension';
          } else if (rawType === 'true') {
            type = 'dimension';
          }

          const rawTerms = findVal(['terms', 'synonymer', 'synonyms', 'alias', 'keywords']);
          const synonyms = rawTerms
            ? rawTerms
                .split(/[,;\n]/)
                .map(s => s.trim())
                .filter(Boolean)
            : [];

          items.push({
            targetName,
            type,
            synonyms: Array.from(new Set(synonyms)),
          });
        });

        resolve({
          success: true,
          data: items,
          rowCount: items.length,
        });
      } catch (err: any) {
        resolve({
          success: false,
          data: [],
          rowCount: 0,
          error: `Kunde inte läsa Excel-filen: ${err.message || err}`,
        });
      }
    };

    reader.onerror = () => {
      resolve({ success: false, data: [], rowCount: 0, error: 'Kunde inte läsa in filen.' });
    };

    reader.readAsBinaryString(file);
  });
};