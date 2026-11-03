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

test('totalCost: タイヤ脱着料・エアーバルブ交換料・タイヤ処分料も合計する', () => {
  assert.equal(C.totalCost({ partsCost: 60000, laborCost: null, mountFee: 4400, valveFee: 1320, disposalFee: 1100 }), 66820);
  assert.equal(C.totalCost({ mountFee: 3300 }), 3300);
});

const ITEMS = [
  { id: 'tires', tireSet: 'summer' },
  { id: 'winter-tires', tireSet: 'winter' },
  { id: 'tire-swap-winter', tireSet: 'winter', kind: 'swap' },
  { id: 'tire-swap-summer', tireSet: 'summer', kind: 'swap' },
  { id: 'engine-oil' },
];

test('tireUsage: 夏・冬それぞれ装着していた距離だけを数える', () => {
  const recs = [
    { id: 'a', itemId: 'tires', date: '2024-04-01', km: 10000 },        // 夏タイヤ購入
    { id: 'b', itemId: 'engine-oil', date: '2024-08-01', km: 13000 },
    { id: 'c', itemId: 'winter-tires', date: '2024-12-01', km: 16000 }, // 冬タイヤ購入（夏 6000km）
    { id: 'd', itemId: 'tire-swap-summer', date: '2025-04-01', km: 19000 }, // 冬 3000km
    { id: 'e', itemId: 'tire-swap-winter', date: '2025-12-01', km: 25000 }, // 夏 +6000km
  ];
  const ev = C.tireEvents(recs, ITEMS);
  assert.equal(ev.length, 4);
  const u = C.tireUsage(ev, 27000); // 冬 +2000km
  assert.equal(u.mounted, 'winter');
  assert.deepEqual(u.mountedSince, { date: '2025-12-01', km: 25000 });
  assert.equal(u.sets.summer.km, 12000);
  assert.equal(u.sets.winter.km, 5000);
  assert.deepEqual(u.sets.summer.since, { date: '2024-04-01', km: 10000 });
  assert.deepEqual(u.sets.winter.since, { date: '2024-12-01', km: 16000 });
});

test('tireUsage: 新品に交換すると、そのセットの使用距離は 0 から数え直す', () => {
  const recs = [
    { id: 'a', itemId: 'tires', date: '2024-04-01', km: 10000 },
    { id: 'b', itemId: 'tire-swap-winter', date: '2024-12-01', km: 16000 },
    { id: 'c', itemId: 'tires', date: '2025-04-01', km: 19000 }, // 春に新品の夏タイヤへ
  ];
  const u = C.tireUsage(C.tireEvents(recs, ITEMS), 20000);
  assert.equal(u.mounted, 'summer');
  assert.equal(u.sets.summer.km, 1000);
  assert.equal(u.sets.winter.km, 3000);
  assert.equal(u.sets.winter.since, null); // 冬タイヤは購入記録なし（履き替えのみ）
  assert.equal(u.sets.winter.tracked, true);
});

test('tireSetAt: その時点で装着していたセット', () => {
  const ev = C.tireEvents([
    { id: 'a', itemId: 'tires', date: '2024-04-01', km: 10000 },
    { id: 'b', itemId: 'tire-swap-winter', date: '2024-12-01', km: 16000 },
  ], ITEMS);
  assert.equal(C.tireSetAt(ev, '2024-03-01', 9000), null);
  assert.equal(C.tireSetAt(ev, '2024-06-01', 12000), 'summer');
  assert.equal(C.tireSetAt(ev, '2024-12-01', 16000), 'winter');
  assert.equal(C.tireSetAt(ev, '2025-01-10', 17000), 'winter');
});

test('computeStatus: タイヤセットは使用距離で判定する', () => {
  const item = { intervalKm: 30000, intervalMonths: 48 };
  const last = { date: '2024-12-01', km: 16000 };
  const ctx = { today: '2025-12-01', currentKm: 40000, kmPerDay: 30 };
  const mounted = C.computeStatus(item, last, ctx, { usedKm: 5000, mounted: true });
  assert.equal(mounted.elapsedKm, 5000);
  assert.equal(mounted.remainingKm, 25000);
  assert.equal(mounted.dueKm, 65000);
  assert.equal(mounted.state, 'ok');
  const stored = C.computeStatus(item, last, ctx, { usedKm: 29800, mounted: false });
  assert.equal(stored.remainingKm, 200);
  assert.equal(stored.dueKm, undefined);
  assert.equal(stored.dueDateByKm, undefined);
  assert.equal(stored.state, 'soon');
});

test('measureLevel: 冬タイヤはプラットフォームを基準に判定', () => {
  assert.equal(C.measureLevel('treadF', 5, 'summer'), 'ok');
  assert.equal(C.measureLevel('treadF', 5, 'winter'), 'soon');
  assert.equal(C.measureLevel('treadF', 4, 'winter'), 'overdue');
  assert.equal(C.measureLevel('padF', 4, 'winter'), 'soon');
});
