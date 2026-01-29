export type ThemePromptMode = "fullTemplate";

export interface ThemePromptConfig {
  mode: ThemePromptMode;
  template: string;
}

export interface ThemeFallbackTemplate {
  title: string;
  body: string;
}

export interface ThemeFallbackTemplates {
  [rubric: string]: ThemeFallbackTemplate;
}

export interface ThemeUnsplashConfig {
  queryByRubric?: Record<string, string>;
}

export interface ThemeMediaConfig {
  unsplash?: ThemeUnsplashConfig;
}

export interface ThemeCaptionRules {
  min: number;
  max: number;
  minSoft?: number;
  maxSoft?: number;
  allowShorter?: boolean;
  telegramMax?: number;
  maxTries?: number;
  similarityThreshold?: number;
  minChars?: number;
  maxChars?: number;
}

export interface ThemeConfig {
  name: string;
  language?: string;
  audience: string;
  rubrics: string[];
  tones: string[];
  cta: string[];
  captionRules: ThemeCaptionRules;
  schedule?: {
    mode: "hourly" | "daily" | "hours" | "off";
    time?: string;
    hours?: string | string[];
    minute?: number;
  };
  briefs?: string[];
  briefsByRubric?: Record<string, string[]>;
  unsplash?: ThemeUnsplashConfig;
  media?: ThemeMediaConfig;
  promptConfig?: ThemePromptConfig;
  fallbackTemplates?: ThemeFallbackTemplates;
}
