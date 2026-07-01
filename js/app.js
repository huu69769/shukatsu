/* ============================================================
 * app.js —— 描画と操作のロジック（第一・第二阶段）
 *
 * 全体の流れ：
 *   1. 画面の状態（今どのモジュール／業界／画面を見ているか等）を変数で持つ
 *   2. render() が state を読んで画面を描き直す（基本はこれを呼べば全部更新される）
 *   3. 操作 → state を変更 → saveState() →（必要なら）render()
 *
 * 画面は 2 種類：
 *   ・一覧（board）… カンバン。モジュール切替・業界・進捗ステージ
 *   ・詳細（detail）… カードを開くと一覧を置き換えて全体に表示。自動保存。
 * ============================================================ */

/* ---------- 画面の状態（UI state） ---------- */
let currentModule = "kininaru"; // "kininaru" | "oubo"
let currentIndustry = "__all__"; // 応募済みで選択中の業界（"__all__" は「すべて」）
let currentView = "board"; // "board"（一覧）| "detail"（詳細）
let detailId = null; // 詳細表示中の会社 ID
let selectionMode = false; // 選択モード中か
let selectedIds = new Set(); // 選択中の会社 ID

/* ---------- よく使う DOM 参照 ---------- */
const boardEl = document.getElementById("board");
const bulkBarEl = document.getElementById("bulk-bar");
const overlayEl = document.getElementById("modal-overlay");
const modalEl = document.getElementById("modal");
const tabsEl = document.getElementById("module-tabs");

/* ============================================================
 * 小さなユーティリティ
 * ============================================================ */

/* HTML エスケープ（ユーザー入力をそのまま innerHTML に入れる時の安全対策） */
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* 会社名から色を決める（アイコン代わりの色ブロック用）。
 * 同じ名前なら必ず同じ色になるよう、文字コードの合計で選ぶ。 */
const SWATCH_COLORS = ["#6FB3B8", "#88B7C9", "#7FA9A0", "#9DB8C4", "#6E9CB0", "#A0C0B4"];
function colorFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SWATCH_COLORS[h % SWATCH_COLORS.length];
}

/* 会社名の先頭 1 文字（色ブロックに重ねる） */
function initialOf(name) {
  const s = String(name || "").trim();
  return s ? s[0] : "・";
}

/* ---- 日付まわり（面接日は廃止。予定・記録はすべてタイムラインで扱う） ---- */

/* 今日の 0 時 */
function today0() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
/* "2026-07-03" → Date（不正なら null） */
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}
/* タイムラインの中で「これからの予定（日付が今日以降）」のうち、最も近いものを返す */
function nextUpcoming(c) {
  const t0 = today0();
  let best = null;
  for (const item of c.timeline || []) {
    const d = parseDate(item.date);
    if (d && d >= t0) {
      if (!best || d < parseDate(best.date)) best = item;
    }
  }
  return best;
}
/* 直近の予定が 7 日以内か（＝カードを暖色でハイライト） */
function isSoon(c) {
  const up = nextUpcoming(c);
  if (!up) return false;
  const diff = Math.round((parseDate(up.date) - today0()) / 86400000);
  return diff >= 0 && diff <= 7;
}
/* タイムラインの 1 件が「これから（予定）」かどうか */
function isFutureEntry(item) {
  const d = parseDate(item.date);
  return !!(d && d >= today0());
}
/* カード表示用の短い日付 "07/03" */
function formatMD(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return "";
  return String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0");
}

/* よく使う SVG アイコン（emoji は使わない方針） */
const ICON_STAR =
  '<svg class="icon icon--star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .6-4.5 4 1.3 5.9L12 16.7 6.6 19.2l1.3-5.9-4.5-4 6-.6z"/></svg>';
const ICON_CLOCK =
  '<svg class="icon icon--clock" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3 2"/></svg>';

/* ============================================================
 * メイン描画：render()
 *   currentView によって「一覧」か「詳細」を描く。
 * ============================================================ */
function render() {
  // モジュールタブの見た目を同期
  document.querySelectorAll(".module-tab").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.module === currentModule);
  });

  // 選択バーが出ている間は、内容が隠れないよう body に印を付ける（CSS で下余白を足す）
  document.body.classList.toggle("is-selecting", selectionMode && currentView === "board");

  if (currentView === "detail") {
    tabsEl.hidden = true; // 詳細ではタブを隠して集中できるように
    bulkBarEl.hidden = true;
    renderDetail();
    return;
  }

  tabsEl.hidden = false;
  if (currentModule === "kininaru") {
    renderKininaru();
  } else if (currentModule === "oubo") {
    renderOubo();
  } else {
    renderJiku();
  }
  renderBulkBar();
}

/* 一覧 ⇄ 詳細の切り替え */
function enterDetail(id) {
  currentView = "detail";
  detailId = id;
  render();
  window.scrollTo(0, 0);
}
function exitDetail() {
  currentView = "board";
  detailId = null;
  render();
}
/* 詳細表示中の会社オブジェクトを取得 */
function currentDetailCompany() {
  const list = currentModule === "oubo" ? state.oubo : state.kininaru;
  return list.find((x) => x.id === detailId);
}

/* ------------------------------------------------------------
 * モジュール①：気になる（未応募リスト）
 * ------------------------------------------------------------ */
function renderKininaru() {
  const list = state.kininaru;

  let html = `
    <div class="toolbar">
      <div class="toolbar__left">
        <h2 class="toolbar__title">気になる</h2>
      </div>
      <div class="toolbar__right">
        <button type="button" class="btn btn--primary" data-action="add">会社を追加</button>
        <button type="button" class="btn btn--ghost" data-action="toggle-select">
          ${selectionMode ? "選択モード解除" : "選択モード"}
        </button>
      </div>
    </div>
  `;

  if (list.length === 0) {
    html += emptyState("まだ会社がありません", "気になる会社を追加してみましょう。");
  } else {
    const groups = groupByIndustry(list);
    for (const industry of Object.keys(groups)) {
      html += `<section class="industry-group">
        <h3 class="industry-group__title">${esc(industry)}</h3>
        <div class="card-grid">
          ${groups[industry].map((c) => cardKininaru(c)).join("")}
        </div>
      </section>`;
    }
  }

  boardEl.innerHTML = html;
}

/* 配列を業界ごとのオブジェクトにまとめる */
function groupByIndustry(list) {
  const groups = {};
  for (const c of list) {
    const key = c.industry || "その他";
    (groups[key] = groups[key] || []).push(c);
  }
  return groups;
}

/* 気になるカード 1 枚分の HTML */
function cardKininaru(c) {
  const selected = selectedIds.has(c.id);
  return `
    <article class="card ${selectionMode && selected ? "is-selected" : ""}" data-id="${c.id}">
      ${selectionMode ? `<span class="card__check ${selected ? "is-on" : ""}"></span>` : ""}
      <div class="card__swatch" style="background:${colorFor(c.name)}">${esc(initialOf(c.name))}</div>
      <div class="card__body">
        <p class="card__name">${esc(c.name)}</p>
        <p class="card__role">${esc(c.role || "職種未設定")}</p>
      </div>
      ${
        selectionMode
          ? ""
          : `<button type="button" class="btn btn--small btn--apply" data-action="apply" data-id="${c.id}">応募した</button>`
      }
    </article>
  `;
}

/* ------------------------------------------------------------
 * モジュール②：応募済み（進捗管理：主モジュール）
 * ------------------------------------------------------------ */
function renderOubo() {
  const tabs =
    `<button type="button" class="ind-tab ${currentIndustry === "__all__" ? "is-active" : ""}" data-industry="__all__">すべて</button>` +
    state.industries
      .map(
        (ind) =>
          `<button type="button" class="ind-tab ${currentIndustry === ind ? "is-active" : ""}" data-industry="${esc(ind)}">${esc(ind)}</button>`
      )
      .join("") +
    `<button type="button" class="ind-tab ind-tab--add" data-action="add-industry">＋ 業界</button>`;

  let html = `
    <div class="industry-bar">${tabs}</div>

    <div class="toolbar">
      <div class="toolbar__left">
        <label class="switch">
          <input type="checkbox" id="fav-only" ${state.settings.favOnly ? "checked" : ""} />
          <span>お気に入りのみ表示</span>
        </label>
      </div>
      <div class="toolbar__right">
        ${
          currentIndustry !== "__all__"
            ? `<button type="button" class="btn btn--ghost btn--danger" data-action="delete-industry">この業界を削除</button>`
            : ""
        }
        <button type="button" class="btn btn--primary" data-action="add">会社を追加</button>
        <button type="button" class="btn btn--ghost" data-action="toggle-select">
          ${selectionMode ? "選択モード解除" : "選択モード"}
        </button>
      </div>
    </div>
  `;

  let list = state.oubo.slice();
  if (currentIndustry !== "__all__") list = list.filter((c) => c.industry === currentIndustry);
  if (state.settings.favOnly) list = list.filter((c) => c.favorite);

  if (list.length === 0) {
    html += emptyState(
      "ここにはまだ会社がありません",
      state.settings.favOnly
        ? "お気に入りに登録すると、ここに表示されます。"
        : "「会社を追加」から応募済みの会社を登録しましょう。"
    );
  } else {
    for (const stage of STAGES) {
      const inStage = list.filter((c) => c.stage === stage.key);
      if (inStage.length === 0) continue;
      html += `<section class="stage-section">
        <h3 class="stage-section__title">${esc(stage.label)}<span class="stage-section__count">${inStage.length}</span></h3>
        <div class="card-grid">
          ${inStage.map((c) => cardOubo(c)).join("")}
        </div>
      </section>`;
    }
  }

  // 業界メモ（特定の業界を選んでいるときだけ、その業界の下に表示。フォーカスを外すと自動保存）
  if (currentIndustry !== "__all__") {
    const memo = (state.industryMemos && state.industryMemos[currentIndustry]) || "";
    html += `<section class="industry-memo">
      <h3 class="industry-memo__title">業界メモ：${esc(currentIndustry)}</h3>
      <textarea class="industry-memo__text" id="industry-memo" rows="4"
        placeholder="この業界を選んだ理由、業界研究のメモ、同業他社の比較など（入力欄から離れると自動保存）">${esc(memo)}</textarea>
    </section>`;
  }

  boardEl.innerHTML = html;
}

/* 応募済みカード 1 枚分の HTML */
function cardOubo(c) {
  const selected = selectedIds.has(c.id);
  const up = nextUpcoming(c); // 直近の予定
  const soon = isSoon(c);
  return `
    <article class="card ${soon ? "is-soon" : ""} ${selectionMode && selected ? "is-selected" : ""}" data-id="${c.id}">
      ${selectionMode ? `<span class="card__check ${selected ? "is-on" : ""}"></span>` : ""}
      ${c.favorite ? `<span class="card__fav" title="お気に入り">${ICON_STAR}</span>` : ""}
      <div class="card__swatch" style="background:${colorFor(c.name)}">${esc(initialOf(c.name))}</div>
      <div class="card__body">
        <p class="card__name">${esc(c.name)}</p>
        <p class="card__role">${esc(c.role || "職種未設定")}</p>
        ${
          soon && up
            ? `<p class="card__soon">${ICON_CLOCK}<span>${esc(formatMD(up.date))} ${esc(up.text)}</span></p>`
            : ""
        }
      </div>
    </article>
  `;
}

/* 空状態の共通パーツ */
function emptyState(title, desc) {
  return `
    <div class="empty">
      <p class="empty__title">${esc(title)}</p>
      <p class="empty__desc">${esc(desc)}</p>
      <button type="button" class="btn btn--primary" data-action="add">会社を追加</button>
    </div>
  `;
}

/* ------------------------------------------------------------
 * モジュール③：就活の軸（プリセット＝母版の管理）
 *   ここは「母版（テンプレート）」を編集できる唯一の場所。
 *   会社カードにはこれを「コピー」して使い、コピーを直しても母版は変わらない。
 * ------------------------------------------------------------ */

/* chip の並び（グループ分けはしない。前半＝主軸型、後半＝条件型の順） */
const JIKU_CHIPS = [
  "自己成長",
  "挑戦",
  "長所を生かす",
  "やりがい",
  "社会貢献",
  "キャリアアップ",
  "業務内容",
  "社内の雰囲気",
  "研修制度",
  "評価されたい",
  "趣味の時間",
];

/* chip を押したとき、内容が空なら入れる「主軸の骨架（下書き）」 */
const JIKU_SKELETONS = {
  自己成長: "〔なぜ〕だから、成長し続けられる環境を求めています。御社の〔特徴〕に惹かれました。",
  挑戦: "若いうちから裁量を持って挑戦したいと考えています。御社の〔特徴〕に惹かれました。",
  長所を生かす: "自分の〔強み〕を活かして、〔誰に/何に〕貢献したいと考えています。",
  やりがい: "〔どんな瞬間〕にやりがいを感じます。だから〔軸〕を大切にしています。",
  社会貢献: "〔関心のある社会課題〕の解決に、〔手段〕を通じて貢献したいと考えています。",
  キャリアアップ: "〔将来像〕を目指し、そのために〔何〕を積める環境を求めています。",
  業務内容: "〔携わりたい業務〕に取り組みたいと考えています。〔なぜ惹かれるか〕だからです。",
  社内の雰囲気: "〔どんな雰囲気〕の環境で働きたいと考えています。御社の〔社風・特徴〕に魅力を感じています。",
  研修制度: "入社後も学び続けたいと考えており、〔研修・育成制度〕が整った環境を重視しています。",
  評価されたい: "成果を正しく評価してもらえる環境で、〔どう成長したいか〕を実現したいと考えています。",
  趣味の時間: "〔大切にしたい時間〕を大事にしながら、長く働き続けられる環境を求めています。",
};

function renderJiku() {
  let html = `
    <div class="toolbar">
      <div class="toolbar__left"><h2 class="toolbar__title">就活の軸</h2></div>
      <div class="toolbar__right">
        <button type="button" class="btn btn--primary" data-action="add-jiku">軸を追加</button>
      </div>
    </div>
  `;

  const presets = state.jikuPresets || [];
  if (presets.length === 0) {
    html += `<div class="empty">
      <p class="empty__title">まだ軸がありません</p>
      <p class="empty__desc">「なぜこの方向か」をテンプレートとして登録しましょう。</p>
      <button type="button" class="btn btn--primary" data-action="add-jiku">軸を追加</button>
    </div>`;
  } else {
    html += `<div class="jiku-list">`;
    for (const p of presets) {
      html += `<div class="jiku-card" data-jiku-id="${p.id}">
        <p class="jiku-chips-hint">タグを押すと、タイトルに追加＋下書きが入ります</p>
        <div class="jiku-chips">
          ${JIKU_CHIPS.map(
            (w) =>
              `<button type="button" class="jiku-chip" data-action="jiku-chip" data-jiku-id="${p.id}" data-word="${esc(w)}" ${p.title.includes(w) ? "disabled" : ""}>${esc(w)}</button>`
          ).join("")}
        </div>
        <input type="text" class="jiku-card__title" data-jikufield="title" data-jiku-id="${p.id}" value="${esc(p.title)}" placeholder="軸のタイトル（例：自己成長・挑戦）" />
        <textarea class="jiku-card__body" data-jikufield="body" data-jiku-id="${p.id}" rows="4" placeholder="例：〔原体験〕から、〔軸〕を大切にしています。御社の〔特徴〕に惹かれました。">${esc(p.body)}</textarea>
        <div class="jiku-card__foot">
          <button type="button" class="btn btn--small btn--ghost" data-action="jiku-clear" data-jiku-id="${p.id}">骨架をクリア</button>
          <button type="button" class="btn btn--small btn--ghost btn--danger" data-action="delete-jiku" data-jiku-id="${p.id}">削除</button>
        </div>
      </div>`;
    }
    html += `</div>`;
  }
  boardEl.innerHTML = html;
}

/* 詳細画面：この会社にコピー済みの軸（副本）一覧 */
function jikuCopiesHTML(c) {
  const list = c.jiku || [];
  if (list.length === 0) {
    return `<p class="jiku-empty">まだ軸を追加していません。下のプリセットから選べます。</p>`;
  }
  return list
    .map(
      (j) => `<div class="jiku-copy" data-jiku-id="${j.id}">
      <input type="text" class="jiku-copy__title" data-copyfield="title" data-jiku-id="${j.id}" value="${esc(j.title)}" placeholder="軸のタイトル" />
      <textarea class="jiku-copy__body" data-copyfield="body" data-jiku-id="${j.id}" rows="3" placeholder="この会社向けに言い回しを調整…">${esc(j.body)}</textarea>
      <button type="button" class="jiku-copy__remove" data-action="remove-jiku-copy" data-jiku-id="${j.id}">この軸を外す</button>
    </div>`
    )
    .join("");
}

/* 詳細画面：プリセットから追加するピッカー */
function jikuPickerHTML() {
  const presets = state.jikuPresets || [];
  let html = `<div class="jiku-add">
    <button type="button" class="btn btn--small btn--primary" data-action="add-jiku-blank">＋ 空で追加</button>`;
  // 母版がある時だけ「プリセットから選ぶ」も出す
  if (presets.length) {
    html += `
    <span class="jiku-add__or">または プリセットから</span>
    <select id="jiku-picker">
      <option value="">選ぶ…</option>
      ${presets.map((p) => `<option value="${p.id}">${esc(p.title || "（無題）")}</option>`).join("")}
    </select>
    <button type="button" class="btn btn--small" data-action="add-jiku-copy">追加</button>`;
  }
  html += `</div>`;
  return html;
}

/* 母版カードの chip 活性状態を、タイトルの内容に合わせて更新する。
 * タイトルにその語が含まれていれば disabled（灰）にする（＝二度押せない）。
 * カード全体を描き直さずに更新するので、入力中のカーソルを壊さない。 */
function updateJikuChips(card, titleValue) {
  card.querySelectorAll(".jiku-chip").forEach((chip) => {
    chip.disabled = titleValue.includes(chip.dataset.word);
  });
}

/* ============================================================
 * 詳細ビュー（一覧を置き換えて表示。全項目が自動保存）
 * ============================================================ */

/* 進捗タイムラインの一覧 HTML（日付の昇順、日付なしは最後） */
function timelineHTML(c) {
  const items = (c.timeline || []).slice().sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  if (items.length === 0) {
    return `<p class="timeline__empty">まだ記録がありません。下から追加できます。</p>`;
  }
  return `<ul class="timeline">
    ${items
      .map((t) => {
        const future = isFutureEntry(t); // これからの予定は暖色＋「予定」
        return `<li class="timeline__item ${future ? "is-upcoming" : ""}">
      <span class="timeline__date">${esc(t.date || "日付なし")}</span>
      ${future ? `<span class="timeline__badge">予定</span>` : ""}
      <span class="timeline__text">${esc(t.text)}</span>
      <button type="button" class="timeline__del" data-action="del-timeline" data-id="${c.id}" data-entry="${t.id}" title="削除">×</button>
    </li>`;
      })
      .join("")}
  </ul>`;
}

/* URL を新しいタブで開くリンク行（URL があるときだけ表示） */
function urlOpenRow(url) {
  if (!url) return "";
  return `<p class="url-open"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">ホームページを開く ↗</a></p>`;
}

/* 業界選択の <datalist>（既存から選ぶ or 新規入力できる） */
function industryDatalist() {
  return `<datalist id="industry-options">
    ${state.industries.map((i) => `<option value="${esc(i)}"></option>`).join("")}
  </datalist>`;
}

function renderDetail() {
  const isOubo = currentModule === "oubo";
  const c = currentDetailCompany();
  if (!c) {
    // 対象が見つからない（削除された等）→ 一覧へ戻す
    exitDetail();
    return;
  }
  const up = nextUpcoming(c);
  const soon = isOubo && isSoon(c);

  boardEl.innerHTML = `
    <div class="detail">
      <button type="button" class="detail__back" data-action="back-to-list">← 一覧に戻る</button>

      <div class="detail__head ${soon ? "is-soon" : ""}">
        <div class="detail__swatch" style="background:${colorFor(c.name)}">${esc(initialOf(c.name))}</div>
        <div class="detail__headmain">
          <h2 class="detail__name">${esc(c.name)}</h2>
          ${
            soon && up
              ? `<p class="detail__soon">${ICON_CLOCK}<span>${esc(formatMD(up.date))} ${esc(up.text)}（まもなく）</span></p>`
              : ""
          }
        </div>
        ${
          isOubo
            ? `<button type="button" class="fav-toggle ${c.favorite ? "is-on" : ""}" data-action="toggle-fav" title="お気に入り">${ICON_STAR}</button>`
            : ""
        }
        <span class="save-status" id="save-status">自動保存</span>
      </div>

      <section class="detail__section">
        <h3 class="detail__section-title">基本情報</h3>
        <label class="field">
          <span class="field__label">会社名 <em>必須</em></span>
          <input type="text" data-field="name" value="${esc(c.name)}" />
        </label>
        <label class="field">
          <span class="field__label">応募職種</span>
          <input type="text" data-field="role" value="${esc(c.role || "")}" />
        </label>
        <label class="field">
          <span class="field__label">業界</span>
          <input type="text" data-field="industry" list="industry-options" value="${esc(c.industry || "")}" placeholder="選ぶか、新しく入力" />
          ${industryDatalist()}
        </label>
        ${
          isOubo
            ? `
        <label class="field">
          <span class="field__label">進捗ステージ</span>
          <select data-field="stage">
            ${STAGES.map((s) => `<option value="${s.key}" ${c.stage === s.key ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span class="field__label">ビザサポート</span>
          <select data-field="visa">
            ${VISA_OPTIONS.map((v) => `<option value="${v}" ${c.visa === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>`
            : ""
        }
        <label class="field">
          <span class="field__label">会社ホームページ URL</span>
          <input type="url" data-field="url" value="${esc(c.url || "")}" placeholder="https://..." />
        </label>
        <span id="url-open-slot">${urlOpenRow(c.url)}</span>
      </section>

      <section class="detail__section">
        <h3 class="detail__section-title">会社メモ</h3>
        <textarea class="detail__memo" data-field="memo" rows="6" placeholder="面接メモ、社風の印象、気づいたことなど（自動保存）">${esc(c.memo || "")}</textarea>
      </section>

      ${
        isOubo
          ? `
      <section class="detail__section">
        <h3 class="detail__section-title">就活の軸</h3>
        ${jikuCopiesHTML(c)}
        ${jikuPickerHTML()}
      </section>`
          : ""
      }

      ${
        isOubo
          ? `
      <section class="detail__section">
        <h3 class="detail__section-title">進捗タイムライン</h3>
        ${timelineHTML(c)}
        <div class="timeline-add">
          <input type="date" id="tl-date" />
          <input type="text" id="tl-text" placeholder="内容（例：一次面接 通過）" />
          <button type="button" class="btn btn--small" data-action="add-timeline" data-id="${c.id}">追加</button>
        </div>
      </section>`
          : ""
      }

      <div class="detail__actions">
        ${
          !isOubo
            ? `<button type="button" class="btn btn--apply" data-action="apply" data-id="${c.id}">応募した</button>`
            : `<span></span>`
        }
        <button type="button" class="btn btn--ghost btn--danger" data-action="delete-company" data-id="${c.id}">この会社を削除</button>
      </div>
    </div>
  `;
}

/* 「保存しました ✓」を一瞬表示するための状態表示 */
let savedTimer = null;
function showSaved() {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.textContent = "保存しました ✓";
  el.classList.add("is-saved");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    el.textContent = "自動保存";
    el.classList.remove("is-saved");
  }, 1500);
}

/* 1 つの入力欄の値を会社オブジェクトへ保存する（自動保存の本体）。 */
function saveField(el) {
  const field = el.dataset.field;
  if (!field) return;
  const c = currentDetailCompany();
  if (!c) return;

  if (field === "name") {
    const v = el.value.trim();
    if (!v) {
      el.value = c.name; // 会社名は必須：空なら元に戻して保存しない
      return;
    }
    c.name = v;
    // 見出しの会社名・色ブロックも更新（再描画はしない）
    const nameEl = document.querySelector(".detail__name");
    if (nameEl) nameEl.textContent = v;
    const sw = document.querySelector(".detail__swatch");
    if (sw) {
      sw.textContent = initialOf(v);
      sw.style.background = colorFor(v);
    }
  } else if (field === "industry") {
    c.industry = el.value.trim();
    ensureIndustry(c.industry);
  } else if (field === "url") {
    c.url = el.value.trim();
    // 「ホームページを開く」リンクも更新
    const slot = document.getElementById("url-open-slot");
    if (slot) slot.innerHTML = urlOpenRow(c.url);
  } else if (field === "role") {
    c.role = el.value.trim();
  } else {
    // memo は改行を保つため trim しない。stage / visa / interviewDate はそのまま。
    c[field] = el.value;
  }
  saveState();
  showSaved();
}

/* タイムライン操作の前に、編集中の全項目を会社に反映しておく（消えないように）。 */
function syncDetailFields(c) {
  document.querySelectorAll("#board [data-field]").forEach((el) => {
    const field = el.dataset.field;
    if (field === "name") {
      const v = el.value.trim();
      if (v) c.name = v;
    } else if (field === "industry") {
      c.industry = el.value.trim();
      ensureIndustry(c.industry);
    } else if (field === "url" || field === "role") {
      c[field] = el.value.trim();
    } else {
      c[field] = el.value;
    }
  });
}

/* ============================================================
 * 一括操作バー（選択モード）
 * ============================================================ */
function renderBulkBar() {
  if (!selectionMode) {
    bulkBarEl.hidden = true;
    bulkBarEl.innerHTML = "";
    return;
  }
  bulkBarEl.hidden = false;
  const count = selectedIds.size;

  let actions = `<button type="button" class="btn btn--danger" data-action="bulk-delete">一括削除</button>`;
  if (currentModule === "oubo") {
    actions =
      `<button type="button" class="btn btn--ghost" data-action="bulk-fav">一括お気に入り</button>` +
      `<button type="button" class="btn btn--ghost" data-action="bulk-unfav">お気に入り解除</button>` +
      actions;
  }

  bulkBarEl.innerHTML = `
    <span class="bulk-bar__count">${count} 件を選択中</span>
    <div class="bulk-bar__actions">
      ${actions}
      <button type="button" class="btn btn--ghost" data-action="toggle-select">キャンセル</button>
    </div>
  `;
}

/* ============================================================
 * モーダル（「会社を追加」専用）
 * ============================================================ */
function openModal(innerHTML) {
  modalEl.innerHTML = innerHTML;
  overlayEl.hidden = false;
}
function closeModal() {
  overlayEl.hidden = true;
  modalEl.innerHTML = "";
}

/* 会社の追加モーダル（追加のときだけモーダルを使う） */
function openAddModal() {
  const isOubo = currentModule === "oubo";
  const presetIndustry = isOubo && currentIndustry !== "__all__" ? currentIndustry : "";

  openModal(`
    <form id="form-add" class="modal__form">
      <h2 class="modal__title">会社を追加</h2>

      <label class="field">
        <span class="field__label">会社名 <em>必須</em></span>
        <input type="text" name="name" required autocomplete="off" />
      </label>

      <label class="field">
        <span class="field__label">応募職種</span>
        <input type="text" name="role" autocomplete="off" />
      </label>

      <label class="field">
        <span class="field__label">業界</span>
        <input type="text" name="industry" list="industry-options" autocomplete="off" value="${esc(presetIndustry)}" placeholder="選ぶか、新しく入力" />
        ${industryDatalist()}
      </label>

      ${
        isOubo
          ? `
        <label class="field">
          <span class="field__label">ビザサポート</span>
          <select name="visa">
            ${VISA_OPTIONS.map((v) => `<option value="${v}">${v}</option>`).join("")}
          </select>
        </label>`
          : ""
      }

      <label class="field">
        <span class="field__label">会社ホームページ URL</span>
        <input type="url" name="url" autocomplete="off" placeholder="https://..." />
      </label>

      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-action="close">キャンセル</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>
  `);

  document.getElementById("form-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    if (!name) return;
    const industry = f.industry.value.trim();

    if (isOubo) {
      ensureIndustry(industry);
      state.oubo.push({
        id: genId(),
        name,
        role: f.role.value.trim(),
        industry,
        url: f.url.value.trim(),
        visa: f.visa.value,
        stage: "entry",
        favorite: false,
        memo: "",
        timeline: [],
        jiku: [],
      });
    } else {
      state.kininaru.push({
        id: genId(),
        name,
        role: f.role.value.trim(),
        industry,
        url: f.url.value.trim(),
        memo: "", // 気になる段階でも調べたことをメモできる
      });
    }
    saveState();
    closeModal();
    render();
  });
}

/* 業界が一覧に無ければ追加する */
function ensureIndustry(industry) {
  if (industry && !state.industries.includes(industry)) {
    state.industries.push(industry);
  }
}

/* ============================================================
 * 各種アクション
 * ============================================================ */

/* 気になる → 応募済み（「応募した」）。メモも引き継ぐ。 */
function applyCompany(id) {
  const idx = state.kininaru.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const c = state.kininaru[idx];
  ensureIndustry(c.industry);
  state.oubo.push({
    id: c.id,
    name: c.name,
    role: c.role || "",
    industry: c.industry || "",
    url: c.url || "",
    visa: "不明",
    stage: "entry", // エントリー済みで開始
    favorite: false,
    memo: c.memo || "", // 投稿前に調べたメモをそのまま引き継ぐ
    timeline: [],
    jiku: [],
  });
  state.kininaru.splice(idx, 1);
  saveState();
}

/* 会社を削除（確認あり） */
function deleteCompany(id) {
  const ok = confirm("この会社を削除します。本当によろしいですか？");
  if (!ok) return false;
  state.kininaru = state.kininaru.filter((c) => c.id !== id);
  state.oubo = state.oubo.filter((c) => c.id !== id);
  saveState();
  return true;
}

/* 業界を追加 */
function addIndustry() {
  const name = (prompt("新しい業界名を入力してください") || "").trim();
  if (!name) return;
  if (state.industries.includes(name)) {
    alert("その業界はすでにあります。");
    return;
  }
  state.industries.push(name);
  saveState();
  currentIndustry = name;
  render();
}

/* 業界を削除（空ならそのまま、会社があれば確認） */
function deleteIndustry(industry) {
  const count = state.oubo.filter((c) => c.industry === industry).length;
  if (count > 0) {
    const ok = confirm(
      `この業界には ${count} 社あります。業界ごと削除すると、その会社も削除されます。本当に削除しますか？`
    );
    if (!ok) return;
  }
  state.industries = state.industries.filter((i) => i !== industry);
  state.oubo = state.oubo.filter((c) => c.industry !== industry);
  state.kininaru = state.kininaru.filter((c) => c.industry !== industry);
  currentIndustry = "__all__";
  saveState();
  render();
}

/* 選択モードの ON/OFF */
function toggleSelectionMode() {
  selectionMode = !selectionMode;
  selectedIds.clear();
  render();
}

/* カードの選択トグル */
function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  render();
}

/* 一括削除 */
function bulkDelete() {
  if (selectedIds.size === 0) return;
  const ok = confirm(`${selectedIds.size} 件を削除します。本当によろしいですか？`);
  if (!ok) return;
  state.kininaru = state.kininaru.filter((c) => !selectedIds.has(c.id));
  state.oubo = state.oubo.filter((c) => !selectedIds.has(c.id));
  selectedIds.clear();
  saveState();
  render();
}

/* 一括お気に入り（応募済みのみ）。on=true で登録、false で解除 */
function bulkFavorite(on) {
  if (selectedIds.size === 0) return;
  state.oubo.forEach((c) => {
    if (selectedIds.has(c.id)) c.favorite = on;
  });
  saveState();
  render();
}

/* ============================================================
 * イベント処理（イベント委譲でまとめて拾う）
 * ============================================================ */

/* モジュールタブ */
tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".module-tab");
  if (!btn) return;
  currentModule = btn.dataset.module;
  currentView = "board"; // 詳細を開いていたら一覧へ
  detailId = null;
  selectionMode = false;
  selectedIds.clear();
  render();
});

/* ボード内クリック（一覧・詳細どちらもここで拾う） */
boardEl.addEventListener("click", (e) => {
  const actionEl = e.target.closest("[data-action]");
  const card = e.target.closest(".card");
  const indTab = e.target.closest(".ind-tab");

  // --- data-action 系 ---
  if (actionEl) {
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;
    switch (action) {
      case "add":
        openAddModal();
        return;
      case "toggle-select":
        toggleSelectionMode();
        return;
      case "add-industry":
        addIndustry();
        return;
      case "delete-industry":
        deleteIndustry(currentIndustry);
        return;
      case "back-to-list":
        exitDetail();
        return;
      case "apply":
        // 一覧のカード上ボタン・詳細のボタン どちらからも
        applyCompany(id);
        if (currentView === "detail") exitDetail();
        else render();
        return;
      case "delete-company":
        if (deleteCompany(id)) exitDetail();
        return;
      case "toggle-fav": {
        // 詳細ページのお気に入り星（応募済みのみ）
        const c = currentDetailCompany();
        if (c && currentModule === "oubo") {
          c.favorite = !c.favorite;
          actionEl.classList.toggle("is-on", c.favorite);
          saveState();
          showSaved();
        }
        return;
      }
      case "add-timeline": {
        const c = currentDetailCompany();
        if (!c) return;
        const dateEl = document.getElementById("tl-date");
        const textEl = document.getElementById("tl-text");
        const text = textEl.value.trim();
        if (!text) {
          textEl.focus();
          return;
        }
        syncDetailFields(c); // 編集中の他項目を失わないように反映
        c.timeline = c.timeline || [];
        c.timeline.push({ id: genId(), date: dateEl.value || "", text });
        saveState();
        renderDetail(); // 一覧に追記
        showSaved();
        return;
      }
      case "del-timeline": {
        const c = currentDetailCompany();
        if (!c) return;
        const entryId = actionEl.dataset.entry;
        syncDetailFields(c);
        c.timeline = (c.timeline || []).filter((t) => t.id !== entryId);
        saveState();
        renderDetail();
        showSaved();
        return;
      }
      case "add-jiku": {
        // 就活の軸タブ：母版を1件追加
        state.jikuPresets = state.jikuPresets || [];
        state.jikuPresets.push({ id: genId(), title: "", body: "" });
        saveState();
        renderJiku();
        return;
      }
      case "jiku-chip": {
        // chip を押す：語をタイトルへ追加＋（内容が空なら）主軸の骨架を入れる
        const jid = actionEl.dataset.jikuId;
        const word = actionEl.dataset.word;
        const card = actionEl.closest(".jiku-card");
        const p = (state.jikuPresets || []).find((x) => x.id === jid);
        if (!p || !card) return;
        const titleEl = card.querySelector('[data-jikufield="title"]');
        const bodyEl = card.querySelector('[data-jikufield="body"]');
        if (!titleEl || !bodyEl) return;
        // タイトルに追加（「・」で連結。すでに含む場合は追加しない＝二重防止）
        if (!titleEl.value.includes(word)) {
          titleEl.value = titleEl.value.trim() ? titleEl.value + "・" + word : word;
        }
        // 内容が空のときだけ主軸の骨架を入れる（＝主軸は1つ）
        if (!bodyEl.value.trim()) {
          bodyEl.value = JIKU_SKELETONS[word] || "";
        }
        p.title = titleEl.value;
        p.body = bodyEl.value;
        saveState();
        updateJikuChips(card, titleEl.value);
        return;
      }
      case "jiku-clear": {
        // 内容（骨架）をクリアして、別の主軸を入れ直せるようにする
        const jid = actionEl.dataset.jikuId;
        const card = actionEl.closest(".jiku-card");
        const p = (state.jikuPresets || []).find((x) => x.id === jid);
        const bodyEl = card && card.querySelector('[data-jikufield="body"]');
        if (bodyEl) bodyEl.value = "";
        if (p) {
          p.body = "";
          saveState();
        }
        if (bodyEl) bodyEl.focus();
        return;
      }
      case "delete-jiku": {
        // 母版を削除（会社にコピー済みの軸は残る）
        const jid = actionEl.dataset.jikuId;
        if (
          confirm(
            "この軸（テンプレート）を削除します。会社にコピー済みの軸はそのまま残ります。よろしいですか？"
          )
        ) {
          state.jikuPresets = (state.jikuPresets || []).filter((p) => p.id !== jid);
          saveState();
          renderJiku();
        }
        return;
      }
      case "add-jiku-blank": {
        // 詳細画面：母版に頼らず、空の軸を直接追加して自分で書く
        const c = currentDetailCompany();
        if (!c) return;
        syncDetailFields(c);
        c.jiku = c.jiku || [];
        c.jiku.push({ id: genId(), title: "", body: "" });
        saveState();
        renderDetail();
        showSaved();
        return;
      }
      case "add-jiku-copy": {
        // 詳細画面：プリセットを選んでこの会社にコピー（独立した副本）
        const c = currentDetailCompany();
        if (!c) return;
        const sel = document.getElementById("jiku-picker");
        const pid = sel && sel.value;
        if (!pid) {
          if (sel) sel.focus();
          return;
        }
        const preset = (state.jikuPresets || []).find((p) => p.id === pid);
        if (!preset) return;
        syncDetailFields(c);
        c.jiku = c.jiku || [];
        c.jiku.push({ id: genId(), title: preset.title, body: preset.body }); // 母版とは切り離したコピー
        saveState();
        renderDetail();
        showSaved();
        return;
      }
      case "remove-jiku-copy": {
        // 詳細画面：この会社から軸（副本）を外す（母版には影響しない）
        const c = currentDetailCompany();
        if (!c) return;
        const jid = actionEl.dataset.jikuId;
        syncDetailFields(c);
        c.jiku = (c.jiku || []).filter((j) => j.id !== jid);
        saveState();
        renderDetail();
        showSaved();
        return;
      }
    }
  }

  // --- 業界バーのタブ切り替え ---
  if (indTab && !indTab.dataset.action) {
    currentIndustry = indTab.dataset.industry;
    render();
    return;
  }

  // --- カードのクリック → 詳細へ（選択モード中は選択トグル） ---
  if (card) {
    const id = card.dataset.id;
    if (selectionMode) {
      toggleSelect(id);
      return;
    }
    enterDetail(id);
  }
});

/* 自動保存：入力欄からフォーカスが外れた時（text / url / textarea など） */
boardEl.addEventListener("focusout", (e) => {
  const t = e.target;
  if (t.matches && t.matches("[data-field]")) {
    saveField(t);
    return;
  }
  // 業界メモの自動保存
  if (t.id === "industry-memo" && currentIndustry !== "__all__") {
    state.industryMemos = state.industryMemos || {};
    state.industryMemos[currentIndustry] = t.value;
    saveState();
    return;
  }
  // 就活の軸：母版（プリセット）の自動保存
  if (t.dataset && t.dataset.jikufield) {
    const p = (state.jikuPresets || []).find((x) => x.id === t.dataset.jikuId);
    if (p) {
      p[t.dataset.jikufield] = t.value;
      saveState();
    }
    return;
  }
  // 就活の軸：会社ごとのコピー（副本）の自動保存
  if (t.dataset && t.dataset.copyfield) {
    const c = currentDetailCompany();
    if (c) {
      const j = (c.jiku || []).find((x) => x.id === t.dataset.jikuId);
      if (j) {
        j[t.dataset.copyfield] = t.value;
        saveState();
        showSaved();
      }
    }
  }
});

/* 母版タイトルを手入力で変えたときも、chip の活性状態をその場で追従させる */
boardEl.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.jikufield === "title") {
    const card = t.closest(".jiku-card");
    if (card) updateJikuChips(card, t.value);
  }
});

/* 自動保存：選択（ステージ・ビザ）や日付は change ですぐ保存。
 * お気に入りのみ表示トグルもここ。 */
boardEl.addEventListener("change", (e) => {
  if (e.target.id === "fav-only") {
    state.settings.favOnly = e.target.checked;
    saveState();
    render();
    return;
  }
  if (e.target.matches && e.target.matches("[data-field]")) {
    saveField(e.target);
  }
});

/* 一括操作バーのボタン */
bulkBarEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  switch (btn.dataset.action) {
    case "bulk-delete":
      bulkDelete();
      break;
    case "bulk-fav":
      bulkFavorite(true);
      break;
    case "bulk-unfav":
      bulkFavorite(false);
      break;
    case "toggle-select":
      toggleSelectionMode();
      break;
  }
});

/* 追加モーダル内クリック（キャンセルのみ。他はフォーム submit で処理） */
modalEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (btn && btn.dataset.action === "close") closeModal();
});

/* オーバーレイの外側クリックで閉じる */
overlayEl.addEventListener("click", (e) => {
  if (e.target === overlayEl) closeModal();
});

/* Esc：モーダルを閉じる／詳細から一覧へ戻る */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!overlayEl.hidden) {
    closeModal();
  } else if (currentView === "detail") {
    exitDetail();
  }
});

/* エクスポート／インポート */
document.getElementById("btn-export").addEventListener("click", exportData);
document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("import-file").click();
});
document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) importData(file, render);
  e.target.value = "";
});

/* ============================================================
 * 起動
 * ============================================================ */

/* 旧データ移行：以前の「面接日(interviewDate)」を、タイムラインの1件に変換する。
 * （面接日フィールドは廃止し、予定・記録はすべてタイムラインで扱うため） */
function migrateInterviewDates() {
  let changed = false;
  for (const c of state.oubo) {
    if (c.interviewDate) {
      c.timeline = c.timeline || [];
      const exists = c.timeline.some((t) => t.date === c.interviewDate);
      if (!exists) {
        c.timeline.push({ id: genId(), date: c.interviewDate, text: "面接" });
      }
      c.interviewDate = "";
      changed = true;
    }
  }
  if (changed) saveState();
}

migrateInterviewDates();
render();
