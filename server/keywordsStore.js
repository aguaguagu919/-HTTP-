const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'keywords.json');

/**
 * Загружает словарь "ключевое слово -> [URL]" из JSON-файла.
 * Бросает понятную ошибку, если файл отсутствует или повреждён.
 */
function loadKeywordsMap() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_PATH, 'utf-8');
  } catch (err) {
    throw new Error(`Не удалось прочитать файл с данными (${DATA_PATH}): ${err.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Файл с данными повреждён (невалидный JSON): ${err.message}`);
  }
}

/**
 * Нормализует ключевое слово для регистронезависимого поиска.
 */
function normalize(word) {
  return String(word || '').trim().toLowerCase();
}

/**
 * Возвращает список URL для заданного ключевого слова.
 * Возвращает null, если слово не найдено в словаре.
 */
function findUrlsByKeyword(word) {
  const map = loadKeywordsMap();
  const target = normalize(word);

  for (const key of Object.keys(map)) {
    if (normalize(key) === target) {
      return map[key];
    }
  }
  return null;
}

/**
 * Возвращает полный список доступных ключевых слов (для подсказок на клиенте).
 */
function listKeywords() {
  const map = loadKeywordsMap();
  return Object.keys(map);
}

module.exports = {
  findUrlsByKeyword,
  listKeywords,
};
