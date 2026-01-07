import React, { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { Layout } from './components/Layout';
import { SentenceItem } from './components/SentenceItem';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import { EnglishSentence, GenerationStatus } from './types';
import { generateImageWithStyle } from './services/geminiService';
import { saveImage, getImage, getAllImages, deleteImage, getAllKeys } from './services/dbService';
import { exportBackup, importBackup } from './services/backupService';

const App: React.FC = () => {
  const [sentences, setSentences] = useState<EnglishSentence[]>([]);
  const [styleDescription, setStyleDescription] = useState<string>('educational manga illustration, flat color style, friendly character design, clear composition, simple background, textbook illustration art');
  const [batchSize, setBatchSize] = useState(10);
  const [status, setStatus] = useState<GenerationStatus>(GenerationStatus.IDLE);
  const [activeTab, setActiveTab] = useState<'upload' | 'manage'>('upload');
  const [visibleCount, setVisibleCount] = useState(20);
  const [searchTerm, setSearchTerm] = useState('');
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<{ id: string, url: string } | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  // CSV Parsing
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/);
      const parsed: EnglishSentence[] = lines
        .slice(1) // skip header
        .filter(line => line.trim())
        .map(line => {
          const [id, ...rest] = line.split(',');
          return {
            id: id?.trim(),
            english_text: rest.join(',').trim().replace(/^"|"$/g, ''),
            status: 'pending' as const
          };
        });
      setSentences(parsed);
      setActiveTab('manage');
    };
    reader.readAsText(file);
  };

  // Lightweight Sync with IDB (just updates status, doesn't load images)
  useEffect(() => {
    const sync = async () => {
      if (sentences.length === 0) return;
      try {
        const keys = await getAllKeys();
        const keySet = new Set(keys);
        
        setSentences(prev => prev.map(s => {
          const hasImage = keySet.has(s.id);
          if (hasImage && s.status !== 'completed') {
             return { ...s, status: 'completed' };
          }
          if (!hasImage && s.status === 'completed') {
             return { ...s, status: 'pending' };
          }
          return s;
        }));
      } catch (e) {
        console.error("Failed to sync DB keys", e);
      }
    };
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentences.length, dataVersion]);

  // Batch Generation Logic
  const startBatch = async () => {
    if (status === GenerationStatus.RUNNING) return;
    setStatus(GenerationStatus.RUNNING);
    
    const pending = sentences.filter(s => s.status !== 'completed').slice(0, batchSize);
    
    for (const s of pending) {
      let attempts = 0;
      const maxRetries = 3;
      let success = false;

      while (attempts < maxRetries && !success) {
        attempts++;
        try {
          setSentences(prev => prev.map(p => p.id === s.id ? { ...p, status: 'processing' } : p));
          const url = await generateImageWithStyle(s.english_text, styleDescription);
          await saveImage(s.id, url);
          
          setSentences(prev => prev.map(p => p.id === s.id ? { ...p, imageUrl: url, status: 'completed' } : p));
          success = true;
        } catch (err) {
          console.error(`Failed to generate image for ${s.id} (Attempt ${attempts}/${maxRetries}):`, err);
          if (attempts === maxRetries) {
            setSentences(prev => prev.map(p => p.id === s.id ? { ...p, status: 'error' } : p));
          } else {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    }
    
    setStatus(GenerationStatus.IDLE);
  };

  const handleExport = async () => {
    try {
      const keys = await getAllKeys();
      if (keys.length === 0) {
        alert("No images to export.");
        return;
      }

      const CHUNK_SIZE = 500;
      const totalChunks = Math.ceil(keys.length / CHUNK_SIZE);
      
      for (let i = 0; i < totalChunks; i++) {
        const chunkKeys = keys.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const zip = new JSZip();
        const imgFolder = zip.folder("images");
        
        let count = 0;
        for (const id of chunkKeys) {
          const dataUrl = await getImage(id);
          if (!dataUrl) continue;
          
          const base64Data = dataUrl.split(',')[1];
          if (base64Data) {
            imgFolder?.file(`${id}.png`, base64Data, { base64: true });
            count++;
          }
        }

        if (count > 0) {
          const content = await zip.generateAsync({ type: "blob" });
          const url = URL.createObjectURL(content);
          const a = document.createElement('a');
          a.href = url;
          a.download = `english_visualizer_export_part${i + 1}_of_${totalChunks}.zip`;
          a.click();
          URL.revokeObjectURL(url);
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export images. Check console for details.");
    }
  };

  const handleBackupExport = async () => {
    try {
      setExportProgress(0);
      await new Promise(resolve => setTimeout(resolve, 100));
      await exportBackup(sentences, (progress) => setExportProgress(progress));
    } catch (error) {
      console.error("Backup failed:", error);
      alert("Failed to create backup. If the file is very large, try using Chrome or Edge for better memory management.");
    } finally {
      setExportProgress(null);
    }
  };

  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setExportProgress(0);
      const { imageCount, restoredSentences, legacyImageIds } = await importBackup(file, (progress) => setExportProgress(progress));
      
      setSentences(prev => {
        const idMap = new Map(prev.map(s => [s.id, s]));
        
        restoredSentences.forEach(s => idMap.set(s.id, s));

        legacyImageIds.forEach(id => {
          if (!idMap.has(id)) {
            idMap.set(id, {
              id: id,
              english_text: "(Restored Image - No Text Available)",
              status: 'completed',
              imageUrl: undefined
            });
          }
        });

        return Array.from(idMap.values());
      });

      setDataVersion(prev => prev + 1);

      alert(`Successfully imported ${imageCount} images and restored ${restoredSentences.length} sentences.`);
      setActiveTab('manage');

    } catch (error) {
      console.error("Import failed:", error);
      alert("Failed to import backup file.");
    } finally {
      setExportProgress(null);
      e.target.value = '';
    }
  };

  const handleDeleteImage = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this image?')) return;
    try {
      await deleteImage(id);
      setSentences(prev => prev.map(s => s.id === id ? { ...s, imageUrl: undefined, status: 'pending' } : s));
    } catch (error) {
      console.error('Failed to delete image:', error);
      alert('Failed to delete image.');
    }
  };

  // Infinite Scroll logic
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
      setVisibleCount(prev => Math.min(prev + 20, sentences.length));
    }
  };

  const filteredSentences = sentences.filter(s => 
    s.english_text.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      {previewImage && (
        <ImagePreviewModal 
          imageUrl={previewImage.url} 
          id={previewImage.id} 
          onClose={() => setPreviewImage(null)} 
        />
      )}
      {exportProgress !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-800">Processing Backup</h3>
              <p className="text-slate-500 text-sm mt-1">Please wait...</p>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden mt-2">
              <div 
                className="bg-indigo-600 h-full transition-all duration-300"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            <span className="text-xs font-bold text-indigo-600">{exportProgress}%</span>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-8">
        {/* Top Control Panel */}
        <section className="glass-card p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="space-y-1">
              <h2 className="text-xl font-bold">English Visualizer</h2>
              <p className="text-sm text-slate-500">Configure your parameters and start the engine.</p>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Batch Size</label>
                <input 
                  type="number"
                  min="1"
                  max="2000"
                  className="bg-slate-100 border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 w-24"
                  value={batchSize}
                  onChange={(e) => setBatchSize(Math.min(2000, Math.max(1, Number(e.target.value))))}
                />
              </div>

              <button
                onClick={startBatch}
                disabled={status === GenerationStatus.RUNNING || sentences.length === 0}
                className={`px-6 py-3 rounded-xl font-semibold shadow-lg shadow-indigo-100 transition-all active:scale-95 flex items-center gap-2 ${status === GenerationStatus.RUNNING 
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {status === GenerationStatus.RUNNING ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    Start Batch
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExport}
                  title="Export Images as ZIP"
                  className="px-4 py-3 rounded-xl font-semibold bg-white border border-slate-200 hover:bg-slate-50 transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  ZIP
                </button>
                <button
                  onClick={handleBackupExport}
                  title="Export All Data as Single File"
                  className="px-4 py-3 rounded-xl font-semibold bg-white border border-slate-200 hover:bg-slate-50 transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
                  Backup
                </button>
                <label className="px-4 py-3 rounded-xl font-semibold bg-white border border-slate-200 hover:bg-slate-50 transition-all flex items-center gap-2 cursor-pointer">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  Restore
                  <input type="file" accept=".evb" className="hidden" onChange={handleBackupImport} />
                                </label>
                              </div>
                            </div>
                          </div>
                        </section>
          {/* Main Interface */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Sidebar */}
            <aside className="lg:col-span-1 space-y-6">
              <div className="glass-card p-6 rounded-2xl border border-slate-200 h-fit">
                <h3 className="font-bold mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-500" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"></path></svg>
                  Resources
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase">CSV Data (jh-data.csv)</label>
                    <label className="flex items-center justify-center w-full h-24 px-4 transition bg-white border-2 border-slate-200 border-dashed rounded-xl appearance-none cursor-pointer hover:border-indigo-400 focus:outline-none">
                      <span className="flex items-center space-x-2">
                        <span className="font-medium text-slate-600">
                          {sentences.length > 0 ? `${sentences.length} Sentences Loaded` : 'Upload CSV'}
                        </span>
                      </span>
                      <input type="file" name="csv_upload" className="hidden" accept=".csv" onChange={handleCsvUpload} />
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase">Style Description</label>
                    <textarea 
                      className="w-full h-24 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none transition-all"
                      placeholder="Describe the visual style (e.g., 'Watercolor painting, pastel colors, soft lighting')"
                      value={styleDescription}
                      onChange={(e) => setStyleDescription(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="glass-card p-6 rounded-2xl border border-slate-200 h-fit">
                 <h3 className="font-bold mb-3">Stats</h3>
                 <div className="space-y-3">
                   <div className="flex justify-between text-sm">
                     <span className="text-slate-500">Total Sentences</span>
                     <span className="font-bold">{sentences.length}</span>
                   </div>
                   <div className="flex justify-between text-sm">
                     <span className="text-slate-500">Generated</span>
                     <span className="font-bold text-green-600">{sentences.filter(s => s.status === 'completed').length}</span>
                   </div>
                   <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                     <div 
                       className="bg-indigo-600 h-full transition-all duration-500"
                       style={{ width: `${(sentences.filter(s => s.status === 'completed').length / (sentences.length || 1)) * 100}%` }}
                      />
                   </div>
                 </div>
              </div>
            </aside>

          {/* Grid Area */}
          <div className="lg:col-span-3 space-y-4">
            <div className="flex items-center justify-between">
               <div className="relative w-full max-w-md">
                 <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                 <input 
                  type="text" 
                  placeholder="Search ID or Text..." 
                  className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                 />
               </div>
               <div className="text-sm font-medium text-slate-500">
                 Showing {Math.min(visibleCount, filteredSentences.length)} of {filteredSentences.length}
               </div>
            </div>

            <div 
              onScroll={handleScroll}
              className="glass-card rounded-2xl border border-slate-200 h-[600px] overflow-y-auto custom-scroll"
            >
              {filteredSentences.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                  <svg className="w-16 h-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
                  <p className="font-medium italic">No data to display. Please upload a CSV file.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">ID</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">English Text</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Visualization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSentences.slice(0, visibleCount).map((s) => (
                      <SentenceItem 
                        key={s.id} 
                        sentence={s} 
                        onDelete={handleDeleteImage} 
                        onView={(id, url) => setPreviewImage({ id, url })}
                        version={dataVersion}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default App;
