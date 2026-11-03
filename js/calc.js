/*
 * 計算ロジック（DOM 非依存）。ブラウザでは window.Calc、Node では module.exports として使う。
 * 日付はすべて "YYYY-MM-DD" 形式の文字列で扱う（タイムゾーンのずれを避けるため UTC で計算）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function formatDate(ms) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }

  function todayStr(now = new Date()) {
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const da = String(now.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }

  /** a から b までの日数（b - a） */
  function diffDays(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
  }

  function addDays(dateStr, days) {
    return formatDate(parseDate(dateStr) + Math.round(days) * DAY_MS);
  }

  /** 月加算。月末は丸める（1/31 + 1ヶ月 = 2/28 or 2/29） */
  function addMonths(dateStr, months) {
    const t = parseDate(dateStr);
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + months;
    const day = d.getUTCDate();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return formatDate(Date.UTC(y, m, Math.min(day, lastDay)));
  }

  /** a から b までの経過を {years, months, days} で返す（b >= a 前提） */
  function diffYMD(a, b) {
    const da = new Date(parseDate(a));
    const db = new Date(parseDate(b));
    let months =
      (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
    if (addMonths(a, months) > b) months -= 1;
    const days = diffDays(addMonths(a, months), b);
    return { years: Math.floor(months / 12), months: months % 12, days };
  }

  /** 経過期間を「1年2ヶ月」「3ヶ月10日」「12日」のような日本語で表す */
  function formatElapsed(from, to) {
    if (diffDays(from, to) < 0) return '—';
    const { years, months, days } = diffYMD(from, to);
    const parts = [];
    if (years) parts.push(`${years}年`);
    if (months) parts.push(`${months}ヶ月`);
    if (!years && days) parts.push(`${days}日`);
    if (!parts.length) return days === 0 ? '当日' : `${days}日`;
    return parts.join('');
  }

  /**
   * 走行距離の記録点 [{date, km}] から 1 日あたりの平均走行距離を推定する。
   * 最古と最新の点の差から求める。期間が短すぎる場合は null。
   */
  function avgKmPerDay(points) {
    const valid = points
      .filter((p) => p && parseDate(p.date) !== null && Number.isFinite(p.km))
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.km - y.km));
    if (valid.length < 2) return null;
    const first = valid[0];
    const last = valid[valid.length - 1];
    const days = diffDays(first.date, last.date);
    const km = last.km - first.km;
    if (days < 14 || km <= 0) return null;
    return km / days;
  }

  /**
   * 現在の走行距離を推定する。
   * 記録点の中で最大の距離を採用し、その日付も返す。
   */
  function latestOdometer(points) {
    let best = null;
    for (const p of points) {
      if (!p || !Number.isFinite(p.km) || parseDate(p.date) === null) continue;
      if (!best || p.km > best.km || (p.km === best.km && p.date > best.date)) best = p;
    }
    return best;
  }

  /**
   * 部品ごとの状態を計算する。
   * @param {object} item  {intervalKm, intervalMonths}（どちらか null 可）
   * @param {object|null} last  前回交換記録 {date, km}
   * @param {object} ctx  {today, currentKm, kmPerDay}
   * @param {object} [opts]  タイヤセット用 {usedKm: 装着中に走った距離, mounted: 現在装着中か}
   *   usedKm を渡すと、オドメーターの差ではなく使用距離で距離の判定をする。
   */
  function computeStatus(item, last, ctx, opts = {}) {
    const { today, currentKm, kmPerDay } = ctx;
    const intervalKm = Number(item.intervalKm) > 0 ? Number(item.intervalKm) : null;
    const intervalMonths = Number(item.intervalMonths) > 0 ? Number(item.intervalMonths) : null;

    if (!last) return { state: 'none', intervalKm, intervalMonths };

    const res = { state: 'ok', intervalKm, intervalMonths };
    res.elapsedDays = diffDays(last.date, today);
    res.elapsedText = formatElapsed(last.date, today);
    res.elapsedKm =
      Number.isFinite(currentKm) && Number.isFinite(last.km) ? currentKm - last.km : null;

    // 期間による推奨日
    if (intervalMonths) {
      res.dueDateByTime = addMonths(last.date, intervalMonths);
    }
    // 距離による推奨距離・到達予想日
    if (Number.isFinite(opts.usedKm)) {
      // タイヤセット：装着していた間の走行距離で判定する
      res.usedKmMode = true;
      res.mounted = !!opts.mounted;
      res.elapsedKm = opts.usedKm;
      if (intervalKm) {
        res.remainingKm = intervalKm - opts.usedKm;
        // 装着中のときだけ、オドメーター上の到達距離と到達日を予測できる
        if (res.mounted && Number.isFinite(currentKm)) {
          res.dueKm = currentKm + res.remainingKm;
          if (kmPerDay && kmPerDay > 0) res.dueDateByKm = addDays(today, res.remainingKm / kmPerDay);
        }
      }
    } else if (intervalKm && Number.isFinite(last.km)) {
      res.dueKm = last.km + intervalKm;
      if (Number.isFinite(currentKm)) res.remainingKm = res.dueKm - currentKm;
      if (kmPerDay && kmPerDay > 0 && res.remainingKm !== undefined) {
        res.dueDateByKm = addDays(today, res.remainingKm / kmPerDay);
      }
    }

    // 早い方を推奨時期とする
    const candidates = [];
    if (res.dueDateByTime) candidates.push({ date: res.dueDateByTime, reason: 'time' });
    if (res.dueDateByKm) candidates.push({ date: res.dueDateByKm, reason: 'km' });
    candidates.sort((a, b) => (a.date < b.date ? -1 : 1));
    if (candidates.length) {
      res.dueDate = candidates[0].date;
      res.dueReason = candidates[0].reason;
      res.remainingDays = diffDays(today, res.dueDate);
    }

    // 状態判定
    const daysLeftByTime = res.dueDateByTime ? diffDays(today, res.dueDateByTime) : null;
    const kmMargin = intervalKm ? Math.max(500, intervalKm * 0.1) : null;
    const overdue =
      (daysLeftByTime !== null && daysLeftByTime < 0) ||
      (res.remainingKm !== undefined && res.remainingKm < 0);
    const soon =
      (daysLeftByTime !== null && daysLeftByTime <= 30) ||
      (res.remainingKm !== undefined && res.remainingKm <= kmMargin) ||
      (res.dueDateByKm && diffDays(today, res.dueDateByKm) <= 30);
    res.state = overdue ? 'overdue' : soon ? 'soon' : 'ok';

    // 進捗率（0〜1+）：期間・距離のうち進んでいる方
    const ratios = [];
    if (intervalMonths && res.dueDateByTime) {
      const total = diffDays(last.date, res.dueDateByTime);
      if (total > 0) ratios.push(res.elapsedDays / total);
    }
    if (intervalKm && res.elapsedKm !== null) ratios.push(res.elapsedKm / intervalKm);
    res.progress = ratios.length ? Math.max(0, ...ratios) : null;

    return res;
  }

  /**
   * 記録の費用合計（部品代 + 工賃 + タイヤ脱着料・エアーバルブ交換料・タイヤ処分料）。
   * 内訳がない古い記録は、以前の「費用」(cost) をそのまま合計として扱う。
   * 何も入力されていなければ null。
   */
  const COST_FIELDS = [
    { key: 'partsCost', label: '部品代' },
    { key: 'laborCost', label: '工賃' },
    { key: 'mountFee', label: 'タイヤ脱着料' },
    { key: 'valveFee', label: 'エアーバルブ交換料' },
    { key: 'disposalFee', label: 'タイヤ処分料' },
  ];

  function totalCost(rec) {
    if (!rec) return null;
    const vals = COST_FIELDS.map((f) => rec[f.key]).filter((v) => Number.isFinite(v));
    if (vals.length) return vals.reduce((a, b) => a + b, 0);
    return Number.isFinite(rec.cost) ? rec.cost : null;
  }

  /**
   * 残量測定の項目と判定基準（mm）。
   *   red   : この値以下は交換が必要
   *   yellow: この値以下はそろそろ交換
   * タイヤの 1.6mm は法定の使用限度（スリップサイン）。
   */
  const MEASURES = [
    { key: 'padF', group: 'pad', label: 'ブレーキパッド F', short: 'Fパッド', red: 3, yellow: 5 },
    { key: 'padR', group: 'pad', label: 'ブレーキパッド R', short: 'Rパッド', red: 3, yellow: 5 },
    { key: 'treadF', group: 'tread', label: 'タイヤ残り溝 F', short: 'Fタイヤ', red: 1.6, yellow: 4 },
    { key: 'treadR', group: 'tread', label: 'タイヤ残り溝 R', short: 'Rタイヤ', red: 1.6, yellow: 4 },
  ];
  // 冬タイヤ（スタッドレス）は溝が新品時の約半分（プラットフォーム露出）で冬用として使用限度
  const WINTER_TREAD = { red: 4, yellow: 5.5 };

  /** 測定値の状態: 'overdue'（交換が必要）/ 'soon'（そろそろ）/ 'ok'。tireSet は 'summer' | 'winter' */
  function measureLevel(key, value, tireSet) {
    const m = MEASURES.find((x) => x.key === key);
    if (!m || !Number.isFinite(value)) return null;
    const th = m.group === 'tread' && tireSet === 'winter' ? WINTER_TREAD : m;
    if (value <= th.red) return 'overdue';
    if (value <= th.yellow) return 'soon';
    return 'ok';
  }

  // ---------- 夏タイヤ・冬タイヤ ----------
  const TIRE_SETS = { summer: '夏タイヤ', winter: '冬タイヤ' };

  const byDateKm = (a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.km || 0) - (b.km || 0));

  /**
   * 記録からタイヤの装着イベントを取り出す。
   * 項目の tireSet（'summer' | 'winter'）が付いた記録が対象で、
   * kind が 'swap' なら履き替え、それ以外（購入・交換）なら新しいセットに交換したものとする。
   * いずれも、その時点からそのセットを装着したとみなす。
   * @returns {Array<{id, date, km, set, type: 'purchase'|'swap'}>}
   */
  function tireEvents(records, items) {
    const map = new Map(items.map((i) => [i.id, i]));
    return records
      .filter((r) => {
        const it = map.get(r.itemId);
        return it && it.tireSet && Number.isFinite(r.km);
      })
      .map((r) => {
        const it = map.get(r.itemId);
        return { id: r.id, date: r.date, km: r.km, set: it.tireSet, type: it.kind === 'swap' ? 'swap' : 'purchase' };
      })
      .sort(byDateKm);
  }

  /** 指定時点（日付・距離）で装着していたタイヤセット。記録がなければ null */
  function tireSetAt(events, date, km) {
    let set = null;
    for (const e of events) {
      if (e.date < date || (e.date === date && (e.km || 0) <= (km || 0))) set = e.set;
      else break;
    }
    return set;
  }

  /**
   * 夏・冬それぞれの使用距離（最後に購入・交換してから、装着していた間に走った距離の合計）。
   * @param {Array} events  tireEvents() の結果
   * @param {number|null} endKm  現在の走行距離（装着中のセットの距離をここまで数える）
   */
  function tireUsage(events, endKm) {
    const sets = {
      summer: { km: 0, since: null, tracked: false },
      winter: { km: 0, since: null, tracked: false },
    };
    let mounted = null;
    let mountedSince = null;
    for (const e of events) {
      if (mounted) sets[mounted].km += Math.max(0, e.km - mountedSince.km);
      const s = sets[e.set];
      if (e.type === 'purchase') {
        s.km = 0;
        s.since = { date: e.date, km: e.km };
      }
      s.tracked = true;
      mounted = e.set;
      mountedSince = { date: e.date, km: e.km };
    }
    if (mounted && Number.isFinite(endKm)) sets[mounted].km += Math.max(0, endKm - mountedSince.km);
    return { mounted, mountedSince, sets };
  }

  /**
   * 記録の中から、測定項目ごとに最新の値と 1 つ前の値を取り出す。
   * @returns {{[key]: {value, date, km, prev: {value, date, km}|null}}}
   */
  function latestMeasurements(records) {
    const sorted = records
      .slice()
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.km || 0) - (a.km || 0)));
    const out = {};
    for (const m of MEASURES) {
      const hits = sorted.filter((r) => Number.isFinite(r[m.key]));
      if (!hits.length) continue;
      const pick = (r) => ({ value: r[m.key], date: r.date, km: r.km });
      out[m.key] = { ...pick(hits[0]), prev: hits[1] ? pick(hits[1]) : null };
    }
    return out;
  }

  return {
    COST_FIELDS,
    TIRE_SETS,
    tireEvents,
    tireSetAt,
    tireUsage,
    MEASURES,
    measureLevel,
    latestMeasurements,
    totalCost,
    parseDate,
    formatDate,
    todayStr,
    diffDays,
    addDays,
    addMonths,
    diffYMD,
    formatElapsed,
    avgKmPerDay,
    latestOdometer,
    computeStatus,
  };
});
