const API_BASE = '/api';

async function fetchJson(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'demo-user',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export interface Book {
  id: string;
  title: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  status: string;
  userId: string;
  createdAt: string;
}

export interface Character {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
  description?: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  chapterRef?: string;
}

export interface Location {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
  description?: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  chapterRef?: string;
  importanceScore: number;
  tier: 'core' | 'supporting' | 'candidate' | 'archived';
  storyScore: number;
  productionScore: number;
  pillarCausal: number;
  pillarUniqueness: number;
  pillarTransition: number;
  mentionCount: number;
  firstChapter?: number;
  lastChapter?: number;
  chapterAppearances: number[];
}

export interface Item {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
  description?: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  chapterRef?: string;
  importanceScore: number;
  tier: 'core' | 'supporting' | 'candidate' | 'archived';
  storyScore: number;
  productionScore: number;
  pillarCausal: number;
  pillarUniqueness: number;
  pillarTransition: number;
  mentionCount: number;
  firstChapter?: number;
  lastChapter?: number;
  chapterAppearances: number[];
}

export const api = {
  // Books
  async uploadBook(file: File): Promise<{ book: Book }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/books`, {
      method: 'POST',
      headers: { 'x-user-id': 'demo-user' },
      body: formData,
    });
    if (!res.ok) {
      const body = await res.text();
      let message = `HTTP ${res.status}`;
      try {
        const json = JSON.parse(body);
        if (json.error) message = json.error;
      } catch {
        message += `: ${body}`;
      }
      throw new Error(message);
    }
    return res.json();
  },

  async listBooks(): Promise<{ books: Book[] }> {
    return fetchJson(`${API_BASE}/books`);
  },

  async getBook(id: string): Promise<{ book: Book }> {
    return fetchJson(`${API_BASE}/books/${id}`);
  },

  async getBookContent(id: string): Promise<{ content: string }> {
    return fetchJson(`${API_BASE}/books/${id}/content`);
  },

  async deleteBook(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/books/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': 'demo-user' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json();
  },

  // Characters
  async listCharacters(bookId: string, status?: string): Promise<{ characters: Character[] }> {
    const url = status
      ? `${API_BASE}/characters?bookId=${bookId}&status=${status}`
      : `${API_BASE}/characters?bookId=${bookId}`;
    return fetchJson(url);
  },

  async updateCharacter(id: string, data: Partial<Character>): Promise<{ character: Character }> {
    return fetchJson(`${API_BASE}/characters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Locations
  async listLocations(bookId: string, params?: { status?: string; tier?: string }): Promise<{ locations: Location[] }> {
    const searchParams = new URLSearchParams({ bookId });
    if (params?.status) searchParams.set('status', params.status);
    if (params?.tier) searchParams.set('tier', params.tier);
    return fetchJson(`${API_BASE}/locations?${searchParams}`);
  },

  async updateLocation(id: string, data: Partial<Location>): Promise<{ location: Location }> {
    return fetchJson(`${API_BASE}/locations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Items
  async listItems(bookId: string, params?: { status?: string; tier?: string }): Promise<{ items: Item[] }> {
    const searchParams = new URLSearchParams({ bookId });
    if (params?.status) searchParams.set('status', params.status);
    if (params?.tier) searchParams.set('tier', params.tier);
    return fetchJson(`${API_BASE}/items?${searchParams}`);
  },

  async updateItem(id: string, data: Partial<Item>): Promise<{ item: Item }> {
    return fetchJson(`${API_BASE}/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Extraction
  async startExtraction(bookId: string): Promise<{ taskId: string }> {
    const res = await fetch(`${API_BASE}/books/${bookId}/extract`, {
      method: 'POST',
      headers: { 'x-user-id': 'demo-user' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json();
  },

  async pollExtraction(bookId: string, taskId: string) {
    return fetchJson(`${API_BASE}/books/${bookId}/extract/status?taskId=${taskId}`);
  },

  async getExtractionStages(bookId: string) {
    return fetchJson(`${API_BASE}/books/${bookId}/extract/stages`);
  },

  /**
   * Connect to SSE stream for real-time extraction progress.
   * Returns a ReadableStream reader; caller must call return() to close.
   */
  getExtractionStream(bookId: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    return fetch(`${API_BASE}/books/${bookId}/extract/stream`, {
      headers: { 'x-user-id': 'demo-user' },
    }).then((res) => {
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}: Failed to connect to extraction stream`);
      }
      return res.body.getReader();
    });
  },

  // LLM Provider
  async getLlmStatus(): Promise<{ provider: string; configured: boolean; canExtract: boolean; keyHint: string; baseUrl: string; model: string }> {
    const res = await fetch(`${API_BASE}/health/llm`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json();
  },

  async setLlmProvider(provider: 'llm' | 'mock' | 'auto'): Promise<{ provider: string; configured: boolean; canExtract: boolean; keyHint: string; baseUrl: string; model: string }> {
    return fetchJson(`${API_BASE}/health/llm`, {
      method: 'PATCH',
      body: JSON.stringify({ provider }),
    });
  },

  async configureLlm(config: { provider: 'ollama' | 'custom' | 'mock'; apiKey?: string; baseUrl?: string; model?: string }): Promise<{ provider: string; configured: boolean; canExtract: boolean; keyHint: string; baseUrl: string; model: string }> {
    return fetchJson(`${API_BASE}/health/llm/config`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  },

  async testLlmConnection(): Promise<{ success: boolean; message: string }> {
    return fetchJson(`${API_BASE}/health/llm/test`, {
      method: 'POST',
    });
  },
};
