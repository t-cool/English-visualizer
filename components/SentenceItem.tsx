
import React, { useState, useEffect } from 'react';
import { EnglishSentence } from '../types';
import { getImage, deleteImage } from '../services/dbService';

interface SentenceItemProps {
  sentence: EnglishSentence;
  onDelete: (id: string) => void;
  onView: (id: string, imageUrl: string) => void;
  version?: number;
}

export const SentenceItem: React.FC<SentenceItemProps> = ({ sentence, onDelete, onView, version = 0 }) => {
  const [imageUrl, setImageUrl] = useState<string | undefined>(sentence.imageUrl);
  const [status, setStatus] = useState(sentence.status);
  const [isLoading, setIsLoading] = useState(false);

  // Load image on mount or when version changes
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      // If we already have an image and version hasn't changed, skip.
      // But if version changed, we should re-verify DB.
      // Actually, if version changed, we should probably re-fetch even if we have an image?
      // Yes, in case it was overwritten.
      
      setIsLoading(true);
      try {
        const stored = await getImage(sentence.id);
        if (mounted) {
          if (stored) {
            setImageUrl(stored);
            setStatus('completed');
          } else {
             // If status says completed but no image, revert to pending?
             // Or keep as is.
          }
        }
      } catch (e) {
        console.error("Failed to load image for", sentence.id);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    
    load();
    
    return () => { mounted = false; };
  }, [sentence.id, version]); // Depend on version

  // Update local state if prop changes (e.g. re-generation)
  useEffect(() => {
    if (sentence.imageUrl) {
      setImageUrl(sentence.imageUrl);
      setStatus('completed');
    } else {
      // If prop clears image (e.g. delete from parent), reflect that.
      // But only if we are syncing status too.
      if (sentence.status !== 'completed' && imageUrl) {
         setImageUrl(undefined);
      }
    }
    if (sentence.status) {
        setStatus(sentence.status);
    }
  }, [sentence, imageUrl]);


  return (
    <tr className="hover:bg-slate-50/50 transition-colors">
      {/* ... (td id, td text) */}
      <td className="px-6 py-4">
        <span className="font-mono text-xs px-2 py-1 bg-slate-100 rounded text-slate-600">{sentence.id}</span>
      </td>
      <td className="px-6 py-4">
        <p className="text-sm font-medium text-slate-700 max-w-lg leading-relaxed">{sentence.english_text}</p>
      </td>
      <td className="px-6 py-4">
        {imageUrl ? (
          <div className="relative w-20 h-20 group">
            <img 
              src={imageUrl} 
              alt={sentence.id} 
              className="w-full h-full object-cover rounded-lg shadow-sm border border-slate-100" 
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 gap-2">
              <button 
                onClick={() => onView(sentence.id, imageUrl)}
                className="p-1 bg-white rounded-full shadow-lg hover:bg-slate-100 transition-colors" 
                title="View"
              >
                <svg className="w-4 h-4 text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              </button>
              <button 
                onClick={() => onDelete(sentence.id)}
                className="p-1 bg-white rounded-full shadow-lg hover:bg-red-50 text-red-600 transition-colors"
                title="Delete Image"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          </div>
        ) : (
          <div className={`w-20 h-20 rounded-lg border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1 ${status === 'processing' ? 'animate-pulse bg-indigo-50 border-indigo-200' : 'bg-slate-50'}`}>
              {status === 'processing' ? (
                <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              )}
              <span className="text-[10px] font-bold text-slate-400 uppercase">{status}</span>
          </div>
        )}
      </td>
    </tr>
  );
};
