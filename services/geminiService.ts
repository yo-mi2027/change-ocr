import { GoogleGenAI } from "@google/genai";
import {
  OCR_CACHE_SCHEMA_VERSION,
  OCR_CACHE_TTL_MS,
  OCR_OUTPUT_CONTRACT,
  OCR_POLICY_FINGERPRINT_VERSION,
  OCR_PROFILE_POLICIES,
  OUTPUT_STREAM_CHUNK_SIZE,
  PDF_BALANCED_MAX_MB,
  PDF_ECONOMY_MIN_MB,
  PDF_ESCALATION_THRESHOLD,
  QUALITY_VERIFIER_SAMPLE_CHARS
} from '../constants';
import { AnalysisEvent, ModelType, OptimizationProfile, QualityAssessment } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const PDF_CACHE_PREFIX = `ocr-cache:pdf:${OCR_CACHE_SCHEMA_VERSION}`;

type AnalysisEventHandler = (event: AnalysisEvent) => void;

interface PdfCacheEntry {
  createdAt: number;
  text: string;
  profile: OptimizationProfile;
  quality: number;
}

const PROFILE_LABEL: Record<OptimizationProfile, string> = {
  economy: 'Economy',
  balanced: 'Balanced',
  accuracy: 'Accuracy'
};

const emit = (handler: AnalysisEventHandler | undefined, event: AnalysisEvent) => {
  if (handler) handler(event);
};

const toMB = (base64: string): number => Math.floor((base64.length * 0.75) / (1024 * 1024));

const decideInitialPdfProfile = (pdfBase64: string): OptimizationProfile => {
  const mb = toMB(pdfBase64);
  if (mb >= PDF_ECONOMY_MIN_MB) return 'economy';
  if (mb <= PDF_BALANCED_MAX_MB) return 'balanced';
  return 'economy';
};

const resolvePdfCandidateProfiles = (pdfBase64: string, modelOverride?: ModelType): OptimizationProfile[] => {
  const initial = decideInitialPdfProfile(pdfBase64);

  if (modelOverride === ModelType.PRO) {
    return ['accuracy'];
  }

  if (modelOverride === ModelType.FLASH) {
    return initial === 'balanced' ? ['balanced'] : ['economy', 'balanced'];
  }

  return initial === 'balanced'
    ? ['balanced', 'accuracy']
    : ['economy', 'balanced', 'accuracy'];
};

const modelForProfile = (profile: OptimizationProfile, modelOverride?: ModelType): ModelType => {
  if (modelOverride) return modelOverride;
  return OCR_PROFILE_POLICIES[profile].model;
};

const fastHash = (input: string): string => {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
};

const sha256Hex = async (input: string): Promise<string> => {
  try {
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(input);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fallback below.
  }
  return fastHash(input);
};

const buildPdfCacheKey = async (pdfBase64: string, prompt: string): Promise<string> => {
  const middle = Math.max(0, Math.floor(pdfBase64.length / 2) - 256);
  const fingerprint = [
    String(pdfBase64.length),
    pdfBase64.slice(0, 512),
    pdfBase64.slice(middle, middle + 512),
    pdfBase64.slice(-512)
  ].join('|');
  const promptHash = await sha256Hex(prompt);
  const fingerprintHash = await sha256Hex(fingerprint);
  const policyHash = await sha256Hex(JSON.stringify({
    version: OCR_POLICY_FINGERPRINT_VERSION,
    outputContract: OCR_OUTPUT_CONTRACT,
    profilePolicies: OCR_PROFILE_POLICIES
  }));
  return `${PDF_CACHE_PREFIX}:${policyHash}:${promptHash}:${fingerprintHash}`;
};

const readPdfCache = (cacheKey: string): PdfCacheEntry | null => {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PdfCacheEntry;
    if (!parsed.createdAt || (Date.now() - parsed.createdAt) > OCR_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writePdfCache = (cacheKey: string, entry: PdfCacheEntry): void => {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch {
    // Ignore quota errors; cache is opportunistic.
  }
};

const buildPdfPrompt = (prompt: string, profile: OptimizationProfile): string => {
  const profileHint = profile === 'economy'
    ? 'Prioritize direct transcription. Keep output concise and avoid redundant spacing.'
    : profile === 'balanced'
      ? 'Prioritize faithful transcription with moderate OCR corrections for broken words.'
      : 'Prioritize maximum fidelity. Resolve ambiguous glyphs from surrounding context when possible.';

  const userInstruction = prompt.trim() || 'No additional user instruction.';

  return [
    OCR_OUTPUT_CONTRACT,
    profileHint,
    `User instruction:\n${userInstruction}`
  ].join('\n\n');
};

const estimateTextTokens = (text: string): number => Math.ceil(text.length / 4);

const estimateInlineDataTokens = (base64: string): number => {
  const bytes = base64.length * 0.75;
  return Math.max(1, Math.ceil(bytes / 1024));
};

const normalizedLines = (text: string): string[] => {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
};

const evaluateQuality = (text: string): QualityAssessment => {
  const normalized = text.replace(/\r/g, '');
  const chars = Math.max(normalized.length, 1);
  const lines = normalizedLines(normalized);
  const unreadableChars = (normalized.match(/�/g) ?? []).length;
  const placeholderChars = (normalized.match(/□/g) ?? []).length;
  const punctuationBlobs = (normalized.match(/[^\w\s]{5,}/g) ?? []).length;
  const shortLineCount = lines.filter(line => line.length <= 2).length;
  const shortLineRate = lines.length === 0 ? 1 : shortLineCount / lines.length;
  const markdownHeadingCount = lines.filter(line => /^#{1,6}\s/.test(line)).length;
  const tableLineCount = lines.filter(line => /\|/.test(line)).length;
  const veryLongTokenCount = (normalized.match(/[^\s]{35,}/g) ?? []).length;
  const repeatedGlyphBurstCount = (normalized.match(/(.)\1{7,}/g) ?? []).length;
  const unreadableRate = unreadableChars / chars;
  const placeholderRate = placeholderChars / chars;
  const structureSignal = markdownHeadingCount + tableLineCount;

  let score = 1;
  score -= unreadableRate * 2.2;
  score -= Math.min(0.15, placeholderRate * 0.6);
  score -= shortLineRate * 0.45;
  score -= Math.min(0.25, punctuationBlobs * 0.03);
  score -= Math.min(0.2, veryLongTokenCount * 0.02);
  score -= Math.min(0.25, repeatedGlyphBurstCount * 0.04);
  if (normalized.trim().length < 120) score -= 0.25;
  if (structureSignal === 0 && lines.length > 40) score -= 0.06;
  score = Math.max(0, Math.min(1, score));

  const reasons: string[] = [];
  if (unreadableRate > 0.003) reasons.push('High ratio of corrupted replacement characters');
  if (placeholderRate > 0.02) reasons.push('Many unresolved glyph placeholders remain');
  if (shortLineRate > 0.35) reasons.push('Too many fragmented short lines');
  if (punctuationBlobs > 3) reasons.push('Potential OCR artifacts around symbols');
  if (veryLongTokenCount > 2) reasons.push('Unnaturally long tokens may indicate OCR merge errors');
  if (repeatedGlyphBurstCount > 1) reasons.push('Repeated glyph bursts detected');
  if (normalized.trim().length < 120) reasons.push('Output is unexpectedly short');
  if (reasons.length === 0) reasons.push('Transcription quality is stable');

  return { score, reasons };
};

const sampleForVerification = (text: string): string => {
  if (text.length <= QUALITY_VERIFIER_SAMPLE_CHARS) return text;
  const headSize = Math.floor(QUALITY_VERIFIER_SAMPLE_CHARS * 0.6);
  const tailSize = QUALITY_VERIFIER_SAMPLE_CHARS - headSize;
  return `${text.slice(0, headSize)}\n...\n${text.slice(text.length - tailSize)}`;
};

const parseVerifierScore = (raw: string): number | null => {
  const fenced = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '');
  const tryParse = (candidate: string): number | null => {
    try {
      const parsed = JSON.parse(candidate) as { score?: number };
      if (typeof parsed.score !== 'number') return null;
      return Math.max(0, Math.min(1, parsed.score));
    } catch {
      return null;
    }
  };

  const direct = tryParse(fenced);
  if (direct !== null) return direct;

  const match = fenced.match(/\{[\s\S]*\}/);
  return match ? tryParse(match[0]) : null;
};

const runQualityVerifier = async (
  text: string,
  profile: OptimizationProfile,
  modelOverride?: ModelType
): Promise<number | null> => {
  if (text.trim().length < 60) return 0;

  const sampled = sampleForVerification(text);
  const verifierPrompt = [
    'You are validating OCR transcription quality.',
    'Score from 0 to 1 for fidelity and structural integrity.',
    'Return strict JSON only: {"score":0.0,"reason":"short"}',
    'Prefer lower score when text is fragmented, garbled, or structurally inconsistent.',
    `Profile: ${profile}`,
    'Candidate transcription:',
    sampled
  ].join('\n');

  try {
    const response = await ai.models.generateContent({
      model: modelForProfile(profile, modelOverride),
      contents: { parts: [{ text: verifierPrompt }] }
    });
    return parseVerifierScore(response.text ?? '');
  } catch {
    return null;
  }
};

const requiredPdfScore = (profile: OptimizationProfile): number => {
  if (profile === 'accuracy') return 0;
  return Math.max(PDF_ESCALATION_THRESHOLD, OCR_PROFILE_POLICIES[profile].minQualityScore - 0.1);
};

const createTextStream = async function* (text: string) {
  for (let cursor = 0; cursor < text.length; cursor += OUTPUT_STREAM_CHUNK_SIZE) {
    yield { text: text.slice(cursor, cursor + OUTPUT_STREAM_CHUNK_SIZE) };
  }
};

const runPdfAttemptStream = async (
  pdfBase64: string,
  prompt: string,
  profile: OptimizationProfile,
  modelOverride?: ModelType
) => {
  return ai.models.generateContentStream({
    model: modelForProfile(profile, modelOverride),
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfBase64
          }
        },
        {
          text: buildPdfPrompt(prompt, profile)
        }
      ]
    }
  });
};

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return new Error(`Analysis failed: ${error.message}`);
  }
  return new Error('An unexpected error occurred during analysis.');
};

export const analyzePdfStream = async (
  pdfBase64: string,
  prompt: string,
  modelId?: ModelType,
  onEvent?: AnalysisEventHandler
) => {
  const cacheKey = await buildPdfCacheKey(pdfBase64, prompt);
  const cached = readPdfCache(cacheKey);
  if (cached) {
    const estimatedOutputTokens = estimateTextTokens(cached.text);
    emit(onEvent, {
      type: 'cache-hit',
      profile: cached.profile,
      message: `Cache hit: reused ${PROFILE_LABEL[cached.profile]} result`,
      qualityScore: cached.quality,
      estimatedOutputTokens
    });
    emit(onEvent, {
      type: 'completed',
      profile: cached.profile,
      message: `Completed with ${PROFILE_LABEL[cached.profile]} profile (cached).`,
      qualityScore: cached.quality,
      estimatedOutputTokens
    });
    return createTextStream(cached.text);
  }

  const candidateProfiles = resolvePdfCandidateProfiles(pdfBase64, modelId);

  return (async function* () {
    for (let index = 0; index < candidateProfiles.length; index += 1) {
      const profile = candidateProfiles[index];
      const isLastProfile = index === candidateProfiles.length - 1;
      const promptForAttempt = buildPdfPrompt(prompt, profile);
      const estimatedInputTokens = estimateInlineDataTokens(pdfBase64) + estimateTextTokens(promptForAttempt);

      emit(onEvent, {
        type: 'profile-start',
        profile,
        message: `Running ${PROFILE_LABEL[profile]} profile...`,
        estimatedInputTokens
      });

      let text = '';

      try {
        const response = await runPdfAttemptStream(pdfBase64, prompt, profile, modelId);
        for await (const chunk of response) {
          const piece = chunk.text ?? '';
          if (!piece) continue;
          text += piece;
        }

        const assessment = evaluateQuality(text);
        const requiredScore = requiredPdfScore(profile);
        const needsVerifier = assessment.score < (requiredScore + 0.12);
        const verifierScore = needsVerifier ? await runQualityVerifier(text, profile, modelId) : null;
        const qualityScore = verifierScore === null
          ? assessment.score
          : (assessment.score * 0.78) + (verifierScore * 0.22);
        const accepted = qualityScore >= requiredScore || isLastProfile;
        const estimatedOutputTokens = estimateTextTokens(text);

        if (!accepted) {
          emit(onEvent, {
            type: 'profile-escalated',
            profile,
            message: `Quality signal is low (${qualityScore.toFixed(2)}). Escalating automatically.`,
            qualityScore,
            reasons: assessment.reasons,
            estimatedInputTokens,
            estimatedOutputTokens,
            verificationScore: verifierScore === null ? undefined : verifierScore
          });
          continue;
        }

        writePdfCache(cacheKey, {
          createdAt: Date.now(),
          text,
          profile,
          quality: qualityScore
        });

        emit(onEvent, {
          type: 'profile-accepted',
          profile,
          message: `Accepted ${PROFILE_LABEL[profile]} profile.`,
          qualityScore,
          reasons: assessment.reasons,
          estimatedInputTokens,
          estimatedOutputTokens,
          verificationScore: verifierScore === null ? undefined : verifierScore
        });

        for await (const chunk of createTextStream(text)) {
          yield chunk;
        }

        emit(onEvent, {
          type: 'completed',
          profile,
          message: `Completed with ${PROFILE_LABEL[profile]} profile.`,
          qualityScore,
          reasons: assessment.reasons,
          estimatedInputTokens,
          estimatedOutputTokens,
          verificationScore: verifierScore === null ? undefined : verifierScore
        });
        return;
      } catch (error) {
        if (isLastProfile) {
          throw normalizeError(error);
        }

        emit(onEvent, {
          type: 'profile-escalated',
          profile,
          message: `Failed to start ${PROFILE_LABEL[profile]}; escalating automatically.`
        });
      }
    }
  })();
};

export const analyzePdfContent = async (
  pdfBase64: string,
  prompt: string,
  modelId?: ModelType
): Promise<string> => {
  const stream = await analyzePdfStream(pdfBase64, prompt, modelId);
  let text = '';
  for await (const chunk of stream) {
    text += chunk.text;
  }
  return text;
};
