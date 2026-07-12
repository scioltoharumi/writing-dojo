(() => {
  "use strict";

  const STORAGE_PREFIX = "wd:answer:";

  const state = {
    data: null,
    activeCategoryId: null,
    selectedItemId: null, // null = 今日のおすすめを表示
    mode: "problem", // "problem" | "browse"
  };

  const categoryNav = document.getElementById("categoryNav");
  const problemView = document.getElementById("problemView");
  const growthLogView = document.getElementById("growthLogView");
  const growthLogList = document.getElementById("growthLogList");
  const growthLogToggle = document.getElementById("growthLogToggle");

  init();

  async function init() {
    try {
      const res = await fetch("data/questions.json", { cache: "no-store" });
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

  function daysSinceEpoch(dateStr) {
    return Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 86400000);
  }

  function pickRecommendedItem(categoryId) {
    const bank = state.data.banks[categoryId] || [];
    if (bank.length === 0) return null;
    const dateStr = getJSTDateString();
    // バンクを一巡させるため、日数ベースの周回で「今日のおすすめ」を選ぶ
    const days = daysSinceEpoch(dateStr);
    const idx = ((days % bank.length) + bank.length) % bank.length;
    return { item: bank[idx], dateStr };
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

  function statusLabel(saved) {
    if (saved.insight && saved.insight.trim()) return "気づきメモ済み";
    if (hasAnyAnswer(saved)) return "回答あり";
    return "未着手";
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

  function renderProblem() {
    growthLogView.hidden = true;
    problemView.hidden = false;
    categoryNav.hidden = false;
    problemView.innerHTML = "";

    const cat = state.data.categories.find((c) => c.id === state.activeCategoryId);
    const bank = state.data.banks[cat.id] || [];

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

    switch (cat.kind) {
      case "memo":
        renderMemo(cat, activeItem, saved);
        break;
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

    const list = el("div", { class: "growth-log-list" });
    for (const item of bank) {
      const saved = loadSaved(cat.id, item.id);
      const isRecommended = item.id === recommendedItemId;
      const metaText = [isRecommended ? "今日のおすすめ" : null, statusLabel(saved)]
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

  function renderMemo(cat, item, saved) {
    problemView.appendChild(el("p", { class: "prompt-text" }, item.prompt));
    problemView.appendChild(
      el("ul", { class: "key-points" }, item.keyPoints.map((k) => el("li", {}, k)))
    );

    const answerField = el("div", { class: "answer-field" }, [el("label", {}, "自分の再現文")]);
    const textarea = el("textarea", { rows: "8" });
    textarea.value = saved.answer || "";
    textarea.addEventListener("input", () => saveState(cat.id, item.id, { answer: textarea.value }));
    answerField.appendChild(textarea);
    problemView.appendChild(answerField);

    if (!saved.revealed) {
      problemView.appendChild(el("p", { class: "disclaimer" }, "原文は「回答例を見る」を押すまで表示されません。先に自分の再現文を書き終えてから開いてください。"));
    }

    const revealArea = el("div", { class: "reveal-area" }, []);

    const doReveal = () => {
      revealArea.appendChild(quoteBlock(item.reveal.quote));
      revealArea.appendChild(el("div", { class: "explanation" }, item.reveal.explanation));
      revealArea.appendChild(insightField(cat.id, item.id, saved));
      saveState(cat.id, item.id, { revealed: true });
    };

    if (saved.revealed) {
      doReveal();
    } else {
      problemView.appendChild(revealButton(doReveal));
    }
    problemView.appendChild(revealArea);
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
        const next = { ...answers, [i]: textarea.value };
        saveState(cat.id, item.id, { answers: next });
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
        const next = { ...answers, [key]: textarea.value };
        saveState(cat.id, item.id, { answers: next });
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
    if (typeof value.answer === "string" && value.answer.trim()) {
      return value.answer;
    }
    if (value.answers && typeof value.answers === "object") {
      const joined = Object.values(value.answers).filter(Boolean).join(" / ");
      if (joined) return joined;
    }
    return "";
  }

  function renderGrowthLog() {
    growthLogList.innerHTML = "";
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
      const bankItem = (state.data.banks[categoryId] || []).find((it) => it.id === itemId);
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
