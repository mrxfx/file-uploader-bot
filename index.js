import express from "express"
import axios from "axios"
import { randomBytes } from "crypto"
import bodyParser from "body-parser"
import { Telegraf, session } from "telegraf"
import admin from "firebase-admin"

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "flecdev-efed1.appspot.com"
})

const bucket = admin.storage().bucket()

const BOT_TOKEN = "7784028733:AAHANG4AtqTcXhOSHtUT1x0_9q0XX98ultg"
const VERCEL_URL = "https://image-uploader-bot.vercel.app"
const FIREBASE_DB_URL = "https://flecdev-efed1-default-rtdb.firebaseio.com"
const ADMIN_ID = "7320532917"

const bot = new Telegraf(BOT_TOKEN)
const app = express()
const MAX_SIZE = 30 * 1024 * 1024

app.use(bodyParser.json({ limit: "50mb" }))

app.use(bot.webhookCallback("/"))

bot.use(session())

bot.telegram.setWebhook(`${VERCEL_URL}/`)

bot.start(async (ctx) => {
  const id = ctx.from.id
  const name = ctx.from.first_name
  const userData = { telegramid: id, first_name: name, date: Date.now() }
  try {
    const existing = await axios.get(`${FIREBASE_DB_URL}/users/${id}.json`)
    if (!existing.data) {
      await axios.put(`${FIREBASE_DB_URL}/users/${id}.json`, userData)
      const res = await axios.get(`${FIREBASE_DB_URL}/users.json`)
      const totalUsers = Object.keys(res.data || {}).length
      const message = `➕ <b>New User Notification</b> ➕\n\n👤<b>User:</b> <a href="tg://user?id=${id}">${name}</a>\n\n🆔<b>User ID:</b> <code>${id}</code>\n\n🌝 <b>Total Users Count: ${totalUsers}</b>`
      await bot.telegram.sendMessage(ADMIN_ID, message, { parse_mode: "HTML" })
    }
  } catch {}

  await ctx.replyWithHTML(
    `👋<b>Welcome <a href="tg://user?id=${id}">${name}</a>,\n\nI am here to host your file for free. Share me file which should be less than 30 mb</b>`,
    { reply_to_message_id: ctx.message.message_id }
  )
})

bot.command("webhook", async (ctx) => {
  try {
    await bot.telegram.setWebhook(`${VERCEL_URL}/`)
    ctx.reply(JSON.stringify({ status: "Webhook set successfully" }), {
      reply_to_message_id: ctx.message.message_id
    })
  } catch (e) {
    ctx.reply(JSON.stringify({ error: e.message }), {
      reply_to_message_id: ctx.message.message_id
    })
  }
})

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return
  ctx.session.broadcast = true
  await ctx.reply("<b>Enter Broadcast Message Here 👇</b>", {
    parse_mode: "HTML",
    reply_to_message_id: ctx.message.message_id
  })
})

bot.on("message", async (ctx, next) => {
  ctx.session = ctx.session || {}
  if (ctx.session.broadcast && ctx.from.id.toString() === ADMIN_ID) {
    ctx.session.broadcast = false
    const broadcastMsg = ctx.message.message_id
    try {
      const res = await axios.get(`${FIREBASE_DB_URL}/users.json`)
      const users = res.data || {}
      let count = 0
      for (const uid of Object.keys(users)) {
        try {
          await ctx.copyMessage(uid, ctx.chat.id, broadcastMsg)
          count++
          await new Promise(r => setTimeout(r, 300))
        } catch {}
      }
      await ctx.reply(`✅ Broadcast sent to ${count} users.`)
    } catch (e) {
      await ctx.reply(`❌ Broadcast failed: ${e.message}`)
    }
  } else {
    await next()
  }
})

bot.on(["document", "video", "photo", "sticker", "animation"], async (ctx) => {
  let file_id, file_name, file_size
  if (ctx.message.document) {
    file_id = ctx.message.document.file_id
    file_name = ctx.message.document.file_name || "file"
    file_size = ctx.message.document.file_size
  } else if (ctx.message.video) {
    file_id = ctx.message.video.file_id
    file_name = "video.mp4"
    file_size = ctx.message.video.file_size
  } else if (ctx.message.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1]
    file_id = photo.file_id
    file_name = "image.jpg"
    file_size = photo.file_size
  } else if (ctx.message.sticker) {
    file_id = ctx.message.sticker.file_id
    file_name = "sticker.webp"
    file_size = ctx.message.sticker.file_size
  } else if (ctx.message.animation) {
    file_id = ctx.message.animation.file_id
    file_name = ctx.message.animation.file_name || "animation.gif"
    file_size = ctx.message.animation.file_size
  } else return

  if (file_size > MAX_SIZE) {
    await ctx.reply("❌ File too large. Only files under 30 MB are allowed.", {
      reply_to_message_id: ctx.message.message_id
    })
    return
  }

  const file = await ctx.telegram.getFile(file_id)
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
  const response = await axios.get(url, { responseType: "arraybuffer" })
  const buffer = response.data
  const id = randomBytes(8).toString("hex")
  const fileUpload = bucket.file(`${id}-${file_name}`)
  await fileUpload.save(buffer, { resumable: false, contentType: "application/octet-stream" })
  await fileUpload.makePublic()
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileUpload.name}`

  await axios.post(`${FIREBASE_DB_URL}/links.json`, {
    id,
    name: ctx.from.first_name,
    telegram_id: ctx.from.id,
    time: Date.now(),
    file_name,
    publicUrl
  })

  const link = `${VERCEL_URL}/upload?id=${id}`
  await ctx.reply(link, { reply_to_message_id: ctx.message.message_id })
})

app.get("/upload", async (req, res) => {
  const id = req.query.id
  if (!id) return res.status(400).send("Missing id")

  try {
    const linksRes = await axios.get(`${FIREBASE_DB_URL}/links.json`)
    const links = linksRes.data || {}
    const entry = Object.values(links).find(e => e.id === id)
    if (!entry) return res.status(404).send("File not found")

    const fileUrl = entry.publicUrl
    if (!fileUrl) return res.status(404).send("File URL not found")

    const fileResp = await axios.get(fileUrl, { responseType: "stream" })
    res.setHeader("Content-Disposition", `attachment; filename="${entry.file_name}"`)
    res.setHeader("Content-Type", "application/octet-stream")
    fileResp.data.pipe(res)
  } catch {
    res.status(500).send("Server error")
  }
})

export default app
