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
const storage = {}

app.use(bodyParser.json())
app.use(bot.webhookCallback("/"))
bot.use(session())

bot.telegram.setWebhook(`${VERCEL_URL}/`)

async function getUserLinks(userId) {
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/links.json`)
    const allLinks = res.data || {}
    return Object.values(allLinks).filter(l => l.id === userId)
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
  const userData = { telegramid: id, first_name: name, date: Date.now() }

  try {
    await axios.put(`${FIREBASE_DB_URL}/users/${id}.json`, userData)
  } catch {}

  const totalUsers = await getTotalUsers()
  const userLinks = await getUserLinks(id)
  const welcomeMsg = userLinks.length > 0
    ? `👋 Welcome back, <b>${name}</b>!\n\nYou have already uploaded <b>${userLinks.length}</b> files.\n\nUse /myfiles to get all your file links or /deletefiles to delete them.`
    : `👋 Welcome, <b>${name}</b>!\n\nSend me any file (up to 30MB), and I'll host it for free.\n\nYou can manage your files with /myfiles and /deletefiles.`

  await ctx.replyWithHTML(welcomeMsg, {
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback("📁 My Files", "MY_FILES"), Markup.button.callback("🗑️ Delete Files", "DELETE_FILES")]
    ])
  })
})

bot.command("help", async (ctx) => {
  const helpText = `
🤖 <b>Image Uploader Bot Help</b>

📤 Send any file under 30MB to upload and get a permanent URL.
📁 /myfiles - Get all your uploaded file URLs in a TXT file.
🗑️ /deletefiles - Delete all your uploaded file records.
📊 /stats - View your stats and total users.
📢 /broadcast - Admin only: Send broadcast message to all users.
🏓 /ping - Check if bot is alive.

Use the buttons below for quick actions.
`
  await ctx.replyWithHTML(helpText, Markup.inlineKeyboard([
    [Markup.button.callback("📁 My Files", "MY_FILES"), Markup.button.callback("🗑️ Delete Files", "DELETE_FILES")]
  ]))
})

bot.command("stats", async (ctx) => {
  const id = ctx.from.id
  const userLinks = await getUserLinks(id)
  const totalUsers = await getTotalUsers()
  await ctx.replyWithHTML(
    `📊 <b>Your Stats</b>\n\n👤 User: <a href="tg://user?id=${id}">${ctx.from.first_name}</a>\n🗂️ Total Uploaded Files: <b>${userLinks.length}</b>\n🌍 Total Bot Users: <b>${totalUsers}</b>`
  )
})

bot.command("myfiles", async (ctx) => {
  const id = ctx.from.id
  const userLinks = await getUserLinks(id)

  if (userLinks.length === 0) {
    await ctx.reply("📁 You have no uploaded files yet.")
    return
  }

  const lines = userLinks.map((l, i) => `${i + 1}. ${l.link}`)
  const txtContent = lines.join("\n")
  const buffer = Buffer.from(txtContent, "utf-8")

  await ctx.replyWithDocument({ source: buffer, filename: "my_uploaded_files.txt" }, {
    caption: `📁 <b>Your Uploaded Files (${userLinks.length} total)</b>`,
    parse_mode: "HTML"
  })
})

bot.command("deletefiles", async (ctx) => {
  const id = ctx.from.id
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/links.json`)
    const allLinks = res.data || {}

    for (const key in allLinks) {
      if (allLinks[key].id === id) {
        await axios.delete(`${FIREBASE_DB_URL}/links/${key}.json`)
      }
    }
    await ctx.reply("🗑️ All your uploaded file records have been deleted.")
  } catch {
    await ctx.reply("❌ Failed to delete your files, please try again later.")
  }
})

bot.action("MY_FILES", async (ctx) => {
  await ctx.answerCbQuery()
  ctx.message = ctx.update.callback_query.message
  ctx.from = ctx.update.callback_query.from
  await bot.handleUpdate({ message: ctx.message, from: ctx.from, update_id: ctx.update.update_id }, "myfiles")
})

bot.action("DELETE_FILES", async (ctx) => {
  await ctx.answerCbQuery()
  ctx.message = ctx.update.callback_query.message
  ctx.from = ctx.update.callback_query.from
  await bot.handleUpdate({ message: ctx.message, from: ctx.from, update_id: ctx.update.update_id }, "deletefiles")
})

bot.command("ping", async (ctx) => {
  await ctx.reply("🏓 Pong!")
})

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return
  ctx.session.broadcast = true
  await ctx.reply("📢 <b>Send the broadcast message or media now.</b>", { parse_mode: "HTML" })
})

bot.on("message", async (ctx, next) => {
  if (ctx.session.broadcast && ctx.from.id.toString() === ADMIN_ID) {
    ctx.session.broadcast = false
    try {
      const res = await axios.get(`${FIREBASE_DB_URL}/users.json`)
      const users = res.data || {}
      for (const uid of Object.keys(users)) {
        try {
          await ctx.copyMessage(uid, ctx.chat.id, ctx.message.message_id)
        } catch {}
      }
      await ctx.reply("✅ Broadcast sent to all users.")
    } catch {
      await ctx.reply("❌ Failed to send broadcast.")
    }
  } else {
    await next()
  }
})

bot.on(["document", "video", "photo", "sticker", "animation"], async (ctx) => {
  const id = ctx.from.id
  const userLinks = await getUserLinks(id)
  if (userLinks.length >= MAX_FILES_PER_USER) {
    await ctx.reply(`❌ You have reached the maximum upload limit of ${MAX_FILES_PER_USER} files.`)
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
    await ctx.reply("❌ File too large. Only files under 30 MB are allowed.", { reply_to_message_id: ctx.message.message_id })
    return
  }

  const file = await ctx.telegram.getFile(file_id)
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
  const buffer = (await axios.get(url, { responseType: 'arraybuffer' })).data
  const storageId = randomBytes(8).toString("hex")
  storage[storageId] = { buffer, name: file_name }
  const link = `${VERCEL_URL}/upload?id=${storageId}`

  try {
    await axios.post(`${FIREBASE_DB_URL}/links.json`, {
      link,
      name: ctx.from.first_name,
      id: ctx.from.id,
      time: Date.now()
    })
  } catch {}

  await ctx.reply(`🔗 Your file is hosted here:\n${link}`, { reply_to_message_id: ctx.message.message_id })
})

app.get("/webhook", (req, res) => {
  res.json({ status: "Webhook is live ✅" })
})

app.get("/upload", (req, res) => {
  const file = storage[req.query.id]
  if (!file) return res.status(404).send("File not found")
  res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`)
  res.send(file.buffer)
})

export default app
