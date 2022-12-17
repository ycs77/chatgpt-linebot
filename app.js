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
  if ([
    '清除', '清除緩存',
    '/clear', '/reset',
    'clear', 'reset',
  ].includes(event.message.text)) {
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
  let messagesStr = await redis.get(`linebot_user:${sourceId}`) || ''
  if (messagesStr) {
    messagesStr += '\n'
  }
  messagesStr += `Human: ${message}\nAI: `

  const completion = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: messagesStr,
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
