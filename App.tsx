
import React, { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { Layout } from './components/Layout';
import { EnglishSentence, GenerationStatus } from './types';
import { generateImageWithStyle } from './services/geminiService';
import { saveImage, getImage, getAllImages, deleteImage, getAllKeys } from './services/dbService';

const App: React.FC = () => {
  const [sentences, setSentences] = useState<EnglishSentence[]>([]);
  const [styleDescription, setStyleDescription] = useState<string>('educational manga illustration, flat color style, friendly character design, clear composition, simple background, textbook illustration art');
  const [batchSize, setBatchSize] = useState(10);
  const [status, setStatus] = useState<GenerationStatus>(GenerationStatus.IDLE);
  const [activeTab, setActiveTab] = useState<'upload' | 'manage'>('upload');
  const [visibleCount, setVisibleCount] = useState(20);
  const [searchTerm, setSearchTerm] = useState('');

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



  // Sync with IDB on load
  useEffect(() => {
    const sync = async () => {
      if (sentences.length === 0) return;
      const updated = await Promise.all(sentences.map(async s => {
        const stored = await getImage(s.id);
        return { ...s, imageUrl: stored || undefined, status: stored ? 'completed' : s.status };
      }));
      setSentences(updated);
    };
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentences.length > 0]);

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
            // Optional: wait a bit before retrying
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
          
          // Small delay to allow browser to handle the download initiation
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export images. Check console for details.");
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
      <div className="flex flex-col gap-8">
        {/* Top Control Panel */}
        <section className="glass-card p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="space-y-1">
              <h2 className="text-xl font-bold">Batch Generation Console</h2>
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
                className={`px-6 py-3 rounded-xl font-semibold shadow-lg shadow-indigo-100 transition-all active:scale-95 flex items-center gap-2 ${
                  status === GenerationStatus.RUNNING 
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

              <button
                onClick={handleExport}
                className="px-6 py-3 rounded-xl font-semibold bg-white border border-slate-200 hover:bg-slate-50 transition-all flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Export All
              </button>
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
                      <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-mono text-xs px-2 py-1 bg-slate-100 rounded text-slate-600">{s.id}</span>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-slate-700 max-w-lg leading-relaxed">{s.english_text}</p>
                        </td>
                        <td className="px-6 py-4">
                          {s.imageUrl ? (
                            <div className="relative w-20 h-20 group">
                              <img 
                                src={s.imageUrl} 
                                alt={s.id} 
                                className="w-full h-full object-cover rounded-lg shadow-sm border border-slate-100" 
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 gap-2">
                                <button className="p-1 bg-white rounded-full shadow-lg hover:bg-slate-100 transition-colors" title="View">
                                  <svg className="w-4 h-4 text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                </button>
                                <button 
                                  onClick={() => handleDeleteImage(s.id)}
                                  className="p-1 bg-white rounded-full shadow-lg hover:bg-red-50 text-red-600 transition-colors"
                                  title="Delete Image"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className={`w-20 h-20 rounded-lg border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1 ${s.status === 'processing' ? 'animate-pulse bg-indigo-50 border-indigo-200' : 'bg-slate-50'}`}>
                               {s.status === 'processing' ? (
                                 <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                               ) : (
                                 <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                               )}
                               <span className="text-[10px] font-bold text-slate-400 uppercase">{s.status}</span>
                            </div>
                          )}
                        </td>
                      </tr>
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
