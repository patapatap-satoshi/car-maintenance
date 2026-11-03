/*
 * データ保存（ブラウザの localStorage）。
 * 構造:
 * {
 *   version: 1,
 *   items:    [{id, name, category, intervalKm, intervalMonths, builtin}],
 *   vehicles: [{id, name, odometerLog: [{date, km}]}],
 *   records:  [{id, vehicleId, itemId, date, km, partNumber, brand,
 *              partsCost, laborCost, cost(= 部品代 + 工賃),
 *              padF, padR, treadF, treadR（残量 mm）, shop, memo}],
 *   activeVehicleId
 * }
 */
(function (root) {
  const KEY = 'car-maintenance:v1';

  // 交換推奨間隔は一般的な目安。車種・使用状況に合わせて設定画面で変更できる。
  const DEFAULT_ITEMS = [
    { id: 'engine-oil', name: 'エンジンオイル', category: 'オイル', intervalKm: 5000, intervalMonths: 6 },
    { id: 'oil-filter', name: 'オイルフィルター（エレメント）', category: 'フィルター', intervalKm: 10000, intervalMonths: 12 },
    { id: 'atf', name: 'ミッションオイル / ATF・CVTF', category: 'オイル', intervalKm: 40000, intervalMonths: 48 },
    { id: 'brake-fluid', name: 'ブレーキフルード', category: 'オイル', intervalKm: null, intervalMonths: 24 },
    { id: 'coolant', name: 'クーラント（冷却水）', category: 'オイル', intervalKm: null, intervalMonths: 24 },
    { id: 'tires', name: 'タイヤ', category: 'タイヤ', intervalKm: 40000, intervalMonths: 48 },
    { id: 'tire-rotation', name: 'タイヤローテーション', category: 'タイヤ', intervalKm: 5000, intervalMonths: null },
    { id: 'battery', name: 'バッテリー', category: 'バッテリー', intervalKm: null, intervalMonths: 36 },
    { id: 'air-filter', name: 'エアフィルター（エアクリーナー）', category: 'フィルター', intervalKm: 30000, intervalMonths: 24 },
    { id: 'cabin-filter', name: 'エアコンフィルター', category: 'フィルター', intervalKm: 15000, intervalMonths: 12 },
    { id: 'fuel-filter', name: '燃料フィルター', category: 'フィルター', intervalKm: 40000, intervalMonths: null },
    { id: 'spark-plug', name: 'スパークプラグ', category: 'その他', intervalKm: 20000, intervalMonths: null },
    { id: 'wiper', name: 'ワイパーゴム', category: 'その他', intervalKm: null, intervalMonths: 12 },
    { id: 'brake-pad', name: 'ブレーキパッド', category: 'その他', intervalKm: 40000, intervalMonths: null },
    { id: 'underbody-wash', name: '下廻りスチーム洗浄', category: '下廻り・防錆', intervalKm: null, intervalMonths: 12 },
    { id: 'chassis-coat', name: '下廻り錆止めシャシ塗装', category: '下廻り・防錆', intervalKm: null, intervalMonths: 24 },
    { id: 'muffler-coat', name: 'マフラー防錆塗装', category: '下廻り・防錆', intervalKm: null, intervalMonths: 24 },
    { id: 'flare', name: '発煙筒', category: 'その他', intervalKm: null, intervalMonths: 48 },
    // 交換はせず、ブレーキパッド残量・タイヤ残り溝だけを記録するための項目（交換時期の計算対象外）
    { id: 'measurement', name: '残量測定のみ（交換なし）', category: '点検', intervalKm: null, intervalMonths: null, measureOnly: true },
  ].map((i) => ({ ...i, builtin: true }));

  const CATEGORIES = ['点検', 'オイル', 'タイヤ', 'バッテリー', 'フィルター', '下廻り・防錆', 'その他'];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function emptyData() {
    const vid = uid();
    return {
      version: 1,
      items: DEFAULT_ITEMS.map((i) => ({ ...i })),
      vehicles: [{ id: vid, name: 'マイカー', odometerLog: [] }],
      records: [],
      activeVehicleId: vid,
    };
  }

  function normalize(data) {
    if (!data || typeof data !== 'object') return emptyData();
    const d = { ...emptyData(), ...data };
    if (!Array.isArray(d.items) || !d.items.length) d.items = DEFAULT_ITEMS.map((i) => ({ ...i }));
    // アプリの更新で増えた標準項目を、既存データにも追加する
    DEFAULT_ITEMS.forEach((def) => {
      if (!d.items.some((i) => i.id === def.id)) d.items.push({ ...def });
    });
    if (!Array.isArray(d.vehicles) || !d.vehicles.length) d.vehicles = emptyData().vehicles;
    d.vehicles.forEach((v) => {
      if (!Array.isArray(v.odometerLog)) v.odometerLog = [];
    });
    if (!Array.isArray(d.records)) d.records = [];
    if (!d.vehicles.some((v) => v.id === d.activeVehicleId)) d.activeVehicleId = d.vehicles[0].id;
    return d;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (e) {
      console.error('データの読み込みに失敗しました', e);
      return emptyData();
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('データの保存に失敗しました', e);
      return false;
    }
  }

  root.Store = { load, save, normalize, emptyData, uid, DEFAULT_ITEMS, CATEGORIES };
})(typeof self !== 'undefined' ? self : this);
