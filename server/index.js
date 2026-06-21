const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const { findUrlsByKeyword, listKeywords } = require('./keywordsStore');
const { downloadWithProgress } = require('./downloader');
const WsManager = require('./wsManager');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// Статика клиента
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wsManager = new WsManager(server);

/**
 * GET /api/keywords
 * Возвращает список всех доступных ключевых слов (подсказка для клиента).
 */
app.get('/api/keywords', (req, res) => {
  try {
    const keywords = listKeywords();
    res.json({ keywords });
  } catch (err) {
    res.status(500).json({ error: `Не удалось получить список ключевых слов: ${err.message}` });
  }
});

/**
 * GET /api/keywords/:word
 * Возвращает список URL, соответствующих ключевому слову.
 */
app.get('/api/keywords/:word', (req, res) => {
  const word = req.params.word;

  if (!word || !word.trim()) {
    res.status(400).json({ error: 'Ключевое слово не может быть пустым' });
    return;
  }

  try {
    const urls = findUrlsByKeyword(word);

    if (!urls) {
      res.status(404).json({
        error: `По ключевому слову «${word}» ничего не найдено. Попробуйте другое слово.`,
      });
      return;
    }

    res.json({ keyword: word, urls });
  } catch (err) {
    res.status(500).json({ error: `Ошибка сервера при поиске: ${err.message}` });
  }
});

/**
 * POST /api/download
 * Тело: { url: string, clientId: string }
 * Запускает скачивание контента по URL в фоне, прогресс шлётся через WebSocket
 * клиенту с соответствующим clientId. Ответ возвращается сразу с jobId,
 * финальный результат (или ошибка) тоже приходит через WebSocket.
 */
app.post('/api/download', (req, res) => {
  const { url, clientId } = req.body || {};

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Параметр url обязателен и должен быть строкой' });
    return;
  }
  if (!clientId || typeof clientId !== 'string') {
    res.status(400).json({ error: 'Параметр clientId обязателен (нужен для отправки прогресса по WebSocket)' });
    return;
  }

  const jobId = crypto.randomUUID();

  // Сразу отвечаем клиенту jobId, чтобы он мог сопоставить входящие WS-сообщения
  res.json({ jobId });

  // Уведомляем о старте загрузки
  wsManager.sendTo(clientId, {
    type: 'progress',
    jobId,
    url,
    status: 'started',
    loaded: 0,
    total: null,
    progress: 0,
  });

  downloadWithProgress(url, ({ loaded, total, progress }) => {
    wsManager.sendTo(clientId, {
      type: 'progress',
      jobId,
      url,
      status: 'downloading',
      loaded,
      total,
      progress,
    });
  })
    .then((result) => {
      wsManager.sendTo(clientId, {
        type: 'done',
        jobId,
        url,
        status: 'completed',
        size: result.size,
        contentType: result.contentType,
        finalUrl: result.finalUrl,
        content: result.content,
      });
    })
    .catch((err) => {
      wsManager.sendTo(clientId, {
        type: 'error',
        jobId,
        url,
        status: 'error',
        error: err.message,
      });
    });
});

server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
  console.log(`WebSocket доступен на ws://localhost:${PORT}/ws`);
});
