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
bot.telegram.setWebhook(`${VERCEL_URL}/`)

const buttonsMain = Markup.inlineKeyboard([
  [Markup.button.callback("📁 My Files", "MY_FILES"), Markup.button.callback("🗑️ Delete Files", "DELETE_FILES")],
  [Markup.button.callback("❓ Help", "HELP"), Markup.button.callback("🏓 Ping", "PING")]
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
  await axios.put(`${FIREBASE_DB_URL}/users/${id}.json`, { telegramid: id, first_name: name, date: Date.now() }).catch(() => {})
  await ctx.reply("👋 Welcome! Use the buttons below to navigate.", {
    reply_to_message_id: ctx.message?.message_id,
    reply_markup: buttonsMain
  })
})

bot.action("HELP", async (ctx) => {
  await ctx.editMessageText(
    `
🤖 <b>Image Uploader Bot Help</b>

📤 Send any file under 30MB to upload and get a permanent URL.
📁 View or delete your files with buttons.
🏓 Use Ping to check bot status.
`,
    { parse_mode: "HTML", reply_markup: buttonsMain }
  )
  await ctx.answerCbQuery()
})

bot.action("PING", async (ctx) => {
  const start = Date.now()
  await ctx.answerCbQuery()
  const msg = await ctx.editMessageText("🏓 Pinging...")
  const latency = Date.now() - start
  await ctx.editMessageText(`🏓 Pong! Latency: <b>${latency} ms</b>`, { parse_mode: "HTML", reply_markup: buttonsMain })
})

bot.action("MY_FILES", async (ctx) => {
  await ctx.answerCbQuery()
  const id = ctx.from.id
  const userLinks = await getUserLinks(id)
  if (userLinks.length === 0) {
    await ctx.editMessageText("📁 You have no uploaded files.", { reply_markup: buttonsMain })
    return
  }
  const lines = userLinks.map(([key, val], i) => `${i + 1}. ${val.link}`)
  const txtContent = lines.join("\n")
  const buffer = Buffer.from(txtContent, "utf-8")
  await ctx.editMessageText(`📁 You have <b>${userLinks.length}</b> uploaded files. Use buttons below to manage.`, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard(
      userLinks.map(([key], i) => [Markup.button.callback(`❌ Delete #${i + 1}`, `DEL_${key}`)])
      .concat([[Markup.button.callback("⬅️ Back", "BACK")]])
    )
  })
  ctx.session.userFileBuffer = buffer
})

bot.action(/^DEL_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery()
  const fileKey = ctx.match[1]
  const id = ctx.from.id
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/links/${fileKey}.json`)
    if (!res.data || res.data.id !== id) {
      await ctx.answerCbQuery("❌ You cannot delete this file.", { show_alert: true })
      return
    }
    await axios.delete(`${FIREBASE_DB_URL}/links/${fileKey}.json`)
    await ctx.editMessageText("🗑️ File deleted.", { reply_markup: buttonsMain })
  } catch {
    await ctx.answerCbQuery("❌ Error deleting file.", { show_alert: true })
  }
})

bot.action("DELETE_FILES", async (ctx) => {
  await ctx.answerCbQuery()
  const id = ctx.from.id
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/links.json`)
    const allLinks = res.data || {}
    const deletions = Object.entries(allLinks)
      .filter(([, v]) => v.id === id)
      .map(([key]) => axios.delete(`${FIREBASE_DB_URL}/links/${key}.json`))
    await Promise.all(deletions)
    await ctx.editMessageText("🗑️ All your files deleted.", { reply_markup: buttonsMain })
  } catch {
    await ctx.answerCbQuery("❌ Failed to delete files.", { show_alert: true })
  }
})

bot.action("BACK", async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.editMessageText("👋 Welcome! Use the buttons below to navigate.", { reply_markup: buttonsMain })
})

bot.command("myfiles", async (ctx) => {
  const id = ctx.from.id
  const userLinks = await getUserLinks(id)
  if (userLinks.length === 0) {
    await ctx.reply("📁 You have no uploaded files yet.", { reply_to_message_id: ctx.message?.message_id })
    return
  }
  const lines = userLinks.map(([, v], i) => `${i + 1}. ${v.link}`)
  const txtContent = lines.join("\n")
  const buffer = Buffer.from(txtContent, "utf-8")
  await ctx.replyWithDocument({ source: buffer, filename: "my_uploaded_files.txt" }, {
    caption: `📁 Your Uploaded Files (${userLinks.length} total)`,
    parse_mode: "HTML",
    reply_to_message_id: ctx.message?.message_id
  })
})

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return
  ctx.session.broadcast = true
  await ctx.reply("📢 Send the broadcast message or media now.", { reply_to_message_id: ctx.message?.message_id })
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
      await ctx.reply("✅ Broadcast sent to all users.", { reply_to_message_id: ctx.message?.message_id })
    } catch {
      await ctx.reply("❌ Failed to send broadcast.", { reply_to_message_id: ctx.message?.message_id })
    }
  } else {
    await next()
  }
})

bot.on(["document", "video", "photo", "sticker", "animation"], async (ctx) => {
  const id = ctx.from.id
  const userLinks = await getUserLinks(id)
  if (userLinks.length >= MAX_FILES_PER_USER) {
    await ctx.reply(`❌ Max upload limit (${MAX_FILES_PER_USER}) reached.`, { reply_to_message_id: ctx.message?.message_id })
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
    await ctx.reply("❌ File too large. Only files under 30 MB allowed.", { reply_to_message_id: ctx.message?.message_id })
    return
  }

  const file = await ctx.telegram.getFile(file_id)
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
  const buffer = (await axios.get(url, { responseType: 'arraybuffer' })).data
  const key = randomBytes(5).toString("hex")
  await axios.put(`${FIREBASE_DB_URL}/links/${key}.json`, {
    id,
    link: `${VERCEL_URL}/upload?id=${key}`,
    name: file_name,
    date: Date.now()
  }).catch(() => {})

  ctx.session.storage = ctx.session.storage || {}
  ctx.session.storage[key] = { buffer, name: file_name }

  await ctx.reply(`✅ File uploaded!\n🔗 [Open Link](${VERCEL_URL}/upload?id=${key})`, {
    parse_mode: "Markdown",
    reply_to_message_id: ctx.message?.message_id,
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.url("🔗 Open Link", `${VERCEL_URL}/upload?id=${key}`)]
    ])
  })
})

app.get("/upload", (req, res) => {
  const id = req.query.id
  if (!id) return res.status(404).send("File not found.")
  axios.get(`${FIREBASE_DB_URL}/links/${id}.json`).then(({ data }) => {
    if (!data) return res.status(404).send("File not found.")
    const { name } = data
    if (!bot.session?.storage || !bot.session.storage[id]) {
      return res.status(404).send("File buffer not found in session.")
    }
    const { buffer } = bot.session.storage[id]
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`)
    res.setHeader("Content-Type", "application/octet-stream")
    res.send(buffer)
  }).catch(() => res.status(404).send("File not found."))
})

app.get("/", (req, res) => res.send("Bot is running."))

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running.")
})
app.get("/webhook", async (req, res) => {
  try {
    await bot.telegram.setWebhook(`${VERCEL_URL}`);
    res.json({ status: "success", message: "Webhook set to " + `${VERCEL_URL}/` });
  } catch (e) {
    res.json({ status: "error", message: e.message || e.toString() });
  }
});
bot.launch()
