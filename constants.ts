import { ModelType, OptimizationProfile } from './types';

export const APP_TITLE = "Gemini PDF Insight";
export const AUTO_OPTIMIZER_LABEL = "Auto Pareto Optimizer";

export const OCR_PROFILE_ORDER: OptimizationProfile[] = ['economy', 'balanced', 'accuracy'];

export interface OcrProfilePolicy {
  model: ModelType;
  imageMaxDimension: number;
  imageChunkSize: number;
  minQualityScore: number;
  carryContextChars: number;
}

export const OCR_PROFILE_POLICIES: Record<OptimizationProfile, OcrProfilePolicy> = {
  economy: {
    model: ModelType.FLASH,
    imageMaxDimension: 1600,
    imageChunkSize: 8,
    minQualityScore: 0.58,
    carryContextChars: 240
  },
  balanced: {
    model: ModelType.FLASH,
    imageMaxDimension: 2200,
    imageChunkSize: 5,
    minQualityScore: 0.72,
    carryContextChars: 420
  },
  accuracy: {
    model: ModelType.PRO,
    imageMaxDimension: 3200,
    imageChunkSize: 3,
    minQualityScore: 0.0,
    carryContextChars: 640
  }
};

export const OCR_OUTPUT_CONTRACT = `Return Markdown only.
- Keep original order and wording. Do not summarize.
- Preserve headings, lists, formulas, and table structures.
- If a character is unreadable, keep it as □.
- For figures/diagrams, add [FIGURE] then transcribe visible text and short structural notes.
- For tables, output valid Markdown tables.`;

export const INITIAL_PROMPT = `Transcribe the attached PDF as-is.
- Keep line and section order.
- Correct obvious OCR split-word artifacts only.
- Do not add explanations outside the transcription output.`;

export const INITIAL_IMAGE_PROMPT = `Transcribe these ordered images as a single document.
- Keep page sequence strict.
- Preserve wording and structure verbatim.
- Do not add explanations outside the transcription output.`;

export const PDF_BALANCED_MAX_MB = 4;
export const PDF_ECONOMY_MIN_MB = 12;
export const PDF_ESCALATION_THRESHOLD = 0.45;
export const OCR_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
export const OCR_CACHE_SCHEMA_VERSION = 'v4';
export const OCR_POLICY_FINGERPRINT_VERSION = '2026-02-07';
export const OUTPUT_STREAM_CHUNK_SIZE = 1400;

export const MAX_CONCURRENT_REQUESTS = 5;
export const MAX_ESCALATION_SPAN_PAGES = 5;
export const QUALITY_VERIFIER_SAMPLE_CHARS = 2200;
