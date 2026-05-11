require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const QRCode = require("qrcode");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin12345";
const SESSION_SECRET = process.env.SESSION_SECRET || "qr-attendance-secret-2026";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

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

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 2,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function db() {
  if (!supabase) {
    throw new Error("Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.");
  }

  return supabase;
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
    console.error("Failed to save log:", error.message);
  }
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
    console.error(error);
    return res.status(500).send("Terjadi kesalahan server.");
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

    res.json({
      success: true,
      sessions,
      globalLogs
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Gagal mengambil data monitoring"
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

    res.json({
      success: true,
      session: sessionData
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Gagal mengambil session"
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

    res.json({
      success: true,
      message: "Absen berhasil"
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Absen belum berhasil"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Main page: http://localhost:${PORT}`);
  console.log(`Admin login: http://localhost:${PORT}/admin/login`);
});
