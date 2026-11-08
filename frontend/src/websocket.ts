export interface WSCallbacks {
  onStatusChange: (status: 'connected' | 'disconnected' | 'connecting') => void;
  onToken: (text: string) => void;
  onDone: (latencyMs: number, ttftMs?: number) => void;
  onError: (errorMessage: string) => void;
}

export class ARWebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private callbacks: WSCallbacks;
  private reconnectTimer: number | null = null;
  private isIntentionallyClosed = false;

  constructor(url: string, callbacks: WSCallbacks) {
    this.url = url;
    this.callbacks = callbacks;
  }

  public connect() {
    this.isIntentionallyClosed = false;
    this.callbacks.onStatusChange('connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.callbacks.onStatusChange('connected');
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'token':
              this.callbacks.onToken(msg.text || '');
              break;
            case 'done':
              this.callbacks.onDone(msg.latency_ms ?? 0, msg.ttft_ms);
              break;
            case 'error':
              this.callbacks.onError(msg.message || 'Unknown server error');
              break;
            default:
              console.warn('[WS] Unhandled message type:', msg);
          }
        } catch (err) {
          console.error('[WS] Failed to parse message JSON:', err);
        }
      };

      this.ws.onclose = () => {
        this.callbacks.onStatusChange('disconnected');
        this.ws = null;
        if (!this.isIntentionallyClosed && !this.reconnectTimer) {
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, 2500);
        }
      };

      this.ws.onerror = (e) => {
        console.warn('[WS] Socket error:', e);
        // onclose will trigger next
      };
    } catch (err) {
      console.error('[WS] Connection exception:', err);
      this.callbacks.onStatusChange('disconnected');
    }
  }

  public sendFrame(timestamp: number, base64Image: string): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'frame',
          t: timestamp,
          image_b64: base64Image,
        })
      );
      return true;
    }
    return false;
  }

  public sendQuestion(text: string): boolean {
    return this.sendRaw({
      type: 'question',
      text,
    });
  }

  public sendRaw(message: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  public disconnect() {
    this.isIntentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
