const express = require("express")
const multer = require("multer")
const axios = require("axios")
const { Telegraf } = require("telegraf")
const { randomBytes } = require("crypto")

const bot = new Telegraf(process.env.BOT_TOKEN)
const app = express()
const upload = multer({ limits: { fileSize: 30 * 1024 * 1024 } })
const storage = {}

bot.start(async (ctx) => {
  const name = ctx.from.first_name
  const id = ctx.from.id
  await ctx.replyWithHTML(`👋<b>Welcome ${name}](tg://user?id=${id}),\n\nI am here to host your file for free. Share me file which should be less than 30 mb</b>`)
})

bot.on('document', async (ctx) => handleFile(ctx, ctx.message.document.file_id, ctx.message.document.file_name))
bot.on('video', async (ctx) => handleFile(ctx, ctx.message.video.file_id, "video.mp4"))
bot.on('photo', async (ctx) => {
  const photos = ctx.message.photo
  const file_id = photos[photos.length - 1].file_id
  handleFile(ctx, file_id, "image.jpg")
})
bot.on('animation', async (ctx) => handleFile(ctx, ctx.message.animation.file_id, ctx.message.animation.file_name))

async function handleFile(ctx, file_id, file_name) {
  const file = await ctx.telegram.getFile(file_id)
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`
  const buffer = (await axios.get(url, { responseType: 'arraybuffer' })).data
  const id = randomBytes(8).toString("hex")
  storage[id] = { buffer, name: file_name }
  const link = `${process.env.VERCEL_URL}/upload?id=${id}`
  await ctx.reply(link)
}

app.use(bot.webhookCallback("/"))

app.get("/upload", (req, res) => {
  const file = storage[req.query.id]
  if (!file) return res.status(404).send("File not found")
  res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`)
  res.send(file.buffer)
})

module.exports = app
