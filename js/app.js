/* 画面の制御 */
(function () {
  'use strict';

  const { todayStr, formatElapsed, diffDays, avgKmPerDay, latestOdometer, computeStatus } = Calc;
  let data = Store.load();

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ja-JP') : '—');
  const fmtDate = (s) => {
    if (!s) return '—';
    const [y, m, d] = s.split('-');
    return `${y}/${Number(m)}/${Number(d)}`;
  };
  const toNum = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

  function persist() {
    if (!Store.save(data)) toast('保存に失敗しました（ストレージの空き容量を確認してください）');
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- データ参照 ----------
  const activeVehicle = () => data.vehicles.find((v) => v.id === data.activeVehicleId);
  const itemById = (id) => data.items.find((i) => i.id === id);
  const vehicleRecords = (vid = data.activeVehicleId) => data.records.filter((r) => r.vehicleId === vid);

  function sortRecordsDesc(list) {
    return list.slice().sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.km - a.km));
  }

  /** 車両の走行距離の記録点（交換記録 + 手入力した現在距離） */
  function odoPoints(vid = data.activeVehicleId) {
    const v = data.vehicles.find((x) => x.id === vid);
    return [
      ...vehicleRecords(vid).map((r) => ({ date: r.date, km: r.km })),
      ...(v ? v.odometerLog : []),
    ];
  }

  function context() {
    const points = odoPoints();
    const latest = latestOdometer(points);
    return {
      today: todayStr(),
      currentKm: latest ? latest.km : null,
      currentKmDate: latest ? latest.date : null,
      kmPerDay: avgKmPerDay(points),
    };
  }

  function lastRecordOf(itemId, excludeId) {
    return sortRecordsDesc(vehicleRecords().filter((r) => r.itemId === itemId && r.id !== excludeId))[0] || null;
  }

  // ---------- 表示切替 ----------
  function showView(name) {
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    window.scrollTo(0, 0);
  }

  // ---------- 共通部分 ----------
  function renderHeader(ctx) {
    $('#vehicle-select').innerHTML = data.vehicles
      .map((v) => `<option value="${esc(v.id)}"${v.id === data.activeVehicleId ? ' selected' : ''}>${esc(v.name)}</option>`)
      .join('');
    $('#current-km').textContent = ctx.currentKm !== null ? `${num(ctx.currentKm)} km` : '未入力';
    $('#current-km-date').textContent = ctx.currentKmDate ? `（${fmtDate(ctx.currentKmDate)} 時点）` : '';
  }

  function itemOptions(selectedId, { includeAll = false } = {}) {
    const groups = {};
    data.items.forEach((i) => {
      (groups[i.category || 'その他'] ||= []).push(i);
    });
    let html = includeAll ? '<option value="">すべての項目</option>' : '';
    Store.CATEGORIES.concat(Object.keys(groups).filter((c) => !Store.CATEGORIES.includes(c))).forEach((cat) => {
      if (!groups[cat]) return;
      html += `<optgroup label="${esc(cat)}">`;
      html += groups[cat]
        .map((i) => `<option value="${esc(i.id)}"${i.id === selectedId ? ' selected' : ''}>${esc(i.name)}</option>`)
        .join('');
      html += '</optgroup>';
    });
    return html;
  }

  function intervalText(item) {
    const parts = [];
    if (Number(item.intervalKm) > 0) parts.push(`${num(Number(item.intervalKm))}km`);
    if (Number(item.intervalMonths) > 0) parts.push(`${item.intervalMonths}ヶ月`);
    return parts.length ? parts.join(' / ') : '間隔未設定';
  }

  function remainText(st) {
    const out = [];
    if (st.remainingDays !== undefined) {
      out.push(st.remainingDays >= 0 ? `あと ${num(st.remainingDays)} 日` : `${num(-st.remainingDays)} 日超過`);
    }
    return out.join('');
  }

  // ---------- ダッシュボード ----------
  const STATE_LABEL = { overdue: '交換時期を過ぎています', soon: 'そろそろ交換', ok: '良好' };
  const STATE_ORDER = { overdue: 0, soon: 1, ok: 2 };

  function renderDashboard(ctx) {
    const rows = [];
    const unrecorded = [];
    data.items.forEach((item) => {
      const last = lastRecordOf(item.id);
      if (!last) return unrecorded.push(item);
      rows.push({ item, last, st: computeStatus(item, last, ctx) });
    });
    rows.sort(
      (a, b) =>
        STATE_ORDER[a.st.state] - STATE_ORDER[b.st.state] ||
        (a.st.dueDate || '9999') .localeCompare(b.st.dueDate || '9999') ||
        (b.st.progress || 0) - (a.st.progress || 0)
    );

    const count = (s) => rows.filter((r) => r.st.state === s).length;
    $('#summary').innerHTML = rows.length
      ? `<div class="pill overdue">超過 <b>${count('overdue')}</b></div>
         <div class="pill soon">まもなく <b>${count('soon')}</b></div>
         <div class="pill ok">良好 <b>${count('ok')}</b></div>`
      : `<div class="empty">
           <p>まだ交換記録がありません。</p>
           <button type="button" class="btn primary" data-action="new-record">最初の記録を追加</button>
         </div>`;

    $('#status-list').innerHTML = rows.map(({ item, last, st }) => statusCard(item, last, st)).join('');

    $('#unrecorded-wrap').hidden = !unrecorded.length;
    $('#unrecorded-count').textContent = `(${unrecorded.length})`;
    $('#unrecorded-list').innerHTML = unrecorded
      .map((i) => `<button type="button" class="chip" data-action="new-record" data-item="${esc(i.id)}">＋ ${esc(i.name)}</button>`)
      .join('');

    $('#avg-km').textContent = ctx.kmPerDay
      ? `1日 約${ctx.kmPerDay.toFixed(1)}km ／ 月 約${num(ctx.kmPerDay * 30.4)}km`
      : '記録が2週間分以上たまると計算されます';
  }

  function statusCard(item, last, st) {
    const pct = st.progress !== null ? Math.min(100, Math.round(st.progress * 100)) : null;
    const due = [];
    if (st.dueDateByTime) due.push(`<li><span>期間で</span> ${fmtDate(st.dueDateByTime)}</li>`);
    if (st.dueKm !== undefined) {
      const est = st.dueDateByKm ? `<small>（${fmtDate(st.dueDateByKm)}頃）</small>` : '';
      const rem =
        st.remainingKm !== undefined
          ? st.remainingKm >= 0
            ? `<small>あと ${num(st.remainingKm)}km</small>`
            : `<small class="bad">${num(-st.remainingKm)}km 超過</small>`
          : '';
      due.push(`<li><span>距離で</span> ${num(st.dueKm)}km ${rem} ${est}</li>`);
    }
    const part = [last.partNumber, last.brand].filter(Boolean).map(esc).join(' ／ ');

    return `
      <article class="card status ${st.state}">
        <div class="status-head">
          <div>
            <h3>${esc(item.name)}</h3>
            <span class="muted small">目安 ${esc(intervalText(item))}</span>
          </div>
          <span class="badge ${st.state}">${STATE_LABEL[st.state]}</span>
        </div>
        ${pct !== null ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
        <dl class="kv">
          <dt>前回交換</dt>
          <dd>${fmtDate(last.date)} ・ ${num(last.km)}km</dd>
          <dt>経過</dt>
          <dd><b>${esc(st.elapsedText)}</b>（${num(st.elapsedDays)}日）${
            st.elapsedKm !== null ? ` ・ <b>${num(st.elapsedKm)}km</b> 走行` : ''
          }</dd>
          <dt>交換推奨</dt>
          <dd>${
            st.dueDate
              ? `<b class="due">${fmtDate(st.dueDate)}</b> <span class="${st.remainingDays < 0 ? 'bad' : ''}">${remainText(st)}</span>`
              : st.dueKm !== undefined
              ? `<b class="due">${num(st.dueKm)}km</b>`
              : '<span class="muted">間隔が未設定です</span>'
          }
            ${due.length ? `<ul class="due-list">${due.join('')}</ul>` : ''}
          </dd>
          ${part ? `<dt>前回の部品</dt><dd class="part">${part}</dd>` : ''}
        </dl>
        <div class="card-actions">
          <button type="button" class="link-btn" data-action="show-history" data-item="${esc(item.id)}">履歴</button>
          <button type="button" class="btn small primary" data-action="new-record" data-item="${esc(item.id)}">交換を記録</button>
        </div>
      </article>`;
  }

  // ---------- 記録フォーム ----------
  const form = $('#record-form');

  function openRecordForm(itemId, record) {
    form.reset();
    form.elements.itemId.innerHTML = itemOptions(record ? record.itemId : itemId || data.items[0].id);
    if (record) {
      ['id', 'date', 'km', 'partNumber', 'brand', 'cost', 'shop', 'memo'].forEach((k) => {
        form.elements[k].value = record[k] ?? '';
      });
      $('#form-title').textContent = '交換記録を編集';
      $('#btn-submit').textContent = '更新する';
      $('#btn-cancel-edit').hidden = false;
    } else {
      form.elements.id.value = '';
      form.elements.date.value = todayStr();
      $('#form-title').textContent = '交換記録を追加';
      $('#btn-submit').textContent = '保存する';
      $('#btn-cancel-edit').hidden = true;
      // 前回と同じ部品を使うことが多いので、型番などを引き継ぐ
      prefillFromLast();
    }
    updateSuggestions();
    updatePreview();
    showView('record');
  }

  function prefillFromLast() {
    const last = lastRecordOf(form.elements.itemId.value);
    form.elements.partNumber.value = last?.partNumber || '';
    form.elements.brand.value = last?.brand || '';
  }

  function updateSuggestions() {
    const itemId = form.elements.itemId.value;
    const uniq = (arr) => [...new Set(arr.filter(Boolean))];
    const sameItem = data.records.filter((r) => r.itemId === itemId);
    const opts = (arr) => arr.map((v) => `<option value="${esc(v)}"></option>`).join('');
    $('#part-number-list').innerHTML = opts(uniq(sameItem.map((r) => r.partNumber)));
    $('#brand-list').innerHTML = opts(uniq(sameItem.map((r) => r.brand)));
    $('#shop-list').innerHTML = opts(uniq(data.records.map((r) => r.shop)));
  }

  /** 入力中に「前回からの経過」と「次回の推奨時期」を表示する */
  function updatePreview() {
    const el = $('#preview');
    const item = itemById(form.elements.itemId.value);
    const date = form.elements.date.value;
    const km = toNum(form.elements.km.value);
    if (!item || !date) {
      el.hidden = true;
      return;
    }
    const editingId = form.elements.id.value;
    const prev = sortRecordsDesc(
      vehicleRecords().filter((r) => r.itemId === item.id && r.id !== editingId && r.date <= date)
    )[0];

    const lines = [];
    if (prev) {
      const days = diffDays(prev.date, date);
      const dKm = km !== null ? km - prev.km : null;
      lines.push(
        `<div><span class="muted">前回交換</span> ${fmtDate(prev.date)} ・ ${num(prev.km)}km</div>`,
        `<div><span class="muted">前回から</span> <b>${esc(formatElapsed(prev.date, date))}</b>（${num(days)}日）${
          dKm !== null ? ` ・ <b class="${dKm < 0 ? 'bad' : ''}">${num(dKm)}km</b>` : ''
        }</div>`
      );
      if (dKm !== null && dKm < 0) lines.push('<div class="bad small">前回より走行距離が少なくなっています。入力を確認してください。</div>');
    } else {
      lines.push('<div class="muted">この項目の前回記録はありません（初回記録）</div>');
    }

    const next = [];
    if (Number(item.intervalMonths) > 0) next.push(`${fmtDate(Calc.addMonths(date, Number(item.intervalMonths)))}`);
    if (Number(item.intervalKm) > 0 && km !== null) next.push(`${num(km + Number(item.intervalKm))}km`);
    if (next.length) {
      lines.push(`<div><span class="muted">次回交換推奨</span> <b class="due">${next.join(' または ')}</b> <small class="muted">（早い方）</small></div>`);
    }
    el.innerHTML = lines.join('');
    el.hidden = false;
  }

  form.addEventListener('input', (e) => {
    if (e.target.name !== 'itemId') updatePreview();
  });
  form.elements.itemId.addEventListener('change', () => {
    if (!form.elements.id.value) prefillFromLast();
    updateSuggestions();
    updatePreview();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    const km = toNum(f.km.value);
    if (!f.date.value || km === null || !Number.isFinite(km) || km < 0) {
      toast('交換日と走行距離を入力してください');
      return;
    }
    const rec = {
      id: f.id.value || Store.uid(),
      vehicleId: data.activeVehicleId,
      itemId: f.itemId.value,
      date: f.date.value,
      km: Math.round(km),
      partNumber: f.partNumber.value.trim(),
      brand: f.brand.value.trim(),
      cost: toNum(f.cost.value),
      shop: f.shop.value.trim(),
      memo: f.memo.value.trim(),
    };
    const idx = data.records.findIndex((r) => r.id === rec.id);
    if (idx >= 0) {
      rec.vehicleId = data.records[idx].vehicleId;
      data.records[idx] = rec;
    } else {
      data.records.push(rec);
    }
    persist();

    const ctx = context();
    const st = computeStatus(itemById(rec.itemId), lastRecordOf(rec.itemId), ctx);
    toast(
      `${itemById(rec.itemId).name}を${idx >= 0 ? '更新' : '記録'}しました` +
        (st.dueDate ? `。次回推奨: ${fmtDate(st.dueDate)}` : st.dueKm ? `。次回推奨: ${num(st.dueKm)}km` : '')
    );
    renderAll();
    showView(idx >= 0 ? 'history' : 'dashboard');
  });

  $('#btn-cancel-edit').addEventListener('click', () => showView('history'));

  // ---------- 履歴 ----------
  function renderHistory() {
    const filterEl = $('#history-filter');
    const current = filterEl.value;
    filterEl.innerHTML = itemOptions(current, { includeAll: true });
    filterEl.value = current;

    const q = $('#history-search').value.trim().toLowerCase();
    const all = vehicleRecords();
    const list = sortRecordsDesc(all).filter((r) => {
      if (current && r.itemId !== current) return false;
      if (!q) return true;
      return [r.partNumber, r.brand, r.shop, r.memo, itemById(r.itemId)?.name]
        .some((v) => (v || '').toLowerCase().includes(q));
    });

    if (!list.length) {
      $('#history-list').innerHTML = `<p class="empty">${all.length ? '該当する記録がありません' : 'まだ記録がありません'}</p>`;
      return;
    }

    $('#history-list').innerHTML = list
      .map((r) => {
        const item = itemById(r.itemId);
        // 同じ項目の 1 つ前の記録との差
        const prev = sortRecordsDesc(all.filter((x) => x.itemId === r.itemId && x.id !== r.id && x.date <= r.date &&
          (x.date < r.date || x.km < r.km)))[0];
        const interval = prev
          ? `前回から ${esc(formatElapsed(prev.date, r.date))} ・ ${num(r.km - prev.km)}km`
          : '初回記録';
        return `
        <article class="card history-item">
          <div class="history-head">
            <div>
              <div class="muted small">${fmtDate(r.date)}</div>
              <h3>${esc(item ? item.name : '（削除された項目）')}</h3>
            </div>
            <div class="right"><b>${num(r.km)}</b> km</div>
          </div>
          <div class="small muted">${interval}</div>
          ${r.partNumber ? `<div class="part"><span class="tag">型番</span> ${esc(r.partNumber)}</div>` : ''}
          ${r.brand ? `<div class="part"><span class="tag">商品</span> ${esc(r.brand)}</div>` : ''}
          <div class="small meta">
            ${r.cost !== null && r.cost !== undefined ? `<span>¥${num(r.cost)}</span>` : ''}
            ${r.shop ? `<span>${esc(r.shop)}</span>` : ''}
          </div>
          ${r.memo ? `<p class="memo">${esc(r.memo)}</p>` : ''}
          <div class="card-actions">
            <button type="button" class="link-btn danger" data-action="delete-record" data-id="${esc(r.id)}">削除</button>
            <button type="button" class="btn small secondary" data-action="edit-record" data-id="${esc(r.id)}">編集</button>
          </div>
        </article>`;
      })
      .join('');
  }

  $('#history-filter').addEventListener('change', renderHistory);
  $('#history-search').addEventListener('input', renderHistory);

  // ---------- 設定 ----------
  function renderSettings() {
    $('#vehicle-list').innerHTML = data.vehicles
      .map((v) => {
        const n = vehicleRecords(v.id).length;
        return `
        <div class="row">
          <input type="text" value="${esc(v.name)}" data-action="rename-vehicle" data-id="${esc(v.id)}" aria-label="車両名" />
          <span class="muted small">${n}件</span>
          <button type="button" class="link-btn danger" data-action="delete-vehicle" data-id="${esc(v.id)}">削除</button>
        </div>`;
      })
      .join('');

    $('#item-settings').innerHTML = `
      <div class="item-table">
        <div class="th">項目</div><div class="th">km</div><div class="th">ヶ月</div><div class="th"></div>
        ${data.items
          .map(
            (i) => `
          <div class="name">${esc(i.name)}<small class="muted"> ${esc(i.category || '')}</small></div>
          <input type="number" min="0" step="100" value="${i.intervalKm ?? ''}" data-action="item-interval" data-field="intervalKm" data-id="${esc(i.id)}" aria-label="${esc(i.name)} の距離" />
          <input type="number" min="0" step="1" value="${i.intervalMonths ?? ''}" data-action="item-interval" data-field="intervalMonths" data-id="${esc(i.id)}" aria-label="${esc(i.name)} の期間" />
          <div>${i.builtin ? '' : `<button type="button" class="link-btn danger" data-action="delete-item" data-id="${esc(i.id)}">削除</button>`}</div>`
          )
          .join('')}
      </div>
      <button type="button" class="link-btn" data-action="reset-intervals">間隔を初期値に戻す</button>`;

    $('#item-form').elements.category.innerHTML = Store.CATEGORIES.map((c) => `<option>${c}</option>`).join('');
    $('#item-form').elements.category.value = 'その他';
  }

  $('#vehicle-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.elements.name.value.trim();
    if (!name) return;
    const v = { id: Store.uid(), name, odometerLog: [] };
    data.vehicles.push(v);
    data.activeVehicleId = v.id;
    persist();
    e.target.reset();
    renderAll();
    toast(`${name} を追加しました`);
  });

  $('#item-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const name = f.name.value.trim();
    if (!name) return;
    data.items.push({
      id: 'custom-' + Store.uid(),
      name,
      category: f.category.value,
      intervalKm: toNum(f.intervalKm.value),
      intervalMonths: toNum(f.intervalMonths.value),
      builtin: false,
    });
    persist();
    e.target.reset();
    renderAll();
    toast(`${name} を追加しました`);
  });

  // ---------- 現在の走行距離 ----------
  $('#btn-update-km').addEventListener('click', () => {
    const ctx = context();
    const input = prompt('現在の走行距離（km）を入力してください', ctx.currentKm ?? '');
    if (input === null) return;
    const km = Number(String(input).replace(/[,，\s]/g, ''));
    if (!Number.isFinite(km) || km < 0) return toast('数値を入力してください');
    if (ctx.currentKm !== null && km < ctx.currentKm) {
      if (!confirm(`記録済みの距離（${num(ctx.currentKm)}km）より小さい値です。登録しますか？`)) return;
    }
    const v = activeVehicle();
    const today = todayStr();
    v.odometerLog = v.odometerLog.filter((p) => p.date !== today);
    v.odometerLog.push({ date: today, km: Math.round(km) });
    persist();
    renderAll();
    toast('走行距離を更新しました');
  });

  $('#vehicle-select').addEventListener('change', (e) => {
    data.activeVehicleId = e.target.value;
    persist();
    renderAll();
  });

  // ---------- バックアップ ----------
  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  $('#btn-export').addEventListener('click', () => {
    download(`car-maintenance-${todayStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
  });

  $('#btn-export-csv').addEventListener('click', () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['車両', '項目', '交換日', '走行距離(km)', '型番', 'メーカー・商品名', '費用(円)', '店舗', 'メモ'];
    const lines = sortRecordsDesc(data.records).map((r) =>
      [
        data.vehicles.find((v) => v.id === r.vehicleId)?.name,
        itemById(r.itemId)?.name,
        r.date,
        r.km,
        r.partNumber,
        r.brand,
        r.cost,
        r.shop,
        r.memo,
      ].map(cell).join(',')
    );
    // Excel で文字化けしないよう BOM を付ける
    download(`car-maintenance-${todayStr()}.csv`, '﻿' + [header.map(cell).join(','), ...lines].join('\r\n'), 'text/csv');
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.records)) throw new Error('形式が違います');
      if (!confirm(`${parsed.records.length}件の記録を読み込みます。現在のデータは置き換えられます。よろしいですか？`)) return;
      data = Store.normalize(parsed);
      persist();
      renderAll();
      toast('読み込みました');
    } catch (err) {
      toast('読み込みに失敗しました: ' + err.message);
    }
  });

  // ---------- クリック操作（イベント委譲） ----------
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.tagName === 'INPUT') return;
    const { action, id, item } = btn.dataset;

    switch (action) {
      case 'new-record':
        openRecordForm(item);
        break;
      case 'edit-record':
        openRecordForm(null, data.records.find((r) => r.id === id));
        break;
      case 'delete-record': {
        const r = data.records.find((x) => x.id === id);
        if (r && confirm(`${fmtDate(r.date)} の「${itemById(r.itemId)?.name || ''}」の記録を削除しますか？`)) {
          data.records = data.records.filter((x) => x.id !== id);
          persist();
          renderAll();
          toast('削除しました');
        }
        break;
      }
      case 'show-history':
        $('#history-filter').value = item;
        $('#history-search').value = '';
        renderHistory();
        showView('history');
        break;
      case 'delete-vehicle': {
        if (data.vehicles.length <= 1) return toast('車両は最低1台必要です');
        const v = data.vehicles.find((x) => x.id === id);
        const n = vehicleRecords(id).length;
        if (!confirm(`「${v.name}」と、その記録 ${n} 件を削除しますか？`)) return;
        data.vehicles = data.vehicles.filter((x) => x.id !== id);
        data.records = data.records.filter((r) => r.vehicleId !== id);
        if (data.activeVehicleId === id) data.activeVehicleId = data.vehicles[0].id;
        persist();
        renderAll();
        break;
      }
      case 'delete-item': {
        const it = itemById(id);
        const n = data.records.filter((r) => r.itemId === id).length;
        if (n) return toast(`「${it.name}」には記録が ${n} 件あるため削除できません`);
        if (!confirm(`「${it.name}」を削除しますか？`)) return;
        data.items = data.items.filter((x) => x.id !== id);
        persist();
        renderAll();
        break;
      }
      case 'reset-intervals':
        if (!confirm('標準項目の交換間隔を初期値に戻しますか？')) return;
        Store.DEFAULT_ITEMS.forEach((d) => {
          const it = itemById(d.id);
          if (it) Object.assign(it, { intervalKm: d.intervalKm, intervalMonths: d.intervalMonths });
        });
        persist();
        renderAll();
        toast('初期値に戻しました');
        break;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.action === 'item-interval') {
      const it = itemById(el.dataset.id);
      const v = toNum(el.value);
      it[el.dataset.field] = v !== null && v > 0 ? v : null;
      persist();
      renderAll();
    } else if (el.dataset.action === 'rename-vehicle') {
      const v = data.vehicles.find((x) => x.id === el.dataset.id);
      if (el.value.trim()) v.name = el.value.trim();
      persist();
      renderAll();
    }
  });

  $$('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.view === 'record') openRecordForm();
      else showView(b.dataset.view);
    })
  );

  // ---------- 描画 ----------
  function renderAll() {
    const ctx = context();
    renderHeader(ctx);
    renderDashboard(ctx);
    renderHistory();
    renderSettings();
  }

  renderAll();
})();
