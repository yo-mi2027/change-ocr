import { GoogleGenAI } from "@google/genai";
import {
  MAX_CONCURRENT_REQUESTS,
  OCR_CACHE_SCHEMA_VERSION,
  OCR_CACHE_TTL_MS,
  OCR_OUTPUT_CONTRACT,
  OCR_POLICY_FINGERPRINT_VERSION,
  OCR_PROFILE_ORDER,
  OCR_PROFILE_POLICIES,
  OUTPUT_STREAM_CHUNK_SIZE,
  QUALITY_VERIFIER_SAMPLE_CHARS
} from '../constants';
import { AnalysisEvent, ImageFile, ModelType, OptimizationProfile, QualityAssessment } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const IMAGE_CACHE_PREFIX = `ocr-cache:image:${OCR_CACHE_SCHEMA_VERSION}`;

type AnalysisEventHandler = (event: AnalysisEvent) => void;

interface ImageCacheEntry {
  createdAt: number;
  text: string;
  highestProfile: OptimizationProfile;
  quality: number;
}

interface PreparedImagePart {
  mimeType: string;
  data: string;
}

interface SpanResolution {
  text: string;
  profile: OptimizationProfile;
  assessment: QualityAssessment;
  qualityScore: number;
  consumed: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  verificationScore?: number;
}

const PROFILE_LABEL: Record<OptimizationProfile, string> = {
  economy: 'Economy',
  balanced: 'Balanced',
  accuracy: 'Accuracy'
};

const emit = (handler: AnalysisEventHandler | undefined, event: AnalysisEvent) => {
  if (handler) handler(event);
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

const resolveImageCandidateProfiles = (modelOverride?: ModelType): OptimizationProfile[] => {
  if (modelOverride === ModelType.PRO) return ['accuracy'];
  if (modelOverride === ModelType.FLASH) return ['economy', 'balanced'];
  return OCR_PROFILE_ORDER;
};

const modelForProfile = (profile: OptimizationProfile, modelOverride?: ModelType): ModelType => {
  if (modelOverride) return modelOverride;
  return OCR_PROFILE_POLICIES[profile].model;
};

const buildImageCacheKey = async (images: ImageFile[], prompt: string, modelOverride?: ModelType): Promise<string> => {
  const fingerprint = images
    .map((img, idx) => {
      const base64 = img.base64 ?? '';
      const head = base64.slice(0, 64);
      const tail = base64.slice(-64);
      return `${idx}:${img.file.name}:${img.file.type}:${img.file.size}:${img.file.lastModified}:${base64.length}:${head}:${tail}`;
    })
    .join('|');
  const modelTag = modelOverride ?? 'auto';
  const promptHash = await sha256Hex(prompt);
  const fingerprintHash = await sha256Hex(fingerprint);
  const policyHash = await sha256Hex(JSON.stringify({
    version: OCR_POLICY_FINGERPRINT_VERSION,
    outputContract: OCR_OUTPUT_CONTRACT,
    profilePolicies: OCR_PROFILE_POLICIES
  }));
  return `${IMAGE_CACHE_PREFIX}:${modelTag}:${policyHash}:${promptHash}:${fingerprintHash}`;
};

const readImageCache = (cacheKey: string): ImageCacheEntry | null => {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImageCacheEntry;
    if (!parsed.createdAt || (Date.now() - parsed.createdAt) > OCR_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeImageCache = (cacheKey: string, entry: ImageCacheEntry): void => {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch {
    // Ignore quota errors; cache is opportunistic.
  }
};

const createTextStream = async function* (text: string) {
  for (let cursor = 0; cursor < text.length; cursor += OUTPUT_STREAM_CHUNK_SIZE) {
    yield { text: text.slice(cursor, cursor + OUTPUT_STREAM_CHUNK_SIZE) };
  }
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
  score -= unreadableRate * 2.3;
  score -= Math.min(0.15, placeholderRate * 0.65);
  score -= shortLineRate * 0.4;
  score -= Math.min(0.25, punctuationBlobs * 0.03);
  score -= Math.min(0.2, veryLongTokenCount * 0.02);
  score -= Math.min(0.25, repeatedGlyphBurstCount * 0.04);
  if (normalized.trim().length < 80) score -= 0.2;
  if (structureSignal === 0 && lines.length > 30) score -= 0.06;
  score = Math.max(0, Math.min(1, score));

  const reasons: string[] = [];
  if (unreadableRate > 0.004) reasons.push('Unreadable replacement character ratio is high');
  if (placeholderRate > 0.025) reasons.push('Many unresolved glyph placeholders remain');
  if (shortLineRate > 0.4) reasons.push('Fragmented line pattern detected');
  if (punctuationBlobs > 3) reasons.push('Symbol artifacts detected');
  if (veryLongTokenCount > 2) reasons.push('Long token merges suggest OCR boundary errors');
  if (repeatedGlyphBurstCount > 1) reasons.push('Repeated glyph bursts detected');
  if (normalized.trim().length < 80) reasons.push('Chunk output is unexpectedly short');
  if (reasons.length === 0) reasons.push('Chunk quality looks stable');

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
    'You are validating OCR transcription quality for image pages.',
    'Score from 0 to 1 for fidelity and structure.',
    'Return strict JSON only: {"score":0.0,"reason":"short"}',
    'Prefer lower scores for missing lines, garbled tokens, and malformed tables/headings.',
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

const loadImageElement = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for preprocessing.'));
    img.src = src;
  });
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const preprocessImageForProfile = async (
  image: ImageFile,
  profile: OptimizationProfile
): Promise<PreparedImagePart> => {
  const policy = OCR_PROFILE_POLICIES[profile];
  const img = await loadImageElement(image.preview);
  const originalWidth = img.naturalWidth || img.width;
  const originalHeight = img.naturalHeight || img.height;
  const maxDimension = Math.max(originalWidth, originalHeight);
  const scale = maxDimension > policy.imageMaxDimension
    ? policy.imageMaxDimension / maxDimension
    : 1;

  const targetWidth = Math.max(1, Math.round(originalWidth * scale));
  const targetHeight = Math.max(1, Math.round(originalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      mimeType: image.file.type || 'image/jpeg',
      data: image.base64 || ''
    };
  }

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imageData.data;
  const pixelCount = targetWidth * targetHeight;

  let luminanceSum = 0;
  const luminance = new Uint8Array(pixelCount);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const lum = Math.round((0.299 * data[i]) + (0.587 * data[i + 1]) + (0.114 * data[i + 2]));
    luminance[p] = lum;
    luminanceSum += lum;
  }

  const mean = luminanceSum / Math.max(1, pixelCount);
  let variance = 0;
  for (let p = 0; p < luminance.length; p += 1) {
    const delta = luminance[p] - mean;
    variance += delta * delta;
  }
  const stdDev = Math.sqrt(variance / Math.max(1, pixelCount));

  const targetStd = profile === 'economy' ? 44 : profile === 'balanced' ? 56 : 66;
  const adaptiveContrast = clamp(targetStd / Math.max(stdDev, 1), 1, profile === 'economy' ? 1.45 : 1.7);
  const needsBinarize = profile !== 'economy' && stdDev < 42;
  const threshold = clamp(mean - (profile === 'accuracy' ? 6 : 2), 70, 200);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const centered = (luminance[p] - 128) * adaptiveContrast + 128;
    const adjusted = clamp(centered, 0, 255);
    const out = needsBinarize ? (adjusted >= threshold ? 255 : 0) : adjusted;
    data[i] = out;
    data[i + 1] = out;
    data[i + 2] = out;
  }

  ctx.putImageData(imageData, 0, 0);

  const mimeType = profile === 'economy' ? 'image/jpeg' : 'image/png';
  const dataUrl = mimeType === 'image/jpeg'
    ? canvas.toDataURL(mimeType, 0.82)
    : canvas.toDataURL(mimeType);

  return {
    mimeType,
    data: dataUrl.split(',')[1]
  };
};

const preprocessSpan = async (
  images: ImageFile[],
  profile: OptimizationProfile
): Promise<PreparedImagePart[]> => {
  const prepared: PreparedImagePart[] = [];
  for (let i = 0; i < images.length; i += MAX_CONCURRENT_REQUESTS) {
    const batch = images.slice(i, i + MAX_CONCURRENT_REQUESTS);
    const batchResult = await Promise.all(batch.map(img => preprocessImageForProfile(img, profile)));
    prepared.push(...batchResult);
  }
  return prepared;
};

const extractCarryContext = (text: string, maxChars: number): string => {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const headingLines = lines.filter(line => /^#{1,6}\s/.test(line)).slice(-3);
  const tableLines = lines.filter(line => /\|/.test(line)).slice(-3);
  const tailLines = lines.slice(-4);
  const merged = [...headingLines, ...tableLines, ...tailLines];
  const deduped = merged.filter((line, idx) => merged.indexOf(line) === idx);
  const joined = deduped.join('\n');

  return joined.length <= maxChars ? joined : joined.slice(joined.length - maxChars);
};

const buildImagePrompt = (
  prompt: string,
  profile: OptimizationProfile,
  startPage: number,
  endPage: number,
  totalPages: number,
  carryContext: string
): string => {
  const profileHint = profile === 'economy'
    ? 'Prioritize concise but faithful transcription for this page span.'
    : profile === 'balanced'
      ? 'Prioritize faithful transcription and repair obvious OCR split words.'
      : 'Prioritize maximum fidelity and resolve hard glyphs via neighboring context.';

  const contextBlock = carryContext
    ? `Context from previous pages (for continuity only):\n${carryContext}`
    : 'No previous page context.';

  const userInstruction = prompt.trim() || 'No additional user instruction.';

  return [
    OCR_OUTPUT_CONTRACT,
    `Current page range: ${startPage}-${endPage} of ${totalPages}.`,
    `For this page range, every page must begin with an exact heading: "## pageN" using the absolute page number in the full document.`,
    profileHint,
    contextBlock,
    `User instruction:\n${userInstruction}`
  ].join('\n\n');
};

const runSpanAttempt = async (
  preparedImages: PreparedImagePart[],
  prompt: string,
  profile: OptimizationProfile,
  modelOverride?: ModelType
): Promise<string> => {
  const parts = [
    ...preparedImages.map(img => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data
      }
    })),
    { text: prompt }
  ];

  const response = await ai.models.generateContentStream({
    model: modelForProfile(profile, modelOverride),
    contents: { parts }
  });

  let text = '';
  for await (const chunk of response) {
    text += chunk.text ?? '';
  }
  return text;
};

const maxProfile = (current: OptimizationProfile, next: OptimizationProfile): OptimizationProfile => {
  return OCR_PROFILE_ORDER.indexOf(next) > OCR_PROFILE_ORDER.indexOf(current) ? next : current;
};

const resolveSpanWithEscalation = async (
  images: ImageFile[],
  prompt: string,
  carryContext: string,
  startIndex: number,
  candidateProfiles: OptimizationProfile[],
  modelOverride: ModelType | undefined,
  onEvent?: AnalysisEventHandler
): Promise<SpanResolution> => {
  const totalPages = images.length;
  const baseChunkSize = 1;
  const span = images.slice(startIndex, startIndex + baseChunkSize);

  if (span.length === 0) {
    throw new Error('No images left to process.');
  }

  const startPage = startIndex + 1;
  const endPage = startIndex + span.length;

  for (let i = 0; i < candidateProfiles.length; i += 1) {
    const profile = candidateProfiles[i];
    const isLastProfile = i === candidateProfiles.length - 1;
    const composedPrompt = buildImagePrompt(prompt, profile, startPage, endPage, totalPages, carryContext);
    const estimatedPromptTokens = estimateTextTokens(composedPrompt);

    emit(onEvent, {
      type: 'profile-start',
      profile,
      message: `Pages ${startPage}-${endPage}: running ${PROFILE_LABEL[profile]} profile...`,
      estimatedInputTokens: estimatedPromptTokens + span.reduce((sum, img) => sum + estimateInlineDataTokens(img.base64 ?? ''), 0)
    });

    try {
      const prepared = await preprocessSpan(span, profile);
      const estimatedImageTokens = prepared.reduce((sum, img) => sum + estimateInlineDataTokens(img.data), 0);
      const estimatedInputTokens = estimatedImageTokens + estimatedPromptTokens;
      const text = await runSpanAttempt(prepared, composedPrompt, profile, modelOverride);
      const assessment = evaluateQuality(text);
      const requiredScore = OCR_PROFILE_POLICIES[profile].minQualityScore;
      const needsVerifier = assessment.score < (requiredScore + 0.1);
      const verifierScore = needsVerifier ? await runQualityVerifier(text, profile, modelOverride) : null;
      const qualityScore = verifierScore === null
        ? assessment.score
        : (assessment.score * 0.78) + (verifierScore * 0.22);
      const accepted = qualityScore >= requiredScore || isLastProfile;
      const estimatedOutputTokens = estimateTextTokens(text);

      if (accepted) {
        emit(onEvent, {
          type: 'profile-accepted',
          profile,
          message: `Pages ${startPage}-${endPage}: accepted ${PROFILE_LABEL[profile]}.`,
          qualityScore,
          reasons: assessment.reasons,
          estimatedInputTokens,
          estimatedOutputTokens,
          verificationScore: verifierScore === null ? undefined : verifierScore
        });

        return {
          text,
          profile,
          assessment,
          qualityScore,
          consumed: span.length,
          estimatedInputTokens,
          estimatedOutputTokens,
          verificationScore: verifierScore === null ? undefined : verifierScore
        };
      }

      emit(onEvent, {
        type: 'profile-escalated',
        profile,
        message: `Pages ${startPage}-${endPage}: escalating from ${PROFILE_LABEL[profile]}.`,
        qualityScore,
        reasons: assessment.reasons,
        estimatedInputTokens,
        estimatedOutputTokens,
        verificationScore: verifierScore === null ? undefined : verifierScore
      });
    } catch (error) {
      if (isLastProfile) {
        if (error instanceof Error) {
          throw new Error(`Image sequence analysis failed: ${error.message}`);
        }
        throw new Error('Image sequence analysis failed unexpectedly.');
      }

      emit(onEvent, {
        type: 'profile-escalated',
        profile,
        message: `Pages ${startPage}-${endPage}: ${PROFILE_LABEL[profile]} failed, escalating automatically.`
      });
    }
  }

  throw new Error('Could not resolve span with available profiles.');
};

export const readImageFile = (file: File): Promise<ImageFile> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve({
          id: Math.random().toString(36).substring(7),
          file,
          preview: reader.result,
          base64: reader.result.split(',')[1],
          status: 'idle'
        });
      } else {
        reject(new Error('Failed to read image file'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const analyzeImageSequenceStream = async (
  images: ImageFile[],
  prompt: string,
  modelId?: ModelType,
  onEvent?: AnalysisEventHandler
) => {
  const cacheKey = await buildImageCacheKey(images, prompt, modelId);
  const cached = readImageCache(cacheKey);
  if (cached) {
    const estimatedOutputTokens = estimateTextTokens(cached.text);
    emit(onEvent, {
      type: 'cache-hit',
      profile: cached.highestProfile,
      message: `Cache hit: reused sequence result (${PROFILE_LABEL[cached.highestProfile]} max profile).`,
      qualityScore: cached.quality,
      estimatedOutputTokens
    });
    emit(onEvent, {
      type: 'completed',
      profile: cached.highestProfile,
      message: 'Completed with cached result.',
      qualityScore: cached.quality,
      estimatedOutputTokens
    });
    return createTextStream(cached.text);
  }

  const candidateProfiles = resolveImageCandidateProfiles(modelId);

  return (async function* () {
    let cursor = 0;
    let carryContext = '';
    let accumulated = '';
    let highestProfile: OptimizationProfile = candidateProfiles[0] ?? 'economy';
    let minQualityScore = 1;
    let totalEstimatedInputTokens = 0;
    let totalEstimatedOutputTokens = 0;

    while (cursor < images.length) {
      const resolved = await resolveSpanWithEscalation(
        images,
        prompt,
        carryContext,
        cursor,
        candidateProfiles,
        modelId,
        onEvent
      );

      highestProfile = maxProfile(highestProfile, resolved.profile);
      minQualityScore = Math.min(minQualityScore, resolved.qualityScore);
      totalEstimatedInputTokens += resolved.estimatedInputTokens;
      totalEstimatedOutputTokens += resolved.estimatedOutputTokens;

      const normalized = resolved.text.trim();
      const appendText = normalized
        ? (accumulated ? `\n\n${normalized}` : normalized)
        : '';

      if (appendText) {
        accumulated += appendText;
        yield { text: appendText };
      }

      carryContext = extractCarryContext(normalized, OCR_PROFILE_POLICIES[resolved.profile].carryContextChars);
      cursor += resolved.consumed;
    }

    if (!accumulated) {
      minQualityScore = 0;
    }

    writeImageCache(cacheKey, {
      createdAt: Date.now(),
      text: accumulated,
      highestProfile,
      quality: minQualityScore
    });

    emit(onEvent, {
      type: 'completed',
      profile: highestProfile,
      message: `Completed image sequence with max profile ${PROFILE_LABEL[highestProfile]}.`,
      qualityScore: minQualityScore,
      estimatedInputTokens: totalEstimatedInputTokens,
      estimatedOutputTokens: totalEstimatedOutputTokens
    });
  })();
};

export const analyzeImageSequence = async (
  images: ImageFile[],
  prompt: string,
  modelId?: ModelType
): Promise<string> => {
  const stream = await analyzeImageSequenceStream(images, prompt, modelId);
  let text = '';
  for await (const chunk of stream) {
    text += chunk.text;
  }
  return text;
};
