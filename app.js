require('dotenv').config()

const express = require('express')
const line = require('@line/bot-sdk')
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
const client = new line.Client(lineConfig)

// express instance
const app = express()

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.post('/callback', line.middleware(lineConfig), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err)
      res.status(500).end()
    })
})

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    // ignore non-text-message event
    return Promise.resolve(null)
  }

  const humanMessage = event.message.text
  const aiMessage = await ask(humanMessage)

  console.log(c.green('[human]: ' + humanMessage))
  console.log(c.blue('[AI]: ' + aiMessage))

  // create a echoing text message
  const echo = { type: 'text', text: aiMessage }

  // use reply API
  return client.replyMessage(event.replyToken, echo)
}

async function ask(message) {
  const completion = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: message,
    max_tokens: 500,
  })

  return completion.data.choices[0].text.trim()
}

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`listening on ${port}`)
})
