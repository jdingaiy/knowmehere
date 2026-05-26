/**
 * board.js — 3D corner room, surface-conforming stickers
 *
 * Room geometry (fractions of canvas). MUST match the SVG seams in index.html:
 *   Corner point:        (CX, CY) = (0.40, 0.56)
 *   Left-wall bottom:    (0, LB)  = (0, 0.86)
 *   Vertical seam   (left wall | back wall): x=CX, y in [0, CY]
 *   Horizontal seam (back wall | floor):     y=CY, x in [CX, 1]
 *   Diagonal seam   (left wall | floor):     (0,LB) -> (CX,CY)
 *
 * Drag is free; on release a sticker snaps its ORIENTATION to whatever
 * surface its center sits on, and snaps onto a seam line when close to one.
 */
(function () {
  'use strict';

  const CX = 0.40;   // corner x
  const CY = 0.56;   // corner y (horizon)
  const LB = 0.86;   // left-wall bottom y at left edge
  const PERSP = 900; // perspective depth (px)
  const SNAP = 30;   // seam snap radius (px)

  let activeFilter = 'all';
  let draggingEl = null;
  let dragStartX = 0, dragStartY = 0;
  let dragOffX = 0, dragOffY = 0;
  let currentModal = null;

  const canvas  = document.getElementById('board-canvas');
  const overlay = document.getElementById('modal-overlay');

  /* INIT */
  function init() {
    if (!canvas) return;
    STICKERS_DATA.forEach((d, i) => {
      const el = buildSticker(d);
      canvas.appendChild(el);
      placeSticker(el, d);
      el.style.zIndex = 10 + i;
    });
    bindFilter();
    bindModal();
    bindKeys();
    setTimeout(hideHint, 5000);
  }

  /* BUILD STICKER */
  function buildSticker(d) {
    const sizes = { large: 168, normal: 142, small: 116 };
    const sz = sizes[d.size] || 142;

    const el = document.createElement('div');
    el.className = 'sticker';
    el.dataset.id  = d.id;
    el.dataset.cat = d.category;
    el.style.setProperty('--sz', sz + 'px');

    const catNames = { vibe:'VIBE', portfolio:'作品集', studio:'工作室', illus:'插画' };

    el.innerHTML = `
      <div class="sticker-inner">
        <img class="sticker-img" src="${d.sticker}" alt="${d.name}" draggable="false"
             onerror="this.outerHTML='<div class=\\'sticker-emoji\\'>${d.heroEmoji}</div>'" />
        <div class="sticker-label">
          <span class="sticker-name">${d.name}</span>
          <div class="sticker-meta">
            <span class="s-dot ${d.category}"></span>
            <span class="s-cat">${catNames[d.category] || d.category}</span>
          </div>
        </div>
      </div>`;

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('click', () => {
      if (el._dragged) { el._dragged = false; return; }
      openModal(d);
    });
    return el;
  }

  /* PLACE on canvas */
  function placeSticker(el, d) {
    const saved = loadPos(d.id);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const sz = parseInt(getComputedStyle(el).getPropertyValue('--sz')) || 142;
    const totalH = sz + 50;

    let x, y;
    if (saved) {
      x = clamp(saved.x, 0, W - sz - 20);
      y = clamp(saved.y, 0, H - totalH);
    } else {
      x = clamp(d.ix * W + jitter(26), 10, W - sz - 20);
      y = clamp(d.iy * H + jitter(18), 10, H - totalH);
    }
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    applyTransform(el, d.rot, x, y, sz, W, H);
  }

  /* SURFACE DETECTION (uses sticker center) */
  function getSurface(cxp, cyp, W, H) {
    const cornerX = W * CX, cornerY = H * CY, lb = H * LB;
    if (cxp < cornerX) {
      // diagonal split between left-wall (above) and floor (below)
      const diagY = lb + (cornerY - lb) * (cxp / cornerX);
      return (cyp > diagY) ? 'floor' : 'left-wall';
    }
    return (cyp > cornerY) ? 'floor' : 'back-wall';
  }

  /* Build a CSS transform for a given surface + depth */
  function transformFor(surface, cxp, cyp, W, H, r) {
    const cornerX = W * CX, cornerY = H * CY;
    switch (surface) {
      case 'floor': {
        const p = clamp((cyp - cornerY) / (H - cornerY), 0, 1);
        const rotX = 44 + p * 16;            // 44deg near horizon -> 60deg near viewer
        return `rotate(${r}deg) perspective(${PERSP}px) rotateX(${rotX}deg)`;
      }
      case 'left-wall': {
        const p = clamp((cornerX - cxp) / cornerX, 0, 1);
        const rotY = 24 + p * 14;            // hinges toward the seam
        return `rotate(${r}deg) perspective(${PERSP}px) rotateY(${rotY}deg)`;
      }
      case 'seam-v':                          // left wall | back wall fold
        return `rotate(${r}deg) perspective(${PERSP}px) rotateY(13deg)`;
      case 'seam-h':                          // back wall | floor fold
      case 'seam-d':                          // left wall | floor fold
        return `rotate(${r}deg) perspective(${PERSP}px) rotateX(26deg)`;
      default:                                // back-wall: flat, faces viewer
        return `rotate(${r}deg)`;
    }
  }

  function applyTransform(el, baseRot, x, y, sz, W, H) {
    const cxp = x + sz / 2, cyp = y + sz / 2;
    const surface = getSurface(cxp, cyp, W, H);
    el.dataset.surface = surface;
    el.style.transform = transformFor(surface, cxp, cyp, W, H, baseRot || 0);
  }

  /* Snap position onto a nearby seam; returns {x,y,surface} (top-left coords) */
  function snapToSeam(x, y, sz, W, H) {
    const cornerX = W * CX, cornerY = H * CY, lb = H * LB;
    let cxp = x + sz / 2, cyp = y + sz / 2;
    let surface = getSurface(cxp, cyp, W, H);

    // Vertical seam (only above horizon)
    if (cyp < cornerY && Math.abs(cxp - cornerX) < SNAP) {
      cxp = cornerX; surface = 'seam-v';
    }
    // Horizontal seam (back wall side, right of corner)
    else if (cxp > cornerX && Math.abs(cyp - cornerY) < SNAP) {
      cyp = cornerY; surface = 'seam-h';
    }
    // Diagonal seam (left of corner): project point onto the line
    else if (cxp < cornerX) {
      const ax = 0, ay = lb, bx = cornerX, by = cornerY;
      const dx = bx - ax, dy = by - ay;
      const t = clamp(((cxp - ax) * dx + (cyp - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      const px = ax + t * dx, py = ay + t * dy;
      if (Math.hypot(cxp - px, cyp - py) < SNAP) {
        cxp = px; cyp = py; surface = 'seam-d';
      }
    }
    return { x: cxp - sz / 2, y: cyp - sz / 2, surface };
  }

  /* DRAG */
  function onDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault(); e.stopPropagation();

    draggingEl = e.currentTarget;
    draggingEl._dragged = false;
    dragStartX = e.clientX; dragStartY = e.clientY;

    const cr = canvas.getBoundingClientRect();
    dragOffX = e.clientX - cr.left - parseFloat(draggingEl.style.left);
    dragOffY = e.clientY - cr.top  - parseFloat(draggingEl.style.top);

    draggingEl.classList.add('dragging');
    draggingEl.style.zIndex = 300;
    draggingEl.setPointerCapture(e.pointerId);

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  }

  function onMove(e) {
    if (!draggingEl) return;
    if (Math.abs(e.clientX - dragStartX) > 4 || Math.abs(e.clientY - dragStartY) > 4)
      draggingEl._dragged = true;

    const cr = canvas.getBoundingClientRect();
    const sz = parseInt(getComputedStyle(draggingEl).getPropertyValue('--sz')) || 142;
    let x = e.clientX - cr.left - dragOffX;
    let y = e.clientY - cr.top  - dragOffY;
    x = clamp(x, 0, canvas.clientWidth  - sz - 10);
    y = clamp(y, 0, canvas.clientHeight - sz - 50);

    draggingEl.style.left = x + 'px';
    draggingEl.style.top  = y + 'px';

    const d = STICKERS_DATA.find(s => s.id === draggingEl.dataset.id);
    applyTransform(draggingEl, d ? d.rot : 0, x, y, sz, canvas.clientWidth, canvas.clientHeight);
  }

  function onUp() {
    if (!draggingEl) return;
    const el = draggingEl;
    el.classList.remove('dragging');

    const W = canvas.clientWidth, H = canvas.clientHeight;
    const sz = parseInt(getComputedStyle(el).getPropertyValue('--sz')) || 142;
    const d = STICKERS_DATA.find(s => s.id === el.dataset.id);

    // Snap onto nearby seam, then settle orientation to the resolved surface
    const snapped = snapToSeam(parseFloat(el.style.left), parseFloat(el.style.top), sz, W, H);
    el.style.left = snapped.x + 'px';
    el.style.top  = snapped.y + 'px';
    el.dataset.surface = snapped.surface;
    const cxp = snapped.x + sz / 2, cyp = snapped.y + sz / 2;
    el.style.transform = transformFor(snapped.surface, cxp, cyp, W, H, d ? d.rot : 0);

    savePos(el.dataset.id, snapped.x, snapped.y);
    draggingEl = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup',   onUp);
  }

  /* FILTER */
  function bindFilter() {
    window.applyFilter = function(cat) {
      activeFilter = cat;
      document.querySelectorAll('.sticker').forEach(el => {
        el.classList.toggle('filtered-out',
          cat !== 'all' && el.dataset.cat !== cat);
      });
    };
  }

  /* MODAL */
  function openModal(d) {
    if (!overlay) return;
    currentModal = d;
    const slot = document.getElementById('modal-slot');
    if (slot) slot.innerHTML = renderModal(d);
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    overlay.addEventListener('click', onBd);
  }
  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    overlay.removeEventListener('click', onBd);
    currentModal = null;
  }
  function onBd(e) { if (e.target === overlay) closeModal(); }

  function bindModal() {
    if (!overlay) return;
    overlay.addEventListener('click', e => {
      if (e.target.classList.contains('modal-close-btn')) closeModal();
    });
  }
  function bindKeys() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && currentModal) closeModal();
    });
  }

  function renderModal(d) {
    const tags = d.tags.map(t =>
      `<span class="badge badge-${d.category}">${t}</span>`).join('');
    const metrics = d.metrics.length
      ? `<div class="modal-sec">
           <p class="modal-sec-label">核心成果</p>
           <div class="modal-metrics">
             ${d.metrics.map(m => `
               <div><span class="metric-val">${m.value}</span>
               <span class="metric-lbl">${m.label}</span></div>`).join('')}
           </div>
         </div>` : '';
    const demo = d.demoType === 'iframe'
      ? `<div class="modal-sec">
           <p class="modal-sec-label">在线体验</p>
           <div class="modal-demo">
             ${(!d.demoUrl || d.demoUrl.startsWith('PLACEHOLDER'))
               ? `<div class="demo-ph"><span style="font-size:32px">${d.heroEmoji}</span>Demo 链接即将添加</div>`
               : `<iframe src="${d.demoUrl}" title="${d.name}" allowfullscreen loading="lazy"></iframe>`}
           </div>
         </div>` : '';

    return `
      <div class="modal-hero">
        <img src="${d.sticker}" alt="${d.name}"
             onerror="this.outerHTML='<div class=\\'modal-hero-emoji\\'>${d.heroEmoji}</div>'" />
      </div>
      <div class="modal-tags">${tags}</div>
      <h2 class="modal-title">${d.name}</h2>
      <p class="modal-sub">${d.role} · ${d.period}</p>
      <div class="modal-sec">
        <p class="modal-sec-label">项目背景</p>
        <p class="modal-desc">${d.description}</p>
      </div>
      ${metrics}${demo}`;
  }

  /* RESET */
  window.resetStickers = function () {
    STICKERS_DATA.forEach(d => {
      try { localStorage.removeItem('sk_' + d.id); } catch(e) {}
    });
    location.reload();
  };

  /* UTILS */
  function savePos(id, x, y) {
    try { localStorage.setItem('sk_' + id, JSON.stringify({x, y})); } catch(e) {}
  }
  function loadPos(id) {
    try { const r = localStorage.getItem('sk_' + id); return r ? JSON.parse(r) : null; } catch(e) { return null; }
  }
  function jitter(r) { return (Math.random() - 0.5) * r * 2; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hideHint() {
    const h = document.querySelector('.drag-hint');
    if (h) { h.style.transition = 'opacity 1s'; h.style.opacity = '0'; }
  }

  document.addEventListener('DOMContentLoaded', init);
})();