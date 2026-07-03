/* ============================================================
   香港抗戰歷史圖像生成器 — Node.js 後端伺服器
   接駁 Stability AI (Stable Diffusion) API 生成圖像
   支援 QR Code 掃碼下載（自動偵測本機 IP）
   ============================================================ */

"use strict";

// ==================== 載入環境變數 ====================
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const os = require("os");
const fetch = require("node-fetch");
const FormData = require("form-data");

// ==================== 設定 ====================
const PORT = process.env.PORT || 3000;
const STABILITY_API_KEY = (process.env.STABILITY_API_KEY || "").trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").trim();

// Stability AI 設定
const STABILITY_API_URL =
  "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image";

// Replicate 設定（方案 B）
const REPLICATE_API_URL = "https://api.replicate.com/v1/predictions";
const REPLICATE_API_KEY = (process.env.REPLICATE_API_KEY || "").trim();

// Hugging Face 設定（方案 C，免費）
const HUGGINGFACE_API_URL =
  "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0";
const HUGGINGFACE_API_KEY = (process.env.HUGGINGFACE_API_KEY || "").trim();

const AI_PROVIDER = (process.env.AI_PROVIDER || "replicate").trim().toLowerCase();
const AI_MODEL = (process.env.AI_MODEL || "flux-dev").trim().toLowerCase();

// FLUX.1 schnell 設定（Replicate 上運行，原生支援繁體中文）
const FLUX_VERSION =
  "black-forest-labs/flux-schnell";

// 確保 generated 目錄存在
const GENERATED_DIR = path.join(__dirname, "generated");
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

// ==================== Express 初始化 ====================
const app = express();

// CORS：允許前端跨域請求（開發階段寬鬆設定）
app.use(cors());
app.use(express.json());

// 提供靜態檔案：前端頁面
app.use(express.static(__dirname));

// 提供靜態檔案：生成的圖片
app.use("/generated", express.static(GENERATED_DIR));

// ==================== 輔助函式 ====================

/**
 * 取得本機區域網路 IP 位址
 * 用於 QR Code 連結，讓同一 WiFi 下的手機可以存取
 * @returns {string} IP 位址
 */
function getLocalIP() {
  var interfaces = os.networkInterfaces();
  var names = Object.keys(interfaces);
  var wifiIPs = [];
  var otherIPs = [];

  for (var i = 0; i < names.length; i++) {
    var ifaceList = interfaces[names[i]];
    var nameLower = names[i].toLowerCase();
    for (var j = 0; j < ifaceList.length; j++) {
      var iface = ifaceList[j];
      if (iface.family === "IPv4" && !iface.internal) {
        var addr = iface.address;
        // 優先 WiFi 介面（手機通常經 WiFi 連接）
        if (nameLower.includes("wi") || nameLower.includes("wireless") || nameLower.includes("wlan")) {
          wifiIPs.push(addr);
        } else if (!nameLower.includes("hyper") && !nameLower.includes("wsl") && !nameLower.includes("docker") && !nameLower.includes("vethernet")) {
          otherIPs.push(addr);
        }
      }
    }
  }

  // 先回傳 WiFi IP，冇先至用其他
  var candidates = wifiIPs.concat(otherIPs);
  if (candidates.length > 0) {
    return candidates[0];
  }
  return "localhost";
}

/**
 * 取得公開基礎網址
 * 優先使用環境變數，否則自動偵測本機 IP
 * @returns {string} 基礎網址（含 port）
 */
function getBaseURL() {
  if (PUBLIC_BASE_URL) {
    return PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  // Render 雲端平台
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    return "https://" + process.env.RENDER_EXTERNAL_HOSTNAME;
  }
  // 其他雲端平台（Railway、Heroku 等）
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return "https://" + process.env.RAILWAY_PUBLIC_DOMAIN;
  }
  // 本地開發
  var ip = getLocalIP();
  if (ip === "localhost") {
    return "http://localhost:" + PORT;
  }
  return "http://" + ip + ":" + PORT;
}

/**
 * 驗證 API Key 是否已設定
 * @returns {boolean}
 */
function hasAPIKey() {
  if (AI_PROVIDER === "replicate") {
    return REPLICATE_API_KEY && REPLICATE_API_KEY.length > 10;
  }
  if (AI_PROVIDER === "huggingface") {
    return HUGGINGFACE_API_KEY && HUGGINGFACE_API_KEY.length > 10;
  }
  return STABILITY_API_KEY && STABILITY_API_KEY !== "sk-your-stability-api-key-here" && STABILITY_API_KEY.length > 10;
}

// ==================== API 路由 ====================

/**
 * GET /download/:filename
 * 圖片下載頁面 — 手機掃 QR Code 後打開此頁，可直接下載圖片
 */
app.get("/download/:filename", function (req, res) {
  var filename = req.params.filename;
  var filepath = path.join(GENERATED_DIR, filename);
  var baseURL = getBaseURL();
  var imageUrl = baseURL + "/generated/" + filename;

  res.send(
    '<!DOCTYPE html><html lang="zh-HK"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<title>香港抗戰歷史圖像 — 下載</title>" +
    "<style>" +
    "*{margin:0;padding:0;box-sizing:border-box}" +
    "body{font-family:'Microsoft JhengHei',sans-serif;background:#FDF8F0;text-align:center;padding:24px 16px}" +
    "h2{color:#2D5A3D;margin-bottom:16px}" +
    "img{max-width:100%;border-radius:12px;box-shadow:0 3px 12px rgba(0,0,0,.1);margin-bottom:20px}" +
    "a.btn{display:inline-block;padding:14px 36px;background:#2D5A3D;color:#fff;" +
    "text-decoration:none;border-radius:50px;font-size:1.1rem;font-weight:600}" +
    "p.hint{color:#9B8E7E;margin-top:12px;font-size:.9rem}" +
    "</style></head><body>" +
    '<h2>🖼️ 香港抗戰歷史圖像</h2>' +
    '<img src="' + imageUrl + '" alt="生成的歷史圖像">' +
    '<br><a class="btn" href="' + imageUrl + '" download>📥 下載圖片</a>' +
    '<p class="hint">長按上面圖片亦可儲存到手機相簿</p>' +
    "</body></html>"
  );
});

/**
 * GET /api/status
 * 檢查伺服器狀態與 API Key 是否已設定
 */
app.get("/api/status", function (req, res) {
  res.json({
    status: "ok",
    apiKeyConfigured: hasAPIKey(),
    baseURL: getBaseURL(),
    message: hasAPIKey()
      ? "✅ API Key 已設定，可以生成圖片。"
      : "⚠️ 尚未設定 STABILITY_API_KEY，請在 .env 檔案中填入 API Key。",
  });
});

/**
 * POST /api/generate-image
 * 接收 prompt，呼叫 AI API 生成圖片
 * 支援 Stability AI 和 Replicate 兩種後端
 *
 * Request body: { prompt: string }
 * Response:      { success: true, imageUrl: string, prompt: string }
 */
app.post("/api/generate-image", async function (req, res) {
  // ----- 驗證 API Key -----
  if (!hasAPIKey()) {
    var providerNames = { replicate: "Replicate", huggingface: "Hugging Face", stability: "Stability AI" };
    var providerName = providerNames[AI_PROVIDER] || "AI";
    return res.status(503).json({
      success: false,
      error: "尚未設定 " + providerName + " API Key。請在 .env 檔案中設定。",
    });
  }

  // ----- 驗證輸入 -----
  var prompt = (req.body.prompt || "").trim();
  if (!prompt) {
    return res.status(400).json({
      success: false,
      error: "請提供圖像描述（prompt）。",
    });
  }

  if (prompt.length > 2000) {
    prompt = prompt.substring(0, 2000);
  }

  // 從 request 取得用戶選擇的模型（預設用 .env 設定）
  var requestedModel = (req.body.model || AI_MODEL).trim().toLowerCase();

  // FLUX / Ideogram 原生支援中文，用視覺化 prompt
  var apiPrompt;
  var isChineseModel = requestedModel === "flux" || requestedModel === "flux-dev" ||
                       requestedModel === "flux-pro" || requestedModel === "ideogram";
  if (isChineseModel) {
    apiPrompt = buildFluxPrompt(prompt);
    console.log("📝 使用 " + requestedModel.toUpperCase() + "，視覺化中文 prompt");
  } else {
    apiPrompt = buildEnglishPrompt(prompt);
  }

  console.log("🎨 開始生成圖片...");
  console.log("📝 Model: " + requestedModel);
  console.log("📝 Prompt: " + apiPrompt.substring(0, 150) + "...");

  try {
    var imageBase64;

    if (requestedModel === "ideogram") {
      imageBase64 = await generateWithIdeogram(apiPrompt);
    } else if (requestedModel === "flux" || requestedModel === "flux-dev" || requestedModel === "flux-pro") {
      imageBase64 = await generateWithFlux(apiPrompt, requestedModel);
    } else if (AI_PROVIDER === "replicate") {
      imageBase64 = await generateWithReplicate(apiPrompt);
    } else if (AI_PROVIDER === "huggingface") {
      imageBase64 = await generateWithHuggingFace(apiPrompt);
    } else {
      imageBase64 = await generateWithStability(apiPrompt);
    }

    // ----- 儲存圖片到磁碟 -----
    var imageBuffer = Buffer.from(imageBase64, "base64");
    var timestamp = Date.now();
    var filename = "hk-war-history-" + timestamp + ".png";
    var filepath = path.join(GENERATED_DIR, filename);

    fs.writeFileSync(filepath, imageBuffer);
    console.log("💾 圖片已儲存: " + filepath);

    // ----- 建立圖片網址 -----
    var baseURL = getBaseURL();
    // imageUrl 用相對路徑（避免 HTTP/HTTPS mixed content）
    var imageUrl = "/generated/" + filename;
    // downloadUrl 用絕對路徑（QR Code 需要完整網址）
    var downloadUrl = baseURL + "/download/" + filename;

    console.log("✅ 圖片生成成功！");
    console.log("🔗 圖片網址: " + imageUrl);

    res.json({
      success: true,
      imageUrl: imageUrl,
      downloadUrl: downloadUrl,
      prompt: prompt,
    });
  } catch (error) {
    console.error("❌ 圖片生成失敗:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== FLUX 中文 Prompt 優化 ====================

/**
 * 將教科書式 prompt 轉換為 FLUX 能理解的視覺場景描述
 * FLUX 需要具體的視覺元素，而非抽象嘅教育用語
 * 
 * 設計理念：
 * - 英文為主幹（FLUX 對英文理解最佳），中文為輔助標籤
 * - 大量香港 1940 年代抗戰歷史專屬詞彙，營造真實歷史氛圍
 * - 畫面風格定位為「溫暖明亮的兒童教育插畫」，適合小學生觀看
 * - 強調自然光影、質感細節、人物互動，讓畫面生動有故事感
 */
function buildFluxPrompt(chinesePrompt) {
  // ==================== 香港抗戰歷史專屬詞彙映射表（40+ 條目） ====================
  // 涵蓋：人物、地點、建築、服飾、道具、行動、精神、氛圍、畫風
  var termMap = {
    // ── 人物 / 群體 ──
    "東江縱隊": "East River Column guerrilla soldiers in simple uniforms",
    "東江縱隊戰士": "East River Column guerrilla soldiers in simple uniforms",
    "游擊隊員": "guerrilla fighters in modest wartime clothing",
    "村民": "Hong Kong village farmers in traditional 1940s linen clothes and straw hats",
    "小學生": "young school children in 1940s style uniforms",
    "平民": "local villagers going about daily life during wartime",
    "護士": "kind nurse in a crisp white uniform with a Red Cross armband",
    "漁民": "Hong Kong fishing folk in traditional sampans with conical bamboo hats",
    "客家人": "Hakka villagers in traditional indigo-dyed clothing near walled villages",
    "傳信員": "young messenger on a vintage bicycle carrying handwritten notes",

    // ── 香港地點 ──
    "大帽山": "Tai Mo Shan, Hong Kong's highest peak, with misty forested slopes",
    "八仙嶺": "Pat Sin Leng mountain ridge with dramatic rocky peaks and golden grasslands",
    "新界": "New Territories rural landscapes with rice paddies and village paths",
    "客家圍村": "traditional Hakka walled village with grey brick walls and courtyards",
    "粉嶺": "Fanling countryside with old stone houses and lush green hills",
    "元朗": "Yuen Long plains with wide open farmland and distant blue mountains",
    "青山": "Castle Peak hills with historic trails overlooking the South China Sea",
    "維多利亞港": "Victoria Harbour seen from the hills, with sampans and old buildings",
    "香港島山區": "wooded hillsides of Hong Kong Island with winding footpaths",
    "獅子山": "Lion Rock mountain silhouette against a warm sunset sky",

    // ── 建築 / 場所 ──
    "石屋": "traditional granite stone houses with dark tiled roofs",
    "青磚瓦房": "blue-grey brick houses with curved tiled rooftops typical of old Hong Kong",
    "木屋": "wooden stilt houses on hillsides with laundry hanging outside",
    "防空洞": "air raid shelter entrance carved into a hillside, framed by greenery",
    "祠堂": "ancestral hall with carved wooden beams and traditional Chinese architecture",
    "炮台": "old coastal artillery battery overlooking the sea, weathered by time",

    // ── 服飾細節 ──
    "草帽": "wide-brimmed straw hats",
    "竹笠": "conical bamboo hats worn by farmers and fishermen",
    "布鞋": "simple black cloth shoes",
    "客家服": "traditional Hakka indigo-blue jacket and trousers with embroidered trim",

    // ── 道具 / 物件 ──
    "竹籃": "woven bamboo baskets used for carrying food and supplies",
    "腳踏車": "vintage black bicycle with a woven basket",
    "油燈": "glowing oil lanterns casting warm amber light",
    "舊式收音機": "vintage 1940s wooden radio set with large dials",
    "手寫訊息": "handwritten messages on yellowed rice paper with ink brush",
    "擔挑": "bamboo shoulder pole with woven baskets hanging at both ends",

    // ── 行動 / 場景 ──
    "山路": "winding mountain trails through misty green forests",
    "山區小路": "narrow winding mountain paths lined with ferns and wild grasses",
    "運送物資": "carefully carrying food supplies and medicine through mountain trails in bamboo baskets",
    "傳遞訊息": "delivering handwritten urgent messages by bicycle along village roads",
    "守望相助": "neighbors warmly helping and protecting each other in difficult times",
    "躲避空襲": "villagers calmly taking shelter under trees and in hillside caves during air raids",
    "保護家園": "standing together with quiet determination to defend their homes and homeland",
    "耕種": "farmers tending rice paddies and vegetable fields on terraced hillsides",
    "出海捕魚": "fishermen in wooden sampans casting nets in calm coastal waters",
    "教學": "a teacher giving a lesson to village children under a large banyan tree",

    // ── 精神 / 價值 ──
    "勇敢": "quiet bravery and steadfast courage",
    "團結": "heartwarming unity and community solidarity",
    "堅毅": "resilience and unwavering determination in hardship",
    "希望": "gentle hope and optimism shining through dark times",
    "珍惜和平": "deeply cherishing peace and harmony",
    "互助": "warm mutual support and kindness among neighbors",

    // ── 氛圍 / 光影 ──
    "晨霧": "soft morning mist rolling through mountain valleys, golden sunrise light",
    "夕陽": "warm golden sunset glow casting long gentle shadows",
    "溫暖光影": "soft warm sunlight filtering through leaves, dappled light on the ground",
    "山間清風": "gentle mountain breeze rustling through tall grass and tree leaves",

    // ── 畫風 / 技術 ──
    "彩色插畫": "bright colorful illustration with rich texture and depth",
    "兒童繪本風": "heartwarming children's picture book art style with soft rounded shapes",
    "卡通風格": "gentle cartoon style with expressive friendly faces",
    "手繪海報風": "hand-drawn vintage poster art with bold compositions",
    "水彩風格": "soft watercolor painting style with gentle color washes and visible brush textures",
    "溫暖明亮": "warm bright sunlight tones with a cheerful and inviting atmosphere",
  };

  // ==================== 雙語替換：中文關鍵詞 → 英文＋中文標籤 ====================
  var keys = Object.keys(termMap);
  for (var i = 0; i < keys.length; i++) {
    chinesePrompt = chinesePrompt.split(keys[i]).join(termMap[keys[i]] + "(" + keys[i] + ")");
  }

  // ==================== 提取結構化元素 ====================
  var sceneElements = extractBetween(chinesePrompt, "描繪", "的畫面");
  var spiritElements = extractBetween(chinesePrompt, "加入", "的元素");

  // ==================== 組裝雙語視覺 Prompt ====================
  var parts = [];

  // ── 第一層：畫面主體風格定位（英文為主） ──
  parts.push(
    "A beautifully illustrated historical scene set in 1940s Hong Kong during World War II, "
  );

  // ── 第二層：場景描述（從使用者 input 提取並翻譯） ──
  if (sceneElements) {
    var sceneEn = sceneElements;
    for (var k = 0; k < keys.length; k++) {
      sceneEn = sceneEn.split(keys[k]).join(termMap[keys[k]]);
    }
    parts.push("vividly showing " + sceneEn + ". ");
  }

  // ── 第三層：香港 1940 年代環境細節（固定增強） ──
  parts.push(
    "The background features authentic 1940s Hong Kong scenery: " +
    "misty green mountains of the New Territories, traditional Hakka walled villages " +
    "with grey-blue brick houses and curved tiled roofs, winding stone paths through " +
    "lush forests, old banyan trees with hanging aerial roots, distant views of " +
    "coastal waters with wooden sampans. "
  );

  // ── 第四層：氣氛 / 精神描述（從使用者 input 提取並翻譯） ──
  if (spiritElements) {
    var spiritEn = spiritElements;
    for (var m = 0; m < keys.length; m++) {
      spiritEn = spiritEn.split(keys[m]).join(termMap[keys[m]]);
    }
    parts.push("The mood radiates " + spiritEn + ", ");
  }
  parts.push(
    "with a sense of gentle historical nostalgia and warmth. "
  );

  // ── 第五層：光影與色彩氣氛 ──
  parts.push(
    "Soft golden sunlight filters through the scene, " +
    "casting warm highlights and gentle shadows. " +
    "The color palette combines earthy terracotta browns, soft olive greens, " +
    "warm ochre yellows, and muted sky blues — evoking a vintage yet hopeful feeling. "
  );

  // ── 第六層：畫風技術要求 ──
  parts.push(
    "Art style: heartwarming children's picture book illustration, " +
    "hand-drawn feel with expressive linework and visible brush textures, " +
    "soft rounded character designs with friendly faces suitable for primary school students, " +
    "rich environmental details that tell a story, " +
    "educational and uplifting atmosphere — historically respectful yet warm and approachable. "
  );

  // ── 第七層：排除條件 ──
  parts.push(
    "No text, letters, signatures, or watermarks in the image. " +
    "No violence, blood, weapons prominently visible, or frightening imagery. " +
    "No overly dark or gloomy tones — the mood should be hopeful, brave, and educational."
  );

  return parts.join("");
}

function extractBetween(text, start, end) {
  var startIdx = text.indexOf(start);
  if (startIdx === -1) return "";
  startIdx += start.length;
  var endIdx = text.indexOf(end, startIdx);
  if (endIdx === -1) return text.substring(startIdx).trim();
  return text.substring(startIdx, endIdx).trim();
}

// ==================== 中→英 Prompt 轉換 ====================

/**
 * 將繁體中文 prompt 轉換為 SDXL 能理解的英文描述
 * 保留香港抗戰歷史的具體細節
 */
function buildEnglishPrompt(chinesePrompt) {
  // 關鍵詞翻譯表
  var dict = {
    "香港抗戰歷史": "Hong Kong's WWII resistance history in the 1940s",
    "香港抗戰時期": "Hong Kong during the WWII resistance period in the 1940s",
    "東江縱隊": "East River Column guerrilla force",
    "東江縱隊戰士": "East River Column guerrilla soldier",
    "游擊隊員": "guerrilla fighter",
    "山路": "mountain trail",
    "山區小路": "mountain path",
    "香港街道": "old Hong Kong street",
    "海岸防線": "coastal defense line",
    "鄉村": "rural Hong Kong village",
    "防空洞": "air raid shelter",
    "小學生": "primary school student",
    "平民": "civilian villager",
    "護士": "nurse",
    "運送物資": "carrying supplies",
    "傳遞訊息": "delivering messages",
    "守望相助": "helping and protecting each other",
    "躲避空襲": "taking shelter from air raids",
    "保護家園": "defending their homeland",
    "勇敢": "courage",
    "團結": "solidarity",
    "堅毅": "perseverance",
    "希望": "hope",
    "珍惜和平": "cherishing peace",
    "彩色插畫": "colorful illustration",
    "兒童繪本風": "children's picture book style",
    "卡通風格": "cartoon style",
    "手繪海報風": "hand-drawn vintage poster style",
    "溫暖明亮": "warm and bright colors",
    "小學課堂": "primary school classroom",
    "教育插圖": "educational illustration",
    "歷史畫面": "historical scene",
  };

  // 先嘗試在中文 prompt 中替換關鍵詞
  var translated = chinesePrompt;
  var keys = Object.keys(dict);
  for (var i = 0; i < keys.length; i++) {
    var zh = keys[i];
    var en = dict[zh];
    // 用 split-join 做全域替換
    translated = translated.split(zh).join(en);
  }

  // 如果替換後仍有大量中文，在開頭補充完整英文描述
  var chineseCount = (translated.match(/[\u4e00-\u9fff]/g) || []).length;

  if (chineseCount > 10) {
    // 中文太多，直接用英文模板重寫
    return "A warm, bright, child-friendly illustration in childrens picture book style, " +
      "depicting Hong Kong during the 1940s WWII resistance period. " +
      "The scene shows East River Column guerrilla fighters and local villagers " +
      "in the New Territories countryside, mountain paths and old villages, " +
      "helping each other, carrying supplies, with a spirit of courage and unity. " +
      "Educational illustration for primary school textbook, " +
      "peaceful, hopeful atmosphere, no violence or blood, suitable for children.";
  }

  // 英文前綴（提供 SDXL 足夠的視覺上下文）
  var prefix = "A warm bright childrens book illustration of Hong Kong 1940s history: ";

  return prefix + translated;
}

// ==================== Stability AI 生成 ====================

async function generateWithStability(prompt) {
  var requestBody = {
    text_prompts: [
      { text: prompt, weight: 1 }
    ],
    cfg_scale: 7,
    samples: 1,
    steps: 30,
    style_preset: "digital-art"
  };

  console.log("📡 正在呼叫 Stability AI API...");

  var response = await fetch(STABILITY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + STABILITY_API_KEY,
      Accept: "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  var result = await response.json();

  if (!response.ok) {
    // 如果是內容審查錯誤，給出更具體的提示
    if (result.name === "content_moderation") {
      throw new Error(
        "Stability AI 內容審查阻擋咗呢個請求。請嘗試用 Replicate 後端（喺 .env 設定 AI_PROVIDER=replicate 並填入 REPLICATE_API_KEY）。"
      );
    }
    throw new Error(result.message || result.name || "Stability AI 錯誤");
  }

  if (!result.artifacts || result.artifacts.length === 0) {
    throw new Error("API 沒有回傳圖片。");
  }

  return result.artifacts[0].base64;
}

// ==================== Replicate 生成 ====================

async function generateWithReplicate(prompt) {
  // 使用 Replicate 的 SDXL 模型
  // 模型: stability-ai/sdxl
  var requestBody = {
    version: "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
    input: {
      prompt: prompt,
      negative_prompt: "violent, bloody, scary, weapons",
      width: 1024,
      height: 1024,
      num_outputs: 1,
      num_inference_steps: 30,
      guidance_scale: 7,
    },
  };

  console.log("📡 正在呼叫 Replicate API...");

  // 第一步：建立 prediction
  var response = await fetch(REPLICATE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Token " + REPLICATE_API_KEY,
    },
    body: JSON.stringify(requestBody),
  });

  var prediction = await response.json();

  if (!response.ok) {
    throw new Error("Replicate 錯誤: " + (prediction.detail || prediction.message || "未知"));
  }

  // 第二步：等待結果（Replicate 是非同步的）
  var predictionUrl = REPLICATE_API_URL + "/" + prediction.id;
  var maxAttempts = 60; // 最多等 120 秒
  var outputUrl = null;

  for (var i = 0; i < maxAttempts; i++) {
    await sleep(2000); // 每 2 秒查一次

    var statusResp = await fetch(predictionUrl, {
      headers: { Authorization: "Token " + REPLICATE_API_KEY },
    });
    var statusData = await statusResp.json();

    if (statusData.status === "succeeded") {
      outputUrl = statusData.output[0];
      break;
    }
    if (statusData.status === "failed") {
      throw new Error("Replicate 生成失敗: " + (statusData.error || "未知"));
    }
    // 否則繼續等待 (status === "processing" 或 "starting")

    if (i % 5 === 0) {
      console.log("⏳ 等待中... (" + statusData.status + ")");
    }
  }

  if (!outputUrl) {
    throw new Error("Replicate 生成超時，請重試。");
  }

  // 第三步：下載圖片並轉 base64
  console.log("📥 正在下載生成的圖片...");
  var imageResp = await fetch(outputUrl);
  var arrayBuffer = await imageResp.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

// ==================== FLUX.1 生成（原生繁體中文）====================

async function generateWithFlux(prompt, model) {
  var modelMap = {
    "flux": "black-forest-labs/flux-schnell",
    "flux-dev": "black-forest-labs/flux-dev",
    "flux-pro": "black-forest-labs/flux-pro",
  };
  var modelVersion = modelMap[model] || "black-forest-labs/flux-dev";

  var requestBody = {
    input: {
      prompt: prompt,
      negative_prompt: "text, words, letters, watermark, signature, logo, chinese characters, writing, typography, font, caption, label, violent, bloody, weapons, gore",
      num_outputs: 1,
      aspect_ratio: "1:1",
      output_format: "png",
      output_quality: 90,
      guidance_scale: 7.5,
    },
  };

  console.log("📡 正在呼叫 Replicate " + modelVersion + "...");

  // 第一步：建立 prediction
  var fluxUrl = REPLICATE_API_URL;
  var response = await fetch(fluxUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Token " + REPLICATE_API_KEY,
      Prefer: "wait",
    },
    body: JSON.stringify(
      Object.assign({}, requestBody, {
        version: modelVersion,
      })
    ),
  });

  var prediction = await response.json();

  if (!response.ok) {
    throw new Error(
      "FLUX 錯誤: " + (prediction.detail || prediction.message || "未知")
    );
  }

  // 檢查是否已完成
  var outputUrl = null;
  if (prediction.status === "succeeded" && prediction.output) {
    // output 可能是 string URL 或 array
    outputUrl = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;
  } else if (prediction.status === "processing" || prediction.status === "starting") {
    // 等待完成
    var predictionUrl = REPLICATE_API_URL + "/" + prediction.id;
    for (var i = 0; i < 45; i++) {
      await sleep(2000);
      var statusResp = await fetch(predictionUrl, {
        headers: { Authorization: "Token " + REPLICATE_API_KEY },
      });
      var statusData = await statusResp.json();

      if (statusData.status === "succeeded") {
        outputUrl = Array.isArray(statusData.output)
          ? statusData.output[0]
          : statusData.output;
        break;
      }
      if (statusData.status === "failed") {
        throw new Error("FLUX 生成失敗: " + (statusData.error || "未知"));
      }
      if (i % 5 === 0) {
        console.log("⏳ FLUX 生成中... (" + statusData.status + ")");
      }
    }
  } else if (prediction.error) {
    throw new Error("FLUX 錯誤: " + prediction.error);
  }

  if (!outputUrl) {
    throw new Error("FLUX 生成超時，請重試。");
  }

  // 第三步：下載圖片並轉 base64
  console.log("📥 正在下載 FLUX 生成的圖片...");
  var imageResp = await fetch(outputUrl);
  var arrayBuffer = await imageResp.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

// ==================== Ideogram v2 生成 ====================

async function generateWithIdeogram(prompt) {
  var requestBody = {
    input: {
      prompt: prompt,
      aspect_ratio: "1:1",
      style_type: "Auto",
      negative_prompt: "text, words, letters, watermark, signature, violent, bloody, weapons",
    },
  };

  console.log("📡 正在呼叫 Replicate ideogram-ai/ideogram-v2...");

  var response = await fetch(REPLICATE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Token " + REPLICATE_API_KEY,
      Prefer: "wait",
    },
    body: JSON.stringify(
      Object.assign({}, requestBody, {
        version: "ideogram-ai/ideogram-v2",
      })
    ),
  });

  var prediction = await response.json();

  if (!response.ok) {
    throw new Error("Ideogram 錯誤: " + (prediction.detail || prediction.message || "未知"));
  }

  var outputUrl = await waitForPrediction(prediction);

  console.log("📥 正在下載 Ideogram 生成的圖片...");
  var imageResp = await fetch(outputUrl);
  var arrayBuffer = await imageResp.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

/**
 * 等待 Replicate prediction 完成並回傳圖片 URL
 */
async function waitForPrediction(prediction) {
  if (prediction.status === "succeeded" && prediction.output) {
    return Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  }

  var predictionUrl = REPLICATE_API_URL + "/" + prediction.id;
  for (var i = 0; i < 45; i++) {
    await sleep(2000);
    var resp = await fetch(predictionUrl, {
      headers: { Authorization: "Token " + REPLICATE_API_KEY },
    });
    var data = await resp.json();

    if (data.status === "succeeded") {
      return Array.isArray(data.output) ? data.output[0] : data.output;
    }
    if (data.status === "failed") {
      throw new Error("生成失敗: " + (data.error || "未知"));
    }
    if (i % 5 === 0) {
      console.log("⏳ 等待中... (" + data.status + ")");
    }
  }
  throw new Error("生成超時，請重試。");
}

// ==================== Hugging Face 生成（免費方案）====================

async function generateWithHuggingFace(prompt) {
  console.log("📡 正在呼叫 Hugging Face API（SDXL，免費）...");
  console.log("⏳ 首次載入模型約需 30-60 秒，請耐心等候...");

  var response = await fetch(HUGGINGFACE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + HUGGINGFACE_API_KEY,
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        negative_prompt: "violent, bloody, scary, weapons, realistic war",
        width: 1024,
        height: 1024,
        num_inference_steps: 30,
        guidance_scale: 7,
      },
    }),
  });

  // Hugging Face 可能回傳圖片 binary（成功）或 JSON（錯誤/載入中）
  var contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    var json = await response.json();

    // 模型正在載入中，等待後重試
    if (json.error && json.error.includes("loading")) {
      console.log("⏳ 模型正在載入中，等待 30 秒後重試...");
      var estimatedTime = json.estimated_time || 30;
      await sleep((estimatedTime + 5) * 1000);

      // 重試一次
      var retryResp = await fetch(HUGGINGFACE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + HUGGINGFACE_API_KEY,
        },
        body: JSON.stringify({ inputs: prompt }),
      });

      var retryContentType = retryResp.headers.get("content-type") || "";
      if (retryContentType.includes("application/json")) {
        var retryJson = await retryResp.json();
        throw new Error("Hugging Face 錯誤: " + (retryJson.error || JSON.stringify(retryJson)));
      }

      var retryBuffer = await retryResp.arrayBuffer();
      return Buffer.from(retryBuffer).toString("base64");
    }

    throw new Error("Hugging Face 錯誤: " + (json.error || JSON.stringify(json)));
  }

  // 成功：回傳的是圖片 binary
  var arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength < 1000) {
    throw new Error("Hugging Face 回傳的圖片太小，可能生成失敗。請重試。");
  }

  return Buffer.from(arrayBuffer).toString("base64");
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// ==================== 啟動伺服器 ====================
app.listen(PORT, function () {
  var baseURL = getBaseURL();
  console.log("");
  console.log("══════════════════════════════════════════════");
  console.log("  🏯  香港抗戰歷史圖像生成器 — 後端伺服器");
  console.log("══════════════════════════════════════════════");
  console.log("  📡  網址: " + baseURL);
  console.log("  🎨  API:  " + baseURL + "/api/generate-image");
  console.log("  📋  狀態: " + baseURL + "/api/status");
  console.log("  🖼️  圖片: " + baseURL + "/generated/");
  console.log("──────────────────────────────────────────────");
  console.log("  🔌  後端: " + AI_PROVIDER.toUpperCase() + " / " + AI_MODEL.toUpperCase());
  if (AI_MODEL === "flux") {
    console.log("  🈶  原生支援繁體中文輸入");
  }
  if (hasAPIKey()) {
    console.log("  ✅  API Key 已設定");
  } else {
    console.log("  ⚠️  尚未設定 API Key");
    console.log("     請複製 .env.example 為 .env 並填入 API Key");
  }
  console.log("══════════════════════════════════════════════");
  console.log("");
});
