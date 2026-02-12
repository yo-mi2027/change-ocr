import React, { useRef, useState } from 'react';
import { Upload, Image as ImageIcon } from 'lucide-react';
import { readImageFile } from '../services/imageService';
import { ImageFile } from '../types';

interface ImageUploaderProps {
  onImagesSelected: (images: ImageFile[]) => void;
  disabled?: boolean;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  onImagesSelected,
  disabled
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = async (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    if (validFiles.length === 0) {
      alert("Please upload valid image files.");
      return;
    }

    try {
      const processedImages = await Promise.all(validFiles.map(readImageFile));
      onImagesSelected(processedImages);
    } catch (error) {
      console.error("Error reading images:", error);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    await processFiles(e.dataTransfer.files);
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(e.target.files);
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); !disabled && setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
      onDrop={handleDrop}
      onClick={() => !disabled && fileInputRef.current?.click()}
      className={`
        border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer text-center
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
        accept="image/*"
        multiple
        className="hidden"
        disabled={disabled}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="p-3 bg-slate-100 rounded-full">
          <ImageIcon className={`w-8 h-8 ${isDragging ? 'text-blue-500' : 'text-slate-400'}`} />
        </div>
        <div>
          <p className="font-medium text-slate-700">
            Drop images here or click to upload
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Batch processing supported (Drag multiple files)
          </p>
        </div>
      </div>
    </div>
  );
};
