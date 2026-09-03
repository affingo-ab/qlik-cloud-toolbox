export interface RawFieldInfo {
  name: string;
  table?: string;
  type?: 'numeric' | 'text' | 'date' | 'key' | 'unknown';
  comment?: string;
}

export interface SuggestedMeasure {
  id: string;
  title: string;
  label: string;
  expression: string;
  description: string;
  format?: string;
  tags?: string[];
  selected?: boolean;
}

export interface SuggestedDimension {
  id: string;
  title: string;
  label: string;
  fieldDefs: string[];
  description: string;
  tags?: string[];
  selected?: boolean;
}

export interface LogicalGroup {
  name: string;
  type: 'dimension' | 'measure' | 'calendar';
  items: string[];
  defaultGrain?: 'Year' | 'Quarter' | 'Month' | 'Week' | 'Day';
}

export interface LogicalPackage {
  name: string;
  description: string;
  groups: string[];
}

export interface LogicalHierarchy {
  name: string;
  levels: string[];
}

export interface LogicalBehavior {
  type: 'prefer' | 'deny' | 'required_selection';
  description: string;
  measureGroup?: string;
  preferredGroup?: string;
  deniedGroup?: string;
  requiredGroup?: string;
  selectionField?: string;
  selectionValues?: string[];
}

export interface VocabularyTerm {
  targetName: string;
  type: 'measure' | 'dimension' | 'field';
  locale: 'sv' | 'en';
  synonyms: string[];
}

export interface FullBusinessLogicPlan {
  masterItems: {
    measures: SuggestedMeasure[];
    dimensions: SuggestedDimension[];
  };
  logicalModel: {
    groups: LogicalGroup[];
    hiddenFields: string[];
    packages: LogicalPackage[];
    hierarchies: LogicalHierarchy[];
    behaviors: LogicalBehavior[];
  };
  vocabulary: {
    sv: {
      terms: VocabularyTerm[];
      exampleQuestions: string[];
    };
    en: {
      terms: VocabularyTerm[];
      exampleQuestions: string[];
    };
  };
}