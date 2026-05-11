const refreshBtn = document.getElementById("refreshBtn");
const totalSessions = document.getElementById("totalSessions");
const sessionSelect = document.getElementById("sessionSelect");
const emptySessionMessage = document.getElementById("emptySessionMessage");

const summarySection = document.getElementById("summarySection");
const sessionIdText = document.getElementById("sessionIdText");
const createdAtText = document.getElementById("createdAtText");
const qrStatusText = document.getElementById("qrStatusText");
const totalAttendance = document.getElementById("totalAttendance");

const attendeesTable = document.getElementById("attendeesTable");
const sessionLogsTable = document.getElementById("sessionLogsTable");
const globalLogsTable = document.getElementById("globalLogsTable");

let allSessions = [];
let selectedSessionId = null;

refreshBtn.addEventListener("click", loadMonitoringData);

sessionSelect.addEventListener("change", () => {
  selectedSessionId = sessionSelect.value;
  renderSelectedSession();
});

loadMonitoringData();
setInterval(loadMonitoringData, 3000);

async function loadMonitoringData() {
  try {
    const response = await fetch("/api/sessions");

    if (response.status === 401) {
      window.location.href = "/admin/login";
      return;
    }

    const result = await response.json();

    if (!result.success) {
      return;
    }

    allSessions = result.sessions;

    if (!selectedSessionId && allSessions.length > 0) {
      selectedSessionId = allSessions[0].sessionId;
    }

    if (selectedSessionId) {
      const stillExists = allSessions.some((session) => {
        return session.sessionId === selectedSessionId;
      });

      if (!stillExists && allSessions.length > 0) {
        selectedSessionId = allSessions[0].sessionId;
      }
    }

    renderSessionOptions();
    renderSelectedSession();
    renderGlobalLogs(result.globalLogs);
  } catch (error) {
    console.error("Gagal mengambil data monitoring:", error);
  }
}

function renderSessionOptions() {
  totalSessions.textContent = allSessions.length;
  sessionSelect.innerHTML = "";

  if (allSessions.length === 0) {
    emptySessionMessage.textContent = "Belum ada session absensi.";
    summarySection.classList.add("hidden");
    return;
  }

  emptySessionMessage.textContent = "";

  allSessions.forEach((session) => {
    const option = document.createElement("option");
    option.value = session.sessionId;
    option.textContent = `${session.sessionId} - ${formatDate(session.createdAt)}`;

    if (session.sessionId === selectedSessionId) {
      option.selected = true;
    }

    sessionSelect.appendChild(option);
  });
}

function renderSelectedSession() {
  const session = allSessions.find((item) => {
    return item.sessionId === selectedSessionId;
  });

  if (!session) {
    summarySection.classList.add("hidden");
    return;
  }

  summarySection.classList.remove("hidden");

  const qrAlreadyUsed = Boolean(session.usedAt) || session.attendees.length > 0;

  sessionIdText.textContent = session.sessionId;
  createdAtText.textContent = formatDate(session.createdAt);
  qrStatusText.textContent = qrAlreadyUsed ? "Sudah digunakan" : "Belum digunakan";
  totalAttendance.textContent = session.attendees.length;

  attendeesTable.innerHTML = "";

  session.attendees.forEach((attendee, index) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(attendee.name)}</td>
      <td>${formatDate(attendee.time)}</td>
    `;

    attendeesTable.appendChild(row);
  });

  sessionLogsTable.innerHTML = "";

  session.logs.forEach((log, index) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(log.name || "-")}</td>
      <td>${escapeHtml(log.status)}</td>
      <td>${escapeHtml(log.reason)}</td>
      <td>${formatDate(log.time)}</td>
    `;

    sessionLogsTable.appendChild(row);
  });
}

function renderGlobalLogs(logs) {
  globalLogsTable.innerHTML = "";

  const orderedLogs = [...logs].reverse();

  orderedLogs.forEach((log, index) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(log.sessionId || "-")}</td>
      <td>${escapeHtml(log.name || "-")}</td>
      <td>${escapeHtml(log.status)}</td>
      <td>${escapeHtml(log.reason)}</td>
      <td>${formatDate(log.time)}</td>
    `;

    globalLogsTable.appendChild(row);
  });
}

function formatDate(isoString) {
  if (!isoString) {
    return "-";
  }

  return new Date(isoString).toLocaleString("id-ID");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
