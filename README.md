# ChatGPT LINE 聊天機器人

> 參考自文章 [用 Node.js 建立你的第一個 LINE Bot 聊天機器人以 OpenAI GPT-3 為例](https://israynotarray.com/nodejs/20221210/1224824056/)

## 申請金鑰

### LINE Developers

開啟 [LINE Developers](https://developers.line.biz/) 新增 Messaging API 即可獲取金鑰，並關閉「自動回應訊息」和開啟「Webhook」。

### ChatGPT

開啟 [API keys - OpenAI API](https://beta.openai.com/account/api-keys) 新增一個 API 金鑰。

## 啟動

複製 .env 檔並將取得的金鑰貼進去：

```bash
cp .env.example .env
```

這個機器人還使用到 Redis 暫存對話資料，需要事先啟動好 Redis。

然後本地安裝和啟動：

```bash
yarn
yarn dev
```

## 使用

發送以下關鍵字可以清除對話暫存資料：

* `清除`
* `清除緩存`
* `/clear`
* `/reset`

在群組中需要加上 `/chat` 機器人才會回話，例如：

```
/chat 請問1+1等於幾?
```
