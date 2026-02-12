import React, { useRef, useState } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import { PdfFile } from '../types';
import { readFileAsBase64, formatFileSize } from '../services/pdfService';

interface FileUploaderProps {
  onFileSelect: (file: PdfFile) => void;
  onClear: () => void;
  selectedFile: PdfFile | null;
  disabled?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  onFileSelect,
  onClear,
  selectedFile,
  disabled
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const processFile = async (file: File) => {
    if (file && file.type === 'application/pdf') {
      try {
        const pdfFile = await readFileAsBase64(file);
        onFileSelect(pdfFile);
      } catch (error) {
        console.error("Error reading file", error);
        alert("Failed to read file");
      }
    } else {
      alert("Please upload a valid PDF file.");
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await processFile(files[0]);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFile(e.target.files[0]);
    }
  };

  if (selectedFile) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-md">
            <FileText className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="font-medium text-slate-800">{selectedFile.name}</p>
            <p className="text-sm text-slate-500">{formatFileSize(selectedFile.size)}</p>
          </div>
        </div>
        {!disabled && (
          <button
            onClick={onClear}
            className="p-1 hover:bg-slate-200 rounded-full transition-colors"
            title="Remove file"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !disabled && fileInputRef.current?.click()}
      className={`
        border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer text-center mb-6
        ${isDragging 
          ? 'border-blue-500 bg-blue-50' 
          : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInput}
        accept="application/pdf"
        className="hidden"
        disabled={disabled}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="p-3 bg-slate-100 rounded-full">
          <Upload className={`w-6 h-6 ${isDragging ? 'text-blue-500' : 'text-slate-400'}`} />
        </div>
        <div>
          <p className="font-medium text-slate-700">
            Click to upload or drag and drop
          </p>
          <p className="text-sm text-slate-500 mt-1">
            PDF files only
          </p>
        </div>
      </div>
    </div>
  );
};
