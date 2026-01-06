
export interface EnglishSentence {
  id: string;
  english_text: string;
  imageUrl?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

export interface AppState {
  sentences: EnglishSentence[];
  styleDescription: string;
  isGenerating: boolean;
  progress: number;
  batchSize: number;
}

export enum GenerationStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED'
}
