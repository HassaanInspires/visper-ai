import { LocalDb } from "./db";

export interface SyncConfig {
  supabaseUrl: string;
  supabaseKey: string;
  enableCloudSync: boolean;
}

export class CloudSync {
  private static isSyncing = false;

  /**
   * Syncs unsynced local sessions and messages from IndexedDB to the Supabase PostgreSQL database
   */
  static async sync(): Promise<void> {
    if (this.isSyncing) {
      console.log("CloudSync: Sync is already in progress. Skipping.");
      return;
    }
    this.isSyncing = true;

    try {
      // 1. Fetch cloud sync configuration from chrome storage
      const config = await new Promise<SyncConfig>((resolve) => {
        chrome.storage.local.get(["enableCloudSync", "apiKeys"], (res) => {
          const apiKeys = (res.apiKeys as any) || {};
          resolve({
            enableCloudSync: !!res.enableCloudSync,
            supabaseUrl: apiKeys.supabaseUrl || "",
            supabaseKey: apiKeys.supabaseKey || ""
          });
        });
      });

      // If cloud sync is disabled or configuration keys are missing, exit gracefully
      if (!config.enableCloudSync || !config.supabaseUrl || !config.supabaseKey) {
        this.isSyncing = false;
        return;
      }

      console.log("CloudSync: Starting database sync routine...");
      const url = config.supabaseUrl.replace(/\/$/, "");
      const headers = {
        "apikey": config.supabaseKey,
        "Authorization": `Bearer ${config.supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates" // Tells PostgREST to perform an upsert
      };

      // 2. Fetch and sync sessions
      const unsyncedSessions = await LocalDb.getUnsyncedSessions();
      if (unsyncedSessions.length > 0) {
        console.log(`CloudSync: Found ${unsyncedSessions.length} unsynced sessions. Syncing...`);
        const payload = unsyncedSessions.map(s => ({
          id: s.id,
          title: s.title,
          created_at: new Date(s.createdAt).toISOString(),
          updated_at: new Date(s.updatedAt).toISOString()
        }));

        const res = await fetch(`${url}/rest/v1/sessions?on_conflict=id`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const ids = unsyncedSessions.map(s => s.id);
          await LocalDb.markSessionsSynced(ids);
          console.log(`CloudSync: Successfully synced ${ids.length} sessions.`);
        } else {
          const text = await res.text();
          console.error("CloudSync: Failed to sync sessions. Supabase response:", text);
        }
      }

      // 3. Fetch and sync messages
      const unsyncedMessages = await LocalDb.getUnsyncedMessages();
      if (unsyncedMessages.length > 0) {
        console.log(`CloudSync: Found ${unsyncedMessages.length} unsynced messages. Syncing...`);
        const payload = unsyncedMessages.map(m => ({
          id: m.id,
          session_id: m.sessionId,
          sender: m.sender,
          text: m.text,
          timestamp: new Date(m.timestamp).toISOString(),
          vector: m.vector && m.vector.length > 0 ? m.vector : null
        }));

        let res = await fetch(`${url}/rest/v1/messages?on_conflict=id`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        });

        // Resilience Fallback: If it failed, try inserting WITHOUT the vector column in case they don't have pgvector set up
        if (!res.ok) {
          console.warn("CloudSync: First sync attempt failed. Retrying without vector column...");
          const payloadNoVector = unsyncedMessages.map(m => ({
            id: m.id,
            session_id: m.sessionId,
            sender: m.sender,
            text: m.text,
            timestamp: new Date(m.timestamp).toISOString()
          }));

          res = await fetch(`${url}/rest/v1/messages?on_conflict=id`, {
            method: "POST",
            headers,
            body: JSON.stringify(payloadNoVector)
          });
        }

        if (res.ok) {
          const ids = unsyncedMessages.map(m => m.id);
          await LocalDb.markMessagesSynced(ids);
          console.log(`CloudSync: Successfully synced ${ids.length} messages.`);
        } else {
          const text = await res.text();
          console.error("CloudSync: Failed to sync messages. Supabase response:", text);
        }
      }
    } catch (err) {
      console.error("CloudSync: Sync loop failed with exception:", err);
    } finally {
      this.isSyncing = false;
    }
  }
}
