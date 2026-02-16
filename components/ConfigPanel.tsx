import React from 'react';
import { Settings, Sparkles } from 'lucide-react';

interface ConfigPanelProps {
  onAnalyze: () => void;
  isAnalyzing: boolean;
  hasFile: boolean;
  metrics?: {
    profileTransitions: number;
    escalations: number;
    cacheHits: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    lastQualityScore?: number;
    lastVerificationScore?: number;
  };
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({
  onAnalyze,
  isAnalyzing,
  hasFile,
  metrics
}) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-6 text-slate-800">
        <Settings className="w-5 h-5" />
        <h2 className="font-semibold text-lg">Configuration</h2>
      </div>

      <div className="space-y-6 flex-grow">
        {metrics && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Run Metrics
            </label>
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 space-y-1">
              <p>Profile transitions: {metrics.profileTransitions}</p>
              <p>Escalations: {metrics.escalations}</p>
              <p>Cache hits: {metrics.cacheHits}</p>
              <p>Estimated input tokens: {metrics.estimatedInputTokens.toLocaleString()}</p>
              <p>Estimated output tokens: {metrics.estimatedOutputTokens.toLocaleString()}</p>
              <p>Latest quality score: {typeof metrics.lastQualityScore === 'number' ? metrics.lastQualityScore.toFixed(2) : '-'}</p>
              <p>Latest verifier score: {typeof metrics.lastVerificationScore === 'number' ? metrics.lastVerificationScore.toFixed(2) : '-'}</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 pt-6 border-t border-slate-100">
        <button
          onClick={onAnalyze}
          disabled={!hasFile || isAnalyzing}
          className={`
            w-full py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-medium text-white transition-all
            ${!hasFile || isAnalyzing
              ? 'bg-slate-300 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/20 active:scale-[0.98]'
            }
          `}
        >
          {isAnalyzing ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Analyzing...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              <span>Analyze Document</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
