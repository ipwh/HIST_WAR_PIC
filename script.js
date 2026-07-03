/* ============================================================
   香港抗戰歷史圖像生成器 — 主要腳本
   功能：關鍵字解析、Chip 切換、Prompt 生成、複製、重設
   ============================================================ */

(function () {
  "use strict";

  // ==================== DOM 元素參照 ====================
  const heroStartBtn        = document.getElementById("heroStartBtn");
  const keywordInput        = document.getElementById("keywordInput");
  const buildPromptBtn      = document.getElementById("buildPromptBtn");
  const copyPromptBtn       = document.getElementById("copyPromptBtn");
  const resetBtn            = document.getElementById("resetBtn");
  const generateImageBtn    = document.getElementById("generateImageBtn");
  const resultsEmpty        = document.getElementById("resultsEmpty");
  const resultsContent      = document.getElementById("resultsContent");
  const userKeywordsDisplay = document.getElementById("userKeywordsDisplay");
  const optionalKeywordsDisplay = document.getElementById("optionalKeywordsDisplay");
  const finalPromptDisplay  = document.getElementById("finalPromptDisplay");
  const imagePreview        = document.getElementById("imagePreview");
  const toastEl             = document.getElementById("toast");
  const qrModalOverlay      = document.getElementById("qrModalOverlay");
  const qrCodeImage         = document.getElementById("qrCodeImage");
  const qrModalHint         = document.getElementById("qrModalHint");
  const qrCodeBtn           = document.getElementById("qrCodeBtn");
  const downloadTxtBtn      = document.getElementById("downloadTxtBtn");
  const qrModalCloseBtn     = document.getElementById("qrModalCloseBtn");
  const qrModalUrlBox       = document.getElementById("qrModalUrlBox");
  const qrModalUrlInput     = document.getElementById("qrModalUrlInput");
  const qrModalCopyUrlBtn   = document.getElementById("qrModalCopyUrlBtn");

  // 儲存已生成圖片的 URL（供 QR Code 使用）
  var generatedImageUrl = null;
  // 儲存下載頁面 URL（手機掃 QR Code 會打開呢個）
  var generatedDownloadUrl = null;

  // 目前選擇的 AI 模型
  var selectedModel = "flux-dev";

  // 所有 chip 按鈕
  const allChips = document.querySelectorAll(".chip");
  // 所有 model chip
  const allModelChips = document.querySelectorAll(".model-chip");

  // ==================== 初始設定 ====================

  /**
   * 頁面載入時預設填入示例關鍵字（少量）
   */
  function setDefaultExample() {
    keywordInput.value = "東江縱隊、山路、運送物資";
  }

  // ==================== Toast 提示 ====================

  let toastTimer = null;

  /**
   * 顯示輕量 Toast 提示
   * @param {string} message - 提示文字
   */
  function showToast(message) {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastEl.classList.remove("toast--visible");
    }

    toastEl.textContent = message;
    // 強制 reflow 以確保動畫觸發
    void toastEl.offsetWidth;
    toastEl.classList.add("toast--visible");

    toastTimer = setTimeout(function () {
      toastEl.classList.remove("toast--visible");
      toastTimer = null;
    }, 2200);
  }

  // ==================== 錯誤提示對話框 ====================

  /**
   * 顯示友善錯誤提示對話框
   * @param {string} message - 錯誤訊息
   */
  function showErrorDialog(message) {
    // 移除舊有的對話框
    var existing = document.querySelector(".error-dialog-overlay");
    if (existing) {
      existing.remove();
    }

    var overlay = document.createElement("div");
    overlay.className = "error-dialog-overlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");

    var dialog = document.createElement("div");
    dialog.className = "error-dialog";

    var icon = document.createElement("div");
    icon.className = "error-dialog__icon";
    icon.textContent = "😅";

    var msg = document.createElement("p");
    msg.className = "error-dialog__message";
    msg.textContent = message;

    var btn = document.createElement("button");
    btn.className = "error-dialog__btn";
    btn.textContent = "知道啦";
    btn.addEventListener("click", function () {
      overlay.remove();
    });

    dialog.appendChild(icon);
    dialog.appendChild(msg);
    dialog.appendChild(btn);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 點擊背景關閉
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    // 鍵盤 Escape 關閉
    function onKeyDown(e) {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", onKeyDown);
      }
    }
    document.addEventListener("keydown", onKeyDown);

    // 自動 focus 按鈕
    setTimeout(function () {
      btn.focus();
    }, 100);
  }

  // ==================== 捲動輔助 ====================

  /**
   * 平滑捲動到指定區塊
   * @param {string} selector - 目標元素的 CSS 選擇器
   */
  function scrollToSection(selector) {
    var target = document.querySelector(selector);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ==================== Chip 切換 ====================

  /**
   * 切換 chip 的選中狀態
   * @param {HTMLElement} chipElement - 被點擊的 chip 按鈕
   */
  function toggleChip(chipElement) {
    if (!chipElement || !chipElement.classList.contains("chip")) {
      return;
    }
    chipElement.classList.toggle("chip--selected");
  }

  // ==================== 關鍵字解析 ====================

  /**
   * 解析輸入框中的關鍵字
   * 支援逗號、頓號、空格、換行作為分隔符
   * 移除空白值並去除重複
   * @returns {string[]} 清理後的關鍵字陣列
   */
  function parseKeywords() {
    var raw = keywordInput.value.trim();
    if (!raw) {
      return [];
    }

    // 使用多種分隔符號拆分：逗號（中/英）、頓號、空格、換行
    var keywords = raw
      .split(/[,，、\s\n\r]+/)
      .map(function (kw) {
        return kw.trim();
      })
      .filter(function (kw) {
        return kw.length > 0;
      });

    // 去重（保留順序）
    var seen = {};
    var unique = [];
    for (var i = 0; i < keywords.length; i++) {
      var kw = keywords[i];
      if (!seen[kw]) {
        seen[kw] = true;
        unique.push(kw);
      }
    }
    return unique;
  }

  // ==================== 取得已選的 Optional 關鍵字 ====================

  /**
   * 取得所有已選中的 optional 關鍵字，依分類整理
   * @returns {Object} 以分類為 key 的物件，value 為關鍵字陣列
   */
  function getSelectedOptionalKeywords() {
    var result = {};
    var selectedChips = document.querySelectorAll(".chip--selected");

    selectedChips.forEach(function (chip) {
      var categoryContainer = chip.closest(".chip-group__items");
      if (!categoryContainer) return;

      var category = categoryContainer.getAttribute("data-category");
      if (!category) return;

      if (!result[category]) {
        result[category] = [];
      }
      result[category].push(chip.getAttribute("data-value"));
    });

    return result;
  }

  // ==================== 建立 Prompt ====================

  /**
   * 根據使用者關鍵字與 optional 關鍵字，組合成自然流暢、富有畫面感的最終 prompt
   * 
   * 設計理念：
   * - 以「場景描繪」為核心，讓句子讀起來像在描述一幅畫面
   * - 融合香港 1940 年代歷史元素，營造真實的時代氛圍
   * - 語調溫暖明亮，適合小學生閱讀理解
   * - 善用視覺形容詞（光影、色彩、構圖），幫助 AI 生成更具畫面感的圖片
   * 
   * @returns {string} 繁體中文 prompt 字串
   */
  function buildPrompt() {
    var userKeywords = parseKeywords();
    var optionalByCategory = getSelectedOptionalKeywords();

    // ── 分類收集：場景、人物、行動 → 用於描繪畫面 ──
    var sceneParts = [];     // 場景
    var characterParts = []; // 人物
    var actionParts = [];    // 行動

    // 場景
    if (optionalByCategory["場景"] && optionalByCategory["場景"].length > 0) {
      sceneParts = optionalByCategory["場景"].slice();
    }

    // 人物
    if (optionalByCategory["人物"] && optionalByCategory["人物"].length > 0) {
      characterParts = optionalByCategory["人物"].slice();
    }

    // 行動
    if (optionalByCategory["行動"] && optionalByCategory["行動"].length > 0) {
      actionParts = optionalByCategory["行動"].slice();
    }

    // 使用者自訂關鍵字（加入行動描述中）
    if (userKeywords.length > 0) {
      actionParts = actionParts.concat(userKeywords);
    }

    // 精神
    var spiritParts = [];
    if (optionalByCategory["精神"] && optionalByCategory["精神"].length > 0) {
      spiritParts = optionalByCategory["精神"].slice();
    }

    // 畫風
    var artStyleParts = [];
    if (optionalByCategory["畫風"] && optionalByCategory["畫風"].length > 0) {
      artStyleParts = optionalByCategory["畫風"].slice();
    }

    // ==================== 組裝 Prompt ====================
    var sentences = [];

    // ── 開頭句：定調教育用途 + 時代背景 ──
    sentences.push(
      "這是一張適合小學課堂使用的溫暖歷史插畫，以1940年代香港抗戰時期為背景"
    );

    // ── 場景句：描繪具體地點與環境 ──
    if (sceneParts.length > 0) {
      sentences.push(
        "，畫面背景設定在" + sceneParts.join("、") + "，" +
        "可以看到香港傳統的鄉村風貌與自然山水景色"
      );
    } else {
      sentences.push(
        "，畫面展現香港鄉村與山區的自然景色，" +
        "有青翠的山巒、蜿蜒的山路和傳統的石屋村落"
      );
    }

    // ── 人物句：描述角色與動作 ──
    var hasCharacters = characterParts.length > 0;
    var hasActions = actionParts.length > 0;

    if (hasCharacters && hasActions) {
      sentences.push(
        "，圖中可以看到" + characterParts.join("、") + "" +
        "正在" + actionParts.join("、") + ""
      );
    } else if (hasCharacters) {
      sentences.push(
        "，圖中可以看到" + characterParts.join("、") + "的身影"
      );
    } else if (hasActions) {
      sentences.push(
        "，畫面描繪了" + actionParts.join("、") + "的情景"
      );
    } else {
      sentences.push(
        "，畫面描繪了香港村民在戰時互相幫助、努力生活的溫暖情景"
      );
    }

    // ── 精神句：加入情感與價值觀 ──
    if (spiritParts.length > 0) {
      sentences.push(
        "，畫面中流露出" + spiritParts.join("、") + "的精神"
      );
    } else {
      sentences.push(
        "，畫面中流露出勇敢堅毅、守望相助的精神"
      );
    }

    // ── 畫風句：視覺風格描述 ──
    var styleText = "";
    if (artStyleParts.length > 0) {
      styleText = artStyleParts.join("、");
    } else {
      styleText = "溫暖明亮的兒童繪本風格";
    }
    sentences.push(
      "，整體採用" + styleText + "，" +
      "色彩以柔和的暖色調為主，光影溫暖自然，" +
      "人物造型親切可愛，細節豐富細膩，" +
      "營造出充滿歷史感但不沉重的教育氛圍"
    );

    // ── 結尾句：固定安全提示 ──
    sentences.push(
      "。畫面正面積極、適合小學生觀看學習，" +
      "強調團結互助與珍惜和平的價值，避免任何血腥暴力或恐怖場面。"
    );

    return sentences.join("");
  }

  // ==================== 渲染結果區 ====================

  /**
   * 顯示已整理的使用者關鍵字
   * @param {string[]} keywords - 使用者關鍵字陣列
   */
  function renderUserKeywords(keywords) {
    userKeywordsDisplay.innerHTML = "";

    if (keywords.length === 0) {
      var emptyMsg = document.createElement("p");
      emptyMsg.style.color = "var(--color-text-muted)";
      emptyMsg.style.fontSize = "var(--font-size-sm)";
      emptyMsg.textContent = "未有輸入關鍵字";
      userKeywordsDisplay.appendChild(emptyMsg);
      return;
    }

    keywords.forEach(function (kw) {
      var tag = document.createElement("span");
      tag.className = "keyword-tag";
      tag.textContent = kw;
      userKeywordsDisplay.appendChild(tag);
    });
  }

  /**
   * 顯示已選 optional 關鍵字（依分類）
   * @param {Object} optionalByCategory - 分類後的 optional 關鍵字
   */
  function renderOptionalKeywords(optionalByCategory) {
    optionalKeywordsDisplay.innerHTML = "";

    var categories = Object.keys(optionalByCategory);
    if (categories.length === 0) {
      var emptyMsg = document.createElement("p");
      emptyMsg.style.color = "var(--color-text-muted)";
      emptyMsg.style.fontSize = "var(--font-size-sm)";
      emptyMsg.textContent = "未有選擇額外關鍵字";
      optionalKeywordsDisplay.appendChild(emptyMsg);
      return;
    }

    categories.forEach(function (category) {
      var keywords = optionalByCategory[category];

      var container = document.createElement("div");
      container.className = "optional-category";

      var nameEl = document.createElement("p");
      nameEl.className = "optional-category__name";
      nameEl.textContent = category + "：";
      container.appendChild(nameEl);

      var tagsContainer = document.createElement("div");
      tagsContainer.className = "optional-category__tags";

      keywords.forEach(function (kw) {
        var tag = document.createElement("span");
        tag.className = "keyword-tag keyword-tag--optional";
        tag.textContent = kw;
        tagsContainer.appendChild(tag);
      });

      container.appendChild(tagsContainer);
      optionalKeywordsDisplay.appendChild(container);
    });
  }

  /**
   * 顯示最終 prompt
   * @param {string} promptText - 最終 prompt 文字
   */
  function renderFinalPrompt(promptText) {
    finalPromptDisplay.textContent = promptText;
  }

  /**
   * 重設圖片預覽區為空狀態
   */
  function resetImagePreview() {
    imagePreview.innerHTML = "";
    var placeholder = document.createElement("div");
    placeholder.className = "image-preview__placeholder";

    var icon = document.createElement("span");
    icon.className = "image-preview__icon";
    icon.textContent = "🖼️";

    var text = document.createElement("p");
    text.className = "image-preview__text";
    text.textContent = "尚未生成圖片";

    placeholder.appendChild(icon);
    placeholder.appendChild(text);
    imagePreview.appendChild(placeholder);
  }

  /**
   * 整合渲染所有選中的關鍵字資訊到結果區
   * @param {string[]} userKeywords
   * @param {Object} optionalByCategory
   * @param {string} finalPrompt
   */
  function renderSelectedKeywords(userKeywords, optionalByCategory, finalPrompt) {
    renderUserKeywords(userKeywords);
    renderOptionalKeywords(optionalByCategory);
    renderFinalPrompt(finalPrompt);
  }

  // ==================== 複製 Prompt ====================

  /**
   * 複製 prompt 到剪貼簿，並顯示 toast 提示
   */
  function copyPrompt() {
    var promptText = finalPromptDisplay.textContent;

    if (!promptText || promptText.trim() === "") {
      showErrorDialog("仲未有生成嘅 prompt 喎！請先按「生成圖像描述」啦。");
      return;
    }

    // 使用 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(promptText).then(function () {
        showToast("✅ 已複製 Prompt 到剪貼簿！");
      }).catch(function () {
        fallbackCopy(promptText);
      });
    } else {
      fallbackCopy(promptText);
    }
  }

  /**
   * 備用複製方法（使用 textarea）
   * @param {string} text
   */
  function fallbackCopy(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      var success = document.execCommand("copy");
      if (success) {
        showToast("✅ 已複製 Prompt 到剪貼簿！");
      } else {
        showErrorDialog("複製失敗，請手動選擇 Prompt 文字再按 Ctrl+C 複製。");
      }
    } catch (e) {
      showErrorDialog("複製失敗，請手動選擇 Prompt 文字再按 Ctrl+C 複製。");
    }

    document.body.removeChild(textarea);
  }

  // ==================== 生成圖片 ====================

  /**
   * 判斷後端 API 的基礎網址
   * 如果網頁是從 Node 伺服器開啟（http://），則使用相對路徑
   * 如果是從本地檔案開啟（file://），則預設連接到 localhost:3000
   * @returns {string} API 基礎網址
   */
  function getApiBaseURL() {
    if (window.location.protocol === "file:") {
      return "http://localhost:3000";
    }
    // 網頁由 Node 伺服器託管，使用相同 origin
    return "";
  }

  /**
   * 在圖片預覽區顯示載入中狀態
   */
  function showImageLoading() {
    imagePreview.innerHTML = "";
    var loadingEl = document.createElement("div");
    loadingEl.className = "image-preview__placeholder";

    var spinner = document.createElement("span");
    spinner.className = "image-preview__spinner";
    spinner.setAttribute("aria-label", "正在生成圖片");

    var text = document.createElement("p");
    text.className = "image-preview__text";
    text.textContent = "🎨 正在生成圖片，請稍候…（約需 10-30 秒）";

    loadingEl.appendChild(spinner);
    loadingEl.appendChild(text);
    imagePreview.appendChild(loadingEl);
  }

  /**
   * 在圖片預覽區顯示生成的圖片
   * @param {string} imageUrl - 圖片網址
   */
  function showGeneratedImage(imageUrl) {
    imagePreview.innerHTML = "";
    var img = document.createElement("img");
    img.src = imageUrl;
    img.alt = "AI 生成的香港抗戰歷史圖像";
    img.id = "generatedImage";
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.style.borderRadius = "8px";
    img.style.display = "block";
    img.onerror = function () {
      showImageError("圖片載入失敗，請重試。");
    };
    imagePreview.appendChild(img);
  }

  /**
   * 在圖片預覽區顯示錯誤訊息
   * @param {string} message - 錯誤訊息
   */
  function showImageError(message) {
    imagePreview.innerHTML = "";
    var errorEl = document.createElement("div");
    errorEl.className = "image-preview__placeholder";
    errorEl.style.color = "#C44";

    var icon = document.createElement("span");
    icon.className = "image-preview__icon";
    icon.textContent = "❌";

    var text = document.createElement("p");
    text.className = "image-preview__text";
    text.textContent = message;

    errorEl.appendChild(icon);
    errorEl.appendChild(text);
    imagePreview.appendChild(errorEl);
  }

  /**
   * 生成圖片：將 prompt 傳送到後端 Node.js 伺服器，
   * 後端再轉發到 Stability AI（Stable Diffusion）API 生成圖像。
   */
  function generateImage() {
    var promptText = finalPromptDisplay.textContent;

    if (!promptText || promptText.trim() === "") {
      showErrorDialog("仲未有生成嘅 prompt 喎！請先按「生成圖像描述」啦。");
      return;
    }

    var apiUrl = getApiBaseURL() + "/api/generate-image";

    // 顯示載入中狀態
    showImageLoading();

    // 呼叫後端 API
    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptText, model: selectedModel })
    })
    .then(function (response) {
      return response.json().then(function (data) {
        return { ok: response.ok, data: data };
      });
    })
    .then(function (result) {
      if (result.ok && result.data.success && result.data.imageUrl) {
        // 成功：儲存圖片 URL 供 QR Code 使用
        // downloadUrl 係絕對路徑（QR Code 用），imageUrl 係相對路徑（img tag 用）
        generatedImageUrl = result.data.imageUrl;
        generatedDownloadUrl = result.data.downloadUrl || result.data.imageUrl;
        // img tag 可以直接用相對路徑
        showGeneratedImage(result.data.imageUrl);
        showToast("✅ 圖片已生成！可以用「掃碼下載」儲存到手機。");
      } else {
        // API 回傳錯誤
        var errorMsg = result.data.error || "圖片生成失敗，請重試。";
        showImageError(errorMsg);
        showErrorDialog(errorMsg);
      }
    })
    .catch(function (error) {
      // 網路錯誤（無法連線到伺服器）
      console.error("generateImage error:", error);
      var msg = "無法連接到圖片生成伺服器。\n請確認已啟動後端：node server.js";
      showImageError(msg);
      showErrorDialog(msg);
    });
  }

  // ==================== QR Code 彈窗 ====================

  /**
   * 取得需要編碼到 QR Code 的內容
   * 優先使用已生成圖片的 URL，否則使用 prompt 文字
   * @returns {string} 要編碼的內容
   */
  function getQRContent() {
    // 優先使用下載頁面 URL（手機友好）
    if (generatedDownloadUrl) {
      return generatedDownloadUrl;
    }
    if (generatedImageUrl) {
      return generatedImageUrl;
    }
    // 否則使用 prompt 文字
    var promptText = finalPromptDisplay.textContent;
    if (promptText && promptText.trim() !== "") {
      return promptText;
    }
    return "";
  }

  /**
   * 顯示 QR Code 彈窗
   * 使用免費 QR Code API（api.qrserver.com）生成 QR 圖案
   */
  function showQRModal() {
    var content = getQRContent();
    if (!content) {
      showErrorDialog("仲未有內容可以生成 QR Code！請先按「生成圖像描述」啦。");
      return;
    }

    // 使用 api.qrserver.com 免費生成 QR Code
    var encodedData = encodeURIComponent(content);
    var qrApiUrl = "https://api.qrserver.com/v1/create-qr-code/?size=250x250&color=2D5A3D&data=" + encodedData;

    // 設定 QR Code 圖片來源
    qrCodeImage.src = qrApiUrl;
    qrCodeImage.alt = "QR Code，掃描後可查看作品內容";

    // 設定提示文字
    if (generatedDownloadUrl || generatedImageUrl) {
      qrModalHint.textContent = "掃描後會開啟下載頁面，撳「下載圖片」即可儲存到手機相簿。";
    } else {
      qrModalHint.textContent = "掃描後會顯示你嘅圖像描述文字，可以複製留低慢慢用。";
    }

    // 顯示下載連結（備用）
    var dlUrl = generatedDownloadUrl || generatedImageUrl;
    if (dlUrl) {
      qrModalUrlBox.style.display = "";
      qrModalUrlInput.value = dlUrl;
    } else {
      qrModalUrlBox.style.display = "none";
    }

    // 顯示彈窗
    qrModalOverlay.style.display = "";

    // 自動 focus 關閉按鈕
    setTimeout(function () {
      qrModalCloseBtn.focus();
    }, 100);

    // 防止背景捲動
    document.body.style.overflow = "hidden";
  }

  /**
   * 關閉 QR Code 彈窗
   */
  function closeQRModal() {
    qrModalOverlay.style.display = "none";
    document.body.style.overflow = "";
  }

  // ==================== 下載 Prompt 文字檔 ====================

  /**
   * 將 prompt 文字下載為 .txt 檔案
   */
  function downloadPromptText() {
    var promptText = finalPromptDisplay.textContent;
    if (!promptText || promptText.trim() === "") {
      showErrorDialog("仲未有生成嘅 prompt 喎！請先按「生成圖像描述」啦。");
      return;
    }

    // 建立 Blob 並觸發下載
    var blob = new Blob([promptText], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "香港抗戰歷史圖像描述.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 釋放 URL 物件
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 100);

    showToast("✅ 已下載 Prompt 文字檔！");
  }

  // ==================== 清除全部 ====================

  /**
   * 重設整個表單：清除 textarea、取消所有 chip、清空結果
   */
  function resetForm() {
    // 清除 textarea（保留空值讓學生自行輸入）
    keywordInput.value = "";

    // 取消所有已選 chip
    allChips.forEach(function (chip) {
      chip.classList.remove("chip--selected");
    });

    // 隱藏結果內容，顯示空狀態
    resultsContent.style.display = "none";
    resultsEmpty.style.display = "";

    // 清空結果內容
    userKeywordsDisplay.innerHTML = "";
    optionalKeywordsDisplay.innerHTML = "";
    finalPromptDisplay.textContent = "";
    resetImagePreview();

    // 禁用複製按鈕
    copyPromptBtn.disabled = true;

    // 清除已儲存的圖片 URL
    generatedImageUrl = null;
    generatedDownloadUrl = null;

    // 關閉 QR Code 彈窗（如果開啟中）
    closeQRModal();

    // 捲動回輸入區
    scrollToSection("#inputSection");

    showToast("🗑️ 已清除全部內容");
  }

  // ==================== 主要流程：生成圖像描述 ====================

  /**
   * 處理「生成圖像描述」按鈕點擊
   */
  function handleBuildPrompt() {
    var userKeywords = parseKeywords();

    // 驗證：使用者必須輸入至少一個關鍵字
    if (userKeywords.length === 0) {
      showErrorDialog("請先喺輸入框輸入至少一個工作紙關鍵字啦！📝");
      keywordInput.focus();
      return;
    }

    var optionalByCategory = getSelectedOptionalKeywords();
    var finalPrompt = buildPrompt();

    // 顯示結果
    resultsEmpty.style.display = "none";
    resultsContent.style.display = "";

    renderSelectedKeywords(userKeywords, optionalByCategory, finalPrompt);
    resetImagePreview();

    // 啟用複製按鈕
    copyPromptBtn.disabled = false;

    // 自動捲動到結果區
    // 使用 setTimeout 確保 DOM 更新後再捲動
    setTimeout(function () {
      scrollToSection("#resultsSection");
    }, 150);

    showToast("✅ 圖像描述已生成！");
  }

  // ==================== 事件綁定 ====================

  /**
   * 初始化所有事件監聽器
   */
  function bindEvents() {
    // Hero 開始按鈕 → 捲動到輸入區
    heroStartBtn.addEventListener("click", function () {
      scrollToSection("#inputSection");
      // 稍微延遲後 focus 輸入框
      setTimeout(function () {
        keywordInput.focus();
      }, 400);
    });

    // 所有 chip 點擊 → 切換選中狀態
    allChips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        toggleChip(chip);
      });
    });

    // 生成圖像描述
    buildPromptBtn.addEventListener("click", handleBuildPrompt);

    // 複製 prompt
    copyPromptBtn.addEventListener("click", copyPrompt);

    // 清除全部
    resetBtn.addEventListener("click", resetForm);

    // 生成圖片（預留）
    generateImageBtn.addEventListener("click", generateImage);

    // QR Code 彈窗
    qrCodeBtn.addEventListener("click", showQRModal);
    qrModalCloseBtn.addEventListener("click", closeQRModal);

    // QR 彈窗內複製下載連結
    qrModalCopyUrlBtn.addEventListener("click", function () {
      var url = qrModalUrlInput.value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          showToast("✅ 已複製下載連結！");
        });
      } else {
        qrModalUrlInput.select();
        document.execCommand("copy");
        showToast("✅ 已複製下載連結！");
      }
    });

    // 點擊 QR 彈窗背景關閉
    qrModalOverlay.addEventListener("click", function (e) {
      if (e.target === qrModalOverlay) {
        closeQRModal();
      }
    });

    // 鍵盤 Escape 關閉 QR 彈窗
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && qrModalOverlay.style.display !== "none") {
        closeQRModal();
      }
    });

    // 下載 Prompt 文字檔
    downloadTxtBtn.addEventListener("click", downloadPromptText);

    // 模型選擇 chip
    allModelChips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        // 取消所有 model chip 選中
        allModelChips.forEach(function (c) {
          c.classList.remove("model-chip--selected");
        });
        // 選中當前
        chip.classList.add("model-chip--selected");
        // 儲存選擇
        selectedModel = chip.getAttribute("data-model");
      });
    });

    // 鍵盤快捷鍵：Ctrl+Enter 在 textarea 中觸發生成
    keywordInput.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleBuildPrompt();
      }
    });
  }

  // ==================== 啟動 ====================

  /**
   * 頁面初始化
   */
  function init() {
    setDefaultExample();
    bindEvents();
  }

  // 當 DOM 準備好後執行初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
