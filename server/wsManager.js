const WebSocket = require('ws');

/**
 * Хранит соответствие clientId -> WebSocket соединение
 * и предоставляет методы для регистрации и отправки сообщений.
 */
class WsManager {
  constructor(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.clients = new Map(); // clientId -> ws

    this.wss.on('connection', (ws) => {
      let registeredId = null;

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'register' && msg.clientId) {
            registeredId = msg.clientId;
            this.clients.set(registeredId, ws);
          }
        } catch (err) {
          // Игнорируем некорректные сообщения от клиента, соединение не рвём
          console.warn('Получено некорректное WS-сообщение от клиента:', err.message);
        }
      });

      ws.on('close', () => {
        if (registeredId && this.clients.get(registeredId) === ws) {
          this.clients.delete(registeredId);
        }
      });

      ws.on('error', (err) => {
        console.warn('Ошибка WebSocket-соединения:', err.message);
      });
    });
  }

  /**
   * Отправляет JSON-сообщение конкретному клиенту, если он подключён.
   * Возвращает true, если сообщение отправлено.
   */
  sendTo(clientId, payload) {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }
}

module.exports = WsManager;
