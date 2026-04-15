// Block editor panel — returns HTML string for editing each block type

const API_BASE = import.meta.env.VITE_API_URL || ''

const CARD_BORDERS = [
  { label: 'None',      value: '' },
  { label: 'Hot Pink',  value: '#FF0077' },
  { label: 'Black',     value: '#000000' },
  { label: 'Blue',      value: '#007CB6' },
  { label: 'Violet',    value: '#5461C8' },
  { label: 'Teal',      value: '#008291' },
  { label: 'Grey',      value: '#CED9EB' },
]

const CARD_BACKGROUNDS = [
  { label: 'White',      value: '#FFFFFF' },
  { label: 'Pink light', value: '#FFE8EE' },
  { label: 'Surface',    value: '#F7FAFF' },
  { label: 'Dark',       value: '#101720' },
]

export function cardSectionHTML(block) {
  return `
    <div class="card-section">
      <div class="card-section-header">Card / frame</div>
      <div class="form-row" style="flex-direction:row;align-items:center;gap:8px;margin-bottom:2px">
        <input type="checkbox" data-field="card" ${block.card ? 'checked' : ''} id="card-chk" />
        <label for="card-chk" class="field-label" style="margin:0;cursor:pointer">Enable card frame</label>
      </div>
      ${block.card ? `
        <div class="form-row" style="margin-top:8px">
          ${label('Border colour')}
          <div class="color-chips">
            ${CARD_BORDERS.map(c => c.value === ''
              ? `<button class="color-chip color-chip--none${block.card_border === '' ? ' active' : ''}" data-card-border="" title="None"></button>`
              : `<button class="color-chip${block.card_border === c.value ? ' active' : ''}" data-card-border="${c.value}" title="${c.label}" style="--chip-color:${c.value}"></button>`
            ).join('')}
          </div>
        </div>
        <div class="form-row" style="margin-top:6px">
          ${label('Background')}
          <div class="color-chips">
            ${CARD_BACKGROUNDS.map(c => `<button class="color-chip${block.card_bg === c.value ? ' active' : ''}" data-card-bg="${c.value}" title="${c.label}" style="--chip-color:${c.value}"></button>`).join('')}
          </div>
        </div>
      ` : ''}
    </div>`
}

function input(field, value, placeholder = '', type = 'text') {
  return `<input class="field-input" data-field="${field}" type="${type}"
    value="${esc(String(value ?? ''))}" placeholder="${placeholder}" />`
}

function textarea(field, value, placeholder = '', rows = 3) {
  return `<textarea class="field-textarea" data-field="${field}"
    rows="${rows}" placeholder="${placeholder}">${esc(String(value ?? ''))}</textarea>`
}

// Rich contenteditable — supports bold + colour formatting
function richarea(attrs, content, placeholder, rows = 3) {
  return `<div class="field-richarea" contenteditable="true" data-rich="true"
    ${attrs} style="min-height:${rows * 22}px" data-placeholder="${placeholder}">${content || ''}</div>`
}

function label(text) {
  return `<span class="field-label">${text}</span>`
}

const _SEG_STYLE_LABELS = { h1: 'H1', h2: 'H2', h3: 'H3', body: 'Body', small: 'Small' }
function _segHTML(seg, idx, col) {
  const colAttr = col ? ` data-col="${col}"` : ''
  return `<div class="text-seg">
    <div class="seg-style-row">
      ${Object.keys(_SEG_STYLE_LABELS).map(s =>
        `<button class="seg-style-btn${seg.style === s ? ' active' : ''}" data-seg-idx="${idx}"${colAttr} data-seg-style="${s}">${_SEG_STYLE_LABELS[s]}</button>`
      ).join('')}
      <button class="seg-del-btn icon-btn danger" data-seg-idx="${idx}"${colAttr} title="Remove">×</button>
    </div>
    <textarea class="field-textarea seg-text" data-seg-idx="${idx}"${colAttr}
      rows="2" placeholder="${['h1','h2','h3'].includes(seg.style) ? 'Heading...' : 'Body copy...'}">${esc(seg.text || '')}</textarea>
  </div>`
}

// Slider + ▲▼ fine-step buttons (1% increments)
function rangeRow(lbl, field, min, max, value) {
  const pct = Math.round(value * 100)
  return `
    <div class="form-row" style="margin-top:10px">
      ${label(lbl)}
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
        <input type="range" class="field-range" data-field="${field}"
          min="${min}" max="${max}" step="0.05"
          value="${value}" style="flex:1" />
        <div style="display:flex;align-items:center;gap:3px">
          <span class="range-val" style="font-size:11px;font-weight:600;min-width:34px;text-align:right">${pct}%</span>
          <div style="display:flex;flex-direction:column;gap:1px">
            <button class="range-step-btn" data-step-field="${field}" data-delta="0.01" data-min="${min}" data-max="${max}"
              style="width:16px;height:12px;padding:0;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#DFE7F5;font-size:8px;line-height:1;cursor:pointer;border-radius:2px 2px 0 0;display:flex;align-items:center;justify-content:center">▲</button>
            <button class="range-step-btn" data-step-field="${field}" data-delta="-0.01" data-min="${min}" data-max="${max}"
              style="width:16px;height:12px;padding:0;border:1px solid rgba(255,255,255,.15);border-top:none;background:rgba(255,255,255,.07);color:#DFE7F5;font-size:8px;line-height:1;cursor:pointer;border-radius:0 0 2px 2px;display:flex;align-items:center;justify-content:center">▼</button>
          </div>
        </div>
      </div>
    </div>`
}

function row(lbl, control) {
  return `<div class="form-row">${label(lbl)}${control}</div>`
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
         .replace(/"/g,'&quot;')
}

export function BlockEditor(block) {
  switch (block.type) {
    case 'cover':
      return `<div class="block-editor">
        <h3>Cover page</h3>
        ${row('Title', textarea('title', block.title, 'Report title', 2))}
        ${row('Subtitle', textarea('subtitle', block.subtitle, 'Subtitle or description', 2))}
        ${row('Author', input('author', block.author, 'Author name'))}
        ${row('Date', input('date', block.date, 'e.g. March 2026'))}
        ${row('Category badge', input('category', block.category, 'e.g. Quarterly Report'))}
      </div>`

    case 'section-page':
      return `<div class="block-editor">
        <h3>Section page</h3>
        ${row('Title', textarea('title', block.title, 'Section title', 2))}
        ${row('Description', textarea('description', block.description, 'Brief description', 2))}
      </div>`

    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
      return `<div class="block-editor">
        <h3>Heading ${block.type.slice(1)}</h3>
        ${row('Text', input('text', block.text, 'Heading text'))}
      </div>`

    case 'body':
      return `<div class="block-editor">
        <h3>Body text</h3>
        ${row('Content', textarea('text', block.text, 'Body copy', 5))}
        <div class="form-row">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" data-field="muted" ${block.muted ? 'checked' : ''} />
            <span class="field-label" style="margin:0">Muted (secondary text colour)</span>
          </label>
        </div>
      </div>`

    case 'text-1col': {
      const segs = block.segments || []
      return `<div class="block-editor">
        <h3>1 Column Text</h3>
        <div class="text-segs">
          ${segs.map((seg, i) => _segHTML(seg, i, '')).join('')}
        </div>
        <button class="add-item-btn" data-add-seg="segments" style="margin-top:8px;width:100%">+ Add paragraph</button>
      </div>`
    }

    case 'text-2col': {
      const left  = block.left  || []
      const right = block.right || []
      return `<div class="block-editor">
        <h3>2 Column Text</h3>
        <div class="tc-col-label">Left column</div>
        <div class="text-segs">
          ${left.map((seg, i) => _segHTML(seg, i, 'left')).join('')}
        </div>
        <button class="add-item-btn" data-add-seg="left" style="margin-top:6px;width:100%">+ Add paragraph</button>
        <div class="tc-col-label" style="margin-top:14px">Right column</div>
        <div class="text-segs">
          ${right.map((seg, i) => _segHTML(seg, i, 'right')).join('')}
        </div>
        <button class="add-item-btn" data-add-seg="right" style="margin-top:6px;width:100%">+ Add paragraph</button>
      </div>`
    }

    case 'small':
      return `<div class="block-editor">
        <h3>Small text</h3>
        ${row('Content', textarea('text', block.text, 'Small supporting text', 3))}
      </div>`

    case 'bullets':
    case 'numbered':
      return `<div class="block-editor">
        <h3>${block.type === 'bullets' ? 'Bullet list' : 'Numbered list'}</h3>
        <div class="stats-items" id="list-items">
          ${(block.items || []).map((item, i) => `
            <div style="display:flex;gap:6px;align-items:center">
              <span style="font-size:11px;color:#ABB8CF;width:16px;text-align:right;flex-shrink:0">
                ${block.type === 'bullets' ? '•' : `${i+1}.`}
              </span>
              <input class="field-input" data-list-item="${i}" value="${esc(item)}"
                style="flex:1" />
              <button class="icon-btn danger" data-remove-list="${i}">✕</button>
            </div>
          `).join('')}
        </div>
        <button class="add-item-btn" id="add-list-item">+ Add item</button>
      </div>`

    case 'abx-header':
      return `<div class="block-editor">
        <h3>Hero</h3>
        ${row('Title', textarea('title', block.title, 'Large bold report title', 2))}
        ${row('Descriptor (in pink band)', textarea('descriptor', block.descriptor, 'Brief description shown in the pink band', 3))}
        <div class="form-row">
          ${label('Illustration (right column)')}
          <div class="img-picker-slot" data-selected="${esc(block.image || '')}" data-selected-name="${esc(block.image_name || '')}">
            <div class="img-picker-current">
              ${block.image
                ? `<img class="img-picker-preview" src="${esc(block.image)}" alt="" />`
                : `<img class="img-picker-preview" src="" alt="" style="display:none" />`}
              <span class="img-picker-label">${block.image_name ? esc(block.image_name) : (block.image ? 'Image selected' : 'No image selected')}</span>
            </div>
            <button class="btn btn-ghost img-picker-open-btn" style="width:100%;justify-content:center;margin-top:6px">
              ${block.image ? 'Change image →' : 'Add image →'}
            </button>
          </div>
        </div>
        ${rangeRow('Image size', 'image_scale', 0.5, 2,   block.image_scale || 1)}
        ${rangeRow('Text wrap',  'image_wrap',  0.3, 1.3, block.image_wrap  ?? 0.9)}
      </div>`

    case 'infographic-hero':
      return `<div class="block-editor">
        <h3>Infographic Hero</h3>
        ${row('Accent line (pink italic)', input('accent', block.accent || '', 'e.g. Order up!'))}
        ${row('Main title', textarea('title', block.title || '', 'e.g. Global fast\nfood trends', 3))}
        <div class="form-row">
          ${label('Illustration (right side)')}
          <div class="img-picker-slot" data-selected="${esc(block.image || '')}" data-selected-name="${esc(block.image_name || '')}">
            <div class="img-picker-current">
              ${block.image
                ? `<img class="img-picker-preview" src="${esc(block.image)}" alt="" />`
                : `<img class="img-picker-preview" src="" alt="" style="display:none" />`}
              <span class="img-picker-label">${block.image_name ? esc(block.image_name) : (block.image ? 'Image selected' : 'No image selected')}</span>
            </div>
            <button class="btn btn-ghost img-picker-open-btn" style="width:100%;justify-content:center;margin-top:6px">
              ${block.image ? 'Change image →' : 'Add image →'}
            </button>
          </div>
        </div>
        ${rangeRow('Image size', 'image_scale', 0.5, 2,   block.image_scale || 1)}
        ${rangeRow('Text wrap',  'image_wrap',  0.3, 1.3, block.image_wrap  ?? 0.9)}
      </div>`

    case 'ig-stats': {
      const items = block.items || []
      return `<div class="block-editor">
        <h3>IG Stats Grid</h3>

        <div class="form-row" style="flex-direction:row;align-items:center;gap:8px;margin-bottom:12px">
          ${label('Columns')}
          <div class="style-chips" style="flex-direction:row;gap:6px">
            <button class="style-chip${(block.columns||3) === 2 ? ' active' : ''}" data-field="columns" data-val="2" style="min-width:48px">2</button>
            <button class="style-chip${(block.columns||3) === 3 ? ' active' : ''}" data-field="columns" data-val="3" style="min-width:48px">3</button>
          </div>
        </div>

        <div class="ig-stat-items">
          ${items.map((item, i) => `
            <div class="sc-item">
              <div class="sc-item-header">
                <span class="sc-item-num">Stat ${i + 1}</span>
                <button class="sc-item-remove" data-ig-remove="${i}" title="Remove">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>

              <div class="form-row" style="margin-bottom:6px">
                ${label('Type')}
                <div class="vt-toggle">
                  <button class="vt-btn${item.stat_type !== 'eyebrow' ? ' active' : ''}" data-ig-type="simple" data-ig-idx="${i}">Simple</button>
                  <button class="vt-btn${item.stat_type === 'eyebrow' ? ' active' : ''}" data-ig-type="eyebrow" data-ig-idx="${i}">Eyebrow</button>
                </div>
              </div>

              ${item.stat_type === 'eyebrow' ? `
                <div class="form-row">
                  ${label('Eyebrow')}
                  <input class="field-input" data-ig-field="eyebrow" data-ig-idx="${i}"
                    value="${esc(item.eyebrow||'')}" placeholder="e.g. Nearly" />
                </div>
              ` : ''}
              <div class="stat-value-block">
                <div class="stat-value-block-inner">
                  <div class="form-row" style="flex:1">
                    ${label('Value')}
                    <input class="field-input" data-ig-field="value" data-ig-idx="${i}"
                      value="${esc(item.value||'')}" placeholder="34" />
                  </div>
                  <div class="stat-value-divider"></div>
                  <div class="form-row" style="width:52px;flex-shrink:0">
                    ${label('Unit')}
                    <input class="field-input" data-ig-field="unit" data-ig-idx="${i}"
                      value="${esc(item.unit||'')}" placeholder="%" />
                  </div>
                </div>
              </div>
              <div class="form-row" style="margin-top:4px">
                ${label('Description')}
                ${richarea(`data-ig-field="description" data-ig-idx="${i}"`, item.description||'', 'Description text…', 2)}
              </div>
            </div>
          `).join('')}
        </div>
        <button class="add-btn" id="ig-add-stat" style="margin-top:8px">+ Add stat</button>
      </div>`
    }

    case 'stats':
      return `<div class="block-editor">
        <h3>Rows</h3>

        <div class="form-row-2">
          <div class="form-row">
            ${label('Section number')}
            <input class="field-input" data-field="section_num"
              value="${esc(block.section_num||'')}" placeholder="e.g. 01" />
          </div>
          <div class="form-row">
            ${label('Columns')}
            <div class="col-pick-row">
              <button class="col-pick-btn${block.columns !== 2 ? ' active' : ''}" data-col-pick="1">1</button>
              <button class="col-pick-btn${block.columns === 2 ? ' active' : ''}" data-col-pick="2">2</button>
            </div>
          </div>
        </div>

        ${row('Section title', input('section_title', block.section_title||'', 'Bold section heading'))}

        <div class="form-row" style="margin-top:4px">
          ${label(block.columns === 2 ? 'Stats (2 max)' : 'Stat')}
          <div class="stats-items text-segs">
            ${(block.items || []).map((s, i) => `
              <div class="stat-item text-seg">
                <div class="seg-style-row">
                  <span class="tc-col-label">Stat ${i + 1}</span>
                  <button class="seg-del-btn icon-btn danger" data-remove-stat="${i}" title="Remove">×</button>
                </div>
                <div class="stat-item-body">
                  <div class="stat-value-unit-card">
                    <div class="stat-vu-cell">
                      <span class="stat-vu-label">Value</span>
                      <input class="stat-vu-input" data-stat-idx="${i}" data-stat-field="value"
                        value="${esc(s.value||'')}" placeholder="68" />
                    </div>
                    <div class="stat-vu-divider"></div>
                    <div class="stat-vu-cell">
                      <span class="stat-vu-label">Unit</span>
                      <input class="stat-vu-input" data-stat-idx="${i}" data-stat-field="unit"
                        value="${esc(s.unit||'')}" placeholder="%" />
                    </div>
                  </div>
                  <div class="stat-desc-section">
                    <div class="stat-desc-label">Description</div>
                    ${richarea(`data-stat-idx="${i}" data-stat-field="description"`, s.description||'', 'Lorem ipsum dolor sit amet...', 3)}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
          <button class="add-btn" id="add-stat" style="margin-top:6px">+ Add stat</button>
        </div>

        <div class="form-row">
          ${label('Body copy (optional)')}
          ${richarea('data-field="body"', block.body||'', 'Additional context below the stat...', 3)}
        </div>
      </div>`

    case 'table': {
      const headers = block.headers || []
      const rows    = block.rows    || []
      return `<div class="block-editor">
        <h3>Table</h3>

        <div class="tbl-accordions">
          ${headers.map((h, ci) => `
            <details class="tbl-col-accordion" open>
              <summary class="tbl-col-summary">
                <span class="tbl-col-chevron">▸</span>
                <input class="field-input tbl-col-name" data-header-idx="${ci}"
                  value="${esc(h)}" placeholder="Column ${ci+1}"
                  onclick="event.stopPropagation()" />
                <button class="tbl-del-col icon-btn danger" data-col-idx="${ci}" title="Remove column" onclick="event.stopPropagation()">×</button>
              </summary>
              <div class="tbl-col-cells">
                ${rows.map((r, ri) => `
                  <div class="tbl-cell-row">
                    <span class="tbl-row-num">${ri + 1}</span>
                    <input class="field-input" data-row-idx="${ri}" data-col-idx="${ci}"
                      value="${esc(r[ci] || '')}" placeholder="Row ${ri+1}" />
                    ${ci === 0 ? `<button class="tbl-del-row icon-btn danger" data-row-idx="${ri}" title="Remove row">×</button>` : ''}
                  </div>
                `).join('')}
              </div>
            </details>
          `).join('')}
        </div>

        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="add-item-btn" id="add-table-col">+ Add column</button>
          <button class="add-item-btn" id="add-table-row">+ Add row</button>
        </div>
      </div>`
    }

    case 'callout':
      return `<div class="block-editor">
        <h3>Callout</h3>
        ${row('Text', textarea('text', block.text, 'Callout message', 3))}
        <div class="form-row">
          ${label('Style')}
          <div class="style-picker">
            ${['brand','info','success','warning','error'].map(s =>
              `<button class="style-chip${block.style === s ? ' active' : ''}" data-style="${s}">${s}</button>`
            ).join('')}
          </div>
        </div>
      </div>`

    case 'stat-cards': {
      // Backwards compat: migrate single-value side to items array
      const getItems = (card) => {
        if (card && card.items && card.items.length > 0) return card.items
        return [{ value_type: card.value_type || 'stat', value: card.value || '', unit: card.unit || '%', icon: card.icon || '', description: card.description || '' }]
      }

      const itemFields = (side, item, idx) => {
        const vt = item.value_type || 'stat'
        const isStat = vt === 'stat'
        const isIcon = vt === 'icon'
        return `
        <div class="sc-item text-seg">
          <div class="seg-style-row">
            <span class="tc-col-label">Stat ${idx + 1}</span>
            <button class="seg-del-btn icon-btn danger sc-item-remove" data-side="${side}" data-item-idx="${idx}" title="Remove">×</button>
          </div>
          <div class="stat-item-body">
            <div class="form-row" style="margin-bottom:4px">
              ${label('Type')}
              <div class="vt-toggle">
                <button class="vt-btn${isStat ? ' active' : ''}" data-card-side="${side}" data-item-idx="${idx}" data-value="stat">Stat</button>
                <button class="vt-btn${isIcon ? ' active' : ''}" data-card-side="${side}" data-item-idx="${idx}" data-value="icon">Icon</button>
              </div>
            </div>

            <div class="vt-stat-fields"${!isStat ? ' style="display:none"' : ''}>
              <div class="stat-value-unit-card">
                <div class="stat-vu-cell">
                  <span class="stat-vu-label">Value</span>
                  <input class="stat-vu-input" data-card-side="${side}" data-item-idx="${idx}" data-item-field="value"
                    value="${esc(item.value||'')}" placeholder="14" />
                </div>
                <div class="stat-vu-divider"></div>
                <div class="stat-vu-cell">
                  <span class="stat-vu-label">Unit</span>
                  <input class="stat-vu-input" data-card-side="${side}" data-item-idx="${idx}" data-item-field="unit"
                    value="${esc(item.unit||'')}" placeholder="%" />
                </div>
              </div>
            </div>

            <div class="vt-icon-fields"${!isIcon ? ' style="display:none"' : ''}>
              <div class="form-row">
                ${label('Icon')}
                <div class="icon-picker-slot" data-card-side="${side}" data-item-idx="${idx}">
                  <div class="icon-picker-current">
                    ${item.icon
                      ? `<img class="icon-picker-preview" src="${API_BASE}/api/icon-file/${encodeURIComponent(item.icon)}" alt="" />`
                      : `<img class="icon-picker-preview" src="" alt="" style="display:none" />`}
                    <span class="icon-picker-label">${item.icon
                      ? esc(item.icon.replace(/^Icon=/, '').replace(/,\s*Colour=.*$/i, '').replace(/\.[^.]+$/, ''))
                      : 'No icon selected'}</span>
                  </div>
                  <button class="btn btn-ghost icon-picker-open-btn" data-card-side="${side}" data-item-idx="${idx}" style="width:100%;justify-content:center;margin-top:6px">Choose icon →</button>
                </div>
              </div>
            </div>

            <div class="stat-desc-section">
              <div class="stat-desc-label">Description</div>
              ${richarea(`data-card-side="${side}" data-item-idx="${idx}" data-item-field="description"`, item.description||'', 'of professionals say...', 3)}
            </div>
          </div>
        </div>`
      }

      const cardFields = (side, card, openByDefault) => {
        const items = getItems(card)
        const sideLabel = side === 'left' ? 'Left card' : 'Right card'
        return `
        <details class="sc-accordion" ${openByDefault ? 'open' : ''}>
          <summary class="sc-accordion-summary">
            <span class="sc-accordion-chevron">▸</span>
            <span class="sc-accordion-label">${sideLabel}</span>
          </summary>
          <div class="sc-accordion-body">
            ${row('Section №', `<input class="field-input" data-card-side="${side}" data-card-field="section_num" value="${esc(card.section_num||'')}" placeholder="01" />`)}
            ${row('Section title', `<input class="field-input" data-card-side="${side}" data-card-field="section_title" value="${esc(card.section_title||'')}" placeholder="Section heading" />`)}

            <div class="sc-items text-segs">
              ${items.map((item, i) => itemFields(side, item, i)).join('')}
            </div>

            <button class="add-btn sc-add-item" data-side="${side}" style="margin-top:6px">+ Add stat</button>

            <div class="form-row sc-body-row">
              ${label('Body copy')}
              ${richarea(`data-card-side="${side}" data-card-field="body"`, card.body||'', 'Optional context...', 2)}
            </div>
          </div>
        </details>`
      }
      return `<div class="block-editor">
        <h3>2 Column</h3>
        <div class="stat-cards-editor">
          ${cardFields('left',  block.left  || {}, true)}
          ${cardFields('right', block.right || {}, false)}
        </div>
      </div>`
    }

    case 'two-columns':
      return `<div class="block-editor">
        <h3>Two columns</h3>
        ${row('Left column', richarea('data-field="left"', block.left, 'Left column content...', 4))}
        ${row('Right column', richarea('data-field="right"', block.right, 'Right column content...', 4))}
      </div>`

    case 'divider':
      return `<div class="block-editor">
        <h3>Divider</h3>
        <div class="form-row" style="flex-direction:row;align-items:center;gap:8px">
          <input type="checkbox" data-field="thick" ${block.thick ? 'checked' : ''} />
          ${label('Thick rule')}
        </div>
      </div>`

    case 'page-break':
      return `<div class="block-editor">
        <h3>Page break</h3>
        <p class="text-sm text-muted">Forces content after this point to start on a new page.</p>
      </div>`

    case 'footer':
      return `<div class="block-editor">
        <h3>Footer CTA</h3>
        ${row('Text', textarea('text', block.text, 'Your call-to-action message', 3))}
        ${row('Button label', input('button_label', block.button_label, 'e.g. Discover more'))}
        ${row('Button URL (optional)', input('button_url', block.button_url, 'https://...'))}
      </div>`

    default:
      return `<div class="no-selection"><p>No editor for block type: ${block.type}</p></div>`
  }
}
