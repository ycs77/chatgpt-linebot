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

app.get('/', (req, res) => {
  res.send('Hello World!')
})

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

  // clear cache
  if (['清除', '清除緩存', 'clear'].includes(event.message.text)) {
    redis.del(`linebot_user:${sourceId}`)

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '清除完成~',
    })
  }

  const groupStartKeyword = ['/chat', 'ChatGPT', 'chatgpt']
  if (event.source.type === 'group') {
    const keyword = groupStartKeyword.find(text => userMessage.startsWith(text))
    if (keyword) {
      userMessage = userMessage.replace(new RegExp(`^${keyword}`), '').trim()
      groupCanReply = true
    }
  }

  // echo message with ChatGPT
  if (event.source.type === 'user' || groupCanReply) {
    redis.lPush(`linebot_user:${sourceId}`, userMessage)
    redis.expire(`linebot_user:${sourceId}`, 60 * 60 * 1) // expires in 1 hour
    const cacheMessages = await redis.lRange(`linebot_user:${sourceId}`, 0, -1)

    const aiMessage = await ask(cacheMessages, sourceId)

    console.log(c.green(`[user]: ${userMessage}`))
    console.log(c.blue(`[AI]: ${aiMessage}`))

    // use reply API
    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: aiMessage,
    })
  }
}

async function ask(message, userId) {
  const completion = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: message,
    max_tokens: 500,
    user: userId,
  })

  return completion.data.choices[0].text.trim()
}

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`listening on ${port}`)
})
