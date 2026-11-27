// Purchase form: add/remove item rows and show how the cost will be shared.
(function () {
  // Hamburger menu (phones): open/close, close on outside tap or Escape.
  const toggle = document.querySelector('.menu-toggle');
  const panel = document.getElementById('menu-panel');
  if (toggle && panel) {
    const setOpen = (open) => {
      panel.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!panel.classList.contains('open')); });
    document.addEventListener('click', (e) => { if (!panel.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) { setOpen(false); toggle.focus(); } });
  }

  // Settings page: presets fill the pickers, live preview follows every change.
  const sform = document.getElementById('settings-form');
  if (sform) {
    const preview = document.getElementById('theme-preview');
    const map = { Accent: '--accent', AccentInk: '--accent-ink', Bg: '--bg', Card: '--card', HeaderBg: '--header-bg', Ink: '--ink' };
    const sync = () => {
      for (const [key, css] of Object.entries(map)) {
        const input = sform.querySelector(`input[name="${key}"]`);
        preview.style.setProperty(css, input.value);
        const code = sform.querySelector(`[data-hex="${key}"]`);
        if (code) code.textContent = input.value;
      }
      const name = sform.querySelector('input[name="AppName"]').value.trim();
      document.getElementById('pv-name').textContent = name || 'Clothing Portal';
    };
    sform.addEventListener('input', sync);
    document.querySelectorAll('.preset').forEach((btn) => btn.addEventListener('click', () => {
      const p = JSON.parse(btn.dataset.preset);
      for (const key of Object.keys(map)) sform.querySelector(`input[name="${key}"]`).value = p[key];
      sync();
    }));
    const fav = sform.querySelector('input[name="favicon"]');
    if (fav) fav.addEventListener('change', () => {
      const f = fav.files[0];
      const img = document.getElementById('favicon-preview');
      if (f && img) { img.src = URL.createObjectURL(f); img.hidden = false; }
    });
    sync();
  }
})();

(function () {
  const form = document.getElementById('purchase-form');
  if (form) {
    const rows = document.getElementById('item-rows');
    const tpl = document.getElementById('row-template');
    const hint = document.getElementById('alloc-hint');
    const total = document.getElementById('total-cost');
    let next = rows.children.length;

    const parse = (v) => {
      const n = Number(String(v).replace(/[£,\s]/g, ''));
      return v.trim() === '' || !Number.isFinite(n) ? null : n;
    };

    function updateHint() {
      const t = parse(total.value) || 0;
      const items = [...rows.querySelectorAll('.item-row')];
      const costs = items.map((r) => parse(r.querySelector('.cost').value));
      const fixed = costs.filter((c) => c !== null).reduce((a, b) => a + b, 0);
      const blanks = costs.filter((c) => c === null).length;
      const rem = t - fixed;
      if (!t) hint.textContent = `${items.length} item(s)`;
      else if (rem < -0.004) hint.textContent = `Item costs are £${(-rem).toFixed(2)} over the total`;
      else if (blanks) hint.textContent = `${items.length} item(s) · £${(rem / blanks).toFixed(2)} each for ${blanks} without a cost`;
      else hint.textContent = Math.abs(rem) < 0.005 ? `${items.length} item(s) · costs match total` : `£${rem.toFixed(2)} not allocated`;
    }

    document.getElementById('add-row').addEventListener('click', () => {
      rows.insertAdjacentHTML('beforeend', tpl.innerHTML.replace(/__i__/g, next++));
      rows.lastElementChild.querySelector('input').focus();
      updateHint();
    });
    rows.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-row') && rows.children.length > 1) {
        e.target.closest('.item-row').remove();
        updateHint();
      }
    });
    form.addEventListener('input', updateHint);
    updateHint();
  }

  // Expense form: switch between amount and mileage, show SA103 category.
  const typeSel = document.getElementById('expense-type');
  if (typeSel) {
    const hint = document.getElementById('cat-hint');
    const milesInput = document.querySelector('.miles-field input');
    const showType = () => {
      const opt = typeSel.selectedOptions[0];
      const mileage = !!(opt && opt.dataset.mileage);
      document.querySelectorAll('.money-field').forEach((el) => (el.hidden = mileage));
      document.querySelector('.miles-field').hidden = !mileage;
      const miles = Number(milesInput.value) || 0;
      hint.textContent = opt && opt.dataset.cat
        ? `SA103 category: ${opt.dataset.cat}${mileage && miles ? ` · ${miles} miles × £${Number(milesInput.dataset.rate).toFixed(2)} = £${(miles * milesInput.dataset.rate).toFixed(2)}` : ''}`
        : '';
    };
    typeSel.addEventListener('change', showType);
    milesInput.addEventListener('input', showType);
    showType();
  }

  // eBay import: stop the same existing item being picked for two orders;
  // show cost fields for "Create new business item"; bulk-fill unmatched rows.
  const picks = [...document.querySelectorAll('.item-pick')];
  if (picks.length) {
    const isNew = (v) => v === 'new-business' || v === 'new-personal';
    const sync = () => {
      const chosen = new Set(picks.map((p) => p.value).filter((v) => v && !isNew(v)));
      picks.forEach((p) => {
        [...p.options].forEach((o) => {
          o.disabled = !!o.value && !isNew(o.value) && o.value !== p.value && chosen.has(o.value);
        });
        const cost = p.parentElement.querySelector('.new-cost');
        if (cost) cost.hidden = p.value !== 'new-business';
      });
    };
    picks.forEach((p) => p.addEventListener('change', sync));
    document.querySelectorAll('[data-bulk]').forEach((btn) => btn.addEventListener('click', () => {
      picks.forEach((p) => { if (!p.value) p.value = btn.dataset.bulk; });
      sync();
    }));
    sync();
  }

  // Sale form: default "Sold on" to where the item is listed.
  const item = document.getElementById('sale-item');
  const channel = document.getElementById('sale-channel');
  if (item && channel) {
    item.addEventListener('change', () => {
      const listed = item.selectedOptions[0] && item.selectedOptions[0].dataset.listed;
      if (listed) channel.value = listed;
    });
  }
})();
