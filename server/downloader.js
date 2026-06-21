const http = require('http');
const https = require('https');
const { URL } = require('url');

const MAX_REDIRECTS = 5;
const MAX_CONTENT_BYTES = 15 * 1024 * 1024; // 15 МБ — защита от слишком больших файлов
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Скачивает контент по URL, вызывая onProgress({loaded, total, progress}) по мере
 * получения данных, и возвращает Promise<{content, contentType, size, finalUrl}>.
 *
 * Поддерживает http/https и ограниченное число редиректов.
 * Бросает ошибки с понятными сообщениями (таймаут, недоступен хост, превышен размер и т.д.)
 */
function downloadWithProgress(targetUrl, onProgress, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (err) {
      reject(new Error(`Некорректный URL: ${targetUrl}`));
      return;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      reject(new Error(`Неподдерживаемый протокол: ${parsedUrl.protocol}`));
      return;
    }

    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const req = lib.get(
      parsedUrl,
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          // Многие сайты блокируют запросы без User-Agent
          'User-Agent':
            'Mozilla/5.0 (compatible; WebCollectorBot/1.0; educational project)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      },
      (res) => {
        // Обработка редиректов
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume(); // освобождаем поток
          if (redirectsLeft <= 0) {
            reject(new Error('Превышено максимальное число перенаправлений'));
            return;
          }
          const nextUrl = new URL(res.headers.location, parsedUrl).toString();
          downloadWithProgress(nextUrl, onProgress, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 400) {
          res.resume();
          reject(new Error(`Сервер ответил с кодом ${res.statusCode}`));
          return;
        }

        const contentType = res.headers['content-type'] || 'unknown';
        const totalHeader = res.headers['content-length'];
        const total = totalHeader ? parseInt(totalHeader, 10) : null;

        let loaded = 0;
        const chunks = [];

        res.on('data', (chunk) => {
          loaded += chunk.length;

          if (loaded > MAX_CONTENT_BYTES) {
            req.destroy();
            reject(
              new Error(
                `Превышен максимально допустимый размер контента (${Math.round(
                  MAX_CONTENT_BYTES / 1024 / 1024
                )} МБ)`
              )
            );
            return;
          }

          chunks.push(chunk);

          const progress = total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
          onProgress({ loaded, total, progress });
        });

        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            content: buffer.toString('utf-8'),
            contentType,
            size: buffer.length,
            finalUrl: parsedUrl.toString(),
          });
        });

        res.on('error', (err) => {
          reject(new Error(`Ошибка чтения ответа: ${err.message}`));
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Превышено время ожидания ответа от сервера'));
    });

    req.on('error', (err) => {
      reject(new Error(`Не удалось подключиться: ${err.message}`));
    });
  });
}

module.exports = { downloadWithProgress };
