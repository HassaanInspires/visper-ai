// Local IndexedDB Manager for Conversations and Vector Search

export interface DbSession {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  synced?: boolean;
}

export interface DbMessage {
  id: string;
  sessionId: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: Date;
  vector?: number[];
  synced?: boolean;
  image?: string;
  sources?: Array<{ title: string; url: string; snippet?: string }>;
  ocrProvider?: string;
}

export interface DbDocument {
  id: string;
  name: string;
  size: number;
  uploadedAt: Date;
  status: "processing" | "ready" | "error";
  error?: string;
}

export interface DbDocumentChunk {
  id: string;
  documentId: string;
  text: string;
  pageNumber: number;
  vector: number[];
}

const DB_NAME = "VisperDatabase";
const DB_VERSION = 3;

export class LocalDb {
  private static db: IDBDatabase | null = null;

  static init(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) return resolve(this.db);

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = () => {
        const db = request.result;

        // Upgrade/Create sessions store
        let sessionStore;
        if (!db.objectStoreNames.contains("sessions")) {
          sessionStore = db.createObjectStore("sessions", { keyPath: "id" });
        } else {
          sessionStore = request.transaction!.objectStore("sessions");
        }
        if (!sessionStore.indexNames.contains("synced")) {
          sessionStore.createIndex("synced", "synced", { unique: false });
        }

        // Upgrade/Create messages store
        let messageStore;
        if (!db.objectStoreNames.contains("messages")) {
          messageStore = db.createObjectStore("messages", { keyPath: "id" });
        } else {
          messageStore = request.transaction!.objectStore("messages");
        }
        if (!messageStore.indexNames.contains("sessionId")) {
          messageStore.createIndex("sessionId", "sessionId", { unique: false });
        }
        if (!messageStore.indexNames.contains("synced")) {
          messageStore.createIndex("synced", "synced", { unique: false });
        }

        // Upgrade/Create documents store (DB v3)
        if (!db.objectStoreNames.contains("documents")) {
          db.createObjectStore("documents", { keyPath: "id" });
        }

        // Upgrade/Create documentChunks store (DB v3)
        let chunkStore;
        if (!db.objectStoreNames.contains("documentChunks")) {
          chunkStore = db.createObjectStore("documentChunks", { keyPath: "id" });
        } else {
          chunkStore = request.transaction!.objectStore("documentChunks");
        }
        if (!chunkStore.indexNames.contains("documentId")) {
          chunkStore.createIndex("documentId", "documentId", { unique: false });
        }
      };
    });
  }

  // --- Session Management ---

  static async createSession(title: string): Promise<DbSession> {
    const db = await this.init();
    const session: DbSession = {
      id: Math.random().toString(36).substring(2) + Date.now().toString(36),
      title: title || "New Conversation",
      createdAt: new Date(),
      updatedAt: new Date(),
      synced: false
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      const request = store.add(session);

      request.onsuccess = () => resolve(session);
      request.onerror = () => reject(request.error);
    });
  }

  static async getSessions(): Promise<DbSession[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sessions", "readonly");
      const store = transaction.objectStore("sessions");
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort sessions by updatedAt descending
        const sessions = request.result as DbSession[];
        sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        resolve(sessions);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async deleteSession(id: string): Promise<void> {
    const db = await this.init();
    
    // Delete session
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // Delete associated messages
    const messages = await this.getMessages(id);
    const dbMessagesStore = db.transaction("messages", "readwrite").objectStore("messages");
    for (const msg of messages) {
      dbMessagesStore.delete(msg.id);
    }
  }

  // --- Message Management ---

  static async addMessage(
    sessionId: string,
    sender: "user" | "assistant",
    text: string,
    vector?: number[],
    image?: string,
    sources?: any[],
    ocrProvider?: string
  ): Promise<DbMessage> {
    const db = await this.init();
    const message: DbMessage = {
      id: Math.random().toString(36).substring(2) + Date.now().toString(36),
      sessionId,
      sender,
      text,
      timestamp: new Date(),
      vector,
      image,
      sources,
      ocrProvider,
      synced: false
    };

    // 1. Add message
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const request = store.add(message);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // 2. Update session's updatedAt timestamp
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      const getReq = store.get(sessionId);

      getReq.onsuccess = () => {
        const session = getReq.result as DbSession;
        if (session) {
          session.updatedAt = new Date();
          const putReq = store.put(session);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });

    return message;
  }

  static async getMessages(sessionId: string): Promise<DbMessage[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("messages", "readonly");
      const store = transaction.objectStore("messages");
      const index = store.index("sessionId");
      const request = index.getAll(sessionId);

      request.onsuccess = () => {
        const messages = request.result as DbMessage[];
        // Sort by timestamp ascending
        messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        resolve(messages);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async updateMessageVector(messageId: string, vector: number[]): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const getReq = store.get(messageId);

      getReq.onsuccess = () => {
        const message = getReq.result as DbMessage;
        if (message) {
          message.vector = vector;
          const putReq = store.put(message);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  // --- Local Vector RAG (KNN Similarity Search) ---

  static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  static async searchSimilarMessages(queryVector: number[], limit = 4): Promise<DbMessage[]> {
    const db = await this.init();
    
    // 1. Fetch all messages containing vectors
    const allMessages: DbMessage[] = await new Promise((resolve, reject) => {
      const transaction = db.transaction("messages", "readonly");
      const store = transaction.objectStore("messages");
      const request = store.getAll();

      request.onsuccess = () => {
        const result = request.result as DbMessage[];
        resolve(result.filter(m => m.vector && m.vector.length > 0));
      };
      request.onerror = () => reject(request.error);
    });

    // 2. Compute similarity and sort
    const scoredMessages = allMessages.map(msg => ({
      message: msg,
      score: this.cosineSimilarity(queryVector, msg.vector!)
    }));

    scoredMessages.sort((a, b) => b.score - a.score);

    // 3. Return top N elements
    return scoredMessages.slice(0, limit).map(item => item.message);
  }

  // --- Sync helpers ---

  static async getUnsyncedMessages(): Promise<DbMessage[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("messages", "readonly");
      const store = transaction.objectStore("messages");
      const index = store.index("synced");
      const request = index.getAll(0); // false is typically 0 in indexedDB indices, but let's query raw

      request.onsuccess = () => {
        const result = request.result as DbMessage[];
        // Double filter just to be safe
        resolve(result.filter(m => !m.synced));
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async markMessagesSynced(ids: string[]): Promise<void> {
    const db = await this.init();
    const transaction = db.transaction("messages", "readwrite");
    const store = transaction.objectStore("messages");

    for (const id of ids) {
      await new Promise<void>((resolve) => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const msg = getReq.result as DbMessage;
          if (msg) {
            msg.synced = true;
            store.put(msg).onsuccess = () => resolve();
          } else {
            resolve();
          }
        };
        getReq.onerror = () => resolve(); // Graceful skip
      });
    }
  }

  static async getUnsyncedSessions(): Promise<DbSession[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sessions", "readonly");
      const store = transaction.objectStore("sessions");
      const index = store.index("synced");
      const request = index.getAll(0);

      request.onsuccess = () => {
        const result = request.result as DbSession[];
        resolve(result.filter(s => !s.synced));
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async markSessionsSynced(ids: string[]): Promise<void> {
    const db = await this.init();
    const transaction = db.transaction("sessions", "readwrite");
    const store = transaction.objectStore("sessions");

    for (const id of ids) {
      await new Promise<void>((resolve) => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const session = getReq.result as DbSession;
          if (session) {
            session.synced = true;
            store.put(session).onsuccess = () => resolve();
          } else {
            resolve();
          }
        };
        getReq.onerror = () => resolve();
      });
    }
  }

  // --- Document Management (RAG) ---

  static async createDocument(name: string, size: number): Promise<DbDocument> {
    const db = await this.init();
    const document: DbDocument = {
      id: Math.random().toString(36).substring(2) + Date.now().toString(36),
      name,
      size,
      uploadedAt: new Date(),
      status: "processing"
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documents", "readwrite");
      const store = transaction.objectStore("documents");
      const request = store.add(document);

      request.onsuccess = () => resolve(document);
      request.onerror = () => reject(request.error);
    });
  }

  static async updateDocumentStatus(
    id: string,
    status: "processing" | "ready" | "error",
    error?: string
  ): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documents", "readwrite");
      const store = transaction.objectStore("documents");
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const doc = getReq.result as DbDocument;
        if (doc) {
          doc.status = status;
          if (error) doc.error = error;
          const putReq = store.put(doc);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  static async getDocuments(): Promise<DbDocument[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documents", "readonly");
      const store = transaction.objectStore("documents");
      const request = store.getAll();

      request.onsuccess = () => {
        const docs = request.result as DbDocument[];
        // Sort newest first
        docs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
        resolve(docs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async deleteDocument(id: string): Promise<void> {
    const db = await this.init();

    // 1. Delete document metadata record
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("documents", "readwrite");
      const store = transaction.objectStore("documents");
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // 2. Fetch and delete all chunks corresponding to this document ID
    const chunkIds: string[] = await new Promise((resolve, reject) => {
      const transaction = db.transaction("documentChunks", "readonly");
      const store = transaction.objectStore("documentChunks");
      const index = store.index("documentId");
      const request = index.getAllKeys(id);

      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });

    if (chunkIds.length > 0) {
      const transaction = db.transaction("documentChunks", "readwrite");
      const store = transaction.objectStore("documentChunks");
      for (const chunkId of chunkIds) {
        store.delete(chunkId);
      }
    }
  }

  static async addDocumentChunks(
    documentId: string,
    chunks: Array<{ text: string; pageNumber: number; vector: number[] }>
  ): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documentChunks", "readwrite");
      const store = transaction.objectStore("documentChunks");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const record: DbDocumentChunk = {
          id: `${documentId}_chunk_${i}`,
          documentId,
          text: c.text,
          pageNumber: c.pageNumber,
          vector: c.vector
        };
        store.put(record);
      }
    });
  }

  static async searchSimilarDocumentChunks(
    queryVector: number[],
    limit = 5
  ): Promise<Array<DbDocumentChunk & { documentName: string; similarity: number }>> {
    const db = await this.init();

    // 1. Fetch all documents to create a lookup dictionary (id -> name)
    const docs = await this.getDocuments();
    const docNameMap: Record<string, string> = {};
    for (const d of docs) {
      docNameMap[d.id] = d.name;
    }

    // 2. Fetch all document chunks containing vectors
    const allChunks: DbDocumentChunk[] = await new Promise((resolve, reject) => {
      const transaction = db.transaction("documentChunks", "readonly");
      const store = transaction.objectStore("documentChunks");
      const request = store.getAll();

      request.onsuccess = () => {
        const result = request.result as DbDocumentChunk[];
        resolve(result.filter(c => c.vector && c.vector.length > 0));
      };
      request.onerror = () => reject(request.error);
    });

    // 3. Compute cosine similarity for each chunk
    const scoredChunks = allChunks.map(chunk => {
      const similarity = this.cosineSimilarity(queryVector, chunk.vector);
      return {
        ...chunk,
        similarity,
        documentName: docNameMap[chunk.documentId] || "Unknown Document"
      };
    });

    // 4. Sort descending and slice
    scoredChunks.sort((a, b) => b.similarity - a.similarity);
    return scoredChunks.slice(0, limit);
  }
}
