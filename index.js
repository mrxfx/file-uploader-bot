import express from "express"
import axios from "axios"
import { Telegraf } from "telegraf"
import { randomBytes } from "crypto"

const bot = new Telegraf(process.env.BOT_TOKEN)
const app = express()
const storage = {}
const MAX_SIZE = 30 * 1024 * 1024

bot.start(async (ctx) => {
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing")
  const name = ctx.from.first_name
  const id = ctx.from.id
  await ctx.replyWithHTML(
    👋<b>Welcome <a href="tg://user?id=${id}">${name}</a>,\n\nI am here to host your file for free. Share me file which should be less than 30 mb</b>,
    { reply_to_message_id: ctx.message.message_id }
  )
})

bot.on(["document", "video", "animation", "photo", "sticker"], async (ctx) => {
  let file_id, file_name, file_size

  if (ctx.message.document) {
    file_id = ctx.message.document.file_id
    file_name = ctx.message.document.file_name
    file_size = ctx.message.document.file_size
  } else if (ctx.message.video) {
    file_id = ctx.message.video.file_id
    file_name = "video.mp4"
    file_size = ctx.message.video.file_size
  } else if (ctx.message.animation) {
    file_id = ctx.message.animation.file_id
    file_name = ctx.message.animation.file_name || "animation.gif"
    file_size = ctx.message.animation.file_size
  } else if (ctx.message.sticker) {
    file_id = ctx.message.sticker.file_id
    file_name = "sticker.webp"
    file_size = ctx.message.sticker.file_size
  } else if (ctx.message.photo) {
    const photo = ctx.message.photo.at(-1)
    file_id = photo.file_id
    file_name = "image.jpg"
    file_size = photo.file_size
  }

  if (file_size > MAX_SIZE) {
    await ctx.reply("❌ File too large. Only files under 30 MB are allowed.", {
      reply_to_message_id: ctx.message.message_id
    })
    return
  }

  const file = await ctx.telegram.getFile(file_id)
  const url = https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}
  const buffer = (await axios.get(url, { responseType: 'arraybuffer' })).data
  const id = randomBytes(8).toString("hex")
  storage[id] = { buffer, name: file_name }
  const link = https://image-uploader-bot.vercel.app/upload?id=${id}
  await ctx.reply(link, { reply_to_message_id: ctx.message.message_id })
})

app.use(bot.webhookCallback("/"))

app.get("/upload", (req, res) => {
  const file = storage[req.query.id]
  if (!file) return res.status(404).send("File not found")
  res.setHeader("Content-Disposition", attachment; filename="${file.name}")
  res.send(file.buffer)
})

export default app



4/4

