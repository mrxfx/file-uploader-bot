import express from "express"
import axios from "axios"
import { Telegraf } from "telegraf"
import { randomBytes } from "crypto"
import { initializeApp } from "firebase/app"
import { getDatabase, ref, set, push, get, child } from "firebase/database"
import { createRequire } from "module"
const require = createRequire(import.meta.url)
const config = require("./config.json")

const app = express()
const bot = new Telegraf(config.BOT_TOKEN)
const MAX_SIZE = 30 * 1024 * 1024
const storage = {}

const firebaseApp = initializeApp({ databaseURL: config.FIREBASE_DB_URL })
const db = getDatabase(firebaseApp)

let broadcastMode = false
let broadcastCtx = null

bot.start(async (ctx) => {
  const user = {
    first_name: ctx.from.first_name,
    telegramid: ctx.from.id,
    username: ctx.from.username || ""
  }

  const userRef = ref(db, "users/" + user.telegramid)
  const snapshot = await get(userRef)
  if (!snapshot.exists()) {
    await set(userRef, user)
    const stat = await get(ref(db, "users"))
    const totalUsers = stat.exists() ? Object.keys(stat.val()).length : 1
    await bot.telegram.sendMessage(
      config.ADMIN_ID,
      "➕ <b>New User Notification</b> ➕\n\n👤<b>User:</b> <a href='tg://user?id=" +
        user.telegramid +
        "'>" +
        user.first_name +
        "</a>\n\n🆔<b> User ID :</b> <code>" +
        user.telegramid +
        "</code>\n\n🌝 <b>Total User's Count: " +
        totalUsers +
        "</b>",
      { parse_mode: "HTML" }
    )
  }

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing")
  await ctx.replyWithHTML(
    `👋<b>Welcome <a href="tg://user?id=${user.telegramid}">${user.first_name}</a>,\n\nI am here to host your file for free. Share me file which should be less than 30 mb</b>`,
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
  const url = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`
  const buffer = (await axios.get(url, { responseType: "arraybuffer" })).data
  const id = randomBytes(8).toString("hex")
  storage[id] = { buffer, name: file_name }

  const fileRef = push(ref(db, "files"))
  await set(fileRef, {
    user_id: ctx.from.id,
    file_id: file_id,
    name: file_name
  })

  const link = `https://image-uploader-bot.vercel.app/upload?id=${id}`
  await ctx.reply(link, { reply_to_message_id: ctx.message.message_id })
})

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_ID) return
  broadcastMode = true
  broadcastCtx = ctx
  await ctx.replyWithHTML("<b>Enter Broadcast Message Here 👇</b>")
})

bot.on("message", async (ctx) => {
  if (broadcastMode && ctx.from.id.toString() === config.ADMIN_ID) {
    broadcastMode = false
    const usersRef = ref(db, "users")
    const snapshot = await get(usersRef)

    if (snapshot.exists()) {
      const users = snapshot.val()
      for (const uid in users) {
        try {
          await ctx.telegram.copyMessage(uid, ctx.chat.id, ctx.message.message_id)
        } catch (e) {}
      }
    }
  }
})

app.use(bot.webhookCallback("/"))
app.get("/upload", (req, res) => {
  const file = storage[req.query.id]
  if (!file) return res.status(404).send("File not found")
  res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`)
  res.send(file.buffer)
})

export default app
