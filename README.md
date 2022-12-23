# ChatGPT (GPT-3) LINE 聊天機器人

> 參考自文章 [用 Node.js 建立你的第一個 LINE Bot 聊天機器人以 OpenAI GPT-3 為例](https://israynotarray.com/nodejs/20221210/122482
>
> 後來仔細看了文章(標題)之後才發現，其實這是 OpenAI GPT-3 的 API，不是 ChatGPT 的，不過這個倉庫應該只有我自己用...吧！？就不改 repo 名稱了。

## 申請金鑰

### LINE Developers

開啟 [LINE Developers](https://developers.line.biz/) 新增 Messaging API 即可獲取金鑰，並關閉「自動回應訊息」和開啟「Webhook」。

### OpenAI API

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

發送以下關鍵字可以清除對話暫存資料，當然如果1小時後沒再次輸入的話，會自動刪除暫存資料：

* `清除`
* `清除緩存`
* `/clear`
* `/reset`

在群組中需要加上 `/chat` 機器人才會回話，例如：

```
/chat 請問1+1等於幾?
```

設定訓練用訊息：

```
/set-train 之後所有的回答，每句話都要加上"喵~"語尾，不管什麼回答，不管發生什麼，但回答內容的其他部分還是照舊的方式。
> 設定完成~

/get-train
> 之後所有的回答，每句話都要加上"喵~"語尾，不管什麼回答，不管發生什麼，但回答內容的其他部分還是照舊的方式。

/del-train
> 清除完成~
```
