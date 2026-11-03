const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

test('addMonths は月末を丸める', () => {
  assert.equal(C.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(C.addMonths('2023-01-31', 1), '2023-02-28');
  assert.equal(C.addMonths('2024-05-15', 6), '2024-11-15');
  assert.equal(C.addMonths('2024-11-10', 36), '2027-11-10');
});

test('formatElapsed', () => {
  assert.equal(C.formatElapsed('2024-01-10', '2024-01-10'), '当日');
  assert.equal(C.formatElapsed('2024-01-10', '2024-01-22'), '12日');
  assert.equal(C.formatElapsed('2024-01-10', '2024-04-20'), '3ヶ月10日');
  assert.equal(C.formatElapsed('2023-01-10', '2024-03-20'), '1年2ヶ月');
  assert.equal(C.formatElapsed('2024-01-31', '2024-02-29'), '1ヶ月');
});

test('avgKmPerDay', () => {
  assert.equal(C.avgKmPerDay([{ date: '2024-01-01', km: 10000 }]), null);
  assert.equal(C.avgKmPerDay([{ date: '2024-01-01', km: 10000 }, { date: '2024-01-11', km: 10500 }]), null);
  assert.equal(C.avgKmPerDay([{ date: '2024-01-01', km: 10000 }, { date: '2024-01-31', km: 11500 }]), 50);
});

test('computeStatus: 期間と距離の早い方を推奨時期にする', () => {
  const item = { intervalKm: 5000, intervalMonths: 6 };
  const last = { date: '2024-01-01', km: 10000 };
  const st = C.computeStatus(item, last, { today: '2024-03-01', currentKm: 13000, kmPerDay: 50 });
  assert.equal(st.elapsedDays, 60);
  assert.equal(st.elapsedKm, 3000);
  assert.equal(st.dueKm, 15000);
  assert.equal(st.remainingKm, 2000);
  assert.equal(st.dueDateByTime, '2024-07-01');
  assert.equal(st.dueDateByKm, '2024-04-10'); // 2000km ÷ 50km/日 = 40日後
  assert.equal(st.dueDate, '2024-04-10');
  assert.equal(st.dueReason, 'km');
  assert.equal(st.state, 'ok');
});

test('computeStatus: 状態判定', () => {
  const item = { intervalKm: 5000, intervalMonths: 6 };
  const last = { date: '2024-01-01', km: 10000 };
  assert.equal(C.computeStatus(item, last, { today: '2024-08-01', currentKm: 11000 }).state, 'overdue');
  assert.equal(C.computeStatus(item, last, { today: '2024-02-01', currentKm: 15100 }).state, 'overdue');
  assert.equal(C.computeStatus(item, last, { today: '2024-06-10', currentKm: 11000 }).state, 'soon');
  assert.equal(C.computeStatus(item, last, { today: '2024-02-01', currentKm: 14600 }).state, 'soon');
  assert.equal(C.computeStatus(item, null, { today: '2024-02-01', currentKm: 0 }).state, 'none');
});

test('computeStatus: 期間のみの項目（バッテリー）', () => {
  const st = C.computeStatus({ intervalKm: null, intervalMonths: 36 }, { date: '2023-05-01', km: 20000 },
    { today: '2024-05-01', currentKm: 30000, kmPerDay: 30 });
  assert.equal(st.dueDate, '2026-05-01');
  assert.equal(st.dueKm, undefined);
  assert.equal(st.elapsedText, '1年');
  assert.equal(st.state, 'ok');
});

test('totalCost: 部品代 + 工賃', () => {
  assert.equal(C.totalCost({ partsCost: 4200, laborCost: 1600 }), 5800);
  assert.equal(C.totalCost({ partsCost: 4200, laborCost: null }), 4200);
  assert.equal(C.totalCost({ partsCost: null, laborCost: 1100 }), 1100);
  assert.equal(C.totalCost({ partsCost: 0, laborCost: 0 }), 0);
  assert.equal(C.totalCost({ partsCost: null, laborCost: null }), null);
  // 内訳のない古い記録は以前の費用をそのまま使う
  assert.equal(C.totalCost({ cost: 5000 }), 5000);
  assert.equal(C.totalCost({ cost: null }), null);
});

test('measureLevel: ブレーキパッドとタイヤ溝の判定', () => {
  assert.equal(C.measureLevel('padF', 8), 'ok');
  assert.equal(C.measureLevel('padF', 5), 'soon');
  assert.equal(C.measureLevel('padR', 3), 'overdue');
  assert.equal(C.measureLevel('treadF', 6.5), 'ok');
  assert.equal(C.measureLevel('treadR', 4), 'soon');
  assert.equal(C.measureLevel('treadR', 1.6), 'overdue');
  assert.equal(C.measureLevel('treadR', null), null);
});

test('latestMeasurements: 項目ごとに最新値と前回値', () => {
  const recs = [
    { date: '2025-01-10', km: 40000, padF: 9, treadF: 7 },
    { date: '2026-01-10', km: 50000, padF: 7.5, padR: 8 },
    { date: '2025-06-10', km: 45000, treadF: 6, treadR: 6.5 },
    { date: '2026-03-01', km: 52000 },
  ];
  const m = C.latestMeasurements(recs);
  assert.deepEqual(m.padF, { value: 7.5, date: '2026-01-10', km: 50000, prev: { value: 9, date: '2025-01-10', km: 40000 } });
  assert.equal(m.padR.prev, null);
  assert.equal(m.treadF.value, 6);
  assert.equal(m.treadF.prev.value, 7);
  assert.equal(m.treadR.value, 6.5);
});
