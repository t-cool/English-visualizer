import { iterateImages, saveImage, getAllKeys } from './dbService';
import { EnglishSentence } from '../types';

// Helper to check for File System Access API support
export const supportsFileSystemAccess = (): boolean => {
  return 'showSaveFilePicker' in window;
};

export const exportBackup = async (
  sentences: EnglishSentence[], 
  onProgress?: (progress: number) => void
): Promise<void> => {
  const keys = await getAllKeys();
  const totalImages = keys.length;
  const totalItems = sentences.length + totalImages;
  let processed = 0;

  console.log(`Exporting ${sentences.length} sentences and ${totalImages} images.`);

  // Header
  const header = { type: 'header', version: 2, created: new Date().toISOString(), count: totalImages };
  const headerStr = JSON.stringify(header) + '\n';

  const reportProgress = () => {
    if (onProgress && totalItems > 0) {
      if (processed % 50 === 0 || processed === totalItems) {
        onProgress(Math.round((processed / totalItems) * 100));
      }
    }
  };

  if (supportsFileSystemAccess()) {
    try {
      // @ts-ignore
      const handle = await window.showSaveFilePicker({
        suggestedName: `english_visualizer_backup_${new Date().toISOString().split('T')[0]}.evb`,
        types: [{
          description: 'English Visualizer Backup',
          accept: { 'application/x-jsonlines': ['.evb'] },
        }],
      });

      const writable = await handle.createWritable();
      await writable.write(headerStr);

      // 1. Write Sentences
      for (const s of sentences) {
        const record = { type: 'sentence', id: s.id, text: s.english_text };
        await writable.write(JSON.stringify(record) + '\n');
        processed++;
        reportProgress();
      }

      // 2. Write Images
      await iterateImages(async (id, base64) => {
        const record = { type: 'image', id, base64 };
        await writable.write(JSON.stringify(record) + '\n');
        processed++;
        reportProgress();
      });

      await writable.close();
      console.log("Export via FileSystemAccess API completed.");
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.warn("FileSystemAccess API failed/cancelled, falling back to Blob...", err);
    }
  }

  // === Fallback for Blob ===
  console.log("Using Blob fallback for export.");
  const chunks: string[] = [];
  chunks.push(headerStr);

  for (const s of sentences) {
    const record = { type: 'sentence', id: s.id, text: s.english_text };
    chunks.push(JSON.stringify(record) + '\n');
    processed++;
    reportProgress();
  }

  await iterateImages((id, base64) => {
    const record = { type: 'image', id, base64 };
    chunks.push(JSON.stringify(record) + '\n');
    processed++;
    reportProgress();
  });

  const blob = new Blob(chunks, { type: 'application/x-jsonlines' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `english_visualizer_backup_${new Date().toISOString().split('T')[0]}.evb`;
  a.click();
  URL.revokeObjectURL(url);
  console.log("Export via Blob completed.");
};

export const importBackup = async (
  file: File, 
  onProgress?: (progress: number) => void
): Promise<{ imageCount: number; restoredSentences: EnglishSentence[]; legacyImageIds: string[] }> => {
  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  
  let leftover = '';
  let imageCount = 0;
  const restoredSentences: EnglishSentence[] = [];
  const legacyImageIds: string[] = [];
  
  const totalBytes = file.size;
  let processedBytes = 0;
  
  console.log("Starting backup import...");

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      processedBytes += value.byteLength;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = (leftover + chunk).split('\n');
      leftover = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          
          if (data.type === 'sentence') {
            restoredSentences.push({
              id: data.id,
              english_text: data.text,
              status: 'pending'
            });
          } else if (data.type === 'image') {
             if (data.id && data.base64) {
               await saveImage(data.id, data.base64);
               imageCount++;
             }
          } else if (data.id && data.base64) {
             // Legacy format (no type field)
             await saveImage(data.id, data.base64);
             imageCount++;
             legacyImageIds.push(data.id);
          }
        } catch (e) {
          console.warn("Error parsing line during import:", e);
        }
      }

      if (onProgress) {
        onProgress(Math.round((processedBytes / totalBytes) * 100));
      }
    }

    // Process leftover
    if (leftover.trim()) {
      try {
        const data = JSON.parse(leftover);
        if (data.type === 'sentence') {
            restoredSentences.push({ id: data.id, english_text: data.text, status: 'pending' });
        } else if (data.type === 'image' || (data.id && data.base64)) {
          if (data.id && data.base64) {
            await saveImage(data.id, data.base64);
            imageCount++;
            if (!data.type) legacyImageIds.push(data.id);
          }
        }
      } catch (e) {}
    }

  } finally {
    reader.releaseLock();
  }
  
  console.log(`Import completed. Images: ${imageCount}, Sentences: ${restoredSentences.length}, Legacy Images: ${legacyImageIds.length}`);
  return { imageCount, restoredSentences, legacyImageIds };
};