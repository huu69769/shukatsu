/* ============================================================
 * app.js —— 描画と操作のロジック（第一阶段：核心看板）
 *
 * 全体の流れ：
 *   1. 画面の状態（今どのモジュール／業界を見ているか等）を変数で持つ
 *   2. render() が state を読んで画面を描き直す（基本はこれを呼べば全部更新される）
 *   3. ボタン等の操作 → state を変更 → saveState() → render()
 *
 * フレームワークを使わないので「state を変えたら render() を呼ぶ」を徹底するのがコツ。
 * ============================================================ */

/* ---------- 画面の状態（UI state） ---------- */
let currentModule = "kininaru"; // "kininaru" | "oubo"
let currentIndustry = "__all__"; // 応募済みで選択中の業界（"__all__" は「すべて」）
let selectionMode = false; // 選択モード中か
let selectedIds = new Set(); // 選択中の会社 ID

/* ---------- よく使う DOM 参照 ---------- */
const boardEl = document.getElementById("board");
const bulkBarEl = document.getElementById("bulk-bar");
const overlayEl = document.getElementById("modal-overlay");
const modalEl = document.getElementById("modal");

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
 * ============================================================ */
function render() {
  // モジュールタブの見た目を同期
  document.querySelectorAll(".module-tab").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.module === currentModule);
  });

  if (currentModule === "kininaru") {
    renderKininaru();
  } else {
    renderOubo();
  }

  renderBulkBar();
}

/* ------------------------------------------------------------
 * モジュール①：気になる（未応募リスト）
 *   業界ごとにまとめて一覧表示。進捗ステージは無し。
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
    // 業界ごとにグループ化（業界未設定は「その他」へ）
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
 *   業界バー → お気に入り絞り込み → ステージ別レイアウト
 * ------------------------------------------------------------ */
function renderOubo() {
  // 業界バー（最左に「すべて」、その右に各業界、末尾に「＋ 業界」）
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

  // 表示対象を絞る（業界 + お気に入り）
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
    // ステージごとに分けて、空のステージは出さない
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

  // 第二阶段：業界メモ（特定の業界を選んでいるときだけ、その業界の下に表示）
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

  // 気になるは「一括削除」のみ。応募済みは削除＋お気に入り操作。
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
 * モーダル（共通）
 * ============================================================ */
function openModal(innerHTML) {
  modalEl.innerHTML = innerHTML;
  overlayEl.hidden = false;
}
function closeModal() {
  overlayEl.hidden = true;
  modalEl.innerHTML = "";
}

/* 業界選択の <datalist>（既存から選ぶ or 新規入力できる） */
function industryDatalist() {
  return `<datalist id="industry-options">
    ${state.industries.map((i) => `<option value="${esc(i)}"></option>`).join("")}
  </datalist>`;
}

/* ------- 会社の追加モーダル -------
 * モジュールによって項目が変わる：
 *   気になる … 会社名 / 応募職種 / 業界 / URL
 *   応募済み … 上記 + ビザ / 面接日（ステージは「エントリー済み」で開始）
 */
function openAddModal() {
  const isOubo = currentModule === "oubo";
  // 応募済みで特定業界を見ているなら、その業界を初期値に
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
      // 新しい業界なら一覧に足す
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
        // 予約フィールド（第二・第三阶段）
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

/* ------- 気になるカードの編集モーダル ------- */
function openKininaruEdit(c) {
  openModal(`
    <form id="form-edit" class="modal__form">
      <h2 class="modal__title">会社を編集</h2>

      <label class="field">
        <span class="field__label">会社名 <em>必須</em></span>
        <input type="text" name="name" required value="${esc(c.name)}" />
      </label>
      <label class="field">
        <span class="field__label">応募職種</span>
        <input type="text" name="role" value="${esc(c.role || "")}" />
      </label>
      <label class="field">
        <span class="field__label">業界</span>
        <input type="text" name="industry" list="industry-options" value="${esc(c.industry || "")}" placeholder="選ぶか、新しく入力" />
        ${industryDatalist()}
      </label>
      <label class="field">
        <span class="field__label">会社ホームページ URL</span>
        <input type="url" name="url" value="${esc(c.url || "")}" placeholder="https://..." />
      </label>
      ${urlOpenRow(c.url)}

      <div class="modal__actions modal__actions--split">
        <button type="button" class="btn btn--ghost btn--danger" data-action="delete-company" data-id="${c.id}">削除</button>
        <div class="modal__actions-right">
          <button type="button" class="btn btn--apply" data-action="apply" data-id="${c.id}">応募した</button>
          <button type="submit" class="btn btn--primary">保存</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById("form-edit").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    if (!name) return;
    c.name = name;
    c.role = f.role.value.trim();
    c.industry = f.industry.value.trim();
    c.url = f.url.value.trim();
    saveState();
    closeModal();
    render();
  });
}

/* 進捗タイムラインの一覧 HTML を作る（日付の昇順、日付なしは最後）。 */
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

/* 詳細フォームの入力値を会社オブジェクト c に書き戻す（保存はしない）。
 * タイムラインの追加/削除でモーダルを開き直す前に、他の入力を失わないよう
 * いったん c に反映させる用途でも使う。会社名が空のときは上書きしない。 */
function commitDetailForm(c, f) {
  const name = f.name.value.trim();
  if (name) c.name = name;
  c.role = f.role.value.trim();
  c.stage = f.stage.value;
  c.visa = f.visa.value;
  c.interviewDate = f.interviewDate.value || "";
  c.industry = f.industry.value.trim();
  ensureIndustry(c.industry);
  c.url = f.url.value.trim();
  c.memo = f.memo.value; // メモは改行などを保つため trim しない
}

/* ------- 応募済みカードの詳細／編集モーダル ------- */
function openOuboDetail(c) {
  openModal(`
    <form id="form-detail" class="modal__form">
      <div class="modal__head">
        <h2 class="modal__title">${esc(c.name)}</h2>
        <button type="button" class="fav-toggle ${c.favorite ? "is-on" : ""}" data-action="toggle-fav" data-id="${c.id}" title="お気に入り">
          ${ICON_STAR}
        </button>
      </div>

      <label class="field">
        <span class="field__label">会社名 <em>必須</em></span>
        <input type="text" name="name" required value="${esc(c.name)}" />
      </label>
      <label class="field">
        <span class="field__label">応募職種</span>
        <input type="text" name="role" value="${esc(c.role || "")}" />
      </label>

      <label class="field">
        <span class="field__label">進捗ステージ</span>
        <select name="stage">
          ${STAGES.map((s) => `<option value="${s.key}" ${c.stage === s.key ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
        </select>
      </label>

      <div class="field-row">
        <label class="field">
          <span class="field__label">ビザサポート</span>
          <select name="visa">
            ${VISA_OPTIONS.map((v) => `<option value="${v}" ${c.visa === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span class="field__label">面接日</span>
          <input type="date" name="interviewDate" value="${esc(c.interviewDate || "")}" />
        </label>
      </div>

      <label class="field">
        <span class="field__label">業界</span>
        <input type="text" name="industry" list="industry-options" value="${esc(c.industry || "")}" />
        ${industryDatalist()}
      </label>

      <label class="field">
        <span class="field__label">会社ホームページ URL</span>
        <input type="url" name="url" value="${esc(c.url || "")}" placeholder="https://..." />
      </label>
      ${urlOpenRow(c.url)}

      <!-- 第二阶段：会社メモ（自由記述） -->
      <label class="field">
        <span class="field__label">会社メモ</span>
        <textarea name="memo" rows="4" placeholder="面接メモ、社風の印象、気づいたことなど">${esc(c.memo || "")}</textarea>
      </label>

      <!-- 第二阶段：進捗タイムライン（日付＋内容を手動で追加） -->
      <div class="field">
        <span class="field__label">進捗タイムライン</span>
        ${timelineHTML(c)}
        <div class="timeline-add">
          <input type="date" id="tl-date" />
          <input type="text" id="tl-text" placeholder="内容（例：一次面接 通過）" />
          <button type="button" class="btn btn--small" data-action="add-timeline" data-id="${c.id}">追加</button>
        </div>
      </div>

      <div class="modal__actions modal__actions--split">
        <button type="button" class="btn btn--ghost btn--danger" data-action="delete-company" data-id="${c.id}">削除</button>
        <div class="modal__actions-right">
          <button type="button" class="btn btn--ghost" data-action="close">キャンセル</button>
          <button type="submit" class="btn btn--primary">保存</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById("form-detail").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim()) return; // 会社名は必須
    commitDetailForm(c, f);
    saveState();
    closeModal();
    render();
  });
}

/* URL を新しいタブで開くリンク行（URL があるときだけ表示） */
function urlOpenRow(url) {
  if (!url) return "";
  return `<p class="url-open"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">ホームページを開く ↗</a></p>`;
}

/* ============================================================
 * 各種アクション
 * ============================================================ */

/* 気になる → 応募済み（「応募した」） */
function applyCompany(id) {
  const idx = state.kininaru.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const c = state.kininaru[idx];
  ensureIndustry(c.industry); // 業界が無ければ自動作成
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
    memo: "",
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
  // 業界一覧から外し、その業界の会社も両モジュールから削除
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
document.getElementById("module-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".module-tab");
  if (!btn) return;
  currentModule = btn.dataset.module;
  selectionMode = false;
  selectedIds.clear();
  render();
});

/* ボード内クリック（追加・選択・カード・業界バー など全部ここで） */
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
      case "apply":
        applyCompany(id);
        render();
        return;
      case "add-industry":
        addIndustry();
        return;
      case "delete-industry":
        deleteIndustry(currentIndustry);
        return;
    }
  }

  // --- 業界バーのタブ切り替え ---
  if (indTab && !indTab.dataset.action) {
    currentIndustry = indTab.dataset.industry;
    render();
    return;
  }

  // --- カードのクリック ---
  if (card) {
    const id = card.dataset.id;
    if (selectionMode) {
      toggleSelect(id);
      return;
    }
    // 通常時：詳細／編集を開く
    if (currentModule === "kininaru") {
      const c = state.kininaru.find((x) => x.id === id);
      if (c) openKininaruEdit(c);
    } else {
      const c = state.oubo.find((x) => x.id === id);
      if (c) openOuboDetail(c);
    }
  }
});

/* お気に入りのみ表示トグル（change イベント） */
boardEl.addEventListener("change", (e) => {
  if (e.target.id === "fav-only") {
    state.settings.favOnly = e.target.checked;
    saveState();
    render();
  }
});

/* 業界メモの自動保存（入力欄からフォーカスが外れた時に保存）。
 * 再描画はしない＝入力中のカーソルや他の状態を壊さない。 */
boardEl.addEventListener("focusout", (e) => {
  if (e.target.id === "industry-memo" && currentIndustry !== "__all__") {
    state.industryMemos = state.industryMemos || {};
    state.industryMemos[currentIndustry] = e.target.value;
    saveState();
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

/* モーダル内クリック（閉じる・削除・応募・お気に入りトグル） */
modalEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "close") {
    closeModal();
  } else if (action === "delete-company") {
    if (deleteCompany(id)) {
      closeModal();
      render();
    }
  } else if (action === "apply") {
    applyCompany(id);
    closeModal();
    render();
  } else if (action === "toggle-fav") {
    const c = state.oubo.find((x) => x.id === id);
    if (c) {
      c.favorite = !c.favorite;
      btn.classList.toggle("is-on", c.favorite);
      saveState();
    }
  } else if (action === "add-timeline") {
    // タイムラインに 1 件追加（内容は必須、日付は任意）
    const c = state.oubo.find((x) => x.id === id);
    if (!c) return;
    const dateEl = document.getElementById("tl-date");
    const textEl = document.getElementById("tl-text");
    const text = textEl.value.trim();
    if (!text) {
      textEl.focus();
      return;
    }
    // 開き直す前に、編集中の他の入力値も c に反映しておく（消えないように）
    commitDetailForm(c, document.getElementById("form-detail"));
    c.timeline = c.timeline || [];
    c.timeline.push({ id: genId(), date: dateEl.value || "", text });
    saveState();
    openOuboDetail(c); // 最新の状態で詳細を描き直す
  } else if (action === "del-timeline") {
    const c = state.oubo.find((x) => x.id === id);
    if (!c) return;
    const entryId = btn.dataset.entry;
    commitDetailForm(c, document.getElementById("form-detail"));
    c.timeline = (c.timeline || []).filter((t) => t.id !== entryId);
    saveState();
    openOuboDetail(c);
  }
});

/* オーバーレイの外側クリックで閉じる */
overlayEl.addEventListener("click", (e) => {
  if (e.target === overlayEl) closeModal();
});

/* Esc キーでモーダルを閉じる */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !overlayEl.hidden) closeModal();
});

/* エクスポート／インポート */
document.getElementById("btn-export").addEventListener("click", exportData);
document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("import-file").click();
});
document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) importData(file, render);
  e.target.value = ""; // 同じファイルを再選択できるようリセット
});

/* ============================================================
 * 起動
 * ============================================================ */
render();
