# 實作者盤點｜2026-09-19 03:17 台北

角色：implementer。只列已存在事實與明日必須產出檔案。

## 一、已經有的（不需再買、不需再建）

1. **GitHub 倉庫**  
   `wrencalder149/global-discovery-engine`  
   主分支可寫、可 commit。

2. **desk/ 目錄結構**  
   - `desk/PROTOCOL.txt`：已鎖定三包規格（簡報可短、feature／culture 必須完整文章）。  
   - `desk/ARTICLE_SPEC.txt`：完整文章最低骨架。  
   - `desk/README.txt`：不使用 Workers AI 寫稿。  
   - `desk/sources.yaml`：已列 16 個 RSS（中文種子 + 英文核心 + 德／法／西／印尼）。  
   - `desk/build-feed.py`：從 editions 重建 feed.xml。  
   - `desk/feed.xml`：已存在，目前含 09-18、09-19 各包。

3. **editions 歷史**  
   - `desk/editions/2026-09-18/`：briefing / feature / culture / notes  
   - `desk/editions/2026-09-19/`：briefing / feature / culture / notes  
   現況：feature.md、culture.md 仍為多則短條，整檔遠低於單篇 1200 字門檻，屬簡報級，尚未達 PROTOCOL 要求。

4. **grokbot 每日任務**  
   task_id `6888be5a-510a-4eb6-9977-1021df4dd740`  
   名稱：World Reader daily desk  
   時間：每日 07:30 Asia/Taipei  
   提示已含 PROTOCOL、ARTICLE_SPEC、三檔規格、拒絕 Marvel／票房／偶像。

5. **其他已存在但不當產品的**  
   Cloudflare Worker 仍在跑、仍產 stub。依指示 **IGNORE as product**。不依賴它寫稿、不依賴它當 RSS 來源。

## 二、需要套用／明天就做的（零成本）

- 明天 07:30 grokbot 依 PROTOCOL 產出 **完整長度** 的三包，不再接受短簡報冒充深度／文化。  
- 產出後立刻跑 `python desk/build-feed.py` 更新 `desk/feed.xml`，再 commit main。  
- 若 feature 或 culture 讀不完原文、寫不滿最低字數 → 該包不放進 feed（PROTOCOL 失敗規則）。

## 三、今天不要買、不要申請

- 不買任何付費 API、付費 RSS、付費 TTS。  
- 不申請新 Cloudflare 帳號、新 D1、新 Workers AI 配額。  
- 不新增任何伺服器、VPS、域名。  
- 不改 Cloudflare Worker 程式（它只當 stub 忽略）。  
- 不擴大 sources.yaml 到 250 個來源。  
- 音檔（MeloTTS）延後，今日與明日皆不做。

## 四、明天早晨 grokbot 必須精確產出的檔案

日期以執行當日為準。若 2026-09-20 07:30 執行，則：

```
desk/editions/2026-09-20/briefing.md
desk/editions/2026-09-20/feature.md
desk/editions/2026-09-20/culture.md
desk/editions/2026-09-20/notes.md
desk/feed.xml          ← 由 build-feed.py 重建
```

### 各檔最低要求（直接抄自 PROTOCOL + ARTICLE_SPEC）

**briefing.md**  
- 標題行：今日簡報｜YYYY-MM-DD  
- 3–5 則，每則 200–400 正體中文字。  
- 必須有背景，禁止純標題堆疊。  
- 可短，這是允許的。

**feature.md**  
- 1 或 2 篇 **完整** 報導。  
- 每篇 1200–2800 正體中文字。  
- 必須含：發生什麼、為何現在重要、具體對象／衝突（人名／機構／數字）、背景、已確認與單一來源／爭議、知識邊界。  
- 禁止導言、禁止「目前僅見 XX」當主文。

**culture.md**  
- 同上完整度。  
- 主題限：修復／老電影／文學／設計／歷史／音樂／思想。  
- 禁止漫威、票房、偶像通稿。

**notes.md**  
- 英文或原文筆記即可。  
- 列出讀過的來源、數字性質、單一來源標記。

**feed.xml**  
- 只納入已寫完、非 stub、非「編譯未完成」的包。  
- 由 `desk/build-feed.py` 產生，人工不得手改。

## 五、一句執行指令（給明天 07:30 的 grokbot）

讀完 PROTOCOL.txt 與 ARTICLE_SPEC.txt → 從 sources.yaml 收標題 → 深讀 8–12 篇原文 → 先寫 notes → 再寫三包正體中文 → 跑 build-feed.py → commit main。寫不滿就不出刊該包。
