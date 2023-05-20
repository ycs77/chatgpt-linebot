require('dotenv').config()

const express = require('express')
const { createClient: createRedisClient } = require('redis')
const LINE = require('@line/bot-sdk')
const { Configuration, OpenAIApi } = require('openai')
const axios = require('axios').default
const sharp = require('sharp')
const c = require('chalk')
const { sign, verify } = require('./sign')

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

app.get('/preview-image/:hash/:url', async (req, res) => {
  const signed = req.params.hash
  const url = req.params.url

  if (verify(encodeURIComponent(url), signed)) {
    try {
      const { data, headers } = await axios.get(url, {
        responseType: 'arraybuffer',
      })

      let imageBuffer = data
      // 如果圖片大於 1MB，就縮小圖片
      if (parseInt(headers['content-length']) > (1024 * 1024)) {
        imageBuffer = await sharp(data)
          .resize(512, 512)
          .toBuffer()
      }

      res.setHeader('Content-Length', headers['content-length'])
      res.setHeader('Content-Type', headers['content-type'])
      res.send(imageBuffer)
    } catch (err) {
      console.error(err)
    }

    return
  }

  res.status(404)
  res.send('Not found')
})

async function handleEvent(event) {
  if (event.type !== 'message' ||
      event.message.type !== 'text' && event.message.type !== 'audio'
  ) {
    // ignore non text/audio message event
    return Promise.resolve(null)
  }

  let userMessage = event.message.text
  const sourceId = event.source.groupId || event.source.userId

  let groupCanReply = false
  let audioCanReply = false

  if (event.message.type === 'text' && ['help', '/h', '/help'].includes(userMessage)) {
    let helpMessage = `✨聊天機器人 指令列表✨

清除對話暫存資料：
/clear

在群組問機器人問題：
/chat 請問1+1等於幾?
> 1+1等於2

產生圖片：
/image the beautiful sky
預設圖片解析度是 256x256，如果要較高解析度可以輸入 512 或 1024：
/image 512 the beautiful sky
/image 1024 the beautiful sky

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
  if (event.message.type === 'text' &&
    ['清除', '清緩存', '清除緩存', '/clear'].includes(userMessage)
  ) {
    redis.del(`linebot_user:${sourceId}`)

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '清除完成~',
    })
  }

  // set train message
  if (event.message.type === 'text' && userMessage.startsWith('/set-train')) {
    userMessage = userMessage.replace(/^\/set-train/, '').trim()

    redis.set(`linebot_user_train:${sourceId}`, userMessage)

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '設定完成~',
    })
  }

  // get train message
  if (event.message.type === 'text' && userMessage === '/get-train') {
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
  if (event.message.type === 'text' && userMessage === '/del-train') {
    redis.del(`linebot_user_train:${sourceId}`)

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '清除完成~',
    })
  }

  // generate image
  if (event.message.type === 'text' && userMessage.startsWith('/image ')) {
    let prompt = userMessage.slice('/image '.length)
    let size
    if (prompt.startsWith('256 ') || prompt.startsWith('512 ') || prompt.startsWith('1024 ')) {
      size = prompt.match(/^(\d{3,4}) /)[1]
      prompt = prompt.slice(size.length + 1)
    }
    const urls = await generateImageByGPT3(prompt, `${size}x${size}`)
    console.log(c.green(`[user (image)]: ${prompt}`))
    return linebot.replyMessage(event.replyToken, urls.map(url => {
      console.log(c.blue(`[assistant]: ${url}`))
      const hash = sign(encodeURIComponent(url))
      return {
        type: 'image',
        originalContentUrl: url,
        previewImageUrl: `${process.env.APP_URL.replace(/\/$/, '')}/preview-image/${hash}/${encodeURIComponent(url)}`,
      }
    }))
  }

  // skip `/chat` flag
  if (event.source.type === 'group' && userMessage === '/skip-chat-flag') {
    redis.set(`linebot_group_skip_chat_flag:${sourceId}`, 1)

    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: '之後將可以不用輸入 /chat 指令~',
    })
  }

  // no skip `/chat` flag
  if (event.source.type === 'group' && userMessage === '/no-skip-chat-flag') {
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

  // resolve audio message
  if (event.message.type === 'audio') {
    let content

    if (event.message.contentProvider.type === 'line') {
      content = await linebot.getMessageContent(event.message.id)
      content.path = 'audio.m4a'
    }

    if (content) {
      userMessage = await resolveAudioByWhisper(content)
      audioCanReply = true
    }
  }

  // echo message with GPT-3
  if ((event.source.type === 'user' || groupCanReply || audioCanReply) &&
      userMessage
  ) {
    const aiMessage =
      process.env.OPENAI_MODEL?.startsWith('gpt-3.5-turbo') || !process.env.OPENAI_MODEL
        ? await askByChatGPT(userMessage, sourceId)
        : await askByGPT3(userMessage, sourceId)

    let userSuffix = ''

    if (event.message.type === 'audio')
      userSuffix = ' (audio)'

    console.log(c.green(`[user${userSuffix}]: ${userMessage}`))
    console.log(c.blue(`[assistant]: ${aiMessage}`))

    // use reply API
    return linebot.replyMessage(event.replyToken, {
      type: 'text',
      text: aiMessage,
    })
  }

  return Promise.resolve(null)
}

async function askByGPT3(message, sourceId) {
  const trainMessage = await redis.get(`linebot_user_train:${sourceId}`)
  const trainMessageStr = trainMessage ? `Human: ${trainMessage}\nAI: \n` : ''

  let messagesStr = await redis.get(`linebot_user:${sourceId}`) || ''
  if (messagesStr) {
    messagesStr += '\n'
  }
  messagesStr += `Human: ${message}\nAI: `

  const completion = await openai.createCompletion({
    model: process.env.OPENAI_MODEL || 'text-davinci-003',
    prompt: trainMessageStr + messagesStr,
    temperature: 0.9,
    max_tokens: 1000,
    frequency_penalty: 0,
    presence_penalty: 0.6,
    stop: [' Human:', ' AI:'],
  })

  const aiMessage = completion.data.choices[0].text.trim()

  messagesStr += aiMessage

  redis.set(`linebot_user:${sourceId}`, messagesStr)
  redis.expire(`linebot_user:${sourceId}`, 60 * 60 * 1) // expires in 1 hour

  return aiMessage
}

async function askByChatGPT(message, sourceId) {
  const messages = []

  const trainMessage = await redis.get(`linebot_user_train:${sourceId}`)
  if (trainMessage) {
    messages.push({
      role: 'system',
      content: trainMessage,
    })
  }

  let messagesHistory = []
  try {
    messagesHistory = JSON.parse(await redis.get(`linebot_user:${sourceId}`) || '[]') ?? []
  } catch (e) {}
  messagesHistory.push({
    role: 'user',
    content: message,
  })
  messages.push(...messagesHistory)

  const completion = await openai.createChatCompletion({
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
    messages,
    temperature: 0.9,
    max_tokens: 1000,
    frequency_penalty: 0,
    presence_penalty: 0.6,
  })

  const aiMessage = completion.data.choices[0].message
  aiMessage.content = aiMessage.content
    .trim()
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')

  messagesHistory.push(aiMessage)

  redis.set(`linebot_user:${sourceId}`, JSON.stringify(messagesHistory))
  redis.expire(`linebot_user:${sourceId}`, 60 * 60 * 1) // expires in 1 hour

  return aiMessage.content
}

async function resolveAudioByWhisper(content) {
  const { data } = await openai.createTranscription(content, 'whisper-1')
  return data.text
}

async function generateImageByGPT3(message, size) {
  const { data } = await openai.createImage({
    prompt: message,
    n: 1,
    size: size ?? '256x256',
  })
  return data.data.map(({ url }) => url)
}

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`listening on ${port}`)
})
