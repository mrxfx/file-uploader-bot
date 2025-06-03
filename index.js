import express from "express"
import axios from "axios"
import { Telegraf, session, Markup } from "telegraf"
import { randomBytes } from "crypto"
import bodyParser from "body-parser"

const BOT_TOKEN = "7784028733:AAHANG4AtqTcXhOSHtUT1x0_9q0XX98ultg"
const VERCEL_URL = "https://image-uploader-bot.vercel.app"
const FIREBASE_DB_URL = "https://flecdev-efed1-default-rtdb.firebaseio.com"
const ADMIN_ID = "6918300873"
const MAX_SIZE = 30 * 1024 * 1024
const MAX_FILES_PER_USER = 50

const bot = new Telegraf(BOT_TOKEN)
const app = express()
app.use(bodyParser.json())
bot.use(session())

bot.telegram.setWebhook(`${VERCEL_URL}/`)
app.use(bot.webhookCallback("/"))

async function getUserFiles(userId) {
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/links.json`)
    const allLinks = res.data || {}
    return Object.entries(allLinks).filter(([key, val]) => val.id === userId).map(([key, val]) => ({ key, ...val }))
  } catch {
    return []
  }
}

async function getTotalUsers() {
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/users.json`)
    return Object.keys(res.data || {}).length
  } catch {
    return 0
  }
}

async function deleteFile(key) {
  try {
    await axios.delete(`${FIREBASE_DB_URL}/links/${key}.json`)
    return true
  } catch {
    return false
  }
}

function formatFileList(files) {
  if (!files.length) return "📁 You have no uploaded files."
  return files.map((f, i) => `${i + 1}. <a href="${f.link}">${f.link}</a>`)
    .join("\n")
}

function buildDeleteButtons(files) {
  return files.map(f => [Markup.button.callback(`🗑️ Delete #${f.key.slice(0,6)}`, `delete_${f.key}`)])
}

bot.start(async (ctx) => {
  const id = ctx.from.id
  const name = ctx.from.first_name
  await axios.put(`${FIREBASE_DB_URL}/users/${id}.json`, { telegramid: id, first_name: name, date: Date.now() }).catch(() => {})
  const files = await getUserFiles(id)
  const totalUsers = await getTotalUsers()
  await ctx.replyWithHTML(
    `👋 Hello <b>${name}</b>!\nYou have uploaded <b>${files.length}</b> files.\nTotal bot users: <b>${totalUsers}</b>\nSend me files (max 30MB) to upload.`,
    { reply_to_message_id: ctx.message?.message_id }
  )
})

bot.command("ping", async (ctx) => {
  const start = Date.now()
  await ctx.reply("🏓 Ping...")
  const diff = Date.now() - start
  await ctx.reply(`🏓 Pong! Response time: <b>${diff} ms</b>`, { parse_mode: "HTML", reply_to_message_id: ctx.message?.message_id })
})

bot.command("myfiles", async (ctx) => {
  const id = ctx.from.id
  const files = await getUserFiles(id)
  if (!files.length) {
    await ctx.reply("📁 You have no uploaded files.", { reply_to_message_id: ctx.message?.message_id })
    return
  }
  await ctx.replyWithHTML(
    `📁 Your uploaded files (${files.length}):\n\n` + formatFileList(files),
    { disable_web_page_preview: true, reply_to_message_id: ctx.message?.message_id, reply_markup: Markup.inlineKeyboard(buildDeleteButtons(files)) }
  )
})

bot.command("deletefiles", async (ctx) => {
  const id = ctx.from.id
  const files = await getUserFiles(id)
  if (!files.length) {
    await ctx.reply("🗑️ You have no files to delete.", { reply_to_message_id: ctx.message?.message_id })
    return
  }
  for (const f of files) await deleteFile(f.key)
  await ctx.reply("🗑️ All your uploaded file records deleted.", { reply_to_message_id: ctx.message?.message_id })
})

bot.action(/delete_(.+)/, async (ctx) => {
  const key = ctx.match[1]
  const id = ctx.from.id
  const files = await getUserFiles(id)
  if (!files.find(f => f.key === key)) {
    await ctx.answerCbQuery("❌ This file doesn't belong to you or already deleted.", { show_alert: true })
    return
  }
  const ok = await deleteFile(key)
  if (!ok) {
    await ctx.answerCbQuery("❌ Failed to delete file.", { show_alert: true })
    return
  }
  const newFiles = await getUserFiles(id)
  const text = newFiles.length
    ? `🗑️ File deleted. You have ${newFiles.length} files remaining:\n\n` + formatFileList(newFiles)
    : "🗑️ File deleted. You have no uploaded files now."
  const buttons = newFiles.length ? Markup.inlineKeyboard(buildDeleteButtons(newFiles)) : undefined
  await ctx.editMessageText(text, { parse_mode: "HTML", disable_web_page_preview: true, reply_markup: buttons })
  await ctx.answerCbQuery("✅ File deleted.")
})

bot.on(["document", "video", "photo", "sticker", "animation"], async (ctx) => {
  const id = ctx.from.id
  const userFiles = await getUserFiles(id)
  if (userFiles.length >= MAX_FILES_PER_USER) {
    await ctx.reply(`❌ Upload limit reached: max ${MAX_FILES_PER_USER} files. Delete some files first.`, { reply_to_message_id: ctx.message?.message_id })
    return
  }

  let file_id, file_name, file_size
  if (ctx.message.document) {
    file_id = ctx.message.document.file_id
    file_name = ctx.message.document.file_name
    file_size = ctx.message.document.file_size
  } else if (ctx.message.video) {
    file_id = ctx.message.video.file_id
    file_name = "video.mp4"
    file_size = ctx.message.video.file_size
  } else if (ctx.message.photo) {
    const photo = ctx.message.photo.at(-1)
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
  }

  if (file_size > MAX_SIZE) {
    await ctx.reply("❌ File too large. Max size is 30MB.", { reply_to_message_id: ctx.message?.message_id })
    return
  }

  const file = await ctx.telegram.getFile(file_id)
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
  const buffer = (await axios.get(url, { responseType: "arraybuffer" })).data
  const storageId = randomBytes(8).toString("hex")
  const link = `${VERCEL_URL}/upload?id=${storageId}`

  if (!bot.context.storage) bot.context.storage = {}
  bot.context.storage[storageId] = { buffer, name: file_name }

  try {
    await axios.post(`${FIREBASE_DB_URL}/links.json`, {
      link,
      name: ctx.from.first_name,
      id: ctx.from.id,
      time: Date.now()
    })
  } catch {}

  await ctx.reply(`🔗 File uploaded:\n${link}`, {
    reply_to_message_id: ctx.message?.message_id,
    reply_markup: Markup.inlineKeyboard([[Markup.button.url("🔗 Open Link", link)]])
  })
})

app.get("/upload", (req, res) => {
  const id = req.query.id
  if (!id || !bot.context.storage || !bot.context.storage[id]) return res.status(404).send("File not found.")
  const { buffer, name } = bot.context.storage[id]
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`)
  res.setHeader("Content-Type", "application/octet-stream")
  res.send(buffer)
})

app.get("/", (req, res) => res.send("Bot is running."))

app.listen(process.env.PORT || 3000, () => console.log("Server running."))
