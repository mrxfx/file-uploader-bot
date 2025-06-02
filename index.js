import express from "express"
import axios from "axios"
import { Telegraf } from "telegraf"
import { randomBytes } from "crypto"
import { initializeApp } from "firebase/app"
import { getDatabase, ref, set, push, get, remove } from "firebase/database"

const BOT_TOKEN = "7784028733:AAFILq2JCqa1JlgWTpLbs3aHxa13DheuLeY"
const ADMIN_ID = "6918300873"
const FIREBASE_DB_URL = "https://flecdev-efed1-default-rtdb.firebaseio.com"
const MAX_SIZE = 30 * 1024 * 1024
const UPLOAD_LIMIT = 10 

const app = express()
const bot = new Telegraf(BOT_TOKEN)
const firebaseApp = initializeApp({ databaseURL: FIREBASE_DB_URL })
const db = getDatabase(firebaseApp)
const storage = {}

let broadcastMode = false
const userUploadCounts = {}

bot.start(async (ctx) => {
bot.start(async (ctx) => {
  try {
    const user = {
      first_name: ctx.from.first_name || "User",
      telegramid: ctx.from.id,
      username: ctx.from.username || ""
    };

    const userRef = ref(db, "users/" + user.telegramid);
    const snapshot = await get(userRef);

    if (!snapshot.exists()) {
      await set(userRef, user);
      const stat = await get(ref(db, "users"));
      const totalUsers = stat.exists() ? Object.keys(stat.val()).length : 1;

      try {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `➕ <b>New User Notification</b> ➕\n\n👤<b>User:</b> <a href="tg://user?id=${user.telegramid}">${user.first_name}</a>\n\n🆔<b>User ID:</b> <code>${user.telegramid}</code>\n\n🌝 <b>Total Users Count: ${totalUsers}</b>`,
          { parse_mode: "HTML" }
        );
      } catch (adminErr) {
        console.error("Failed to notify admin:", adminErr);
      }
    }

    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const replyId = ctx.message?.message_id || undefined;

    await ctx.replyWithHTML(
      `👋 <b>Welcome <a href="tg://user?id=${user.telegramid}">${user.first_name}</a>!\n\nSend me any file under 30 MB and I'll host it for you. You can optionally send "delete = true <seconds>" to auto-delete the file after that time.</b>`,
      { reply_to_message_id: replyId }
    );
  } catch (err) {
    console.error("Error in /start handler:", err);
  }
});

  const userRef = ref(db, "users/" + user.telegramid)
  const snapshot = await get(userRef)
  if (!snapshot.exists()) {
    await set(userRef, user)
    const stat = await get(ref(db, "users"))
    const totalUsers = stat.exists() ? Object.keys(stat.val()).length : 1
    await bot.telegram.sendMessage(
      ADMIN_ID,
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
    `👋<b>Welcome <a href="tg://user?id=${user.telegramid}">${user.first_name}</a>,\n\nSend me any file under 30 MB and I'll host it for you. You can optionally send "delete = true <seconds>" to auto-delete the file after that time.</b>`,
    { reply_to_message_id: ctx.message.message_id }
  )
})

bot.on(["document", "video", "animation", "photo", "sticker"], async (ctx) => {
  const userId = ctx.from.id.toString()
  userUploadCounts[userId] = userUploadCounts[userId] || { count: 0, timestamp: Date.now() }
  if (Date.now() - userUploadCounts[userId].timestamp > 3600000) {
    userUploadCounts[userId] = { count: 0, timestamp: Date.now() }
  }
  if (userUploadCounts[userId].count >= UPLOAD_LIMIT) {
    await ctx.reply("⚠️ Upload limit reached (10 files per hour). Please try later.", { reply_to_message_id: ctx.message.message_id })
    return
  }

  let file_id, file_name, file_size

  if (ctx.message.document) {
    file_id = ctx.message.document.file_id
    file_name = ctx.message.document.file_name
    file_size = ctx.message.document.file_size
  } else if (ctx.message.video) {
    file_id = ctx.message.video.file_id
    file_name = ctx.message.video.file_name || "video.mp4"
    file_size = ctx.message.video.file_size
  } else if (ctx.message.animation) {
    file_id = ctx.message.animation.file_id
    file_name = ctx.message.animation.file_name || "animation.gif"
    file_size = ctx.message.animation.file_size
  } else if (ctx.message.sticker) {
    file_id = ctx.message.sticker.file_id
    file_name = ctx.message.sticker.file_name || "sticker.webp"
    file_size = ctx.message.sticker.file_size
  } else if (ctx.message.photo) {
    const photo = ctx.message.photo.at(-1)
    file_id = photo.file_id
    file_name = "photo.jpg"
    file_size = photo.file_size
  }

  if (file_size > MAX_SIZE) {
    await ctx.reply("❌ File too large. Only files under 30 MB are allowed.", { reply_to_message_id: ctx.message.message_id })
    return
  }

  const deleteSeconds = (() => {
    const reply = ctx.message.caption || ""
    const match = reply.match(/delete\s*=\s*true\s*(\d+)/i)
    return match ? parseInt(match[1], 10) : 0
  })()

  try {
    const file = await ctx.telegram.getFile(file_id)
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    const buffer = (await axios.get(url, { responseType: "arraybuffer" })).data
    const randomId = randomBytes(8).toString("hex")
    storage[randomId] = { buffer, name: file_name }

    const fileRef = push(ref(db, "files"))
    const expiresAt = deleteSeconds > 0 ? Date.now() + deleteSeconds * 1000 : 0
    await set(fileRef, {
      user_id: userId,
      file_id,
      name: file_name,
      randomId,
      expiresAt
    })

    if (expiresAt > 0) {
      setTimeout(async () => {
        await remove(fileRef)
        delete storage[randomId]
      }, deleteSeconds * 1000)
    }

    userUploadCounts[userId].count++
    const link = `https://image-uploader-bot.vercel.app/upload?id=${randomId}`
    await ctx.reply(`📁 File hosted: ${link}\n${expiresAt > 0 ? `⏳ This file will be deleted in ${deleteSeconds} seconds.` : "🗃️ This file is saved permanently."}`, { reply_to_message_id: ctx.message.message_id })
  } catch (e) {
    await ctx.reply("❌ Error hosting file. Please try again later.", { reply_to_message_id: ctx.message.message_id })
  }
})

bot.command("myfiles", async (ctx) => {
  const userId = ctx.from.id.toString()
  const filesRef = ref(db, "files")
  const snapshot = await get(filesRef)
  if (!snapshot.exists()) {
    await ctx.reply("You have no files uploaded yet.")
    return
  }
  const files = snapshot.val()
  const userFiles = Object.entries(files).filter(([key, file]) => file.user_id === userId)
  if (userFiles.length === 0) {
    await ctx.reply("You have no files uploaded yet.")
    return
  }
  let msg = "🗂️ Your files:\n"
  for (const [key, file] of userFiles) {
    msg += `\n🔹 <a href="https://image-uploader-bot.vercel.app/upload?id=${file.randomId}">${file.name}</a> (Key: ${key})`
  }
  await ctx.replyWithHTML(msg)
})

bot.command("deletefile", async (ctx) => {
  const userId = ctx.from.id.toString()
  const args = ctx.message.text.split(" ").slice(1)
  if (!args.length) {
    await ctx.reply("Usage: /deletefile <file_key>")
    return
  }
  const key = args[0]
  const fileRef = ref(db, "files/" + key)
  const snapshot = await get(fileRef)
  if (!snapshot.exists()) {
    await ctx.reply("File not found.")
    return
  }
  const file = snapshot.val()
  if (file.user_id !== userId && ctx.from.id.toString() !== ADMIN_ID) {
    await ctx.reply("You can only delete your own files.")
    return
  }
  await remove(fileRef)
  if (file.randomId) delete storage[file.randomId]
  await ctx.reply("File deleted successfully.")
})

bot.command("stats", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return
  const usersSnap = await get(ref(db, "users"))
  const filesSnap = await get(ref(db, "files"))
  const usersCount = usersSnap.exists() ? Object.keys(usersSnap.val()).length : 0
  const filesCount = filesSnap.exists() ? Object.keys(filesSnap.val()).length : 0
  await ctx.reply(`📊 Stats:\n\n👥 Total Users: ${usersCount}\n📁 Total Files Hosted: ${filesCount}`)
})

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return
  broadcastMode = true
  await ctx.replyWithHTML("<b>Enter Broadcast Message Here 👇</b>")
})

bot.on("message", async (ctx) => {
  if (broadcastMode && ctx.from.id.toString() === ADMIN_ID) {
    broadcastMode = false
    const usersRef = ref(db, "users")
    const snapshot = await get(usersRef)
    if (snapshot.exists()) {
      const users = snapshot.val()
      for (const uid in users) {
        try {
          await ctx.telegram.copyMessage(uid, ctx.chat.id, ctx.message.message_id)
        } catch {}
      }
    }
  }
})

app.use(bot.webhookCallback("/bot"))

app.get("/upload", (req, res) => {
  const fileId = req.query.id
  if (!fileId || !storage[fileId]) {
    return res.status(404).send("File not found or expired.")
  }
  const file = storage[fileId]
  res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`)
  res.send(file.buffer)
})

app.listen(3000, () => {
  console.log("Bot server running on port 3000")
})

bot.launch()
