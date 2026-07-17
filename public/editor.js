/* =============================================================================
   🧬 AADNA Local - Markdown Rich-Text Editor Helper
   ============================================================================= */

// Вспомогательная функция для форматирования выделенного текста в Markdown
export function insertMarkdown(textarea, type) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);
  
  let replacement = '';
  let cursorOffset = 0;

  switch (type) {
    case 'bold':
      replacement = `**${selected || 'текст'}**`;
      cursorOffset = selected ? 0 : 2;
      break;
    case 'italic':
      replacement = `*${selected || 'текст'}*`;
      cursorOffset = selected ? 0 : 1;
      break;
    case 'link':
      const url = prompt('Введите URL ссылки:', 'https://');
      if (url === null) return; // отмена
      replacement = `[${selected || 'текст'}](${url})`;
      break;
    case 'image':
      const imgUrl = prompt('Введите URL картинки или загрузите её перетаскиванием:', '/media/results/');
      if (imgUrl === null) return;
      replacement = `![${selected || 'изображение.png'}](${imgUrl})`;
      break;
    case 'code':
      replacement = `\`${selected || 'код'}\``;
      cursorOffset = selected ? 0 : 1;
      break;
  }

  textarea.value = text.substring(0, start) + replacement + text.substring(end);
  textarea.focus();
  
  const newCursorPos = start + replacement.length - cursorOffset;
  textarea.setSelectionRange(newCursorPos, newCursorPos);

  // Вызываем событие input для обновления данных формы
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

// Настройка drag & drop и paste (Ctrl+V) для загрузки картинок
export function setupEditorAttachments(textarea, showToast, getCollection) {
  // 1. Обработка вставки Ctrl+V
  textarea.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    
    for (const item of items) {
      if (item.type.indexOf('image') === 0) {
        e.preventDefault(); // отменяем стандартную вставку текста
        
        const file = item.getAsFile();
        showToast('Загрузка изображения из буфера обмена...', 'info');

        try {
          const pathInput = document.querySelector('input[data-field-path="path"]');
          const slug = pathInput ? pathInput.value.trim().replace(/^\/+/, '').replace(/\/+$/, '') : '';
          const collection = typeof getCollection === 'function' ? getCollection() : 'results';

          const formData = new FormData();
          formData.append('image', file, 'pasted_image.png');

          const uploadUrl = slug ? `/api/upload?slug=${encodeURIComponent(slug)}&collection=${collection}` : `/api/upload?collection=${collection}`;
          const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            throw new Error(`Ошибка HTTP: ${response.status}`);
          }

          const result = await response.json();
          
          // Вставляем изображение в позицию курсора
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const text = textarea.value;
          const imgMarkdown = `\n![изображение.png](${result.url})\n`;
          
          textarea.value = text.substring(0, start) + imgMarkdown + text.substring(end);
          textarea.focus();
          const newPos = start + imgMarkdown.length;
          textarea.setSelectionRange(newPos, newPos);
          
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          showToast('Изображение успешно вставлено!', 'success');
        } catch (error) {
          console.error(error);
          showToast(`Ошибка загрузки: ${error.message}`, 'error');
        }
      }
    }
  });

  // 2. Обработка Drag & Drop на область ввода текста
  textarea.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  textarea.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;

    if (files.length > 0) {
      const file = files[0];
      if (file.type.indexOf('image') === 0) {
        showToast('Загрузка перетащенного изображения...', 'info');

        try {
          const pathInput = document.querySelector('input[data-field-path="path"]');
          const slug = pathInput ? pathInput.value.trim().replace(/^\/+/, '').replace(/\/+$/, '') : '';
          const collection = typeof getCollection === 'function' ? getCollection() : 'results';

          const formData = new FormData();
          formData.append('image', file, file.name);

          const uploadUrl = slug ? `/api/upload?slug=${encodeURIComponent(slug)}&collection=${collection}` : `/api/upload?collection=${collection}`;
          const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            throw new Error(`Ошибка HTTP: ${response.status}`);
          }

          const result = await response.json();
          
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const text = textarea.value;
          const imgMarkdown = `\n![${file.name}](${result.url})\n`;
          
          textarea.value = text.substring(0, start) + imgMarkdown + text.substring(end);
          textarea.focus();
          const newPos = start + imgMarkdown.length;
          textarea.setSelectionRange(newPos, newPos);
          
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          showToast('Изображение успешно добавлено!', 'success');
        } catch (error) {
          console.error(error);
          showToast(`Ошибка загрузки: ${error.message}`, 'error');
        }
      }
    }
  });
}
