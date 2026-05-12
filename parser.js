/**
 * Parse pasted MCQ text into structured items.
 *
 * Supports:
 * - Markdown headings: "### 1.", "### 26" (stem on following lines)
 * - Legacy: "1) …", "12. …", "Q3) …", "question) …"
 * - Options: "a) …", "A. …", "b - …", optional "options)…" prefix
 * - Answer: "Answer: …", "Answer : …", "**Answer:** …" (markdown bold)
 * - Ignores "---" separators between blocks
 */

(function (global) {
  /** e.g. A. foo, b) bar */
  const OPTION_LINE = /^([a-eA-E])\s*[).:\-–—]\s*(.*)$/;
  /** Leading/trailing asterisks/underscores around Answer label allowed */
  const ANSWER_LINE = /^[*_\s]*answer\s*[*_]*\s*:\s*(.+)$/i;
  /** ### 12. optional stem on same line */
  const QUESTION_MD = /^#{3,}\s*(\d+)\s*\.?\s*(.*)$/;
  const QUESTION_LEGACY =
    /^(?:(?:q\s*)?(\d+)\s*[.)]\s*|question\)\s*)(.*)$/i;

  function matchQuestionStart(trimmed) {
    const md = trimmed.match(QUESTION_MD);
    if (md) {
      return {
        qNum: md[1],
        sameLineStem: (md[2] || "").trim(),
        isMarkdown: true,
      };
    }
    const leg = trimmed.match(QUESTION_LEGACY);
    if (leg) {
      return {
        qNum: leg[1] || null,
        sameLineStem: (leg[2] || "").trim(),
        isMarkdown: false,
      };
    }
    return null;
  }

  function isNoiseLine(trimmed) {
    if (!trimmed) return true;
    if (/^-{3,}\s*$/.test(trimmed)) return true;
    return false;
  }

  /** # or ## titles (not ### question headings) */
  function isSectionHeadingLine(trimmed) {
    return /^#{1,2}\s+\S/.test(trimmed);
  }

  function normalizeLetter(s) {
    if (!s) return "";
    const t = String(s).trim();
    const m = t.match(/^([a-eA-E])\b/i);
    if (m) return m[1].toLowerCase();
    return t.toLowerCase();
  }

  function letterFromAnswer(answerRaw, options) {
    const raw = String(answerRaw)
      .trim()
      .replace(/\*+$/, "")
      .replace(/^[*_]+/, "")
      .trim();
    const letterMatch = raw.match(/^([a-eA-E])\b/i);
    if (letterMatch) return letterMatch[1].toLowerCase();

    const norm = raw.toLowerCase();
    for (const [key, text] of Object.entries(options)) {
      if (text && text.toLowerCase().trim() === norm) return key;
    }
    const partial = norm.slice(0, 48);
    for (const [key, text] of Object.entries(options)) {
      if (!text) continue;
      const t = text.toLowerCase().trim();
      if (t.includes(partial) || partial.includes(t)) return key;
    }
    return "";
  }

  function parseMcqText(text) {
    const lines = String(text)
      .split(/\r?\n/)
      .map((l) => l.replace(/\t/g, " ").trimEnd());

    const items = [];
    let i = 0;

    function skipBlankAndNoise() {
      while (i < lines.length) {
        const t = String(lines[i]).trim();
        if (!isNoiseLine(t)) break;
        i++;
      }
    }

    while (i < lines.length) {
      skipBlankAndNoise();
      if (i >= lines.length) break;

      const line = lines[i].trim();
      const qs = matchQuestionStart(line);
      if (!qs) {
        i++;
        continue;
      }

      const qNum = qs.qNum != null ? qs.qNum : null;
      let stem = qs.sameLineStem || "";
      i++;

      while (i < lines.length) {
        const L = lines[i].trim();
        if (isNoiseLine(L)) {
          i++;
          continue;
        }
        if (!L) {
          i++;
          continue;
        }
        if (OPTION_LINE.test(L) || ANSWER_LINE.test(L)) break;
        if (matchQuestionStart(L)) break;
        if (isSectionHeadingLine(L)) {
          i++;
          continue;
        }
        stem = stem ? `${stem} ${L}` : L;
        i++;
      }

      const options = {};
      while (i < lines.length) {
        skipBlankAndNoise();
        if (i >= lines.length) break;
        let L = lines[i].trim();
        const optIntro = L.match(/^options\s*[):]\s*(.*)$/i);
        if (optIntro) L = optIntro[1].trim();
        if (!L) {
          i++;
          continue;
        }
        if (ANSWER_LINE.test(L)) break;
        if (matchQuestionStart(L)) break;
        if (isSectionHeadingLine(L)) {
          i++;
          continue;
        }

        const om = L.match(OPTION_LINE);
        if (om) {
          const key = om[1].toLowerCase();
          let body = (om[2] || "").trim();
          i++;
          while (i < lines.length) {
            const N = lines[i].trim();
            if (isNoiseLine(N)) break;
            if (!N) break;
            if (OPTION_LINE.test(N) || ANSWER_LINE.test(N)) break;
            if (matchQuestionStart(N)) break;
            body = body ? `${body} ${N}` : N;
            i++;
          }
          options[key] = body;
          continue;
        }

        const lone = L.match(/^([a-eA-E])\s*$/i);
        if (lone && i + 1 < lines.length) {
          const key = lone[1].toLowerCase();
          const next = lines[i + 1].trim();
          if (
            next &&
            !OPTION_LINE.test(next) &&
            !ANSWER_LINE.test(next) &&
            !matchQuestionStart(next)
          ) {
            i++;
            let body = next;
            i++;
            while (i < lines.length) {
              const N = lines[i].trim();
              if (isNoiseLine(N)) break;
              if (!N) break;
              if (OPTION_LINE.test(N) || ANSWER_LINE.test(N)) break;
              if (matchQuestionStart(N)) break;
              body = `${body} ${N}`;
              i++;
            }
            options[key] = body;
            continue;
          }
        }

        i++;
      }

      skipBlankAndNoise();
      if (i >= lines.length || !ANSWER_LINE.test(lines[i].trim())) {
        if (stem || Object.keys(options).length)
          items.push({
            error: `Missing or misplaced answer line (e.g. **Answer:** C or Answer: C) after question${qNum ? ` ${qNum}` : ""}.`,
            stem,
            options,
            answerRaw: "",
            answerLetter: "",
            qNum,
          });
        if (i < lines.length && !matchQuestionStart(lines[i].trim())) {
          i++;
        }
        continue;
      }

      const am = lines[i].trim().match(ANSWER_LINE);
      let answerRaw = am ? am[1].trim() : "";
      answerRaw = answerRaw
        .replace(/^[*_]+/, "")
        .replace(/\*+$/, "")
        .trim();
      i++;

      const answerLetter = letterFromAnswer(answerRaw, options);
      const keys = Object.keys(options).sort();

      if (keys.length < 2) {
        items.push({
          error: "Need at least two options (A–D) for each question.",
          stem,
          options,
          answerRaw,
          answerLetter,
          qNum,
        });
        continue;
      }

      if (!answerLetter || !options[answerLetter]) {
        items.push({
          error: `Could not match answer "${answerRaw}" to an option letter or option text.`,
          stem,
          options,
          answerRaw,
          answerLetter: "",
          qNum,
        });
        continue;
      }

      items.push({
        stem,
        options,
        answerRaw,
        answerLetter,
        qNum,
      });
    }

    return items;
  }

  global.MCQParser = {
    parseMcqText,
    normalizeLetter,
    letterFromAnswer,
    matchQuestionStart,
  };
})(typeof window !== "undefined" ? window : globalThis);
