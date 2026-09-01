export interface SanitizedItem {
  originalName: string;
  cleanName: string;
  type: 'dimension' | 'measure' | 'field';
  domain?: string;
}

export function sanitizeFieldName(name: string): string {
  let clean = name.trim();

  // 1. Ta bort vanliga tekniska prefix och suffix
  clean = clean.replace(/^(tbl_|dim_|fct_|v_|kob_|aff_|app_)/i, '');
  clean = clean.replace(/(_id|_kod|_code|_key|_nr|_num)$/i, '');

  // 2. Ersätt understreck och camelCase med mellanslag
  clean = clean.replace(/_/g, ' ');
  clean = clean.replace(/([a-z])([A-Z])/g, '$1 $2');

  // 3. Städa dubbla mellanslag
  clean = clean.replace(/\s+/g, ' ').trim();

  return clean || name;
}

export function prepareItemsForLLM(
  items: { targetName: string; type: 'dimension' | 'measure' | 'field' }[],
  domain: string = 'Affärsverksamhet & Försäljning'
): SanitizedItem[] {
  return items.map(item => ({
    originalName: item.targetName,
    cleanName: sanitizeFieldName(item.targetName),
    type: item.type,
    domain: domain,
  }));
}