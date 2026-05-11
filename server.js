require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const QRCode = require("qrcode");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin12345";
const SESSION_SECRET = process.env.SESSION_SECRET || "qr-attendance-secret-2026";

const DATA_FILE = path.join(__dirname, "data", "sessions.json");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 2
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function createEmptyData() {
  return {
    sessions: {},
    globalLogs: []
  };
}

function normalizeData(data) {
  if (!data || typeof data !== "object") {
    return createEmptyData();
  }

  if (!data.sessions) {
    return {
      sessions: data,
      globalLogs: []
    };
  }

  if (!Array.isArray(data.globalLogs)) {
    data.globalLogs = [];
  }

  return data;
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(createEmptyData(), null, 2));
    }

    const rawData = fs.readFileSync(DATA_FILE, "utf8");

    if (!rawData.trim()) {
      return createEmptyData();
    }

    return normalizeData(JSON.parse(rawData));
  } catch (error) {
    console.error("Failed to read data:", error.message);
    return createEmptyData();
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Failed to write data:", error.message);
  }
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function createLog({ sessionId, name, status, reason }) {
  return {
    sessionId,
    name,
    status,
    reason,
    time: new Date().toISOString()
  };
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }

  return res.redirect("/admin/login");
}

function requireAdminApi(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: "Unauthorized"
  });
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin/login", (req, res) => {
  if (req.session && req.session.isAdmin === true) {
    return res.redirect("/admin");
  }

  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.post("/admin/login", (req, res) => {
  const password = req.body.password || "";

  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect("/admin");
  }

  return res.redirect("/admin/login?error=1");
});

app.post("/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
});

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});

app.get("/attendance/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const data = readData();
  const sessionData = data.sessions[sessionId];

  if (!sessionData) {
    return res.sendFile(path.join(__dirname, "public", "invalid-qr.html"));
  }

  const qrAlreadyUsed = Boolean(sessionData.usedAt) || sessionData.attendees.length > 0;

  if (qrAlreadyUsed) {
    return res.sendFile(path.join(__dirname, "public", "qr-used.html"));
  }

  return res.sendFile(path.join(__dirname, "public", "attendance.html"));
});

app.get("/thank-you", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "thank-you.html"));
});

app.post("/api/generate-session", async (req, res) => {
  try {
    const data = readData();
    const sessionId = crypto.randomUUID();

    data.sessions[sessionId] = {
      sessionId,
      createdAt: new Date().toISOString(),
      usedAt: null,
      attendees: [],
      logs: []
    };

    writeData(data);

    const attendanceUrl = `${getBaseUrl(req)}/attendance/${sessionId}`;
    const qrCodeDataUrl = await QRCode.toDataURL(attendanceUrl);

    res.json({
      success: true,
      sessionId,
      attendanceUrl,
      qrCodeDataUrl
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Gagal membuat QR Code"
    });
  }
});

app.get("/api/sessions", requireAdminApi, (req, res) => {
  const data = readData();

  const sessions = Object.values(data.sessions).sort((a, b) => {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  res.json({
    success: true,
    sessions,
    globalLogs: data.globalLogs
  });
});

app.get("/api/session/:sessionId", requireAdminApi, (req, res) => {
  const { sessionId } = req.params;
  const data = readData();
  const sessionData = data.sessions[sessionId];

  if (!sessionData) {
    return res.status(404).json({
      success: false,
      message: "Session tidak ditemukan"
    });
  }

  res.json({
    success: true,
    session: sessionData
  });
});

app.post("/api/attendance/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const data = readData();
  const sessionData = data.sessions[sessionId];

  const rawName = req.body.name || "";
  const name = rawName.trim();

  if (!sessionData) {
    const log = createLog({
      sessionId,
      name,
      status: "failed",
      reason: "SessionId tidak valid"
    });

    data.globalLogs.push(log);
    writeData(data);

    return res.json({
      success: false,
      message: "Absen belum berhasil"
    });
  }

  if (!name) {
    const log = createLog({
      sessionId,
      name: rawName,
      status: "failed",
      reason: "Nama kosong"
    });

    sessionData.logs.push(log);
    data.globalLogs.push(log);
    writeData(data);

    return res.json({
      success: false,
      message: "Absen belum berhasil"
    });
  }

  const qrAlreadyUsed = Boolean(sessionData.usedAt) || sessionData.attendees.length > 0;

  if (qrAlreadyUsed) {
    const log = createLog({
      sessionId,
      name,
      status: "failed",
      reason: "QR sudah digunakan"
    });

    sessionData.logs.push(log);
    data.globalLogs.push(log);
    writeData(data);

    return res.json({
      success: false,
      message: "QR ini sudah digunakan untuk absen"
    });
  }

  const attendanceTime = new Date().toISOString();
  const attendee = {
    name,
    time: attendanceTime
  };

  sessionData.attendees.push(attendee);
  sessionData.usedAt = attendanceTime;

  const log = createLog({
    sessionId,
    name,
    status: "success",
    reason: "Absen berhasil"
  });

  sessionData.logs.push(log);
  data.globalLogs.push(log);
  writeData(data);

  res.json({
    success: true,
    message: "Absen berhasil"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Main page: http://localhost:${PORT}`);
  console.log(`Admin login: http://localhost:${PORT}/admin/login`);
});
