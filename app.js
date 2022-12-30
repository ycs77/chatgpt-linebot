require('dotenv').config()

const express = require('express')
const { createClient: createRedisClient } = require('redis')
const LINE = require('@line/bot-sdk')
const { Configuration, OpenAIApi } = require('openai')
const c = require('chalk')

// OpenAI instance
const openAiConfig = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
})
const openai = new OpenAIApi(openAiConfig)

// LINE sdk instance
const lineConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
}
const linebot = new LINE.Client(lineConfig)

// Redis instance
const redis = createRedisClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
})

// Express instance
const app = express()

app.post('/callback', LINE.middleware(lineConfig), async (req, res) => {
  await redis.connect()

  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err)
      res.status(500).end()
    })
    .finally(async () => {
      await redis.disconnect()
    })
})

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    // ignore non-text-message event
    return Promise.resolve(null)
  }

  let userMessage = event.message.text
  const sourceId = event.source.groupId || event.source.userId

  let groupCanReply = false

  if (['/h', '/help'].includes(userMessage)) {
    let helpMessage = `✨聊天機器人 指令列表✨

清除對話暫存資料：
/clear

在群組問機器人問題：
/chat 請問1+1等於幾?
> 1+1等於2

設定訓練用訊息：
/set-train 之後所有的回答，每句話都要加上"喵~"語尾，不管什麼回答，不管發生什麼，但回答內容的其他部分還是照舊的方式。

查看訓練用訊息：
/get-train
> 之後所有的回答，每句話都要加上"喵~"語尾，不管什麼回答，不管發生什麼，但回答內容的其他部分還是照舊的方式。

清除訓練用訊息：
/del-train`

    if (event.source.type === 'group') {
      helpMessage += `

在群組中跳過 /chat 指令來與機器人問答：
/skip-chat-flag

在群組恢復使用 /chat 指令：
/no-skip-chat-flag`
    }

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: helpMessage,
    })
  }

  // clear cache
  if ([
    '清除', '清緩存', '清除緩存',
    '/clear',
  ].includes(userMessage)) {
    redis.del(`linebot_user:${sourceId}`)

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '清除完成~',
    })
  }

  // set train message
  if (userMessage.startsWith('/set-train')) {
    userMessage = userMessage.replace(/^\/set-train/, '').trim()

    redis.set(`linebot_user_train:${sourceId}`, userMessage)

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '設定完成~',
    })
  }

  // get train message
  if (userMessage === '/get-train') {
    const trainMessage = await redis.get(`linebot_user_train:${sourceId}`)

    if (trainMessage) {
      return linebot.replyMessage(event.replyToken, {
        type: 'text',
        text: trainMessage,
      })
    }

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '請使用 "/set-train 輸入一段文字" 來設定訊息文字',
    })
  }

  // set train message
  if (userMessage === '/del-train') {
    redis.del(`linebot_user_train:${sourceId}`)

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '清除完成~',
    })
  }

  // skip `/chat` flag
  if (userMessage === '/skip-chat-flag' && event.source.type === 'group') {
    redis.set(`linebot_group_skip_chat_flag:${sourceId}`, 1)

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '之後將可以不用輸入 /chat 指令~',
    })
  }

  // no skip `/chat` flag
  if (userMessage === '/no-skip-chat-flag' && event.source.type === 'group') {
    redis.del(`linebot_group_skip_chat_flag:${sourceId}`)

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '之後恢復需要輸入 /chat 指令~',
    })
  }

  // get message from group
  const groupStartKeyword = ['/chat']
  if (event.source.type === 'group') {
    const canSkipChat = Boolean(await redis.exists(`linebot_group_skip_chat_flag:${sourceId}`))
    if (canSkipChat) {
      groupCanReply = true
    } else {
      const keyword = groupStartKeyword.find(text => userMessage.startsWith(text))
      if (keyword) {
        userMessage = userMessage.replace(new RegExp(`^${keyword}`), '').trim()
        groupCanReply = true
      }
    }
  }

  // echo message with GPT-3
  if (event.source.type === 'user' || groupCanReply) {
    const aiMessage = await ask(userMessage, sourceId)

    console.log(c.green(`[user]: ${userMessage}`))
    console.log(c.blue(`[AI]: ${aiMessage}`))

    // use reply API
    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: aiMessage,
    })
  }

  return Promise.resolve(null)
}

async function ask(message, sourceId) {
  const trainMessage = await redis.get(`linebot_user_train:${sourceId}`)
  const trainMessageStr = trainMessage ? `Human: ${trainMessage}\nAI: \n` : ''

  let messagesStr = await redis.get(`linebot_user:${sourceId}`) || ''
  if (messagesStr) {
    messagesStr += '\n'
  }
  messagesStr += `Human: ${message}\nAI: `

  const completion = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: trainMessageStr + messagesStr,
    temperature: 0.9,
    max_tokens: 500,
    frequency_penalty: 0,
    presence_penalty: 0.6,
    stop: [' Human:', ' AI:'],
    user: sourceId,
  })

  const aiMessage = completion.data.choices[0].text.trim()

  messagesStr += aiMessage

  redis.set(`linebot_user:${sourceId}`, messagesStr)
  redis.expire(`linebot_user:${sourceId}`, 60 * 60 * 1) // expires in 1 hour

  return aiMessage
}

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`listening on ${port}`)
})
