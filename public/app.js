// Purchase form: add/remove item rows and show how the cost will be shared.
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
