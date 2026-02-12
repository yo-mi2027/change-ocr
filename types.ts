export interface PdfFile {
  name: string;
  type: string;
  size: number;
  base64: string; // Base64 string without the data prefix
}

export enum ModelType {
  FLASH = 'gemini-3-flash-preview',
  PRO = 'gemini-3-pro-preview',
}

export type AppMode = 'pdf' | 'batch-image';

export type AnalysisStatus = 'idle' | 'pending' | 'analyzing' | 'completed' | 'error';

export type OptimizationProfile = 'economy' | 'balanced' | 'accuracy';

export type AnalysisEventType =
  | 'cache-hit'
  | 'profile-start'
  | 'profile-accepted'
  | 'profile-escalated'
  | 'completed';

export interface AnalysisEvent {
  type: AnalysisEventType;
  profile: OptimizationProfile;
  message: string;
  qualityScore?: number;
  reasons?: string[];
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  verificationScore?: number;
}

export interface QualityAssessment {
  score: number;
  reasons: string[];
}

export interface ImageFile {
  id: string;
  file: File;
  preview: string;
  base64?: string;
  status: AnalysisStatus;
  result?: string;
  error?: string;
}
