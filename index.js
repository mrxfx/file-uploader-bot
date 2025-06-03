import express from "express"
import axios from "axios"
import { Telegraf, session, Markup } from "telegraf"
import { randomBytes } from "crypto"
import bodyParser from "body-parser"

const BOT_TOKEN = "7784028733:AAHANG4AtqTcXhOSHtUT1x0_9q0XX98ultg"
const VERCEL_URL = "https://image-uploader-bot.vercel.app"
const FIREBASE_DB_URL = "https://flecdev-efed1-default-rtdb.firebaseio.com"
const ADMIN_ID = "7320532917"
const MAX_SIZE = 30 * 1024 * 1024
const MAX_FILES_PER_USER = 50

const bot = new Telegraf(BOT_TOKEN)
const app = express()
app.use(bodyParser.json())
bot.use(session())

const buttonsMain = Markup.inlineKeyboard([
  [Markup.button.callback("\ud83d\udcc1 My Files", "MY_FILES"), Markup.button.callback("\ud83d\uddd1\ufe0f Delete Files", "DELETE_FILES")],
  [Markup.button.callback("\u2753 Help", "HELP"), Markup.button.callback("\ud83c\udfd3 Ping", "PING")]
])

async function getUserLinks(userId) {
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/links.json`)
    const allLinks = res.data || {}
    return Object.entries(allLinks).filter(([, v]) => v.id === userId)
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

bot.start(async (ctx) => {
  const id = ctx.from.id
  const name = ctx.from.first_name
  const existing = await axios.get(`${FIREBASE_DB_URL}/users/${id}.json`).then(res => res.data).catch(() => null)
  await axios.put(`${FIREBASE_DB_URL}/users/${id}.json`, { telegramid: id, first_name: name, date: Date.now() })
  await ctx.reply("\ud83d\udc4b Welcome! Use the buttons below to navigate.", {
    reply_to_message_id: ctx.message?.message_id,
    reply_markup: buttonsMain
  })
  if (!existing) {
    const totalUsers = await getTotalUsers()
    await ctx.telegram.sendMessage(ADMIN_ID, `\u2795 <b>New User Notification</b> \u2795\n\n\ud83d\udc64<b>User:</b> <a href=\"tg://user?id=${id}\">${name}</a>\n\n\ud83c\udd94<b>User ID:</b> <code>${id}</code>\n\n\ud83c\udf1d <b>Total Users Count: ${totalUsers}</b>`, { parse_mode: "HTML" })
  }
  const webhook = await axios.get(`${FIREBASE_DB_URL}/webhook.json`).then(res => res.data).catch(() => null)
  if (webhook) await axios.delete(`${FIREBASE_DB_URL}/webhook.json`).catch(() => {})
})

app.post("/", async (req, res) => {
  bot.handleUpdate(req.body)
  res.sendStatus(200)
})

app.post("/webhook", async (req, res) => {
  await axios.put(`${FIREBASE_DB_URL}/webhook.json`, req.body)
  res.json({ success: true, received: req.body })
})

bot.action("HELP", async (ctx) => {
  await ctx.editMessageText(`\n\ud83e\udd16 <b>Image Uploader Bot Help</b>\n\n\ud83d\uDCC4 Send any file under 30MB to upload and get a permanent URL.\n\ud83d\udcc1 View or delete your files with buttons.\n\ud83c\udfd3 Use Ping to check bot status.`, { parse_mode: "HTML", reply_markup: buttonsMain })
  await ctx.answerCbQuery()
})

bot.action("PING", async (ctx) => {
  const start = Date.now()
  await ctx.answerCbQuery()
  await ctx.editMessageText("\ud83c\udfd3 Pinging...")
  const latency = Date.now() - start
  await ctx.editMessageText(`\ud83c\udfd3 Pong! Latency: <b>${latency} ms</b>`, { parse_mode: "HTML", reply_markup: buttonsMain })
})

bot.action("MY_FILES", async (ctx) => {
  await ctx.answerCbQuery()
  const id = ctx.from.id
  const userLinks = await getUserLinks(id)
  if (userLinks.length === 0) {
    await ctx.editMessageText("\ud83d\udcc1 You have no uploaded files.", { reply_markup: buttonsMain })
    return
  }
  const lines = userLinks.map(([key, val], i) => `${i + 1}. ${val.link}`)
  const buffer = Buffer.from(lines.join("\n"), "utf-8")
  await ctx.editMessageText(`\ud83d\udcc1 You have <b>${userLinks.length}</b> uploaded files. Use buttons below to manage.`, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard(
      userLinks.map(([key], i) => [Markup.button.callback(`\u274c Delete #${i + 1}`, `DEL_${key}`)]).concat([[Markup.button.callback("\u2b05\ufe0f Back", "BACK")]])
    )
  })
  ctx.session.userFileBuffer = buffer
})

bot.action(/^DEL_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery()
  const fileKey = ctx.match[1]
  const id = ctx.from.id
  const res = await axios.get(`${FIREBASE_DB_URL}/links/${fileKey}.json`).then(r => r.data).catch(() => null)
  if (!res || res.id !== id) {
    await ctx.answerCbQuery("\u274c You cannot delete this file.", { show_alert: true })
    return
  }
  await axios.delete(`${FIREBASE_DB_URL}/links/${fileKey}.json`)
  await ctx.editMessageText("\ud83d\uddd1\ufe0f File deleted.", { reply_markup: buttonsMain })
})

bot.action("DELETE_FILES", async (ctx) => {
  await ctx.answerCbQuery()
  const id = ctx.from.id
  const res = await axios.get(`${FIREBASE_DB_URL}/links.json`).then(r => r.data).catch(() => ({}))
  const deletions = Object.entries(res).filter(([, v]) => v.id === id).map(([key]) => axios.delete(`${FIREBASE_DB_URL}/links/${key}.json`))
  await Promise.all(deletions)
  await ctx.editMessageText("\ud83d\uddd1\ufe0f All your files deleted.", { reply_markup: buttonsMain })
})

bot.action("BACK", async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.editMessageText("\ud83d\udc4b Welcome! Use the buttons below to navigate.", { reply_markup: buttonsMain })
})

bot.launch()

export default app
