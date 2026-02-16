import React, { useState } from 'react';
import { Bot, FileText, Image as ImageIcon, Sparkles, Trash2, AlertCircle, Download } from 'lucide-react';
import { FileUploader } from './components/FileUploader';
import { ImageUploader } from './components/ImageUploader';
import { ImageGrid } from './components/ImageGrid';
import { ConfigPanel } from './components/ConfigPanel';
import { MarkdownViewer } from './components/MarkdownViewer';
import { analyzePdfStream } from './services/geminiService';
import { analyzeImageSequenceStream } from './services/imageService';
import { APP_TITLE, AUTO_OPTIMIZER_LABEL, INITIAL_PROMPT, INITIAL_IMAGE_PROMPT } from './constants';
import { AnalysisEvent, PdfFile, AppMode, ImageFile } from './types';

interface RunMetrics {
  profileTransitions: number;
  escalations: number;
  cacheHits: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  lastQualityScore?: number;
  lastVerificationScore?: number;
}

const INITIAL_METRICS: RunMetrics = {
  profileTransitions: 0,
  escalations: 0,
  cacheHits: 0,
  estimatedInputTokens: 0,
  estimatedOutputTokens: 0
};

const createInitialMetrics = (): RunMetrics => ({ ...INITIAL_METRICS });

const App: React.FC = () => {
  // Mode State
  const [mode, setMode] = useState<AppMode>('pdf');

  // Common State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string>('');
  const [autoStatus, setAutoStatus] = useState(`${AUTO_OPTIMIZER_LABEL} is ready.`);
  const [runMetrics, setRunMetrics] = useState<RunMetrics>(createInitialMetrics);

  // PDF State
  const [selectedFile, setSelectedFile] = useState<PdfFile | null>(null);

  // Image Sequence State
  const [images, setImages] = useState<ImageFile[]>([]);

  // --- PDF Handlers ---
  const handleFileSelect = (file: PdfFile) => {
    setSelectedFile(file);
    setError(null);
    setResult('');
    setAutoStatus(`${AUTO_OPTIMIZER_LABEL} is ready for PDF.`);
    setRunMetrics(createInitialMetrics());
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    setResult('');
    setError(null);
    setAutoStatus(`${AUTO_OPTIMIZER_LABEL} is ready for PDF.`);
    setRunMetrics(createInitialMetrics());
  };

  const handlePdfAnalyze = async () => {
    if (!selectedFile) return;
    setIsAnalyzing(true);
    setError(null);
    setResult('');
    setAutoStatus('Auto optimizer is evaluating PDF input...');
    setRunMetrics(createInitialMetrics());

    const onEvent = (event: AnalysisEvent) => {
      const score = typeof event.qualityScore === 'number' ? ` (score: ${event.qualityScore.toFixed(2)})` : '';
      setAutoStatus(`${event.message}${score}`);
      setRunMetrics(prev => ({
        profileTransitions: prev.profileTransitions + (event.type === 'profile-start' ? 1 : 0),
        escalations: prev.escalations + (event.type === 'profile-escalated' ? 1 : 0),
        cacheHits: prev.cacheHits + (event.type === 'cache-hit' ? 1 : 0),
        estimatedInputTokens: Math.max(prev.estimatedInputTokens, event.estimatedInputTokens ?? 0),
        estimatedOutputTokens: Math.max(prev.estimatedOutputTokens, event.estimatedOutputTokens ?? 0),
        lastQualityScore: typeof event.qualityScore === 'number' ? event.qualityScore : prev.lastQualityScore,
        lastVerificationScore: typeof event.verificationScore === 'number' ? event.verificationScore : prev.lastVerificationScore
      }));
    };
    
    try {
      const streamResponse = await analyzePdfStream(
        selectedFile.base64,
        INITIAL_PROMPT,
        undefined,
        onEvent
      );
      
      for await (const chunk of streamResponse) {
        setResult(prev => prev + (chunk.text ?? ''));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- Image Sequence Handlers ---
  const handleAddImages = (newImages: ImageFile[]) => {
    // Merge and Sort by filename to ensure sequence
    setImages(prev => {
      const combined = [...prev, ...newImages];
      return combined.sort((a, b) => (
        a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' })
      ));
    });
    setError(null);
    setResult('');
    setAutoStatus(`${AUTO_OPTIMIZER_LABEL} is ready for image sequence.`);
    setRunMetrics(createInitialMetrics());
  };

  const handleClearImages = () => {
    setImages([]);
    setResult('');
    setError(null);
    setAutoStatus(`${AUTO_OPTIMIZER_LABEL} is ready for image sequence.`);
    setRunMetrics(createInitialMetrics());
  };

  const handleImageSequenceAnalyze = async () => {
    if (images.length === 0) return;
    setIsAnalyzing(true);
    setError(null);
    setResult('');
    setAutoStatus('Auto optimizer is evaluating image sequence...');
    setRunMetrics(createInitialMetrics());

    const onEvent = (event: AnalysisEvent) => {
      const score = typeof event.qualityScore === 'number' ? ` (score: ${event.qualityScore.toFixed(2)})` : '';
      setAutoStatus(`${event.message}${score}`);
      setRunMetrics(prev => ({
        profileTransitions: prev.profileTransitions + (event.type === 'profile-start' ? 1 : 0),
        escalations: prev.escalations + (event.type === 'profile-escalated' ? 1 : 0),
        cacheHits: prev.cacheHits + (event.type === 'cache-hit' ? 1 : 0),
        estimatedInputTokens: Math.max(prev.estimatedInputTokens, event.estimatedInputTokens ?? 0),
        estimatedOutputTokens: Math.max(prev.estimatedOutputTokens, event.estimatedOutputTokens ?? 0),
        lastQualityScore: typeof event.qualityScore === 'number' ? event.qualityScore : prev.lastQualityScore,
        lastVerificationScore: typeof event.verificationScore === 'number' ? event.verificationScore : prev.lastVerificationScore
      }));
    };

    try {
      const streamResponse = await analyzeImageSequenceStream(
        images,
        INITIAL_IMAGE_PROMPT,
        undefined,
        onEvent
      );

      for await (const chunk of streamResponse) {
        setResult(prev => prev + (chunk.text ?? ''));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcription.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 p-2 rounded-lg">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 hidden sm:block">
                {APP_TITLE}
              </h1>
            </div>

            {/* Mode Switcher */}
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => { setMode('pdf'); setError(null); setResult(''); setAutoStatus(`${AUTO_OPTIMIZER_LABEL} is ready for PDF.`); setRunMetrics(createInitialMetrics()); }}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  mode === 'pdf' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                PDF Document
              </button>
              <button
                onClick={() => { setMode('batch-image'); setError(null); setResult(''); setAutoStatus(`${AUTO_OPTIMIZER_LABEL} is ready for image sequence.`); setRunMetrics(createInitialMetrics()); }}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  mode === 'batch-image' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Image Sequence
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[calc(100vh-8rem)]">
          
          {/* Left Column: Input & Config */}
          <div className="lg:col-span-4 flex flex-col gap-6 overflow-y-auto">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="font-semibold text-lg text-slate-800 mb-4 flex items-center gap-2">
                {mode === 'pdf' ? <FileText className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}
                {mode === 'pdf' ? 'Document Source' : 'Sequential Images'}
              </h2>
              
              {mode === 'pdf' ? (
                <FileUploader 
                  onFileSelect={handleFileSelect} 
                  onClear={handleClearFile} 
                  selectedFile={selectedFile}
                  disabled={isAnalyzing}
                />
              ) : (
                <div className="space-y-4">
                  <ImageUploader 
                    onImagesSelected={handleAddImages} 
                    disabled={isAnalyzing} 
                  />
                  {images.length > 0 && (
                     <div className="flex justify-between items-center bg-slate-50 p-2 rounded-lg border border-slate-200">
                        <span className="text-sm text-slate-600 font-medium pl-2">
                          {images.length} pages loaded
                        </span>
                        <button 
                          onClick={handleClearImages}
                          className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                          disabled={isAnalyzing}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                     </div>
                  )}
                  {/* Mini Grid for sequence verification */}
                  <div className="max-h-60 overflow-y-auto pr-1">
                     <ImageGrid images={images} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex-grow">
              <ConfigPanel
                onAnalyze={mode === 'pdf' ? handlePdfAnalyze : handleImageSequenceAnalyze}
                isAnalyzing={isAnalyzing}
                hasFile={mode === 'pdf' ? !!selectedFile : images.length > 0}
                metrics={runMetrics}
              />
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-8 flex flex-col h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="border-b border-slate-100 p-4 bg-slate-50/50 flex justify-between items-center">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-500" />
                Transcription Result
              </h2>
              <div className="flex items-center gap-2">
                {result && (
                  <>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full border ${isAnalyzing ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-green-600 bg-green-50 border-green-200'}`}>
                      {isAnalyzing ? 'Generating...' : 'Completed'}
                    </span>
                    <button
                      onClick={handleDownload}
                      className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors flex items-center gap-2"
                      title="Download Markdown"
                    >
                      <Download className="w-4 h-4" />
                      <span className="text-sm font-medium hidden sm:inline">Download .md</span>
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="flex-grow overflow-y-auto p-6">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex gap-3 text-red-700">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p>{error}</p>
                </div>
              )}
              {result ? (
                <MarkdownViewer content={result} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                  {isAnalyzing ? (
                    <div className="flex flex-col items-center animate-pulse">
                      <Bot className="w-12 h-12 mb-4 text-blue-200" />
                      <p className="text-lg font-medium text-slate-600">Digitizing Document...</p>
                      <p className="text-sm">Reading content and extracting text</p>
                    </div>
                  ) : (
                    <>
                      <Bot className="w-16 h-16 opacity-20" />
                      <p>Upload files and click "Analyze Document"</p>
                      <p className="text-xs opacity-60 max-w-md text-center">
                        Supports PDF or sequential Images.
                        <br/>Content will be transcribed exactly as written (Verbatim).
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;
