(() => {
  "use strict";

  const STORAGE_PREFIX = "wd:answer:";

  const state = {
    data: null, // {categories: [...]}
    banks: {}, // categoryId -> 問題配列（遅延ロード）
    activeCategoryId: null,
    selectedItemId: null, // null = 今日のおすすめを表示
    mode: "problem", // "problem" | "browse"
    browseFilter: "all", // "all" | "none" | "answered" | "insight"
    sceneFilter: "all", // "all" | "日常" | "戦闘" | "シリアス"
  };

  const categoryNav = document.getElementById("categoryNav");
  const problemView = document.getElementById("problemView");
  const growthLogView = document.getElementById("growthLogView");
  const growthLogList = document.getElementById("growthLogList");
  const growthLogToggle = document.getElementById("growthLogToggle");

  init();

  async function init() {
    try {
      // ユニークなクエリでブラウザ・CDN両方のキャッシュを迂回する
      const res = await fetch("data/categories.json?_=" + Date.now(), { cache: "no-store" });
      state.data = await res.json();
    } catch (err) {
      problemView.innerHTML = "<p>問題データの読み込みに失敗しました。ローカルで開いている場合は簡易サーバー経由（例: python -m http.server）でアクセスしてください。</p>";
      return;
    }
    renderCategoryNav();
    state.activeCategoryId = state.data.categories[0].id;
    renderProblem();

    growthLogToggle.addEventListener("click", () => {
      const showingLog = !growthLogView.hidden;
      growthLogView.hidden = showingLog;
      problemView.hidden = !showingLog;
      categoryNav.hidden = !showingLog;
      if (!growthLogView.hidden) renderGrowthLog();
    });
  }

  // カテゴリ別バンクの遅延ロード（100問規模でも初回表示を軽く保つ）
  async function ensureBank(categoryId) {
    if (!state.banks[categoryId]) {
      try {
        const res = await fetch(`data/bank-${categoryId}.json?_=` + Date.now(), { cache: "no-store" });
        state.banks[categoryId] = await res.json();
      } catch (err) {
        state.banks[categoryId] = [];
      }
    }
    return state.banks[categoryId];
  }

  function renderCategoryNav() {
    categoryNav.innerHTML = "";
    for (const cat of state.data.categories) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-chip";
      btn.textContent = cat.label;
      btn.setAttribute("aria-pressed", String(cat.id === state.activeCategoryId));
      btn.addEventListener("click", () => {
        state.activeCategoryId = cat.id;
        state.selectedItemId = null;
        state.mode = "problem";
        renderCategoryNav();
        renderProblem();
      });
      categoryNav.appendChild(btn);
    }
  }

  function getJSTDateString(d = new Date()) {
    const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
    const jst = new Date(utcMs + 9 * 60 * 60000);
    return jst.toISOString().slice(0, 10);
  }

  function dailyPickKey(categoryId) {
    return `wd:daily:${categoryId}`;
  }

  function pickRecommendedItem(categoryId) {
    const bank = state.banks[categoryId] || [];
    if (bank.length === 0) return null;
    const dateStr = getJSTDateString();

    // その日すでに選んだ問題があればそれを使う（日内固定。
    // 回答中にステータスが変わっても問題が入れ替わらないようにするため）
    try {
      const raw = localStorage.getItem(dailyPickKey(categoryId));
      if (raw) {
        const pick = JSON.parse(raw);
        const found = pick.date === dateStr ? bank.find((i) => i.id === pick.itemId) : null;
        if (found) return { item: found, dateStr };
      }
    } catch (err) {
      /* 壊れたデータは無視して選び直す */
    }

    // 未着手の問題からランダムに選ぶ。スキップした日があっても未着手が取り残されない
    const unstarted = bank.filter((i) => statusKey(loadSaved(categoryId, i.id)) === "none");
    let item;
    if (unstarted.length > 0) {
      item = unstarted[Math.floor(Math.random() * unstarted.length)];
    } else {
      // 全問着手済みなら、最終更新が最も古い問題（最も寝かせられている問題）を出す
      item = bank
        .slice()
        .sort((a, b) => {
          const ua = loadSaved(categoryId, a.id).updatedAt || "";
          const ub = loadSaved(categoryId, b.id).updatedAt || "";
          return ua < ub ? -1 : ua > ub ? 1 : 0;
        })[0];
    }

    try {
      localStorage.setItem(dailyPickKey(categoryId), JSON.stringify({ date: dateStr, itemId: item.id }));
    } catch (err) {
      /* 保存不可でも表示は続行 */
    }
    return { item, dateStr };
  }

  function storageKey(categoryId, itemId) {
    return `${STORAGE_PREFIX}${categoryId}:${itemId}`;
  }

  function loadSaved(categoryId, itemId) {
    try {
      const raw = localStorage.getItem(storageKey(categoryId, itemId));
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function saveState(categoryId, itemId, patch) {
    const current = loadSaved(categoryId, itemId);
    const next = { ...current, ...patch, updatedAt: getJSTDateString() };
    try {
      localStorage.setItem(storageKey(categoryId, itemId), JSON.stringify(next));
    } catch (err) {
      /* localStorage不可時は無視（保存はベストエフォート） */
    }
    return next;
  }

  function hasAnyAnswer(saved) {
    if (typeof saved.answer === "string" && saved.answer.trim()) return true;
    if (saved.answers && Object.values(saved.answers).some((v) => v && v.trim())) return true;
    return false;
  }

  function statusKey(saved) {
    if (saved.insight && saved.insight.trim()) return "insight";
    if (hasAnyAnswer(saved)) return "answered";
    return "none";
  }

  const STATUS_LABELS = { none: "未着手", answered: "回答あり", insight: "気づきメモ済み" };

  function statusLabel(saved) {
    return STATUS_LABELS[statusKey(saved)];
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
      if (child == null) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function quoteBlock(quote) {
    if (!quote) return null;
    return el("div", { class: "quote-block" }, [
      el("p", {}, quote.text),
      el("span", { class: "source" }, `出典: ${quote.source}`),
    ]);
  }

  function itemSummaryText(item) {
    const raw = item.prompt || item.situation || item.context || item.lens || item.sourceSentence || "";
    return raw.length > 36 ? raw.slice(0, 36) + "…" : raw;
  }

  const TRIPLE_LABELS = {
    a: "(a) 一人称・内面過多",
    b: "(b) 三人称・カメラ描写のみ",
    c: "(c) 会話のみ",
  };

  function modelAnswerSets(modelAnswers) {
    // modelAnswers: [{label, text}] または [{label, a, b, c}]
    return modelAnswers.map((set) => {
      const bodyChildren = [];
      if (set.text !== undefined) {
        bodyChildren.push(el("p", {}, set.text));
      } else {
        if (set.a !== undefined) bodyChildren.push(el("p", {}, `${TRIPLE_LABELS.a}: ${set.a}`));
        if (set.b !== undefined) bodyChildren.push(el("p", {}, `${TRIPLE_LABELS.b}: ${set.b}`));
        if (set.c !== undefined) bodyChildren.push(el("p", {}, `${TRIPLE_LABELS.c}: ${set.c}`));
      }
      if (set.source) {
        bodyChildren.push(el("span", { class: "source" }, `出典: ${set.source}`));
      }
      return el("div", { class: "model-answer-set" }, [
        el("h3", {}, set.label ? `回答例（${set.label}）` : "回答例"),
        ...bodyChildren,
      ]);
    });
  }

  function insightField(categoryId, itemId, saved) {
    const wrapper = el("div", { class: "answer-field" }, [
      el("label", { for: "insight" }, "気づきメモ（自分に欠けていた技術を一言で）"),
    ]);
    const textarea = el("textarea", { id: "insight", rows: "2" });
    textarea.value = saved.insight || "";
    textarea.addEventListener("input", () => {
      saveState(categoryId, itemId, { insight: textarea.value });
    });
    wrapper.appendChild(textarea);
    return wrapper;
  }

  function revealButton(onReveal) {
    const btn = el("button", { type: "button", class: "primary-button" }, "回答例を見る");
    btn.addEventListener("click", () => {
      btn.remove();
      onReveal();
    }, { once: true });
    return btn;
  }

  function goToday() {
    state.selectedItemId = null;
    state.mode = "problem";
    renderProblem();
  }

  function goBrowse() {
    state.mode = "browse";
    renderProblem();
  }

  function viewToggleRow(bankLength, isToday) {
    const row = el("div", { class: "view-toggle" });
    if (!isToday) {
      const backBtn = el("button", { type: "button", class: "ghost-button" }, "今日のおすすめに戻る");
      backBtn.addEventListener("click", goToday);
      row.appendChild(backBtn);
    }
    const browseBtn = el("button", { type: "button", class: "ghost-button" }, `全問題を見る（${bankLength}問）`);
    browseBtn.addEventListener("click", goBrowse);
    row.appendChild(browseBtn);
    return row;
  }

  async function renderProblem() {
    growthLogView.hidden = true;
    problemView.hidden = false;
    categoryNav.hidden = false;
    problemView.innerHTML = "";

    const cat = state.data.categories.find((c) => c.id === state.activeCategoryId);
    const bank = await ensureBank(cat.id);

    if (bank.length === 0) {
      problemView.appendChild(el("p", {}, "このカテゴリにはまだ問題が登録されていません。"));
      return;
    }

    const recommended = pickRecommendedItem(cat.id);

    if (state.mode === "browse") {
      renderBrowseList(cat, bank, recommended.item.id);
      return;
    }

    const item = state.selectedItemId ? bank.find((i) => i.id === state.selectedItemId) : null;
    const activeItem = item || recommended.item;
    const isToday = activeItem.id === recommended.item.id;
    const saved = loadSaved(cat.id, activeItem.id);

    problemView.appendChild(viewToggleRow(bank.length, isToday));
    problemView.appendChild(
      el("h2", {}, `${cat.label}｜${isToday ? "今日の問題" : "問題を選択中"}`)
    );
    if (activeItem.episode) {
      problemView.appendChild(
        el("p", { class: "hint" }, [activeItem.episode, activeItem.scene].filter(Boolean).join("｜"))
      );
    }

    switch (cat.kind) {
      case "checklist":
        renderChecklist(cat, activeItem, saved);
        break;
      case "triple":
        renderTriple(cat, activeItem, saved);
        break;
      case "single":
        renderSingle(cat, activeItem, saved);
        break;
      default:
        problemView.appendChild(el("p", {}, "未対応の問題形式です。"));
    }
  }

  function renderBrowseList(cat, bank, recommendedItemId) {
    const backRow = el("div", { class: "view-toggle" });
    const backBtn = el("button", { type: "button", class: "ghost-button" }, "← 今日の問題に戻る");
    backBtn.addEventListener("click", goToday);
    backRow.appendChild(backBtn);
    problemView.appendChild(backRow);
    problemView.appendChild(el("h2", {}, `${cat.label}｜全${bank.length}問`));

    const entries = bank.map((item) => {
      const saved = loadSaved(cat.id, item.id);
      return { item, saved, status: statusKey(saved) };
    });
    const counts = { all: entries.length, none: 0, answered: 0, insight: 0 };
    for (const e of entries) counts[e.status]++;

    const FILTERS = [
      ["all", "すべて"],
      ["none", "未着手"],
      ["answered", "回答あり"],
      ["insight", "メモ済み"],
    ];
    const filterRow = el("div", { class: "filter-row" });
    for (const [key, label] of FILTERS) {
      const chip = el(
        "button",
        { type: "button", class: "category-chip filter-chip", "aria-pressed": String(state.browseFilter === key) },
        `${label}（${counts[key]}）`
      );
      chip.addEventListener("click", () => {
        state.browseFilter = key;
        renderProblem();
      });
      filterRow.appendChild(chip);
    }
    problemView.appendChild(filterRow);

    // シーン種別（日常/戦闘/シリアス）の絞り込み。タグ付き問題がある場合のみ表示
    const scenes = [...new Set(bank.map((i) => i.scene).filter(Boolean))];
    if (scenes.length > 1) {
      const sceneRow = el("div", { class: "filter-row" });
      for (const key of ["all", ...scenes]) {
        const chip = el(
          "button",
          { type: "button", class: "category-chip filter-chip", "aria-pressed": String(state.sceneFilter === key) },
          key === "all" ? "全シーン" : key
        );
        chip.addEventListener("click", () => {
          state.sceneFilter = key;
          renderProblem();
        });
        sceneRow.appendChild(chip);
      }
      problemView.appendChild(sceneRow);
    }

    const visible = entries.filter(
      (e) =>
        (state.browseFilter === "all" || e.status === state.browseFilter) &&
        (state.sceneFilter === "all" || e.item.scene === state.sceneFilter)
    );
    const list = el("div", { class: "growth-log-list" });
    if (visible.length === 0) {
      list.appendChild(el("p", { class: "hint" }, "この条件に該当する問題はありません。"));
    }
    for (const { item, saved } of visible) {
      const isRecommended = item.id === recommendedItemId;
      const metaText = [isRecommended ? "今日のおすすめ" : null, statusLabel(saved), item.scene, item.episode]
        .filter(Boolean)
        .join("｜");
      const row = el("button", { type: "button", class: "growth-log-item browse-row" }, [
        el("div", { class: "meta" }, metaText),
        el("div", {}, itemSummaryText(item)),
      ]);
      row.addEventListener("click", () => {
        state.selectedItemId = item.id;
        state.mode = "problem";
        renderProblem();
      });
      list.appendChild(row);
    }
    problemView.appendChild(list);
  }

  function renderChecklist(cat, item, saved) {
    problemView.appendChild(quoteBlock(item.quote));
    if (item.context) problemView.appendChild(el("p", { class: "prompt-text" }, item.context));

    const answers = saved.answers || {};
    item.checklistQuestions.forEach((q, i) => {
      const field = el("div", { class: "answer-field" }, [el("label", {}, q)]);
      const textarea = el("textarea", { rows: "2" });
      textarea.value = answers[i] || "";
      textarea.addEventListener("input", () => {
        // 共有オブジェクトを直接更新しないと、他の欄の保存済み回答を消してしまう
        answers[i] = textarea.value;
        saveState(cat.id, item.id, { answers: { ...answers } });
      });
      field.appendChild(textarea);
      problemView.appendChild(field);
    });

    const revealArea = el("div", { class: "reveal-area" }, []);
    const doReveal = () => {
      revealArea.appendChild(el("p", { class: "disclaimer" }, "以下は模範チェックリストの一例です。"));
      item.modelChecklist.forEach((a, i) => {
        revealArea.appendChild(el("p", {}, `${item.checklistQuestions[i]}: ${a}`));
      });
      revealArea.appendChild(el("div", { class: "explanation" }, item.explanation));
      revealArea.appendChild(insightField(cat.id, item.id, saved));
      saveState(cat.id, item.id, { revealed: true });
    };

    if (saved.revealed) doReveal();
    else problemView.appendChild(revealButton(doReveal));
    problemView.appendChild(revealArea);
  }

  function renderTriple(cat, item, saved) {
    problemView.appendChild(el("p", { class: "prompt-text" }, item.situation));
    problemView.appendChild(quoteBlock(item.quote));

    const answers = saved.answers || {};
    for (const key of ["a", "b", "c"]) {
      const field = el("div", { class: "answer-field" }, [el("label", {}, TRIPLE_LABELS[key])]);
      const textarea = el("textarea", { rows: "4" });
      textarea.value = answers[key] || "";
      textarea.addEventListener("input", () => {
        // 共有オブジェクトを直接更新しないと、他の欄の保存済み回答を消してしまう
        answers[key] = textarea.value;
        saveState(cat.id, item.id, { answers: { ...answers } });
      });
      field.appendChild(textarea);
      problemView.appendChild(field);
    }

    const revealArea = el("div", { class: "reveal-area" }, []);
    const doReveal = () => {
      revealArea.appendChild(el("p", { class: "disclaimer" }, "これは唯一の正解ではありません。方向性の異なる2つの回答例を示します。"));
      revealArea.append(...modelAnswerSets(item.modelAnswers));
      revealArea.appendChild(el("div", { class: "explanation" }, item.explanation));
      revealArea.appendChild(insightField(cat.id, item.id, saved));
      saveState(cat.id, item.id, { revealed: true });
    };

    if (saved.revealed) doReveal();
    else problemView.appendChild(revealButton(doReveal));
    problemView.appendChild(revealArea);
  }

  function renderSingle(cat, item, saved) {
    if (item.constraint) {
      problemView.appendChild(el("p", { class: "prompt-text" }, item.situation));
      problemView.appendChild(el("p", { class: "prompt-text" }, `制約: ${item.constraint}`));
    } else if (item.lens) {
      problemView.appendChild(el("p", { class: "prompt-text" }, `今日のレンズ: ${item.lens}`));
      problemView.appendChild(quoteBlock({ text: item.sampleText, source: "推敲前サンプル" }));
    } else if (item.sourceSentence) {
      problemView.appendChild(el("p", { class: "prompt-text" }, `元の一文（${item.targetDistance}へ書き換える）:`));
      problemView.appendChild(quoteBlock(item.quote || { text: item.sourceSentence, source: "サンプル" }));
    }

    const answerField = el("div", { class: "answer-field" }, [el("label", {}, "自分の回答")]);
    const textarea = el("textarea", { rows: "5" });
    textarea.value = saved.answer || "";
    textarea.addEventListener("input", () => saveState(cat.id, item.id, { answer: textarea.value }));
    answerField.appendChild(textarea);
    problemView.appendChild(answerField);

    const revealArea = el("div", { class: "reveal-area" }, []);
    const doReveal = () => {
      const hasMultiple = Array.isArray(item.modelAnswers) && item.modelAnswers.length > 1;
      if (hasMultiple) {
        revealArea.appendChild(el("p", { class: "disclaimer" }, "これは唯一の正解ではありません。方向性の異なる2つの回答例を示します。"));
        revealArea.append(...modelAnswerSets(item.modelAnswers));
      } else if (item.modelAnswers) {
        revealArea.append(...modelAnswerSets(item.modelAnswers));
      } else if (item.modelAnswer) {
        revealArea.appendChild(el("div", { class: "model-answer-set" }, [
          el("h3", {}, "回答例"),
          el("p", {}, item.modelAnswer),
        ]));
      }
      revealArea.appendChild(el("div", { class: "explanation" }, item.explanation));
      revealArea.appendChild(insightField(cat.id, item.id, saved));
      saveState(cat.id, item.id, { revealed: true });
    };

    if (saved.revealed) doReveal();
    else problemView.appendChild(revealButton(doReveal));
    problemView.appendChild(revealArea);
  }

  function answerPreviewText(value) {
    let text = "";
    if (typeof value.answer === "string" && value.answer.trim()) {
      text = value.answer;
    } else if (value.answers && typeof value.answers === "object") {
      text = Object.values(value.answers).filter(Boolean).join(" / ");
    }
    return text.length > 80 ? text.slice(0, 80) + "…" : text;
  }

  async function renderGrowthLog() {
    growthLogList.innerHTML = "";
    // 問題サマリ表示のため全カテゴリのバンクを読み込む
    await Promise.all(state.data.categories.map((c) => ensureBank(c.id)));
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      let value;
      try {
        value = JSON.parse(localStorage.getItem(key));
      } catch (err) {
        continue;
      }
      if (!value) continue;
      const answerPreview = answerPreviewText(value);
      if (!value.insight && !answerPreview) continue;
      const rest = key.slice(STORAGE_PREFIX.length);
      const sep = rest.indexOf(":");
      const categoryId = rest.slice(0, sep);
      const itemId = rest.slice(sep + 1);
      const cat = state.data.categories.find((c) => c.id === categoryId);
      const bankItem = (state.banks[categoryId] || []).find((it) => it.id === itemId);
      entries.push({
        categoryId,
        itemId,
        updatedAt: value.updatedAt || "",
        label: cat ? cat.label : categoryId,
        insight: value.insight || "",
        answerPreview,
        problemSummary: bankItem ? itemSummaryText(bankItem) : "",
      });
    }
    entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    if (entries.length === 0) {
      growthLogList.appendChild(el("p", { class: "hint" }, "まだ記録がありません。問題に回答してみましょう。"));
      return;
    }

    for (const entry of entries) {
      const metaText = entry.problemSummary
        ? `${entry.updatedAt}｜${entry.label}｜${entry.problemSummary}`
        : `${entry.updatedAt}｜${entry.label}`;
      const children = [el("div", { class: "meta" }, metaText)];
      if (entry.answerPreview) {
        children.push(el("p", { class: "hint" }, `自分の回答: ${entry.answerPreview}`));
      }
      children.push(el("div", {}, entry.insight ? `気づき: ${entry.insight}` : "（気づきメモ未記入）"));
      const row = el("button", { type: "button", class: "growth-log-item browse-row" }, children);
      row.addEventListener("click", () => {
        state.activeCategoryId = entry.categoryId;
        state.selectedItemId = entry.itemId;
        state.mode = "problem";
        renderCategoryNav();
        renderProblem();
      });
      growthLogList.appendChild(row);
    }
  }
})();
