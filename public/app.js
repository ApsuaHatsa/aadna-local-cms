/* =============================================================================
   🧬 AADNA Local - Client Side Application Logic
   ============================================================================= */


let CONFIG = null;
let CURRENT_ENTRY = null;
let ORIGINAL_SLUG = '';
let activePreviewSlug = '';
let COLLECTIONS = [];
let ACTIVE_COLLECTION = 'results';
let ACTIVE_COLLECTION_CONFIG = null;
let YAML_CONFIG_TEXT = '';
let allEntries = [];

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
// Рендеринг боковой панели (Sidebar)
// -----------------------------------------------------------------------------
function renderSidebar() {
  const nav = document.getElementById('collectionsNav');
  nav.innerHTML = '';
  
  COLLECTIONS.forEach(col => {
    const a = document.createElement('a');
    a.href = `#/collection/${col.name}`;
    a.className = `sidebar-nav-item ${ACTIVE_COLLECTION === col.name && window.location.hash !== '#/configuration' ? 'active' : ''}`;
    
    let icon = '📁';
    if (col.name === 'results') icon = '🧬';
    else if (col.name === 'articles') icon = '📝';
    else if (col.name === 'projects') icon = '💼';
    else if (col.name === 'pages') icon = '📄';

    a.innerHTML = `<span class="icon">${icon}</span><span class="label">${col.label}</span>`;
    nav.appendChild(a);
  });

  // Подсвечиваем Настройки CMS если мы там
  const navConfig = document.getElementById('navItemConfig');
  if (window.location.hash === '#/configuration') {
    navConfig.classList.add('active');
  } else {
    navConfig.classList.remove('active');
  }
}

// -----------------------------------------------------------------------------
// Загрузка списков и динамическая отрисовка таблицы
// -----------------------------------------------------------------------------
async function loadEntries() {
  const tableBody = document.getElementById('entriesTableBody');
  const fields = ACTIVE_COLLECTION_CONFIG?.view?.fields || ['title', 'date'];
  const colCount = fields.length + 2;
  tableBody.innerHTML = `<tr><td colspan="${colCount}" style="text-align: center; color: var(--color-muted);">Загрузка постов...</td></tr>`;
  
  try {
    const res = await fetch(`/api/collections/${ACTIVE_COLLECTION}/entries`);
    if (!res.ok) throw new Error('Не удалось загрузить список записей');
    allEntries = await res.json();
    renderEntriesTable(allEntries);
  } catch (error) {
    showToast(error.message, 'error');
    tableBody.innerHTML = `<tr><td colspan="${colCount}" style="text-align: center; color: var(--color-danger);">${error.message}</td></tr>`;
  }
}

function buildTableHeader() {
  const head = document.getElementById('entriesTableHead');
  const fields = ACTIVE_COLLECTION_CONFIG?.view?.fields || ['title', 'date'];
  
  const fieldLabels = {
    'title': 'Заголовок',
    'date': 'Дата',
    'extra.surname': 'Фамилия',
    'extra.result_type': 'Тип',
    'extra.y_haplogroup': 'Гаплогруппа',
    'extra.y_subclade': 'Субклад',
    'extra.settlement': 'Селение',
    'extra.subethnos': 'Субэтнос',
    'authors': 'Авторы',
    'path': 'Путь'
  };

  let html = '';
  fields.forEach(f => {
    const label = fieldLabels[f] || f.split('.').pop();
    html += `<th>${label}</th>`;
  });
  html += `<th>Статус</th>`;
  html += `<th style="text-align: right;">Действия</th>`;
  head.innerHTML = `<tr>${html}</tr>`;
}

function renderEntriesTable(entries) {
  const tableBody = document.getElementById('entriesTableBody');
  tableBody.innerHTML = '';
  
  const fields = ACTIVE_COLLECTION_CONFIG?.view?.fields || ['title', 'date'];
  const colCount = fields.length + 2;
  
  if (entries.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="${colCount}" style="text-align: center; color: var(--color-muted);">Записи не найдены</td></tr>`;
    return;
  }
  
  entries.forEach(entry => {
    const tr = document.createElement('tr');
    
    let cellsHtml = '';
    fields.forEach(f => {
      let val = getValueByPath(entry, f);
      if (Array.isArray(val)) {
        val = val.join(', ');
      }
      if (f === 'title' || f === 'extra.surname') {
        cellsHtml += `<td style="font-weight: 600; color: white;">${val || entry.slug}</td>`;
      } else if (f === 'extra.y_haplogroup') {
        cellsHtml += `<td><span style="font-weight: bold; color: var(--color-accent); font-family: monospace;">${val}</span></td>`;
      } else {
        cellsHtml += `<td>${val ?? ''}</td>`;
      }
    });

    const statusBadge = entry.draft 
      ? '<span class="badge-draft">Черновик</span>' 
      : '<span class="badge-published">Опубликован</span>';

    cellsHtml += `<td>${statusBadge}</td>`;

    cellsHtml += `
      <td style="text-align: right;">
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
          <button class="btn btn-sm edit-entry-btn" data-slug="${entry.slug}">Редактировать</button>
          <button class="btn btn-sm delete-entry-btn" data-slug="${entry.slug}" style="background: rgba(239,68,68,0.15); color: #EF4444; border: 1px solid rgba(239,68,68,0.3);" title="Удалить">🗑️</button>
        </div>
      </td>
    `;
    
    tr.innerHTML = cellsHtml;
    
    tr.querySelector('.edit-entry-btn').addEventListener('click', () => {
      window.location.hash = `#/collection/${ACTIVE_COLLECTION}/edit/${entry.slug}`;
    });

    tr.querySelector('.delete-entry-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Удалить запись "${entry.title || entry.slug}"? Это действие необратимо.`)) {
        try {
          const res = await fetch(`/api/collections/${ACTIVE_COLLECTION}/entry/${entry.slug}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Ошибка удаления');
          showToast(`Запись "${entry.title || entry.slug}" удалена`, 'success');
          loadEntries();
          updateGitStatus();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
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
  
  const filtered = allEntries.filter(entry => {
    const titleMatch = (entry.title || '').toLowerCase().includes(query);
    const surnameMatch = (entry.surname || '').toLowerCase().includes(query);
    const haploMatch = (entry.haplogroup || '').toLowerCase().includes(query);
    const subcladeMatch = (entry.subclade || '').toLowerCase().includes(query);
    return titleMatch || surnameMatch || haploMatch || subcladeMatch;
  });
  renderEntriesTable(filtered);
});

// -----------------------------------------------------------------------------
// Динамическая генерация HTML-форм
// -----------------------------------------------------------------------------
function buildFormHTML(fields, parentPath = '') {
  let html = '';
  
  fields.forEach(field => {
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
        <div class="panel collapsed" id="panel_${fieldPath.replace(/\./g, '_')}">
          <div class="panel-title" onclick="this.parentElement.classList.toggle('collapsed')">${field.label}</div>
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

    // 3. Специфический виджет родословной (только для pedigree в results)
    if (field.name === 'pedigree' && ACTIVE_COLLECTION === 'results') {
      html += `
        <div class="panel collapsed" id="panel_pedigree">
          <div class="panel-title" onclick="this.parentElement.classList.toggle('collapsed')">Родословная протестированного</div>
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
      const values = field.options?.values || [];
      if (field.options?.multiple) {
        inputControl = `
          <div class="checkbox-grid" data-field-path="${fieldPath}">
            ${values.map(val => {
              const label = typeof val === 'object' ? val.label : val;
              const value = typeof val === 'object' ? val.value : val;
              const domId = `chk_${fieldPath.replace(/\./g, '_')}_${String(value).replace(/[^a-zA-Z0-9]/g, '_')}`;
              return `
                <div class="checkbox-badge">
                  <input type="checkbox" id="${domId}" value="${value}">
                  <label for="${domId}">${label}</label>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else {
        inputControl = `
          <select data-field-path="${fieldPath}">
            <option value="">-- Выберите --</option>
            ${values.map(val => {
              const label = typeof val === 'object' ? val.label : val;
              const value = typeof val === 'object' ? val.value : val;
              return `<option value="${value}">${label}</option>`;
            }).join('')}
          </select>
        `;
      }
    } 
    else if (field.type === 'rich-text') {
      inputControl = `
        <div class="editor-container" style="padding: 0; border: none; background: transparent;">
          <div data-editor="toastui" data-field-path="${fieldPath}"></div>
        </div>
      `;
    }
    else if (field.type === 'text') {
      inputControl = `<textarea data-field-path="${fieldPath}" rows="5" style="width: 100%; min-height: 120px;" placeholder="Введите текст..."></textarea>`;
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
    else if (field.name === 'taxonomies' && ACTIVE_COLLECTION === 'results') {
      inputControl = `
        <div class="taxonomies-preview" id="taxonomiesPreview" style="display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 0.75rem; background: rgba(0, 0, 0, 0.25); border-radius: 6px; border: 1px solid var(--color-border); min-height: 40px; align-items: center;">
          <span style="color: var(--color-muted); font-size: 0.8rem;">Автоматические таксономии будут пересчитаны при сохранении</span>
        </div>
      `;
    }
    else if (field.type === 'date') {
      inputControl = `<input type="date" data-field-path="${fieldPath}">`;
    } 
    else if (field.type === 'number') {
      inputControl = `<input type="number" data-field-path="${fieldPath}">`;
    } 
    else if (field.list) {
      inputControl = `
        <div class="string-list-container" id="str_list_${fieldPath.replace(/\./g, '_')}" data-field-path="${fieldPath}">
          <div class="string-list-items"></div>
          <button type="button" class="btn btn-sm" style="margin-top: 0.5rem;" onclick="window.addStringListRow('${fieldPath}')">＋ Добавить значение</button>
        </div>
      `;
    }
    else {
      inputControl = `<input type="text" data-field-path="${fieldPath}">`;
    }

    const fullWidthClass = (field.type === 'rich-text' || field.type === 'text') ? 'full-width' : '';
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

function buildForm() {
  const container = document.getElementById('dynamicFormFields');
  if (ACTIVE_COLLECTION_CONFIG && ACTIVE_COLLECTION_CONFIG.fields) {
    container.innerHTML = buildFormHTML(ACTIVE_COLLECTION_CONFIG.fields);
    initializeFormEvents();
  }
}

// -----------------------------------------------------------------------------
// Инициализация событий формы
// -----------------------------------------------------------------------------
function initializeFormEvents() {
  // Навешиваем обработчики для загрузчиков картинок
  document.querySelectorAll('.uploader-area').forEach(area => {
    const fileInput = area.querySelector('input[type="file"]');
    const hiddenInput = area.querySelector('input[type="hidden"]');
    const previewDiv = area.querySelector('.uploader-preview');
    
    area.addEventListener('click', (e) => {
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

  // Навешиваем обработчики для кнопок "Добавить" в массивах объектов
  CONFIG?.content?.forEach(col => {
    if (col.name !== ACTIVE_COLLECTION) return;
    col.fields.forEach(field => {
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
  });

  // Авто-генерация URL слага из Заголовка
  const titleInput = document.querySelector('input[data-field-path="title"]');
  const pathInput = document.querySelector('input[data-field-path="path"]');
  
  if (titleInput && pathInput) {
    titleInput.addEventListener('blur', () => {
      if (!pathInput.value.trim() && titleInput.value.trim()) {
        const title = titleInput.value.trim();
        const rawSlug = title.toLowerCase()
          .replace(/[^а-яа-яёa-z0-9\s_-]/gi, '')
          .trim();
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
      }
    });
  }
}

// -----------------------------------------------------------------------------
// Изображения: Загрузка на сервер и превью
// -----------------------------------------------------------------------------
async function handleImageUpload(file, hiddenInput, previewDiv) {
  showToast(`Загрузка изображения ${file.name}...`, 'info');
  
  try {
    const pathInput = document.querySelector('input[data-field-path="path"]');
    const slug = pathInput ? pathInput.value.trim().replace(/^\/+/, '').replace(/\/+$/, '') : '';
    const collection = ACTIVE_COLLECTION;

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
    
    hiddenInput.value = result.url;
    hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
    
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
    e.stopPropagation();
    
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
      <span style="font-size: 0.75rem; color: var(--color-muted);">Изображение</span>
      <input type="file" accept="image/*" style="display: none;" id="file_input_${itemPath.replace(/\./g, '_')}">
      <input type="hidden" data-object-field-path="image" value="${data?.image || ''}">
      <div class="uploader-preview" id="preview_${itemPath.replace(/\./g, '_')}" style="display: none;"></div>
    </div>
    
    <!-- Текстовые поля -->
    <div class="item-fields">
      <div class="form-group">
        <label>Подпись под фото</label>
        <input type="text" data-object-field-path="caption" value="${data?.caption || ''}" placeholder="например: Изображение...">
      </div>
      <button type="button" class="remove-item-btn">Удалить элемент</button>
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
  });

  container.appendChild(row);
}

// -----------------------------------------------------------------------------
// Заполнение формы данными (Populate / Load)
// -----------------------------------------------------------------------------
function populateForm(data) {
  document.getElementById('resultForm').reset();
  
  document.querySelectorAll('.object-list-container').forEach(c => c.innerHTML = '');
  document.querySelectorAll('.string-list-container .string-list-items').forEach(c => c.innerHTML = '');
  document.querySelectorAll('.uploader-preview').forEach(p => {
    p.innerHTML = '';
    p.style.display = 'none';
  });

  CURRENT_ENTRY = data;

  // Заполняем поля по путям
  document.querySelectorAll('[data-field-path]').forEach(control => {
    const path = control.getAttribute('data-field-path');
    
    // Пропускаем вложенные списки
    if (path === 'extra.pedigree' && ACTIVE_COLLECTION === 'results') {
      const pedigreeVal = getValueByPath(data, 'extra.pedigree') || [];
      const pedigreeInputs = document.querySelectorAll('#pedigreeGrid input');
      pedigreeInputs.forEach((input, index) => {
        input.value = pedigreeVal[index] || '';
      });
      return;
    }

    let val = getValueByPath(data, path);
    if (val === undefined) return;

    if (control.type === 'date' && typeof val === 'string' && val.includes('T')) {
      val = val.split('T')[0];
    }

    if (control.tagName === 'SELECT') {
      if (control.multiple && Array.isArray(val)) {
        Array.from(control.options).forEach(opt => {
          opt.selected = val.includes(opt.value);
        });
      } else {
        control.value = val;
      }
    } 
    else if (control.classList.contains('checkbox-grid')) {
      const checkboxes = control.querySelectorAll('input[type="checkbox"]');
      const valArray = Array.isArray(val) ? val : [val];
      checkboxes.forEach(chk => {
        chk.checked = valArray.includes(chk.value);
      });
    }
    else if (control.type === 'checkbox') {
      control.checked = !!val;
    } 
    else if (control.type === 'hidden') {
      control.value = val;
      const previewDiv = control.parentElement.querySelector('.uploader-preview');
      renderImagePreview(val, previewDiv);
    }
    else {
      control.value = val;
    }
  });

  // Очистка старых инстансов редактора
  if (window.activeEditors) {
    Object.values(window.activeEditors).forEach(ed => {
      try { ed.destroy(); } catch(e){}
    });
  }
  window.activeEditors = {};

  // Инициализация Toast UI Editor
  document.querySelectorAll('[data-editor="toastui"]').forEach(container => {
    const path = container.getAttribute('data-field-path');
    const val = getValueByPath(data, path) || '';
    
    const editor = new toastui.Editor({
      el: container,
      initialEditType: 'wysiwyg',
      previewStyle: 'vertical',
      height: '500px',
      initialValue: val,
      theme: 'dark',
      language: 'ru-RU',
      hooks: {
        addImageBlobHook: async (blob, callback) => {
          showToast('Загрузка изображения...', 'info');
          try {
            const formData = new FormData();
            formData.append('image', blob);
            const pathInput = document.querySelector('input[data-field-path="path"]');
            const slug = pathInput ? pathInput.value.trim().replace(/^\/+/, '').replace(/\/+$/, '') : '';
            const uploadUrl = slug ? `/api/upload?slug=${encodeURIComponent(slug)}&collection=${ACTIVE_COLLECTION}` : `/api/upload?collection=${ACTIVE_COLLECTION}`;
            
            const response = await fetch(uploadUrl, { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`Ошибка HTTP: ${response.status}`);
            
            const result = await response.json();
            callback(result.url, blob.name || 'image');
            showToast('Изображение вставлено!', 'success');
          } catch (error) {
            console.error(error);
            showToast('Ошибка загрузки изображения', 'error');
            callback('', 'Ошибка загрузки');
          }
        }
      }
    });
    window.activeEditors[path] = editor;
  });

  // Заполняем списки строк
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

  // Заполняем списки объектов
  document.querySelectorAll('.object-list-container').forEach(container => {
    const path = container.getAttribute('data-field-path');
    const items = getValueByPath(data, path);
    if (Array.isArray(items)) {
      items.forEach(item => {
        addObjectListRow(path, item);
      });
    }
  });

  // Отображаем бейджи таксономий в превью (только для results)
  const taxPreview = document.getElementById('taxonomiesPreview');
  if (taxPreview && ACTIVE_COLLECTION === 'results') {
    taxPreview.innerHTML = '';
    let hasTax = false;
    
    const taxonomies = data.taxonomies || {};
    for (const [key, val] of Object.entries(taxonomies)) {
      const list = Array.isArray(val) ? val : [val];
      list.forEach(item => {
        hasTax = true;
        const badge = document.createElement('span');
        badge.style.fontSize = '0.75rem';
        badge.style.padding = '0.25rem 0.6rem';
        badge.style.borderRadius = '4px';
        badge.style.background = 'rgba(0, 229, 192, 0.1)';
        badge.style.color = '#00E5C0';
        badge.style.border = '1px solid rgba(0, 229, 192, 0.2)';
        badge.style.display = 'inline-flex';
        badge.style.alignItems = 'center';
        badge.style.fontWeight = '500';
        badge.innerText = `${key}: ${item}`;
        taxPreview.appendChild(badge);
      });
    }
    
    if (!hasTax) {
      taxPreview.innerHTML = '<span style="color: var(--color-muted); font-size: 0.8rem;">Автоматические таксономии будут сгенерированы при сохранении</span>';
    }
  }
}

// -----------------------------------------------------------------------------
// Сбор данных из формы (Serialize / Save)
// -----------------------------------------------------------------------------
function serializeForm() {
  const result = {};

  // 1. Собираем стандартные плоские поля
  document.querySelectorAll('[data-field-path]').forEach(control => {
    const path = control.getAttribute('data-field-path');
    if (path === 'extra.pedigree') return;
    if (control.classList.contains('string-list-container')) return;

    let val = undefined;
    if (control.getAttribute('data-editor') === 'toastui') {
      val = window.activeEditors && window.activeEditors[path] ? window.activeEditors[path].getMarkdown() : '';
    }
    else if (control.tagName === 'SELECT') {
      if (control.multiple) {
        val = Array.from(control.selectedOptions).map(opt => opt.value);
      } else {
        val = control.value;
      }
    } 
    else if (control.classList.contains('checkbox-grid')) {
      const checked = Array.from(control.querySelectorAll('input[type="checkbox"]:checked')).map(chk => chk.value);
      val = checked;
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

  // 2. Собираем pedigree (только для results)
  const pedigreeGrid = document.getElementById('pedigreeGrid');
  if (pedigreeGrid && ACTIVE_COLLECTION === 'results') {
    const path = pedigreeGrid.getAttribute('data-field-path');
    const inputs = pedigreeGrid.querySelectorAll('input');
    const values = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
    if (values.length > 0) {
      setValueByPath(result, path, values);
    }
  }

  // 3. Собираем списки строк
  document.querySelectorAll('.string-list-container').forEach(container => {
    const path = container.getAttribute('data-field-path');
    const inputs = container.querySelectorAll('input');
    const values = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
    if (values.length > 0) {
      setValueByPath(result, path, values);
    }
  });

  // 4. Собираем списки объектов
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
async function saveEntry(actionType = 'draft') {
  const data = serializeForm();
  
  if (!data.title) {
    showToast('Заголовок обязателен для заполнения!', 'error');
    return null;
  }

  const isPreview = actionType === 'preview';
  showToast(isPreview ? 'Генерация временного предпросмотра...' : 'Сохранение файла на диск (Генерация древа YTree может занять до 15 сек)...', 'info');

  try {
    const response = await fetch(`/api/collections/${ACTIVE_COLLECTION}/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalSlug: ORIGINAL_SLUG,
        data: data,
        isPreview: isPreview
      })
    });

    if (!response.ok) {
      throw new Error(`Ошибка сохранения: HTTP ${response.status}`);
    }

    const result = await response.json();
    
    if (isPreview) {
      showToast('Предпросмотр сгенерирован!', 'success');
    } else {
      showToast('Запись успешно сохранена!', 'success');
    }
    
    if (!isPreview) {
      await updateGitStatus();
    }
    
    if (actionType === 'publish') {
      openPublishModal();
    } else if (actionType === 'draft') {
      window.location.hash = `#/collection/${ACTIVE_COLLECTION}`;
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
function generateCommitMessage(status) {
  if (!status.success || !status.files || status.files.length === 0) {
    return '';
  }

  const resultFiles = status.files.filter(f => f.file.startsWith('content/'));
  if (resultFiles.length === 1) {
    const file = resultFiles[0];
    const filename = file.file.split('/').pop().replace(/\.md$/, '');
    const name = filename.split('_')[0];

    if (file.status === 'A' || file.status === '??') {
      return `add: ${name}`.substring(0, 30);
    } else if (file.status === 'M') {
      return `update: ${name}`.substring(0, 30);
    } else if (file.status === 'D') {
      return `remove: ${name}`.substring(0, 30);
    }
  } else if (resultFiles.length > 1) {
    return 'update: website content';
  }

  const mediaFiles = status.files.filter(f => f.file.startsWith('static/'));
  if (mediaFiles.length > 0) {
    return 'update: media assets';
  }

  return 'update: website';
}

async function openPublishModal() {
  const modal = document.getElementById('publishModal');
  const summary = document.getElementById('gitStatusSummary');
  const commitInput = document.getElementById('commitMessageInput');
  const consoleLog = document.getElementById('modalConsole');
  const filesList = document.getElementById('gitFilesList');
  const diffContainer = document.getElementById('gitDiffContainer');
  const diffContent = document.getElementById('gitDiffContent');
  
  commitInput.value = '';
  consoleLog.style.display = 'none';
  consoleLog.innerText = '';
  filesList.innerHTML = '';
  filesList.style.display = 'none';
  diffContainer.style.display = 'none';
  diffContent.innerHTML = '';
  
  try {
    const res = await fetch('/api/git-status');
    const status = await res.json();
    
    if (status.success) {
      summary.innerText = `Изменено файлов: ${status.totalChanges} (${status.modified} изм., ${status.added + status.untracked} доб., ${status.deleted} уд.)`;
      commitInput.placeholder = `например: add new post`;
      commitInput.value = generateCommitMessage(status);
      
      if (status.files && status.files.length > 0) {
        filesList.style.display = 'block';
        status.files.forEach(f => {
          let color = 'var(--color-muted)';
          let statusChar = f.status;
          
          if (f.status === 'M') {
            color = '#6366F1';
            statusChar = 'Изм.';
          } else if (f.status === 'A' || f.status === '??') {
            color = 'var(--color-accent)';
            statusChar = 'Нов.';
          } else if (f.status === 'D') {
            color = 'var(--color-danger)';
            statusChar = 'Удл.';
          }
          
          const item = document.createElement('div');
          item.style.color = color;
          item.style.marginBottom = '0.25rem';
          item.style.display = 'flex';
          item.style.justifyContent = 'space-between';
          
          item.innerHTML = `
            <span>${f.file}</span>
            <span style="font-weight: bold; font-size: 0.75rem;">[${statusChar}]</span>
          `;
          filesList.appendChild(item);
        });

        try {
          const diffRes = await fetch('/api/git-diff');
          const diffData = await diffRes.json();
          if (diffData.success && diffData.diff) {
            renderDiffText(diffData.diff);
          }
        } catch (err) {
          console.error('Ошибка загрузки diff:', err);
        }
      }
    }
  } catch (e) {
    summary.innerText = 'Не удалось загрузить статус Git';
  }
  
  modal.classList.add('active');
}

function renderDiffText(diffText) {
  const diffContent = document.getElementById('gitDiffContent');
  const diffContainer = document.getElementById('gitDiffContainer');
  
  if (!diffText || diffText.trim() === '') {
    diffContent.innerHTML = '<span style="color: var(--color-muted);">Нет изменений в файлах.</span>';
    diffContainer.style.display = 'block';
    return;
  }
  
  const lines = diffText.split('\n');
  const htmlLines = lines.map(line => {
    const safeLine = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
      
    if (safeLine.startsWith('+') && !safeLine.startsWith('+++')) {
      return `<span style="color: #10B981;">${safeLine}</span>`;
    } else if (safeLine.startsWith('-') && !safeLine.startsWith('---')) {
      return `<span style="color: #EF4444;">${safeLine}</span>`;
    } else if (safeLine.startsWith('@@')) {
      return `<span style="color: #6366F1;">${safeLine}</span>`;
    } else if (safeLine.startsWith('diff ') || safeLine.startsWith('index ')) {
      return `<span style="color: #FFF; font-weight: bold;">${safeLine}</span>`;
    }
    return safeLine;
  });
  
  diffContent.innerHTML = htmlLines.join('\n');
  diffContainer.style.display = 'block';
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
      
      setTimeout(() => {
        closePublishModal();
        window.location.hash = `#/collection/${ACTIVE_COLLECTION}`;
      }, 2000);
    } else {
      consoleLog.innerText += 'ОШИБКА:\n' + result.stderr;
      showToast('Ошибка коммита в Git', 'error');
    }
  } catch (error) {
    consoleLog.innerText += 'Ошибка API:\n' + error.message;
    showToast(error.message, 'error');
  }
}

// -----------------------------------------------------------------------------
// Рендеринг панели настроек конфигурации .pages.yml
// -----------------------------------------------------------------------------
function renderConfigPanel() {
  const listDiv = document.getElementById('configCollectionsList');
  listDiv.innerHTML = '';
  
  CONFIG.content.forEach(col => {
    const item = document.createElement('div');
    item.className = 'config-collection-item';
    item.innerHTML = `
      <span class="title">${col.label} (${col.name})</span>
      <span class="path">Папка: ${col.path}</span>
    `;
    listDiv.appendChild(item);
  });

  const yamlInput = document.getElementById('configYamlInput');
  yamlInput.value = YAML_CONFIG_TEXT;

  const badge = document.getElementById('yamlValidationBadge');
  badge.className = 'yaml-validation-badge badge-valid';
  badge.innerText = 'Синтаксис верен';
}

// -----------------------------------------------------------------------------
// Инициализация SPA и маршрутизатора
// -----------------------------------------------------------------------------
async function initApp() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Не удалось получить конфигурацию полей');
    const data = await res.json();
    
    CONFIG = data.config;
    YAML_CONFIG_TEXT = data.raw;
    COLLECTIONS = CONFIG.content || [];
    
    renderSidebar();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
    return;
  }

  // Настраиваем кнопки
  document.getElementById('createNewBtn').addEventListener('click', () => {
    window.location.hash = `#/collection/${ACTIVE_COLLECTION}/new`;
  });
  
  document.getElementById('backToListBtn').addEventListener('click', () => {
    window.location.hash = `#/collection/${ACTIVE_COLLECTION}`;
  });

  document.getElementById('saveDraftBtn').addEventListener('click', () => saveEntry('draft'));
  document.getElementById('saveAndPublishBtn').addEventListener('click', () => saveEntry('publish'));
  
  document.getElementById('previewBtn').addEventListener('click', async () => {
    // Открываем вкладку сразу (синхронно), чтобы обойти блокировщик всплывающих окон
    const previewWindow = window.open('about:blank', '_blank');
    if (previewWindow) {
      previewWindow.document.write('<html><head><title>Генерация предпросмотра...</title></head><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#e2e8f0;margin:0;"><div style="text-align:center;"><div style="font-size:24px;font-weight:bold;margin-bottom:10px;">Генерация предпросмотра...</div><div style="opacity:0.6;">Пожалуйста, подождите. Страница загрузится автоматически.</div></div></body></html>');
    }

    const previewSlug = await saveEntry('preview');
    if (previewSlug) {
      const cleanSlug = previewSlug.replace('.cms-tmp-preview', '');
      activePreviewSlug = cleanSlug;
      const pathInput = document.querySelector('input[data-field-path="path"]');
      const basePath = pathInput ? pathInput.value.trim().replace(/^\/+/, '').replace(/\/+$/, '') : cleanSlug;
      
      // Задержка 2 сек, чтобы Zola успел пересобрать страницу
      setTimeout(() => {
        if (previewWindow) {
          previewWindow.location.href = `http://localhost:1111/${basePath}-preview/`;
        } else {
          window.open(`http://localhost:1111/${basePath}-preview/`, '_blank');
        }
      }, 2000);
    } else {
      if (previewWindow) {
        previewWindow.close();
      }
    }
  });

  document.getElementById('revertEntryBtn').addEventListener('click', async () => {
    if (!ORIGINAL_SLUG) return;
    
    if (confirm('Вы действительно хотите отменить все локальные изменения этой записи и вернуть ее к исходному состоянию из Git?')) {
      showToast('Откат изменений...', 'info');
      try {
        const res = await fetch(`/api/collections/${ACTIVE_COLLECTION}/entry/${ORIGINAL_SLUG}/revert`, { method: 'POST' });
        if (!res.ok) throw new Error('Не удалось откатить изменения');
        showToast('Изменения успешно отменены!', 'success');
        window.location.hash = `#/collection/${ACTIVE_COLLECTION}`;
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  document.getElementById('deleteEntryBtn').addEventListener('click', async () => {
    if (!ORIGINAL_SLUG) return;

    if (confirm('Вы уверены, что хотите навсегда удалить эту запись, всю связанную с ней медиа-папку и изображения превью?')) {
      showToast('Удаление поста...', 'info');
      try {
        const res = await fetch(`/api/collections/${ACTIVE_COLLECTION}/entry/${ORIGINAL_SLUG}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Не удалось удалить запись');
        showToast('Запись успешно удалена!', 'success');
        window.location.hash = `#/collection/${ACTIVE_COLLECTION}`;
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  document.getElementById('saveConfigBtn').addEventListener('click', async () => {
    const yamlText = document.getElementById('configYamlInput').value;
    const badge = document.getElementById('yamlValidationBadge');
    
    showToast('Сохранение конфигурации...', 'info');
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: yamlText })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Ошибка сохранения конфигурации');
      }

      showToast('Настройки CMS успешно сохранены!', 'success');
      badge.className = 'yaml-validation-badge badge-valid';
      badge.innerText = 'Синтаксис верен';

      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
      badge.className = 'yaml-validation-badge badge-invalid';
      badge.innerText = 'Синтаксическая ошибка';
    }
  });
  
  document.getElementById('gitStatusBar').addEventListener('click', openPublishModal);
  document.getElementById('closePublishModalBtn').addEventListener('click', closePublishModal);
  document.getElementById('startCommitBtn').addEventListener('click', startGitPublish);
  
  document.getElementById('toggleDiffBtn').addEventListener('click', () => {
    const diffContent = document.getElementById('gitDiffContent');
    const toggleBtn = document.getElementById('toggleDiffBtn');
    if (diffContent.style.display === 'none') {
      diffContent.style.display = 'block';
      toggleBtn.innerText = 'Свернуть';
    } else {
      diffContent.style.display = 'none';
      toggleBtn.innerText = 'Развернуть';
    }
  });

  // 3. Маршрутизатор (Router)
  const handleRoute = async () => {
    const hash = window.location.hash;
    
    // Чистим временные файлы предпросмотра при уходе со страницы
    if (activePreviewSlug && !hash.includes(activePreviewSlug) && !hash.includes('/new') && !hash.includes('/edit/')) {
      fetch(`/api/collections/${ACTIVE_COLLECTION}/entry/${activePreviewSlug}/clear-preview`, { method: 'POST' }).catch(() => {});
      activePreviewSlug = '';
    }
    
    updateGitStatus();

    // Скрываем все экраны
    document.getElementById('listView').style.display = 'none';
    document.getElementById('editView').style.display = 'none';
    document.getElementById('configView').style.display = 'none';

    if (hash === '#/configuration') {
      document.getElementById('configView').style.display = 'block';
      renderSidebar();
      renderConfigPanel();
    }
    else if (hash.startsWith('#/collection/')) {
      const parts = hash.split('/');
      const collectionName = parts[2];
      
      ACTIVE_COLLECTION = collectionName;
      ACTIVE_COLLECTION_CONFIG = CONFIG.content.find(c => c.name === collectionName);
      
      if (!ACTIVE_COLLECTION_CONFIG) {
        window.location.hash = '#/';
        return;
      }
      
      renderSidebar();

      if (parts[3] === 'new') {
        ORIGINAL_SLUG = '';
        buildForm();
        document.getElementById('editView').style.display = 'block';
        document.getElementById('revertEntryBtn').style.display = 'none';
        document.getElementById('deleteEntryBtn').style.display = 'none';
        document.getElementById('formTitle').innerText = `Новая запись: ${ACTIVE_COLLECTION_CONFIG.label}`;
        
        // Заполняем дефолтные значения
        const defaults = {
          date: new Date().toISOString().split('T')[0],
          draft: true
        };
        
        if (ACTIVE_COLLECTION === 'results') {
          defaults.template = 'dna-result.html';
          defaults.extra = {
            preview: { mode: 'auto' },
            details_y: {
              overview: `| Уровень | SNP | Описание |\n| ------------- | ---------------------------------------------- | ----------------- |\n| Основная | *снип* | Гаплогруппа *снип* |\n| Промежуточный | [*тут нужно вставить снип*](https://www.yfull.com/tree/*снип*/)  | Субклад *снип* |\n| Терминальный | [*тут нужно вставить снип*](https://www.yfull.com/tree/*снип*/) | Терминальный снип |\n\n{{ haplo_path }}`
            }
          };
        } else if (ACTIVE_COLLECTION === 'articles') {
          defaults.template = 'article.html';
        } else if (ACTIVE_COLLECTION === 'projects' || ACTIVE_COLLECTION === 'pages') {
          defaults.template = 'page.html';
        }

        populateForm(defaults);
      }
      else if (parts[3] === 'edit') {
        const slug = parts.slice(4).join('/');
        ORIGINAL_SLUG = slug;
        buildForm();
        
        document.getElementById('editView').style.display = 'block';
        document.getElementById('revertEntryBtn').style.display = 'inline-flex';
        document.getElementById('deleteEntryBtn').style.display = 'inline-flex';
        document.getElementById('formTitle').innerText = `Редактирование: ${slug}`;
        
        showToast('Загрузка данных записи...', 'info');
        try {
          const res = await fetch(`/api/collections/${ACTIVE_COLLECTION}/entry/${slug}`);
          if (!res.ok) throw new Error('Не удалось загрузить данные записи');
          const data = await res.json();
          
          const formData = { ...data.frontmatter };
          if (data.content) {
            formData.body = data.content;
          }
          populateForm(formData);
        } catch (error) {
          showToast(error.message, 'error');
          window.location.hash = `#/collection/${ACTIVE_COLLECTION}`;
        }
      }
      else {
        buildTableHeader();
        document.getElementById('listView').style.display = 'block';
        document.getElementById('listTitle').innerText = ACTIVE_COLLECTION_CONFIG.label;
        loadEntries();
      }
    }
    else {
      const defaultCol = CONFIG.content?.[0]?.name || 'results';
      window.location.hash = `#/collection/${defaultCol}`;
    }
  };

  window.addEventListener('hashchange', handleRoute);
  
  window.addEventListener('beforeunload', () => {
    if (activePreviewSlug) {
      navigator.sendBeacon(`/api/collections/${ACTIVE_COLLECTION}/entry/${activePreviewSlug}/clear-preview`);
    }
  });

  handleRoute();
}

// Запуск
document.addEventListener('DOMContentLoaded', initApp);
