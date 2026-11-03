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
   */
  function computeStatus(item, last, ctx) {
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
    if (intervalKm && Number.isFinite(last.km)) {
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

  return {
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
