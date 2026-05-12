(function () {
  const STORAGE_KEY = "mcq-ui-maker-session-v1";

  const rawInput = document.getElementById("raw-input");
  const btnParse = document.getElementById("btn-parse");
  const btnSample = document.getElementById("btn-sample");
  const btnReset = document.getElementById("btn-reset");
  const btnWrongOnly = document.getElementById("btn-wrong-only");
  const btnShowAll = document.getElementById("btn-show-all");
  const parseMessage = document.getElementById("parse-message");
  const exam = document.getElementById("exam");
  const examCount = document.getElementById("exam-count");
  const scorePanel = document.getElementById("score-panel");
  const scoreLine = document.getElementById("score-line");
  const scoreReviewNote = document.getElementById("score-review-note");
  const questionList = document.getElementById("question-list");

  /** Full parser output in document order (includes error stubs). */
  let lastParsedItems = [];
  /** `graded[i]` = null (not answered yet) or `{ correct, chosen }` for base index `i`. */
  let graded = [];
  /** "all" = full parsed list; "wrong" = only items whose latest grade is incorrect. */
  let viewMode = "all";

  let persistTimer = null;

  const SAMPLE = `## Module 0 (markdown-style)

### 1.

What is software engineering primarily concerned with?

A. Writing code only
B. Designing hardware
C. Applying engineering principles to software development
D. Creating databases only

**Answer:** C

---

### 2.

Which of the following best differentiates software engineering from programming?

A. Programming focuses on individual code writing, while software engineering includes planning, testing, maintenance, and teamwork
B. Software engineering never involves coding
C. Programming is more advanced than software engineering
D. They are exactly the same

**Answer:** A

---

Plain format still works:

3) What is the chemical symbol for water?
a) O2
b) CO2
c) H2O
d) NaCl
Answer : c`;

  function setMessage(text, isError) {
    parseMessage.textContent = text || "";
    parseMessage.classList.toggle("error", Boolean(isError));
  }

  function assignBaseIndices(items) {
    let bi = 0;
    for (let i = 0; i < items.length; i++) {
      if (!items[i].error) items[i]._baseIndex = bi++;
    }
  }

  function validCount(items) {
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      if (!items[i].error) n++;
    }
    return n;
  }

  function normalizeGraded(raw, len) {
    const arr = new Array(len).fill(null);
    if (!Array.isArray(raw)) return arr;
    for (let i = 0; i < len; i++) {
      const x = raw[i];
      if (x && typeof x === "object" && "correct" in x && x.chosen != null) {
        arr[i] = { correct: Boolean(x.correct), chosen: String(x.chosen) };
      }
    }
    return arr;
  }

  function persist() {
    try {
      const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        rawInput: rawInput.value,
        lastParsedItems,
        graded,
        viewMode,
        examVisible: !exam.hidden,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      if (e && e.name === "QuotaExceededError") {
        setMessage(
          "Browser storage is full; free some space or shorten the paste so progress can be saved.",
          true
        );
      }
    }
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persist();
    }, 450);
  }

  function countGraded() {
    let answered = 0;
    let correct = 0;
    let wrong = 0;
    for (let i = 0; i < graded.length; i++) {
      const g = graded[i];
      if (!g) continue;
      answered++;
      if (g.correct) correct++;
      else wrong++;
    }
    return { answered, correct, wrong, total: graded.length };
  }

  function wrongBaseIndices() {
    const out = [];
    for (let i = 0; i < graded.length; i++) {
      const g = graded[i];
      if (g && !g.correct) out.push(i);
    }
    return out;
  }

  function updateScoreboard() {
    const { answered, correct, wrong, total } = countGraded();
    const pending = total - answered;
    if (total === 0) {
      scorePanel.hidden = true;
      return;
    }
    scorePanel.hidden = false;
    scoreLine.textContent = `Answered ${answered} / ${total} · Correct ${correct} · Wrong ${wrong} · Not tried ${pending}`;

    const w = wrongBaseIndices().length;
    btnWrongOnly.disabled = w === 0;
    btnWrongOnly.textContent = `Practice wrong only (${w})`;

    btnShowAll.hidden = viewMode !== "wrong";

    if (viewMode === "wrong") {
      const list = wrongBaseIndices();
      scoreReviewNote.hidden = false;
      scoreReviewNote.textContent =
        list.length === 0
          ? "Nothing left in this wrong-only list. Switch back to the full set or load new questions."
          : `This review has ${list.length} question(s) whose last answer was wrong. Pick an option again to update your score.`;
    } else {
      scoreReviewNote.hidden = true;
    }
  }

  function itemByBaseIndex(bi) {
    for (let k = 0; k < lastParsedItems.length; k++) {
      const it = lastParsedItems[k];
      if (!it.error && it._baseIndex === bi) return it;
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * @param {object} item
   * @param {number} listIdx unique index for DOM (radio group names)
   * @param {number} baseIndex index into `graded`
   * @param {{ resume: boolean, reviewOrdinal?: number }} opts
   */
  function mountQuestionCard(item, listIdx, baseIndex, opts) {
    const letters = ["a", "b", "c", "d", "e"];
    const resume = Boolean(opts.resume);
    const reviewOrdinal = opts.reviewOrdinal;

    const card = document.createElement("li");
    card.className = "q-card";
    card.dataset.baseIndex = String(baseIndex);
    card.dataset.listIdx = String(listIdx);

    const displayNum = item.qNum != null ? item.qNum : baseIndex + 1;
    const qLabel =
      reviewOrdinal != null
        ? `Review ${reviewOrdinal} · Q ${displayNum}`
        : `Question ${displayNum}`;

    const optsHtml = letters
      .filter((L) => item.options[L] != null && item.options[L] !== "")
      .map((L) => {
        const id = `q${listIdx}-${L}`;
        return `
            <label class="opt" data-letter="${L}">
              <input type="radio" name="q${listIdx}" value="${L}" id="${id}" />
              <span class="opt__label">${L.toUpperCase()}.</span>
              <span class="opt__text">${escapeHtml(item.options[L])}</span>
            </label>`;
      })
      .join("");

    card.innerHTML = `
        <div class="q-card__meta">
          <span class="q-number">${escapeHtml(qLabel)}</span>
          <span class="q-status q-status--pending" data-role="status">Not answered</span>
        </div>
        <p class="q-prompt">${escapeHtml(item.stem)}</p>
        <div class="options" data-role="options">${optsHtml}</div>
        <div class="reveal" data-role="reveal" hidden>
          <p class="reveal__title">Answer key</p>
          <p class="reveal__body" data-role="answer-line"></p>
        </div>`;

    const statusEl = card.querySelector('[data-role="status"]');
    const reveal = card.querySelector('[data-role="reveal"]');
    const answerLine = card.querySelector('[data-role="answer-line"]');
    const optLabels = card.querySelectorAll(".opt");

    function updateSelectedStyles() {
      const checked = card.querySelector('input[type="radio"]:checked');
      optLabels.forEach((lab) => {
        lab.classList.toggle("opt--selected", Boolean(checked && lab.contains(checked)));
      });
    }

    function applyResult(ok, user) {
      const correct = item.answerLetter;
      statusEl.textContent = ok ? "Correct" : "Incorrect";
      statusEl.className = `q-status ${ok ? "q-status--correct" : "q-status--wrong"}`;

      optLabels.forEach((lab) => {
        const letter = lab.dataset.letter;
        lab.classList.remove("opt--selected");
        lab.classList.add("opt--dim");
        if (letter === correct) {
          lab.classList.add("opt--correct");
          lab.classList.remove("opt--dim");
        }
        if (!ok && letter === user) lab.classList.add("opt--incorrect");
      });

      card.querySelectorAll('input[type="radio"]').forEach((inp) => {
        inp.disabled = true;
      });

      answerLine.textContent = `Answer : ${item.answerRaw || correct.toUpperCase()}`;
      reveal.hidden = false;
    }

    function applyResume(g) {
      const user = g.chosen;
      const ok = g.correct;
      const correct = item.answerLetter;
      const input = card.querySelector(`input[value="${user}"]`);
      if (input) input.checked = true;
      updateSelectedStyles();
      applyResult(ok, user);
    }

    let answerCommitted = Boolean(resume && graded[baseIndex] != null);

    card.querySelectorAll('input[type="radio"]').forEach((inp) => {
      inp.addEventListener("change", () => {
        if (answerCommitted) return;
        const chosen = card.querySelector('input[type="radio"]:checked');
        if (!chosen) return;
        answerCommitted = true;

        const user = chosen.value;
        const ok = user === item.answerLetter;
        graded[baseIndex] = { correct: ok, chosen: user };
        updateSelectedStyles();
        applyResult(ok, user);
        updateScoreboard();
        if (viewMode === "wrong" && ok) renderQuestionList();
        else persist();
      });
    });

    if (resume) {
      const g = graded[baseIndex];
      if (g) applyResume(g);
    }

    questionList.appendChild(card);
  }

  function mountErrorCard(item, listIdx) {
    const card = document.createElement("li");
    card.className = "q-card";
    card.dataset.listIdx = String(listIdx);
    card.innerHTML = `
          <div class="q-card__meta">
            <span class="q-number">Block ${listIdx + 1}</span>
            <span class="q-status q-status--wrong">Parse issue</span>
          </div>
          <p class="q-prompt">${escapeHtml(item.stem || "(no stem detected)")}</p>
          <p class="reveal" style="border-style:solid;background:var(--bad-bg);border-color:var(--bad);">
            <span class="reveal__title">Fix this block</span>
            <span class="reveal__body">${escapeHtml(item.error)}</span>
          </p>`;
    questionList.appendChild(card);
  }

  function renderQuestionList() {
    questionList.innerHTML = "";
    updateScoreboard();

    let listIdx = 0;

    if (viewMode === "all") {
      for (let p = 0; p < lastParsedItems.length; p++) {
        const item = lastParsedItems[p];
        if (item.error) {
          mountErrorCard(item, listIdx);
          listIdx++;
          continue;
        }
        const bi = item._baseIndex;
        const g = graded[bi];
        mountQuestionCard(item, listIdx, bi, { resume: g != null });
        listIdx++;
      }
      persist();
      return;
    }

    const wrong = wrongBaseIndices();
    if (wrong.length === 0) {
      const li = document.createElement("li");
      li.className = "q-card";
      li.innerHTML =
        '<p class="q-prompt" style="margin:0">No wrong answers tracked yet, or you have cleared them. Use the full set and answer questions first.</p>';
      questionList.appendChild(li);
      persist();
      return;
    }

    wrong.forEach((bi, j) => {
      const item = itemByBaseIndex(bi);
      if (!item) return;
      mountQuestionCard(item, listIdx, bi, {
        resume: false,
        reviewOrdinal: j + 1,
      });
      listIdx++;
    });
    persist();
  }

  function tryRestoreSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return;
      if (typeof data.rawInput === "string") rawInput.value = data.rawInput;
      if (!Array.isArray(data.lastParsedItems) || data.lastParsedItems.length === 0) {
        persist();
        return;
      }

      lastParsedItems = data.lastParsedItems;
      assignBaseIndices(lastParsedItems);

      const vlen = validCount(lastParsedItems);
      if (vlen === 0) {
        lastParsedItems = [];
        graded = [];
        viewMode = "all";
        exam.hidden = true;
        scorePanel.hidden = true;
        persist();
        return;
      }

      graded = normalizeGraded(data.graded, vlen);
      viewMode = data.viewMode === "wrong" ? "wrong" : "all";
      if (viewMode === "wrong" && wrongBaseIndices().length === 0) viewMode = "all";

      const valid = lastParsedItems.filter((x) => !x.error);
      const errors = lastParsedItems.filter((x) => x.error);
      const wantExam = data.examVisible !== false && valid.length > 0;

      if (wantExam) {
        exam.hidden = false;
        examCount.textContent = `${valid.length} loaded${errors.length ? ` · ${errors.length} block(s) need fixes` : ""} · restored`;
        setMessage(
          "Session restored from this browser (saved automatically). You can keep going where you left off.",
          false
        );
        renderQuestionList();
      } else {
        exam.hidden = true;
        scorePanel.hidden = true;
        questionList.innerHTML = "";
        examCount.textContent = "";
        setMessage(
          "Your last pasted text was restored. Choose “Load questions” to open the exam again.",
          false
        );
        persist();
      }
    } catch (e) {
      console.warn("Session restore failed", e);
    }
  }

  btnSample.addEventListener("click", () => {
    rawInput.value = SAMPLE;
    setMessage("Sample text inserted. Choose “Load questions”.", false);
    schedulePersist();
  });

  btnParse.addEventListener("click", () => {
    const items = MCQParser.parseMcqText(rawInput.value);
    const valid = items.filter((x) => !x.error);
    if (valid.length === 0) {
      exam.hidden = true;
      scorePanel.hidden = true;
      setMessage(
        "No complete questions found. Use “### 1.” (or “1) …”) then stem, options “A.”–“D.” or “a)” style, then “**Answer:** C” or “Answer: C”.",
        true
      );
      persist();
      return;
    }

    assignBaseIndices(items);

    lastParsedItems = items;
    graded = new Array(valid.length).fill(null);
    viewMode = "all";

    const errors = items.filter((x) => x.error);
    exam.hidden = false;
    examCount.textContent = `${valid.length} loaded${errors.length ? ` · ${errors.length} block(s) need fixes` : ""}`;
    setMessage(
      errors.length
        ? "Some blocks have issues; fix the text and reload. Others are ready to practice."
        : "Tap an option to check each question. Use “Practice wrong only” after you have at least one wrong answer.",
      Boolean(errors.length)
    );
    renderQuestionList();
    exam.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  btnWrongOnly.addEventListener("click", () => {
    if (wrongBaseIndices().length === 0) return;
    viewMode = "wrong";
    renderQuestionList();
    exam.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  btnShowAll.addEventListener("click", () => {
    viewMode = "all";
    renderQuestionList();
    exam.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  btnReset.addEventListener("click", () => {
    exam.hidden = true;
    scorePanel.hidden = true;
    questionList.innerHTML = "";
    examCount.textContent = "";
    lastParsedItems = [];
    graded = [];
    viewMode = "all";
    setMessage("", false);
    rawInput.focus();
    persist();
  });

  rawInput.addEventListener("input", schedulePersist);

  const FORMAT_MODAL_DISMISSED = "mcq-ui-format-guide-dismissed";

  function initFormatGuide() {
    const modal = document.getElementById("format-modal");
    const promptEl = document.getElementById("format-prompt-text");
    const toast = document.getElementById("format-copy-toast");
    const btnOpen = document.getElementById("btn-open-format-guide");
    const btnCopy = document.getElementById("btn-copy-format-prompt");
    const btnClose = document.getElementById("btn-format-modal-close");
    const btnDismiss = document.getElementById("btn-format-modal-dismiss");
    if (!modal || !promptEl) return;

    function openFormatGuide() {
      if (typeof modal.showModal === "function") {
        try {
          modal.showModal();
        } catch (e) {
          modal.setAttribute("open", "");
        }
      } else {
        modal.setAttribute("open", "");
      }
    }

    function closeFormatGuide() {
      if (typeof modal.close === "function") {
        try {
          modal.close();
        } catch (e) {
          modal.removeAttribute("open");
        }
      } else {
        modal.removeAttribute("open");
      }
    }

    btnOpen?.addEventListener("click", () => openFormatGuide());

    btnClose?.addEventListener("click", () => closeFormatGuide());

    btnDismiss?.addEventListener("click", () => {
      localStorage.setItem(FORMAT_MODAL_DISMISSED, "1");
      closeFormatGuide();
    });

    btnCopy?.addEventListener("click", () => {
      const text = promptEl.value;
      if (!text) return;
      const flash = (msg) => {
        if (toast) toast.textContent = msg;
      };
      const clearToastSoon = () => {
        if (toast) setTimeout(() => { toast.textContent = ""; }, 2800);
      };

      const fallbackSelectCopy = () => {
        promptEl.focus();
        promptEl.select();
        try {
          document.execCommand("copy");
          flash("Copied to clipboard.");
        } catch (err) {
          flash("Select the text and copy manually (⌘C / Ctrl+C).");
        }
        clearToastSoon();
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => {
            flash("Copied to clipboard.");
            clearToastSoon();
          },
          () => fallbackSelectCopy()
        );
      } else {
        fallbackSelectCopy();
      }
    });

    if (!localStorage.getItem(FORMAT_MODAL_DISMISSED)) {
      requestAnimationFrame(() => openFormatGuide());
    }
  }

  initFormatGuide();
  tryRestoreSession();
})();
