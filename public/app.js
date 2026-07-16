/* =============================================================================
   🧬 AADNA Local - Client Side Application Logic
   ============================================================================= */

import { insertMarkdown, setupEditorAttachments } from './editor.js';

let CONFIG = null;
let CURRENT_ENTRY = null;
let ORIGINAL_SLUG = '';

// Вспомогательные функции для работы с путями в объектах
function setValueByPath(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key]) {
      const nextKey = keys[i + 1];
      current[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    current = current[key];
  }
  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
}

function getValueByPath(obj, path) {
  if (!obj) return undefined;
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

// -----------------------------------------------------------------------------
// Toast Уведомления
// -----------------------------------------------------------------------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  
  container.appendChild(toast);
  
  // Анимация появления
  setTimeout(() => toast.classList.add('active'), 10);
  
  // Автоматическое скрытие через 4 секунды
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// -----------------------------------------------------------------------------
// Git Статус
// -----------------------------------------------------------------------------
async function updateGitStatus() {
  try {
    const res = await fetch('/api/git-status');
    if (!res.ok) throw new Error('Ошибка связи с сервером');
    const status = await res.json();
    
    const dot = document.getElementById('gitDot');
    const text = document.getElementById('gitStatusText');
    const publishBtn = document.getElementById('openPublishModalBtn');
    
    if (status.success) {
      if (status.totalChanges > 0) {
        dot.className = 'git-dot dirty';
        text.innerText = `Git: ${status.totalChanges} изм. (${status.modified} изм., ${status.added} доб.)`;
        publishBtn.style.display = 'inline-flex';
      } else {
        dot.className = 'git-dot';
        text.innerText = `Git: Чисто. Последний: ${status.lastCommit}`;
        publishBtn.style.display = 'none';
      }
    } else {
      dot.className = 'git-dot';
      text.innerText = `Git статус недоступен`;
      publishBtn.style.display = 'none';
    }
  } catch (error) {
    console.error(error);
  }
}

// -----------------------------------------------------------------------------
// Загрузка списков и отрисовка таблицы
// -----------------------------------------------------------------------------
let allEntries = [];

async function loadEntries() {
  const tableBody = document.getElementById('entriesTableBody');
  tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--color-muted);">Загрузка постов...</td></tr>';
  
  try {
    const res = await fetch('/api/entries');
    if (!res.ok) throw new Error('Не удалось загрузить список результатов');
    allEntries = await res.json();
    renderEntriesTable(allEntries);
  } catch (error) {
    showToast(error.message, 'error');
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--color-danger);">${error.message}</td></tr>`;
  }
}

function renderEntriesTable(entries) {
  const tableBody = document.getElementById('entriesTableBody');
  tableBody.innerHTML = '';
  
  if (entries.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--color-muted);">Результаты не найдены</td></tr>';
    return;
  }
  
  entries.forEach(entry => {
    const tr = document.createElement('tr');
    
    const statusBadge = entry.draft 
      ? '<span class="badge-draft">Черновик</span>' 
      : '<span class="badge-published">Опубликован</span>';
      
    tr.innerHTML = `
      <td style="font-weight: 600; color: white;">${entry.title}</td>
      <td>
        <span style="font-weight: bold; color: var(--color-accent); font-family: monospace;">${entry.haplogroup}</span>
        ${entry.subclade ? `<span style="color: var(--color-muted); font-size: 0.8rem; font-family: monospace; margin-left: 0.5rem;">(${entry.subclade})</span>` : ''}
      </td>
      <td>${entry.date || '—'}</td>
      <td>${statusBadge}</td>
      <td style="text-align: right;">
        <button class="btn btn-sm edit-entry-btn" data-slug="${entry.slug}">Редактировать</button>
      </td>
    `;
    
    tr.querySelector('.edit-entry-btn').addEventListener('click', () => {
      window.location.hash = `#/edit/${entry.slug}`;
    });
    
    tableBody.appendChild(tr);
  });
}

// Поиск
document.getElementById('searchInput').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  if (!query) {
    renderEntriesTable(allEntries);
    return;
  }
  
  const filtered = allEntries.filter(entry => 
    entry.title.toLowerCase().includes(query) ||
    entry.surname.toLowerCase().includes(query) ||
    entry.haplogroup.toLowerCase().includes(query) ||
    entry.subclade.toLowerCase().includes(query)
  );
  renderEntriesTable(filtered);
});

// -----------------------------------------------------------------------------
// Динамическая генерация HTML-форм
// -----------------------------------------------------------------------------
function buildFormHTML(fields, parentPath = '') {
  let html = '';
  
  fields.forEach(field => {
    // Пропускаем скрытые системные поля
    if (field.hidden) return;
    
    const fieldPath = parentPath ? `${parentPath}.${field.name}` : field.name;
    const isRequired = field.required ? ' <span class="required">*</span>' : '';
    const descHTML = field.description ? `<span class="field-desc">${field.description}</span>` : '';
    
    // 1. Поля типа Object (вложенные структуры)
    if (field.type === 'object' && !field.list) {
      const isCollapsedClass = field.collapsible?.collapsed ? 'collapsed' : '';
      html += `
        <div class="panel ${isCollapsedClass}" id="panel_${fieldPath.replace(/\./g, '_')}">
          <div class="panel-title" onclick="this.parentElement.classList.toggle('collapsed')">${field.label}</div>
          <div class="form-grid">
            ${buildFormHTML(field.fields, fieldPath)}
          </div>
        </div>
      `;
      return;
    }

    // 2. Список объектов (например, список тамг {image, caption})
    if (field.type === 'object' && field.list) {
      html += `
        <div class="panel" id="panel_${fieldPath.replace(/\./g, '_')}">
          <div class="panel-title">${field.label}</div>
          <div class="object-list-container" id="list_container_${fieldPath.replace(/\./g, '_')}" data-field-path="${fieldPath}">
            <!-- Блоки будут вставляться динамически при заполнении данными -->
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="add_btn_${fieldPath.replace(/\./g, '_')}" style="margin-top: 1rem;">
            ＋ Добавить элемент ${field.label.toLowerCase()}
          </button>
        </div>
      `;
      return;
    }

    // 3. Специфический виджет родословной (inline pedigree, 10 полей в ряд)
    if (field.name === 'pedigree') {
      html += `
        <div class="panel" id="panel_pedigree">
          <div class="panel-title">Родословная протестированного</div>
          <div class="pedigree-row-container">
            <span class="field-desc">Добавляйте предков по порядку (от самого дальнего к самому близкому). Пустые ячейки будут пропущены.</span>
            <div class="pedigree-grid" id="pedigreeGrid" data-field-path="${fieldPath}">
              ${Array.from({ length: 10 }).map((_, idx) => `
                <div class="pedigree-item">
                  <span class="index-label">${idx + 1}-е поколение</span>
                  <input type="text" placeholder="например: Кчич (~1870 г.)">
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
      return;
    }

    // 4. Обычные поля
    let inputControl = '';
    
    if (field.type === 'select') {
      const isMultiple = field.options?.multiple ? 'multiple' : '';
      const sizeAttr = field.options?.multiple ? 'size="5"' : '';
      const values = field.options?.values || [];
      
      inputControl = `
        <select data-field-path="${fieldPath}" ${isMultiple} ${sizeAttr}>
          ${!field.options?.multiple ? '<option value="">-- Выберите --</option>' : ''}
          ${values.map(val => {
            const label = typeof val === 'object' ? val.label : val;
            const value = typeof val === 'object' ? val.value : val;
            return `<option value="${value}">${label}</option>`;
          }).join('')}
        </select>
      `;
    } 
    else if (field.type === 'rich-text') {
      inputControl = `
        <div class="editor-container">
          <div class="editor-toolbar">
            <button type="button" class="editor-btn text-bold" data-action="bold" title="Жирный"><b>B</b></button>
            <button type="button" class="editor-btn text-italic" data-action="italic" title="Курсив"><i>I</i></button>
            <button type="button" class="editor-btn text-link" data-action="link" title="Вставить ссылку">🔗</button>
            <button type="button" class="editor-btn text-image" data-action="image" title="Вставить картинку">🖼️</button>
            <button type="button" class="editor-btn text-code" data-action="code" title="Вставить код">&lt;/&gt;</button>
          </div>
          <textarea data-field-path="${fieldPath}" placeholder="Введите текст... (вы можете вставить изображение Ctrl+V или перетащить файл)"></textarea>
        </div>
      `;
    } 
    else if (field.type === 'image') {
      inputControl = `
        <div class="uploader-area" id="uploader_${fieldPath.replace(/\./g, '_')}">
          <span style="font-size: 0.85rem; color: var(--color-muted);">Перетащите картинку сюда или нажмите для выбора</span>
          <input type="file" accept="image/*" style="display: none;" id="file_input_${fieldPath.replace(/\./g, '_')}">
          <input type="hidden" data-field-path="${fieldPath}">
          <div class="uploader-preview" id="preview_${fieldPath.replace(/\./g, '_')}" style="display: none;"></div>
        </div>
      `;
    } 
    else if (field.type === 'boolean') {
      inputControl = `
        <div class="checkbox-group">
          <input type="checkbox" id="chk_${fieldPath.replace(/\./g, '_')}" data-field-path="${fieldPath}">
          <label for="chk_${fieldPath.replace(/\./g, '_')}">${field.label}</label>
        </div>
      `;
    } 
    else if (field.type === 'date') {
      inputControl = `<input type="date" data-field-path="${fieldPath}">`;
    } 
    else if (field.type === 'number') {
      inputControl = `<input type="number" data-field-path="${fieldPath}">`;
    } 
    else if (field.list) { // Строковый список (например, aliases)
      inputControl = `
        <div class="string-list-container" id="str_list_${fieldPath.replace(/\./g, '_')}" data-field-path="${fieldPath}">
          <div class="string-list-items"></div>
          <button type="button" class="btn btn-sm" style="margin-top: 0.5rem;" onclick="window.addStringListRow('${fieldPath}')">＋ Добавить значение</button>
        </div>
      `;
    }
    else { // Обычная строка
      inputControl = `<input type="text" data-field-path="${fieldPath}">`;
    }

    // Оборачиваем в форму
    const fullWidthClass = (field.type === 'rich-text' || field.type === 'text') ? 'full-width' : '';
    
    // Для чекбокса лейбл уже внутри группы
    const showLabel = field.type !== 'boolean';
    
    html += `
      <div class="form-group ${fullWidthClass}">
        ${showLabel ? `<label>${field.label}${isRequired}</label>` : ''}
        ${inputControl}
        ${descHTML}
      </div>
    `;
  });
  
  return html;
}

// -----------------------------------------------------------------------------
// Инициализация событий формы
// -----------------------------------------------------------------------------
function initializeFormEvents() {
  // Навешиваем обработчики для Markdown редакторов
  document.querySelectorAll('.editor-container').forEach(container => {
    const textarea = container.querySelector('textarea');
    
    // Toolbar кнопки
    container.querySelectorAll('.editor-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        insertMarkdown(textarea, action);
      });
    });

    // Настройка Drag over и Ctrl+V для редактора
    setupEditorAttachments(textarea, showToast);
  });

  // Навешиваем обработчики для загрузчиков картинок
  document.querySelectorAll('.uploader-area').forEach(area => {
    const fileInput = area.querySelector('input[type="file"]');
    const hiddenInput = area.querySelector('input[type="hidden"]');
    const previewDiv = area.querySelector('.uploader-preview');
    
    area.addEventListener('click', (e) => {
      // Игнорируем клик, если нажата кнопка удаления превью
      if (e.target.classList.contains('remove-img-btn')) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      if (fileInput.files.length > 0) {
        await handleImageUpload(fileInput.files[0], hiddenInput, previewDiv);
      }
    });

    // Drag-and-drop
    area.addEventListener('dragover', (e) => {
      e.preventDefault();
      area.classList.add('dragover');
    });

    area.addEventListener('dragleave', () => {
      area.classList.remove('dragover');
    });

    area.addEventListener('drop', async (e) => {
      e.preventDefault();
      area.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        await handleImageUpload(files[0], hiddenInput, previewDiv);
      }
    });
  });

  // Авто-генерация URL слага из Заголовка
  const titleInput = document.querySelector('input[data-field-path="title"]');
  const pathInput = document.querySelector('input[data-field-path="path"]');
  
  if (titleInput && pathInput) {
    titleInput.addEventListener('blur', () => {
      if (!pathInput.value.trim() && titleInput.value.trim()) {
        const title = titleInput.value.trim();
        // Внутренний slugify для автозаполнения
        fetch(`/api/config`)
          .then(() => {
            const rawSlug = title.toLowerCase()
              .replace(/[^а-яа-яëa-z0-9\s_-]/gi, '')
              .trim();
            // Делаем простую латинизацию на клиенте
            const CYR = {
              'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
            };
            let slug = '';
            for (let i = 0; i < rawSlug.length; i++) {
              const char = rawSlug[i];
              slug += CYR[char] !== undefined ? CYR[char] : char;
            }
            slug = slug.toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
            if (slug) {
              pathInput.value = `${slug}/`;
              pathInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
          });
      }
    });
  }

  // Настройка списков объектов (например, Tamgas)
  CONFIG.fields.forEach(field => {
    if (field.type === 'object' && field.list) {
      const fieldPath = field.name;
      const addBtn = document.getElementById(`add_btn_${fieldPath.replace(/\./g, '_')}`);
      
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          addObjectListRow(fieldPath, null);
        });
      }
    }
  });
}

// -----------------------------------------------------------------------------
// Изображения: Загрузка на сервер и превью
// -----------------------------------------------------------------------------
async function handleImageUpload(file, hiddenInput, previewDiv) {
  showToast(`Загрузка изображения ${file.name}...`, 'info');
  
  try {
    const formData = new FormData();
    formData.append('image', file, file.name);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Ошибка HTTP: ${response.status}`);
    }

    const result = await response.json();
    
    // Сохраняем новое значение в input
    hiddenInput.value = result.url;
    hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Отрисовываем превью
    renderImagePreview(result.url, previewDiv);
    
    showToast('Файл успешно загружен!', 'success');
  } catch (error) {
    console.error(error);
    showToast(`Ошибка загрузки: ${error.message}`, 'error');
  }
}

function renderImagePreview(url, previewDiv) {
  if (!url) {
    previewDiv.innerHTML = '';
    previewDiv.style.display = 'none';
    return;
  }

  previewDiv.innerHTML = `
    <img src="${url}" alt="Preview" />
    <button type="button" class="remove-img-btn" title="Удалить картинку">✕</button>
  `;
  previewDiv.style.display = 'flex';

  previewDiv.querySelector('.remove-img-btn').addEventListener('click', (e) => {
    e.stopPropagation(); // Отменяем вызов выбора файла
    
    const hiddenInput = previewDiv.parentElement.querySelector('input[type="hidden"]');
    hiddenInput.value = '';
    hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    previewDiv.innerHTML = '';
    previewDiv.style.display = 'none';
  });
}

// -----------------------------------------------------------------------------
// Динамическая обработка массивов строк (String lists)
// -----------------------------------------------------------------------------
window.addStringListRow = function(fieldPath, value = '') {
  const container = document.getElementById(`str_list_${fieldPath.replace(/\./g, '_')}`);
  const itemsDiv = container.querySelector('.string-list-items');
  
  const div = document.createElement('div');
  div.style.display = 'flex';
  div.style.gap = '0.5rem';
  div.style.marginTop = '0.4rem';
  
  div.innerHTML = `
    <input type="text" value="${value}" style="flex: 1;">
    <button type="button" class="btn btn-danger btn-sm remove-str-btn" style="padding: 0.6rem;">✕</button>
  `;
  
  div.querySelector('.remove-str-btn').addEventListener('click', () => {
    div.remove();
  });
  
  itemsDiv.appendChild(div);
};

// -----------------------------------------------------------------------------
// Динамическая обработка списков объектов (Object lists - Tamgas)
// -----------------------------------------------------------------------------
function addObjectListRow(fieldPath, data = null) {
  const container = document.getElementById(`list_container_${fieldPath.replace(/\./g, '_')}`);
  const childIndex = container.children.length;
  const itemPath = `${fieldPath}.${childIndex}`;

  const row = document.createElement('div');
  row.className = 'object-list-item';
  row.innerHTML = `
    <!-- Блок картинки -->
    <div class="uploader-area" id="uploader_${itemPath.replace(/\./g, '_')}">
      <span style="font-size: 0.75rem; color: var(--color-muted);">Тамга</span>
      <input type="file" accept="image/*" style="display: none;" id="file_input_${itemPath.replace(/\./g, '_')}">
      <input type="hidden" data-object-field-path="image" value="${data?.image || ''}">
      <div class="uploader-preview" id="preview_${itemPath.replace(/\./g, '_')}" style="display: none;"></div>
    </div>
    
    <!-- Текстовые поля -->
    <div class="item-fields">
      <div class="form-group">
        <label>Подпись под фото</label>
        <input type="text" data-object-field-path="caption" value="${data?.caption || ''}" placeholder="например: Тамга рода Ардзинба">
      </div>
      <button type="button" class="remove-item-btn">Удалить тамгу</button>
    </div>
  `;

  // Инициализация загрузчика картинок в строке
  const fileInput = row.querySelector('input[type="file"]');
  const hiddenInput = row.querySelector('input[type="hidden"]');
  const previewDiv = row.querySelector('.uploader-preview');
  const uploaderArea = row.querySelector('.uploader-area');

  uploaderArea.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-img-btn')) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    if (fileInput.files.length > 0) {
      await handleImageUpload(fileInput.files[0], hiddenInput, previewDiv);
    }
  });

  // Превью если есть данные
  if (data?.image) {
    renderImagePreview(data.image, previewDiv);
  }

  // Кнопка удаления строки
  row.querySelector('.remove-item-btn').addEventListener('click', () => {
    row.remove();
    reindexObjectList(container);
  });

  container.appendChild(row);
}

function reindexObjectList(container) {
  // Нам не нужно делать сложный переиндекс, так как мы собираем данные по порядку DOM-элементов
}

// -----------------------------------------------------------------------------
// Заполнение формы данными (Populate / Load)
// -----------------------------------------------------------------------------
function populateForm(data) {
  // 1. Очищаем форму
  document.getElementById('resultForm').reset();
  
  // Очищаем списки объектов
  document.querySelectorAll('.object-list-container').forEach(c => c.innerHTML = '');
  // Очищаем списки строк
  document.querySelectorAll('.string-list-container .string-list-items').forEach(c => c.innerHTML = '');
  // Очищаем превью загрузчиков
  document.querySelectorAll('.uploader-preview').forEach(p => {
    p.innerHTML = '';
    p.style.display = 'none';
  });

  CURRENT_ENTRY = data;

  // 2. Заполняем поля по путям
  // Корневые поля и extra
  document.querySelectorAll('[data-field-path]').forEach(control => {
    const path = control.getAttribute('data-field-path');
    
    // Пропускаем вложенные списки
    if (path === 'extra.pedigree') {
      const pedigreeVal = getValueByPath(data, 'extra.pedigree') || [];
      const pedigreeInputs = document.querySelectorAll('#pedigreeGrid input');
      pedigreeInputs.forEach((input, index) => {
        input.value = pedigreeVal[index] || '';
      });
      return;
    }

    const val = getValueByPath(data, path);
    if (val === undefined) return;

    if (control.tagName === 'SELECT') {
      if (control.multiple && Array.isArray(val)) {
        Array.from(control.options).forEach(opt => {
          opt.selected = val.includes(opt.value);
        });
      } else {
        control.value = val;
      }
    } 
    else if (control.type === 'checkbox') {
      control.checked = !!val;
    } 
    else if (control.type === 'hidden') {
      // Это загрузчик изображения
      control.value = val;
      const previewDiv = control.parentElement.querySelector('.uploader-preview');
      renderImagePreview(val, previewDiv);
    }
    else {
      control.value = val;
    }
  });

  // 3. Заполняем списки строк (например, aliases)
  document.querySelectorAll('.string-list-container').forEach(container => {
    const path = container.getAttribute('data-field-path');
    const values = getValueByPath(data, path);
    if (Array.isArray(values)) {
      values.forEach(val => {
        const cleanPath = path;
        window.addStringListRow(cleanPath, val);
      });
    }
  });

  // 4. Заполняем списки объектов (например, tamga)
  document.querySelectorAll('.object-list-container').forEach(container => {
    const path = container.getAttribute('data-field-path');
    const items = getValueByPath(data, path);
    if (Array.isArray(items)) {
      items.forEach(item => {
        addObjectListRow(path, item);
      });
    }
  });
}

// -----------------------------------------------------------------------------
// Сбор данных из формы (Serialize / Save)
// -----------------------------------------------------------------------------
function serializeForm() {
  const result = {};

  // 1. Собираем стандартные плоские поля
  document.querySelectorAll('[data-field-path]').forEach(control => {
    const path = control.getAttribute('data-field-path');
    if (path === 'extra.pedigree') return; // обрабатывается отдельно
    
    // Пропускаем контейнеры списков строк
    if (control.classList.contains('string-list-container')) return;

    let val = undefined;
    if (control.tagName === 'SELECT') {
      if (control.multiple) {
        val = Array.from(control.selectedOptions).map(opt => opt.value);
      } else {
        val = control.value;
      }
    } 
    else if (control.type === 'checkbox') {
      val = control.checked;
    } 
    else if (control.type === 'number') {
      val = control.value ? Number(control.value) : undefined;
    }
    else {
      val = control.value;
    }

    if (val !== undefined && val !== '') {
      setValueByPath(result, path, val);
    }
  });

  // 2. Собираем pedigree (10 полей в ряд)
  const pedigreeGrid = document.getElementById('pedigreeGrid');
  if (pedigreeGrid) {
    const path = pedigreeGrid.getAttribute('data-field-path');
    const inputs = pedigreeGrid.querySelectorAll('input');
    const values = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
    if (values.length > 0) {
      setValueByPath(result, path, values);
    }
  }

  // 3. Собираем списки строк (например, aliases)
  document.querySelectorAll('.string-list-container').forEach(container => {
    const path = container.getAttribute('data-field-path');
    const inputs = container.querySelectorAll('input');
    const values = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
    if (values.length > 0) {
      setValueByPath(result, path, values);
    }
  });

  // 4. Собираем списки объектов (например, tamga)
  document.querySelectorAll('.object-list-container').forEach(container => {
    const path = container.getAttribute('data-field-path');
    const items = [];
    
    container.querySelectorAll('.object-list-item').forEach(row => {
      const item = {};
      row.querySelectorAll('[data-object-field-path]').forEach(control => {
        const field = control.getAttribute('data-object-field-path');
        const val = control.value.trim();
        if (val) item[field] = val;
      });
      if (Object.keys(item).length > 0) {
        items.push(item);
      }
    });

    if (items.length > 0) {
      setValueByPath(result, path, items);
    }
  });

  return result;
}

// -----------------------------------------------------------------------------
// Сохранение записи на диск
// -----------------------------------------------------------------------------
async function saveEntry(publishAfter = false) {
  const data = serializeForm();
  
  if (!data.title) {
    showToast('Заголовок обязателен для заполнения!', 'error');
    return null;
  }

  showToast('Сохранение файла на диск...', 'info');

  try {
    const response = await fetch('/api/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalSlug: ORIGINAL_SLUG,
        data: data
      })
    });

    if (!response.ok) {
      throw new Error(`Ошибка сохранения: HTTP ${response.status}`);
    }

    const result = await response.json();
    showToast('Пост успешно сохранен!', 'success');
    
    // Обновляем статус Git
    await updateGitStatus();
    
    if (publishAfter) {
      // Открываем модалку коммита
      openPublishModal();
    } else {
      // Возвращаемся к списку
      window.location.hash = '#/';
    }
    
    return result.slug;
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
    return null;
  }
}

// -----------------------------------------------------------------------------
// Git Publish Modal
// -----------------------------------------------------------------------------
async function openPublishModal() {
  const modal = document.getElementById('publishModal');
  const summary = document.getElementById('gitStatusSummary');
  const commitInput = document.getElementById('commitMessageInput');
  const consoleLog = document.getElementById('modalConsole');
  
  commitInput.value = '';
  consoleLog.style.display = 'none';
  consoleLog.innerText = '';
  
  try {
    const res = await fetch('/api/git-status');
    const status = await res.json();
    
    if (status.success) {
      summary.innerText = `Изменено файлов: ${status.totalChanges} (${status.modified} изм., ${status.added} доб., ${status.deleted} уд.)`;
      commitInput.placeholder = `например: add ${ORIGINAL_SLUG || 'new'} post`;
    }
  } catch (e) {
    summary.innerText = 'Не удалось загрузить детальный статус Git';
  }
  
  modal.classList.add('active');
}

function closePublishModal() {
  document.getElementById('publishModal').classList.remove('active');
}

async function startGitPublish() {
  const commitInput = document.getElementById('commitMessageInput');
  const consoleLog = document.getElementById('modalConsole');
  const message = commitInput.value.trim() || commitInput.placeholder;
  
  if (message.length > 30) {
    showToast('Длина описания не должна превышать 30 символов!', 'error');
    return;
  }
  
  consoleLog.style.display = 'block';
  consoleLog.innerText = '> git add .\n> git commit -m "' + message + '"\n';
  
  try {
    const response = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    
    const result = await response.json();
    
    if (result.success) {
      consoleLog.innerText += result.stdout + '\n\n> Успешно опубликовано!';
      showToast('Сайт успешно опубликован на GitHub!', 'success');
      
      // Закрываем модалку через пару секунд и идем к списку
      setTimeout(() => {
        closePublishModal();
        window.location.hash = '#/';
      }, 2000);
    } else {
      consoleLog.innerText += 'ОШИБКА:\n' + result.stderr;
      showToast('Ошибка коммита в Git', 'error');
    }
    
    await updateGitStatus();
  } catch (error) {
    consoleLog.innerText += 'Ошибка запроса к API:\n' + error.message;
    showToast(error.message, 'error');
  }
}

// -----------------------------------------------------------------------------
// Инициализация SPA и маршрутизатора
// -----------------------------------------------------------------------------
async function initApp() {
  // 1. Загружаем конфиг полей с сервера
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Не удалось получить конфигурацию полей');
    CONFIG = await res.json();
    
    // Строим HTML полей формы
    const container = document.getElementById('dynamicFormFields');
    container.innerHTML = buildFormHTML(CONFIG.fields);
    
    // Навешиваем обработчики событий
    initializeFormEvents();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
    return;
  }

  // 2. Настраиваем кнопки
  document.getElementById('createNewBtn').addEventListener('click', () => {
    window.location.hash = '#/new';
  });
  
  document.getElementById('backToListBtn').addEventListener('click', () => {
    window.location.hash = '#/';
  });

  document.getElementById('saveDraftBtn').addEventListener('click', () => saveEntry(false));
  document.getElementById('saveAndPublishBtn').addEventListener('click', () => saveEntry(true));
  
  document.getElementById('openPublishModalBtn').addEventListener('click', openPublishModal);
  document.getElementById('closePublishModalBtn').addEventListener('click', closePublishModal);
  document.getElementById('startCommitBtn').addEventListener('click', startGitPublish);

  // 3. Маршрутизатор (Router)
  const handleRoute = async () => {
    const hash = window.location.hash;
    
    // Обновляем Git статус при каждом переходе
    updateGitStatus();

    if (!hash || hash === '#/') {
      // Режим списка
      document.getElementById('editView').style.display = 'none';
      document.getElementById('listView').style.display = 'block';
      loadEntries();
    } 
    else if (hash === '#/new') {
      // Режим создания нового поста
      ORIGINAL_SLUG = '';
      document.getElementById('listView').style.display = 'none';
      document.getElementById('editView').style.display = 'block';
      document.getElementById('formTitle').innerText = 'Создание нового ДНК-результата';
      
      // Заполняем пустые дефолтные значения (дата, шаблон и т.д.)
      populateForm({
        date: new Date().toISOString().split('T')[0],
        template: 'dna-result.html',
        draft: true,
        extra: {
          preview: {
            mode: 'auto'
          },
          details_y: {
            overview: `| Уровень | SNP | Описание |\n| ------------- | ---------------------------------------------- | ----------------- |\n| Основная | *снип* | Гаплогруппа *снип* |\n| Промежуточный | [*тут нужно вставить снип*](https://www.yfull.com/tree/*снип*/)  | Субклад *снип* |\n| Терминальный | [*тут нужно вставить снип*](https://www.yfull.com/tree/*снип*/) | Терминальный снип |\n\n{{ haplo_path }}`
          }
        }
      });
    } 
    else if (hash.startsWith('#/edit/')) {
      // Режим редактирования
      const slug = hash.replace('#/edit/', '');
      ORIGINAL_SLUG = slug;
      
      document.getElementById('listView').style.display = 'none';
      document.getElementById('editView').style.display = 'block';
      document.getElementById('formTitle').innerText = `Редактирование: ${slug}`;
      
      showToast('Загрузка данных поста...', 'info');
      try {
        const res = await fetch(`/api/entry/${slug}`);
        if (!res.ok) throw new Error('Не удалось загрузить данные поста');
        const data = await res.json();
        
        // Объединяем frontmatter и content если надо (content у нас обычно пустой)
        populateForm(data.frontmatter);
      } catch (error) {
        showToast(error.message, 'error');
        window.location.hash = '#/';
      }
    }
  };

  window.addEventListener('hashchange', handleRoute);
  // Первоначальный запуск роутера
  handleRoute();
}

// Запуск
document.addEventListener('DOMContentLoaded', initApp);
