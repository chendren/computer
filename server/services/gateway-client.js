/**
 * Gateway WebSocket Client
 *
 * Connects to the OpenClaw gateway as a WebSocket client, providing:
 * - Authenticated RPC calls (request/response pattern)
 * - Event subscription and forwarding to Computer's broadcast()
 * - Automatic reconnect with exponential backoff
 */

import WebSocket from 'ws';
import { v4 as uuid } from 'uuid';
import { broadcast } from './websocket.js';
import { getGatewayWsUrl, getGatewayToken, getGatewayStatus } from './gateway-manager.js';
import { deepRedact } from '../middleware/security.js';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const RPC_TIMEOUT_MS = 30000;

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let connected = false;
let pendingRequests = new Map(); // id -> { resolve, reject, timer }
let eventHandlers = new Map(); // event name -> Set of callbacks

/**
 * Connect to the gateway WebSocket.
 */
export function connectToGateway() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const status = getGatewayStatus();
  if (!status.running) {
    scheduleReconnect();
    return;
  }

  const url = getGatewayWsUrl();
  console.log('[gateway-client] Connecting to %s ...', url);

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error('[gateway-client] WebSocket creation failed:', err.message);
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    console.log('[gateway-client] Connected to gateway');
    reconnectAttempts = 0;
    connected = true;

    // Broadcast gateway status to LCARS UI
    broadcast('gateway_status', { connected: true, port: status.port });

    // Authenticate if token is available
    const token = getGatewayToken();
    if (token) {
      sendFrame({
        type: 'req',
        id: uuid(),
        method: 'health',
        params: { auth: { token } },
      });
    }
  });

  ws.on('message', (data) => {
    try {
      const frame = JSON.parse(data.toString());
      handleFrame(frame);
    } catch (err) {
      console.error('[gateway-client] Failed to parse message:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log('[gateway-client] Disconnected (code=%d)', code);
    connected = false;
    ws = null;

    // Reject all pending requests
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Gateway connection closed'));
    }
    pendingRequests.clear();

    broadcast('gateway_status', { connected: false });
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[gateway-client] WebSocket error:', err.message);
  });
}

/**
 * Disconnect from the gateway.
 */
export function disconnectFromGateway() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close(1000, 'Computer shutting down');
    ws = null;
  }

  connected = false;
}

/**
 * Send an RPC request to the gateway and wait for a response.
 *
 * @param {string} method - RPC method name (e.g., 'channels.status', 'sessions.list')
 * @param {object} params - Method parameters
 * @returns {Promise<any>} Response payload
 */
export function callGateway(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Gateway not connected'));
      return;
    }

    const id = uuid();
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Gateway RPC timeout: ${method}`));
    }, RPC_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });

    sendFrame({
      type: 'req',
      id,
      method,
      params,
    });
  });
}

/**
 * Subscribe to a gateway event type.
 *
 * @param {string} event - Event name
 * @param {function} handler - Callback receiving event payload
 * @returns {function} Unsubscribe function
 */
export function onGatewayEvent(event, handler) {
  if (!eventHandlers.has(event)) {
    eventHandlers.set(event, new Set());
  }
  eventHandlers.get(event).add(handler);

  return () => {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        eventHandlers.delete(event);
      }
    }
  };
}

/**
 * Get the current client connection status.
 */
export function getClientStatus() {
  return {
    connected,
    pendingRequests: pendingRequests.size,
    reconnectAttempts,
  };
}

/**
 * Check if gateway client is connected.
 */
export function isGatewayConnected() {
  return connected;
}

// ── Internal ──────────────────────────────────────────────

function sendFrame(frame) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

function handleFrame(frame) {
  switch (frame.type) {
    case 'res':
      handleResponse(frame);
      break;
    case 'event':
      handleEvent(frame);
      break;
    default:
      // Unknown frame type — ignore
      break;
  }
}

function handleResponse(frame) {
  const pending = pendingRequests.get(frame.id);
  if (!pending) return;

  pendingRequests.delete(frame.id);
  clearTimeout(pending.timer);

  if (frame.ok) {
    pending.resolve(frame.payload);
  } else {
    const err = new Error(frame.error?.message || 'Gateway RPC error');
    err.code = frame.error?.code;
    err.details = frame.error?.details;
    pending.reject(err);
  }
}

function handleEvent(frame) {
  const { event, payload: rawPayload } = frame;

  // Redact secrets from gateway payloads before broadcasting
  const { value: payload } = deepRedact(rawPayload);

  // Forward all gateway events to LCARS UI
  broadcast('gateway_event', { event, payload });

  // Dispatch to registered handlers
  const handlers = eventHandlers.get(event);
  if (handlers) {
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error('[gateway-client] Event handler error (%s):', event, err.message);
      }
    }
  }

  // Auto-forward specific event types as distinct broadcast types
  switch (event) {
    case 'message':
    case 'message.received':
      broadcast('channel_message', payload);
      break;
    case 'agent.thinking':
    case 'agent.reply':
      broadcast('agent_activity', payload);
      break;
    case 'cron.fired':
      broadcast('cron_event', payload);
      break;
    case 'node.connected':
    case 'node.disconnected':
      broadcast('node_event', payload);
      break;
    case 'presence':
      broadcast('gateway_presence', payload);
      break;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectAttempts++;
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(1.5, reconnectAttempts - 1),
    RECONNECT_MAX_MS
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToGateway();
  }, delay);
}
