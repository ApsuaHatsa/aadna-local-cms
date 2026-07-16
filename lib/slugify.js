const CYRILLIC_TO_LATIN = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
  'я': 'ya',
  'А': 'a', 'Б': 'b', 'В': 'v', 'Г': 'g', 'Д': 'd', 'Е': 'e', 'Ё': 'yo', 'Ж': 'zh',
  'З': 'z', 'И': 'i', 'Й': 'y', 'К': 'k', 'Л': 'l', 'М': 'm', 'Н': 'n', 'О': 'o',
  'П': 'p', 'Р': 'r', 'С': 's', 'Т': 't', 'У': 'u', 'Ф': 'f', 'Х': 'kh', 'Ц': 'ts',
  'Ч': 'ch', 'Ш': 'sh', 'Щ': 'shch', 'Ъ': '', 'Ы': 'y', 'Ь': '', 'Э': 'e', 'Ю': 'yu',
  'Я': 'ya',
  // Дополнительные абхазские символы, если встретятся
  'ҩ': 'o', 'ҩ': 'o', 'џ': 'dzh', 'Џ': 'dzh', 'ь': '', 'Ь': '', 'ә': 'a', 'Ә': 'a',
  'а́': 'a', 'ы́': 'y', 'е́': 'e', 'о́': 'o', 'у́': 'u', 'и́': 'i'
};

export function slugifyAadnaTitle(title) {
  if (!title || typeof title !== 'string') return '';

  // Нормализуем строку (удаляем ударения и диакритики)
  const normalized = title.normalize('NFD');
  
  let result = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const latin = CYRILLIC_TO_LATIN[char];
    if (latin !== undefined) {
      result += latin;
    } else {
      result += char;
    }
  }

  return result
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-') // Оставляем только буквы, цифры, дефис и подчеркивание
    .replace(/-+/g, '-')          // Схлопываем множественные дефисы
    .replace(/^-+|-+$/g, '');     // Убираем дефисы на концах
}
