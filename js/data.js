/* ============================================================
 * data.js —— データ層
 *   ・定数（進捗ステージ、ビザ選択肢、初期業界）
 *   ・localStorage への保存／読み込み
 *   ・エクスポート／インポート（全データのバックアップ）
 *
 * 注：このアプリはフレームワークを使わない素の HTML/CSS/JS。
 *     状態は 1 つのオブジェクト `state` にまとめ、変更したら saveState() で保存する。
 * ============================================================ */

/* localStorage のキー。バージョンを付けておくと将来の移行がしやすい。 */
const STORAGE_KEY = "shukatsu_data_v1";

/* 進捗ステージ（全 8 個）。
 * key … データ内部で使う識別子（保存値）
 * label … 画面に出す日本語ラベル
 * 並び順は「順番の目安」。実際はどのステージにも自由に変更できる（順番強制なし）。 */
const STAGES = [
  { key: "entry",      label: "エントリー済み" },
  { key: "setsumeikai", label: "説明会" },
  { key: "ichiji",     label: "一次面接" },
  { key: "niji",       label: "二次面接" },
  { key: "saishu",     label: "最終面接" },
  { key: "kekka",      label: "結果待ち" },
  { key: "naitei",     label: "内定" },
  { key: "oinori",     label: "お祈り（不合格）" },
];

/* ステージ key からラベルを引くヘルパー */
function stageLabel(key) {
  const s = STAGES.find((x) => x.key === key);
  return s ? s.label : key;
}

/* ビザサポートの選択肢 */
const VISA_OPTIONS = ["対応", "非対応", "不明"];

/* 最初から用意しておく業界 */
const DEFAULT_INDUSTRIES = ["ゲーム", "IT", "デザイン", "出版"];

/* ------------------------------------------------------------
 * 初期状態を作る
 *   kininaru … 気になる（未応募）の会社リスト
 *   oubo     … 応募済みの会社リスト
 *   industries … 業界の一覧（両モジュールで共有）
 *   industryMemos / jikuPresets … 第二・第三阶段用の置き場（今は空でOK）
 * ------------------------------------------------------------ */
function createInitialState() {
  return {
    version: 1,
    kininaru: [],
    oubo: [],
    industries: [...DEFAULT_INDUSTRIES],
    industryMemos: {}, // 予約：第二阶段（業界メモ）
    jikuPresets: [],   // 予約：第三阶段（就活の軸プリセット）
    settings: {
      favOnly: false,  // 「お気に入りのみ表示」の状態
    },
  };
}

/* ------------------------------------------------------------
 * localStorage から読み込む。無ければ初期状態。
 * 壊れたデータが入っていても落ちないよう try/catch + 既定値で補完する。
 * ------------------------------------------------------------ */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const data = JSON.parse(raw);
    // 既定値とマージして、足りないキーを補う
    return Object.assign(createInitialState(), data, {
      settings: Object.assign({ favOnly: false }, data.settings || {}),
    });
  } catch (e) {
    console.warn("データの読み込みに失敗しました。初期化します。", e);
    return createInitialState();
  }
}

/* localStorage に保存 */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("保存に失敗しました。", e);
    alert("データの保存に失敗しました。ブラウザの容量設定をご確認ください。");
  }
}

/* 一意な ID を作る（会社ごとに付与） */
function genId() {
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

/* ------------------------------------------------------------
 * エクスポート：全データを 1 つの JSON ファイルにして保存する。
 *   → 両モジュールの会社、業界、（将来の）メモ・軸・設定すべてを含む完全バックアップ。
 * ------------------------------------------------------------ */
function exportData() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  // 日付入りのファイル名（例：shukatsu-backup-20260630.json）
  const d = new Date();
  const stamp =
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");

  const a = document.createElement("a");
  a.href = url;
  a.download = `shukatsu-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------
 * インポート：ファイルを読み込み、確認後に全データを置き換える。
 *   onDone … 成功して state を入れ替えたら呼ぶコールバック（再描画用）
 * ------------------------------------------------------------ */
function importData(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      // 最低限の形チェック
      if (!data || !Array.isArray(data.kininaru) || !Array.isArray(data.oubo)) {
        throw new Error("形式が正しくありません");
      }
      // 黙って上書きせず、必ず確認する
      const ok = confirm(
        "現在のデータをこのファイルの内容で上書きします。よろしいですか？\n（この操作は元に戻せません）"
      );
      if (!ok) return;

      state = Object.assign(createInitialState(), data, {
        settings: Object.assign({ favOnly: false }, data.settings || {}),
      });
      saveState();
      if (onDone) onDone();
      alert("インポートが完了しました。");
    } catch (e) {
      console.error(e);
      alert("インポートに失敗しました。正しいバックアップファイルか確認してください。");
    }
  };
  reader.readAsText(file);
}

/* 状態本体（最後に読み込んでおく。app.js から参照・更新する） */
let state = loadState();
