import React from 'react';
import { ImageFile } from '../types';

interface ImageGridProps {
  images: ImageFile[];
}

export const ImageGrid: React.FC<ImageGridProps> = ({ images }) => {
  if (images.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {images.map((img, index) => (
        <div 
          key={img.id} 
          className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm relative group"
        >
          {/* Sequence Badge */}
          <div className="absolute top-2 left-2 z-10 bg-blue-600 text-white text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full shadow-md">
            {index + 1}
          </div>

          {/* Image Preview */}
          <div className="aspect-[3/4] bg-slate-100 relative">
            <img 
              src={img.preview} 
              alt={`Page ${index + 1}`} 
              className="w-full h-full object-cover"
            />
            {/* Filename overlay */}
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 truncate">
               <p className="text-white text-[10px] text-center font-medium truncate">
                 {img.file.name}
               </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
