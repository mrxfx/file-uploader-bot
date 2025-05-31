import express from "express"
import multer from "multer"
import axios from "axios"
import { Telegraf } from "telegraf"
import { randomBytes } from "crypto"

const bot = new Telegraf(process.env.BOT_TOKEN)
const app = express()
const upload = multer({ limits: { fileSize: 30 * 1024 * 1024 } })
const storage = {}

bot.start(async (ctx) => {
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing")
  const name = ctx.from.first_name
  const id = ctx.from.id
  await ctx.replyWithHTML(
    `👋<b>Welcome <a href="tg://user?id=${id}">${name}</a>,\n\nI am here to host your file for free. Share me file which should be less than 30 mb</b>`,
    { reply_to_message_id: ctx.message.message_id }
  )
})

bot.on(["document", "video", "animation", "photo"], async (ctx) => {
  await ctx.telegram.sendChatAction(ctx.chat.id, "upload_document")
  let file_id, file_name

  if (ctx.message.document) {
    file_id = ctx.message.document.file_id
    file_name = ctx.message.document.file_name
  } else if (ctx.message.video) {
    file_id = ctx.message.video.file_id
    file_name = "video.mp4"
  } else if (ctx.message.animation) {
    file_id = ctx.message.animation.file_id
    file_name = ctx.message.animation.file_name || "animation.gif"
  } else if (ctx.message.photo) {
    const photo = ctx.message.photo.at(-1)
    file_id = photo.file_id
    file_name = "image.jpg"
  }

  const file = await ctx.telegram.getFile(file_id)
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`
  const buffer = (await axios.get(url, { responseType: 'arraybuffer' })).data
  const id = randomBytes(8).toString("hex")
  storage[id] = { buffer, name: file_name }
  const link = `https://${process.env.VERCEL_URL}/upload?id=${id}`
  await ctx.reply(link, { reply_to_message_id: ctx.message.message_id })
})

app.use(bot.webhookCallback("/"))

app.get("/upload", (req, res) => {
  const file = storage[req.query.id]
  if (!file) return res.status(404).send("File not found")
  res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`)
  res.send(file.buffer)
})

export default app
