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

/* 面接日が「近い」か（今日〜7日以内）。近ければカードを暖色でハイライト。 */
function interviewSoon(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / 86400000);
  return diffDays >= 0 && diffDays <= 7;
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
  } else {
    renderOubo();
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
  const soon = interviewSoon(c.interviewDate);
  return `
    <article class="card ${soon ? "is-soon" : ""} ${selectionMode && selected ? "is-selected" : ""}" data-id="${c.id}">
      ${selectionMode ? `<span class="card__check ${selected ? "is-on" : ""}"></span>` : ""}
      ${c.favorite ? `<span class="card__fav" title="お気に入り">${ICON_STAR}</span>` : ""}
      <div class="card__swatch" style="background:${colorFor(c.name)}">${esc(initialOf(c.name))}</div>
      <div class="card__body">
        <p class="card__name">${esc(c.name)}</p>
        <p class="card__role">${esc(c.role || "職種未設定")}</p>
        ${
          soon
            ? `<p class="card__soon">${ICON_CLOCK}<span>面接 ${esc(c.interviewDate)}</span></p>`
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
      .map(
        (t) => `<li class="timeline__item">
      <span class="timeline__date">${esc(t.date || "日付なし")}</span>
      <span class="timeline__text">${esc(t.text)}</span>
      <button type="button" class="timeline__del" data-action="del-timeline" data-id="${c.id}" data-entry="${t.id}" title="削除">×</button>
    </li>`
      )
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
  const soon = isOubo && interviewSoon(c.interviewDate);

  boardEl.innerHTML = `
    <div class="detail">
      <button type="button" class="detail__back" data-action="back-to-list">← 一覧に戻る</button>

      <div class="detail__head ${soon ? "is-soon" : ""}">
        <div class="detail__swatch" style="background:${colorFor(c.name)}">${esc(initialOf(c.name))}</div>
        <div class="detail__headmain">
          <h2 class="detail__name">${esc(c.name)}</h2>
          ${
            soon
              ? `<p class="detail__soon">${ICON_CLOCK}<span>面接 ${esc(c.interviewDate)}（まもなく）</span></p>`
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
        ${
          isOubo
            ? `
        <label class="field">
          <span class="field__label">進捗ステージ</span>
          <select data-field="stage">
            ${STAGES.map((s) => `<option value="${s.key}" ${c.stage === s.key ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
          </select>
        </label>
        <div class="field-row">
          <label class="field">
            <span class="field__label">ビザサポート</span>
            <select data-field="visa">
              ${VISA_OPTIONS.map((v) => `<option value="${v}" ${c.visa === v ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span class="field__label">面接日</span>
            <input type="date" data-field="interviewDate" value="${esc(c.interviewDate || "")}" />
          </label>
        </div>`
            : ""
        }
        <label class="field">
          <span class="field__label">業界</span>
          <input type="text" data-field="industry" list="industry-options" value="${esc(c.industry || "")}" placeholder="選ぶか、新しく入力" />
          ${industryDatalist()}
        </label>
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

      <label class="field">
        <span class="field__label">会社ホームページ URL</span>
        <input type="url" name="url" autocomplete="off" placeholder="https://..." />
      </label>

      ${
        isOubo
          ? `
        <label class="field">
          <span class="field__label">ビザサポート</span>
          <select name="visa">
            ${VISA_OPTIONS.map((v) => `<option value="${v}">${v}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span class="field__label">面接日</span>
          <input type="date" name="interviewDate" />
        </label>`
          : ""
      }

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
        interviewDate: f.interviewDate.value || "",
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
    interviewDate: "",
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
  if (e.target.matches && e.target.matches("[data-field]")) {
    saveField(e.target);
    return;
  }
  // 業界メモの自動保存
  if (e.target.id === "industry-memo" && currentIndustry !== "__all__") {
    state.industryMemos = state.industryMemos || {};
    state.industryMemos[currentIndustry] = e.target.value;
    saveState();
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
render();
