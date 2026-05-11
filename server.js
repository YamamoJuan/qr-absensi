require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "kasming";
const SESSION_SECRET = process.env.SESSION_SECRET || "qr-attendance-secret-2026-change-this";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function db() {
  if (!supabase) {
    throw new Error("Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di Vercel Environment Variables.");
  }

  return supabase;
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split("=");
    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
}

function signToken(payload) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
}

function createAdminToken() {
  const timestamp = String(Date.now());
  const signature = signToken(timestamp);
  return `${timestamp}.${signature}`;
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function verifyAdminToken(token) {
  if (!token || !token.includes(".")) {
    return false;
  }

  const [timestamp, signature] = token.split(".");
  const createdAt = Number(timestamp);

  if (!createdAt || Number.isNaN(createdAt)) {
    return false;
  }

  const maxAgeMs = 1000 * 60 * 60 * 2;
  const isExpired = Date.now() - createdAt > maxAgeMs;

  if (isExpired) {
    return false;
  }

  const expectedSignature = signToken(timestamp);
  return safeEqual(signature, expectedSignature);
}

function setAdminCookie(res) {
  const token = createAdminToken();
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `admin_auth=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200${secureFlag}`
  );
}

function clearAdminCookie(res) {
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `admin_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`
  );
}

function isAdmin(req) {
  const token = getCookie(req, "admin_auth");
  return verifyAdminToken(token);
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) {
    return next();
  }

  return res.redirect("/admin/login");
}

function requireAdminApi(req, res, next) {
  if (isAdmin(req)) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: "Unauthorized"
  });
}

function mapSessionRow(sessionRow) {
  return {
    sessionId: sessionRow.id,
    createdAt: sessionRow.created_at,
    usedAt: sessionRow.used_at,
    attendees: [],
    logs: []
  };
}

function mapAttendeeRow(attendeeRow) {
  return {
    name: attendeeRow.name,
    time: attendeeRow.attended_at
  };
}

function mapLogRow(logRow) {
  return {
    sessionId: logRow.session_id,
    name: logRow.name,
    status: logRow.status,
    reason: logRow.reason,
    time: logRow.created_at
  };
}

async function saveLog({ sessionId, name, status, reason, time }) {
  try {
    const { error } = await db()
      .from("attendance_logs")
      .insert({
        session_id: sessionId || null,
        name: name || null,
        status,
        reason,
        created_at: time || new Date().toISOString()
      });

    if (error) {
      console.error("SAVE_LOG_ERROR", error);
    }
  } catch (error) {
    console.error("SAVE_LOG_FATAL", error);
  }
}

function getEnvStatus() {
  return {
    NODE_ENV: process.env.NODE_ENV || null,
    ADMIN_PASSWORD_EXISTS: Boolean(process.env.ADMIN_PASSWORD),
    SESSION_SECRET_EXISTS: Boolean(process.env.SESSION_SECRET),

    SUPABASE_URL_EXISTS: Boolean(process.env.SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_URL_EXISTS: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    VITE_SUPABASE_URL_EXISTS: Boolean(process.env.VITE_SUPABASE_URL),

    SUPABASE_SERVICE_ROLE_KEY_EXISTS: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_SECRET_KEY_EXISTS: Boolean(process.env.SUPABASE_SECRET_KEY),
    SUPABASE_SERVICE_KEY_EXISTS: Boolean(process.env.SUPABASE_SERVICE_KEY),

    SUPABASE_ANON_KEY_EXISTS_BUT_NOT_USED: Boolean(process.env.SUPABASE_ANON_KEY),

    resolvedSupabaseUrl: Boolean(SUPABASE_URL),
    resolvedSupabaseServerKey: Boolean(SUPABASE_SERVICE_ROLE_KEY)
  };
}

async function databaseDebugHandler(req, res) {
  const envStatus = getEnvStatus();

  if (!supabase) {
    return res.status(500).json({
      success: false,
      message: "Supabase env belum kebaca oleh Vercel runtime.",
      envStatus,
      fix: [
        "Pastikan env ada di Vercel Project Settings.",
        "Nama wajib: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.",
        "Pastikan dicentang untuk Production.",
        "Redeploy setelah env ditambahkan."
      ]
    });
  }

  try {
    const sessionsCheck = await db()
      .from("attendance_sessions")
      .select("id, created_at, used_at")
      .limit(1);

    if (sessionsCheck.error) {
      return res.status(500).json({
        success: false,
        message: "Supabase connect, tapi tabel belum siap / query gagal.",
        envStatus,
        supabaseError: {
          message: sessionsCheck.error.message,
          code: sessionsCheck.error.code || null,
          details: sessionsCheck.error.details || null,
          hint: sessionsCheck.error.hint || null
        }
      });
    }

    return res.json({
      success: true,
      message: "Supabase connected dan tabel attendance_sessions bisa dibaca.",
      envStatus,
      sampleRows: sessionsCheck.data || []
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Database debug gagal.",
      envStatus,
      error: {
        message: error.message
      }
    });
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin/login", (req, res) => {
  if (isAdmin(req)) {
    return res.redirect("/admin");
  }

  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.post("/admin/login", (req, res) => {
  const password = req.body.password || "";

  if (password === ADMIN_PASSWORD) {
    setAdminCookie(res);
    return res.redirect("/admin");
  }

  clearAdminCookie(res);
  return res.redirect("/admin/login?error=1");
});

app.post("/admin/logout", (req, res) => {
  clearAdminCookie(res);
  return res.redirect("/admin/login");
});

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});

app.get(["/api/debug/database", "/api/debug/supabase"], databaseDebugHandler);

app.get("/attendance/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!isUuid(sessionId)) {
      return res.sendFile(path.join(__dirname, "public", "invalid-qr.html"));
    }

    const { data: sessionData, error } = await db()
      .from("attendance_sessions")
      .select("id, used_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!sessionData) {
      return res.sendFile(path.join(__dirname, "public", "invalid-qr.html"));
    }

    if (sessionData.used_at) {
      return res.sendFile(path.join(__dirname, "public", "qr-used.html"));
    }

    return res.sendFile(path.join(__dirname, "public", "attendance.html"));
  } catch (error) {
    console.error("ATTENDANCE_PAGE_ERROR", error);

    return res.status(500).send(`
      <h1>Terjadi kesalahan server</h1>
      <p>${error.message}</p>
      <p>Cek /api/debug/database untuk detail koneksi Supabase.</p>
    `);
  }
});

app.get("/thank-you", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "thank-you.html"));
});

app.post("/api/generate-session", async (req, res) => {
  try {
    const sessionId = crypto.randomUUID();

    const { error } = await db()
      .from("attendance_sessions")
      .insert({ id: sessionId });

    if (error) {
      throw error;
    }

    const attendanceUrl = `${getBaseUrl(req)}/attendance/${sessionId}`;
    const qrCodeDataUrl = await QRCode.toDataURL(attendanceUrl);

    return res.json({
      success: true,
      sessionId,
      attendanceUrl,
      qrCodeDataUrl
    });
  } catch (error) {
    console.error("GENERATE_SESSION_ERROR", {
      message: error.message,
      code: error.code || null,
      details: error.details || null,
      hint: error.hint || null
    });

    return res.status(500).json({
      success: false,
      message: "Gagal membuat QR Code",
      error: {
        message: error.message,
        code: error.code || null,
        details: error.details || null,
        hint: error.hint || null
      }
    });
  }
});

app.get("/api/sessions", requireAdminApi, async (req, res) => {
  try {
    const [sessionsResult, attendeesResult, logsResult] = await Promise.all([
      db()
        .from("attendance_sessions")
        .select("id, created_at, used_at")
        .order("created_at", { ascending: false }),
      db()
        .from("attendance_records")
        .select("session_id, name, attended_at")
        .order("attended_at", { ascending: true }),
      db()
        .from("attendance_logs")
        .select("session_id, name, status, reason, created_at")
        .order("created_at", { ascending: true })
    ]);

    if (sessionsResult.error) throw sessionsResult.error;
    if (attendeesResult.error) throw attendeesResult.error;
    if (logsResult.error) throw logsResult.error;

    const sessionMap = new Map();

    const sessions = (sessionsResult.data || []).map((sessionRow) => {
      const mappedSession = mapSessionRow(sessionRow);
      sessionMap.set(mappedSession.sessionId, mappedSession);
      return mappedSession;
    });

    (attendeesResult.data || []).forEach((attendeeRow) => {
      const sessionData = sessionMap.get(attendeeRow.session_id);
      if (sessionData) {
        sessionData.attendees.push(mapAttendeeRow(attendeeRow));
      }
    });

    const globalLogs = (logsResult.data || []).map(mapLogRow);

    globalLogs.forEach((log) => {
      const sessionData = sessionMap.get(log.sessionId);
      if (sessionData) {
        sessionData.logs.push(log);
      }
    });

    return res.json({
      success: true,
      sessions,
      globalLogs
    });
  } catch (error) {
    console.error("GET_SESSIONS_ERROR", error);

    return res.status(500).json({
      success: false,
      message: "Gagal mengambil data monitoring",
      error: {
        message: error.message
      }
    });
  }
});

app.get("/api/session/:sessionId", requireAdminApi, async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!isUuid(sessionId)) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan"
      });
    }

    const { data: sessionRow, error: sessionError } = await db()
      .from("attendance_sessions")
      .select("id, created_at, used_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;

    if (!sessionRow) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan"
      });
    }

    const [{ data: attendees, error: attendeesError }, { data: logs, error: logsError }] = await Promise.all([
      db()
        .from("attendance_records")
        .select("name, attended_at")
        .eq("session_id", sessionId)
        .order("attended_at", { ascending: true }),
      db()
        .from("attendance_logs")
        .select("session_id, name, status, reason, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
    ]);

    if (attendeesError) throw attendeesError;
    if (logsError) throw logsError;

    const sessionData = mapSessionRow(sessionRow);
    sessionData.attendees = (attendees || []).map(mapAttendeeRow);
    sessionData.logs = (logs || []).map(mapLogRow);

    return res.json({
      success: true,
      session: sessionData
    });
  } catch (error) {
    console.error("GET_SESSION_DETAIL_ERROR", error);

    return res.status(500).json({
      success: false,
      message: "Gagal mengambil session",
      error: {
        message: error.message
      }
    });
  }
});

app.post("/api/attendance/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const rawName = req.body.name || "";
  const name = rawName.trim();

  try {
    if (!isUuid(sessionId)) {
      await saveLog({
        sessionId,
        name,
        status: "failed",
        reason: "SessionId tidak valid"
      });

      return res.json({
        success: false,
        message: "Absen belum berhasil"
      });
    }

    if (!name) {
      await saveLog({
        sessionId,
        name: rawName,
        status: "failed",
        reason: "Nama kosong"
      });

      return res.json({
        success: false,
        message: "Absen belum berhasil"
      });
    }

    const { data: result, error } = await db()
      .rpc("mark_attendance_once", {
        p_session_id: sessionId,
        p_name: name
      })
      .single();

    if (error) {
      throw error;
    }

    if (!result.success) {
      const reason = result.message === "QR ini sudah digunakan untuk absen"
        ? "QR sudah digunakan"
        : "SessionId tidak valid";

      await saveLog({
        sessionId,
        name,
        status: "failed",
        reason
      });

      return res.json({
        success: false,
        message: result.message || "Absen belum berhasil"
      });
    }

    await saveLog({
      sessionId,
      name,
      status: "success",
      reason: "Absen berhasil",
      time: result.attended_at
    });

    return res.json({
      success: true,
      message: "Absen berhasil"
    });
  } catch (error) {
    console.error("ATTENDANCE_SUBMIT_ERROR", {
      message: error.message,
      code: error.code || null,
      details: error.details || null,
      hint: error.hint || null
    });

    return res.status(500).json({
      success: false,
      message: "Absen belum berhasil",
      error: {
        message: error.message,
        code: error.code || null,
        details: error.details || null,
        hint: error.hint || null
      }
    });
  }
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Main page: http://localhost:${PORT}`);
    console.log(`Admin login: http://localhost:${PORT}/admin/login`);
  });
}

module.exports = app;
